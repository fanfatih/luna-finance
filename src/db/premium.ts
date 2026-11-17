import type { Db } from './adapter'
import { uid } from './finance'
import { addDays, diffDays } from '@/lib/date'
import { cleanPhone } from '@/lib/phone'

const now = (): number => Date.now()

/* ---------- Status langganan ---------- */

export type SubStatus = 'aktif' | 'hampir-habis' | 'habis'

export function daysLeft(endDate: string, today: string): number {
  return diffDays(today, endDate)
}

export function subStatus(endDate: string, today: string, warnDays: number): SubStatus {
  const left = daysLeft(endDate, today)
  if (left < 0) return 'habis'
  if (left <= warnDays) return 'hampir-habis'
  return 'aktif'
}

/* ---------- Produk & varian ---------- */

export interface Variant {
  id: string
  product_id: string
  name: string
  duration_days: number
  price: number
}

export interface Product {
  id: string
  name: string
  has_account: number
  has_team: number
  team_capacity: number | null
  variants: Variant[]
}

export async function listProducts(db: Db): Promise<Product[]> {
  const products = await db.all<Omit<Product, 'variants'>>(
    `SELECT id, name, has_account, has_team, team_capacity FROM products WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  )
  const variants = await db.all<Variant>(
    `SELECT id, product_id, name, duration_days, price FROM product_variants WHERE deleted_at IS NULL ORDER BY duration_days, price`,
  )
  return products.map((p) => ({ ...p, variants: variants.filter((v) => v.product_id === p.id) }))
}

export interface ProductInput {
  name: string
  hasAccount: boolean
  hasTeam: boolean
  teamCapacity: number | null
}

export async function saveProduct(db: Db, input: ProductInput, id?: string): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new Error('Nama aplikasi wajib diisi.')
  const cap = input.hasTeam ? input.teamCapacity : null
  if (id) {
    await db.run(
      `UPDATE products SET name=?, has_account=?, has_team=?, team_capacity=?, updated_at=? WHERE id=?`,
      [name, input.hasAccount ? 1 : 0, input.hasTeam ? 1 : 0, cap, now(), id],
    )
    return id
  }
  const nid = uid()
  await db.run(
    `INSERT INTO products (id, name, has_account, has_team, team_capacity, updated_at) VALUES (?,?,?,?,?,?)`,
    [nid, name, input.hasAccount ? 1 : 0, input.hasTeam ? 1 : 0, cap, now()],
  )
  return nid
}

export async function deleteProduct(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE products SET deleted_at=?, updated_at=? WHERE id=?`, [now(), now(), id])
}

export async function saveVariant(
  db: Db,
  v: { productId: string; name: string; durationDays: number; price: number },
  id?: string,
): Promise<void> {
  if (!v.name.trim()) throw new Error('Nama varian wajib diisi.')
  if (!(v.durationDays > 0)) throw new Error('Durasi harus lebih dari 0 hari.')
  if (v.price < 0) throw new Error('Harga tidak boleh negatif.')
  if (id) {
    await db.run(`UPDATE product_variants SET name=?, duration_days=?, price=?, updated_at=? WHERE id=?`, [
      v.name.trim(), v.durationDays, v.price, now(), id,
    ])
  } else {
    await db.run(
      `INSERT INTO product_variants (id, product_id, name, duration_days, price, updated_at) VALUES (?,?,?,?,?,?)`,
      [uid(), v.productId, v.name.trim(), v.durationDays, v.price, now()],
    )
  }
}

export async function deleteVariant(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE product_variants SET deleted_at=?, updated_at=? WHERE id=?`, [now(), now(), id])
}

/* ---------- Customer ---------- */

export interface Customer {
  id: string
  name: string
  contact: string | null
  email: string | null
  note: string | null
}

export async function listCustomers(db: Db): Promise<Customer[]> {
  return db.all<Customer>(
    `SELECT id, name, contact, email, note FROM customers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  )
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function saveCustomer(
  db: Db,
  c: { name: string; contact: string | null; note: string | null; email?: string | null },
  id?: string,
): Promise<string> {
  if (!c.name.trim()) throw new Error('Nama customer wajib diisi.')
  c = { ...c, contact: c.contact === null ? null : cleanPhone(c.contact).trim() || null }
  if (c.email !== undefined) {
    const e = c.email?.trim() || null
    if (e && !EMAIL.test(e)) throw new Error('Format email belum benar.')
    c = { ...c, email: e }
  }
  if (id) {
    // email yang tidak dikirim (undefined) dibiarkan seperti semula
    await db.run(`UPDATE customers SET name=?, contact=?, note=?, email=CASE WHEN ? THEN ? ELSE email END, updated_at=? WHERE id=?`, [
      c.name.trim(), c.contact, c.note, c.email === undefined ? 0 : 1, c.email ?? null, now(), id,
    ])
    return id
  }
  const nid = uid()
  await db.run(`INSERT INTO customers (id, name, contact, email, note, updated_at) VALUES (?,?,?,?,?,?)`, [
    nid, c.name.trim(), c.contact, c.email ?? null, c.note, now(),
  ])
  return nid
}

export async function deleteCustomer(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE customers SET deleted_at=?, updated_at=? WHERE id=?`, [now(), now(), id])
  await db.run(`UPDATE subscriptions SET deleted_at=?, updated_at=? WHERE customer_id=? AND deleted_at IS NULL`, [
    now(), now(), id,
  ])
}

/* ---------- Langganan ---------- */

export interface Subscription {
  id: string
  customer_id: string
  customer_name: string
  customer_contact: string | null
  product_id: string
  product_name: string
  variant_id: string | null
  variant_name: string | null
  start_date: string
  duration_days: number
  end_date: string
  price: number
  account_login: string | null
  account_password_enc: string | null
  team: string | null
  note: string | null
}

const SUB_SELECT = `
  SELECT s.id, s.customer_id, c.name AS customer_name, c.contact AS customer_contact,
         s.product_id, p.name AS product_name, s.variant_id, v.name AS variant_name,
         s.start_date, s.duration_days, s.end_date, s.price,
         s.account_login, s.account_password_enc, s.team, s.note
  FROM subscriptions s
  JOIN customers c ON c.id = s.customer_id
  JOIN products p ON p.id = s.product_id
  LEFT JOIN product_variants v ON v.id = s.variant_id
  WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND p.deleted_at IS NULL`

export async function listSubscriptions(db: Db, productId?: string): Promise<Subscription[]> {
  return db.all<Subscription>(
    `${SUB_SELECT} ${productId ? 'AND s.product_id = ?' : ''} ORDER BY s.end_date, c.name COLLATE NOCASE`,
    productId ? [productId] : [],
  )
}

export interface SubscriptionInput {
  customerId: string
  productId: string
  variantId: string | null
  startDate: string
  durationDays: number
  price: number
  accountLogin: string | null
  accountPasswordEnc: string | null
  team: string | null
  note: string | null
}

export async function saveSubscription(db: Db, s: SubscriptionInput, id?: string): Promise<string> {
  if (!(s.durationDays > 0)) throw new Error('Durasi harus lebih dari 0 hari.')
  const end = addDays(s.startDate, s.durationDays)
  if (id) {
    await db.run(
      `UPDATE subscriptions SET customer_id=?, product_id=?, variant_id=?, start_date=?, duration_days=?, end_date=?,
         price=?, account_login=?, account_password_enc=?, team=?, note=?, updated_at=? WHERE id=?`,
      [s.customerId, s.productId, s.variantId, s.startDate, s.durationDays, end, s.price,
       s.accountLogin, s.accountPasswordEnc, s.team, s.note, now(), id],
    )
    return id
  }
  const nid = uid()
  await db.run(
    `INSERT INTO subscriptions (id, customer_id, product_id, variant_id, start_date, duration_days, end_date,
       price, account_login, account_password_enc, team, note, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [nid, s.customerId, s.productId, s.variantId, s.startDate, s.durationDays, end, s.price,
     s.accountLogin, s.accountPasswordEnc, s.team, s.note, now()],
  )
  return nid
}

export async function deleteSubscription(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE subscriptions SET deleted_at=?, updated_at=? WHERE id=?`, [now(), now(), id])
}

/**
 * Perpanjang: durasi ditambah. Bila langganan sudah habis, hitungan mulai dari hari ini,
 * bila belum habis, durasi baru disambung ke tanggal berakhir yang lama.
 */
export async function renewSubscription(db: Db, id: string, addDaysCount: number, today: string): Promise<void> {
  if (!(addDaysCount > 0)) throw new Error('Durasi perpanjangan harus lebih dari 0 hari.')
  const r = await db.all<{ start_date: string; duration_days: number; end_date: string }>(
    `SELECT start_date, duration_days, end_date FROM subscriptions WHERE id = ? AND deleted_at IS NULL`,
    [id],
  )
  if (!r.length) throw new Error('Langganan tidak ditemukan.')
  const { start_date, duration_days, end_date } = r[0]
  if (end_date >= today) {
    const dur = duration_days + addDaysCount
    await db.run(`UPDATE subscriptions SET duration_days=?, end_date=?, updated_at=? WHERE id=?`, [
      dur, addDays(start_date, dur), now(), id,
    ])
  } else {
    await db.run(`UPDATE subscriptions SET start_date=?, duration_days=?, end_date=?, updated_at=? WHERE id=?`, [
      today, addDaysCount, addDays(today, addDaysCount), now(), id,
    ])
  }
}

/* ---------- Tim (misalnya Canva) ---------- */

export interface TeamGroup {
  team: string
  members: Subscription[]
  activeCount: number
  capacity: number | null
}

/** Kelompokkan langganan per tim. Anggota yang sudah habis tidak menghitung kapasitas. */
export function groupByTeam(subs: Subscription[], today: string, capacity: number | null): TeamGroup[] {
  const map = new Map<string, Subscription[]>()
  for (const s of subs) {
    const key = s.team?.trim() || 'Tanpa tim'
    map.set(key, [...(map.get(key) ?? []), s])
  }
  return [...map.entries()]
    .map(([team, members]) => ({
      team,
      members,
      activeCount: members.filter((m) => m.end_date >= today).length,
      capacity,
    }))
    .sort((a, b) => a.team.localeCompare(b.team, 'id', { numeric: true }))
}

/** Langganan yang segera habis atau sudah habis hari ini, untuk pengingat. */
export async function expiringWithin(db: Db, today: string, warnDays: number): Promise<Subscription[]> {
  const subs = await listSubscriptions(db)
  return subs.filter((s) => {
    const left = daysLeft(s.end_date, today)
    return left >= 0 && left <= warnDays
  })
}

/** Cari customer dengan nama yang sama (tanpa peduli huruf besar kecil), kalau tidak ada dibuat baru. */
export async function ensureCustomer(db: Db, name: string): Promise<string> {
  const clean = name.trim()
  if (!clean) throw new Error('Nama customer wajib diisi.')
  const r = await db.all<{ id: string }>(
    `SELECT id FROM customers WHERE deleted_at IS NULL AND LOWER(name) = LOWER(?) LIMIT 1`,
    [clean],
  )
  if (r.length) return r[0].id
  return saveCustomer(db, { name: clean, contact: null, note: null })
}
