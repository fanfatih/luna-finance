import type { Db } from './adapter'
import { uid } from './finance'

const now = (): number => Date.now()

export type DebtKind = 'utang' | 'piutang'
export type DebtStatus = 'lunas' | 'berjalan' | 'jatuh-tempo'

export interface Contact {
  id: string
  name: string
  phone: string | null
  note: string | null
}

export interface Debt {
  id: string
  kind: DebtKind
  contact_id: string
  contact_name: string
  amount: number
  paid: number
  remaining: number
  date: string
  due_date: string | null
  note: string | null
  status: DebtStatus
}

export interface DebtPayment {
  id: string
  debt_id: string
  amount: number
  date: string
  note: string | null
}

/* ---------- Kontak ---------- */

export async function listContacts(db: Db): Promise<Contact[]> {
  return db.all<Contact>(`SELECT id, name, phone, note FROM contacts WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`)
}

/** Cari kontak dengan nama yang sama (tanpa peduli huruf besar kecil), kalau tidak ada dibuat baru. */
export async function ensureContact(db: Db, name: string): Promise<string> {
  const clean = name.trim()
  if (!clean) throw new Error('Nama pihak wajib diisi.')
  const r = await db.all<{ id: string }>(
    `SELECT id FROM contacts WHERE deleted_at IS NULL AND LOWER(name) = LOWER(?) LIMIT 1`,
    [clean],
  )
  if (r.length) return r[0].id
  const id = uid()
  await db.run(`INSERT INTO contacts (id, name, updated_at) VALUES (?,?,?)`, [id, clean, now()])
  return id
}

export async function updateContact(db: Db, id: string, name: string, phone: string | null): Promise<void> {
  await db.run(`UPDATE contacts SET name = ?, phone = ?, updated_at = ? WHERE id = ?`, [name.trim(), phone, now(), id])
}

/* ---------- Utang piutang ---------- */

export interface NewDebt {
  kind: DebtKind
  contactName: string
  amount: number
  date: string
  dueDate?: string | null
  note?: string | null
}

export async function addDebt(db: Db, d: NewDebt): Promise<string> {
  if (!(d.amount > 0)) throw new Error('Nominal harus lebih dari nol.')
  const contactId = await ensureContact(db, d.contactName)
  const id = uid()
  await db.run(
    `INSERT INTO debts (id, kind, contact_id, amount, date, due_date, note, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [id, d.kind, contactId, d.amount, d.date, d.dueDate ?? null, d.note ?? null, now()],
  )
  return id
}

export async function deleteDebt(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE debts SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
}

export interface DebtFilter {
  kind?: DebtKind
  /** 'aktif' = belum lunas, 'lunas' = sudah lunas, 'semua' */
  state?: 'aktif' | 'lunas' | 'semua'
  contactId?: string
}

export async function listDebts(db: Db, today: string, f: DebtFilter = {}): Promise<Debt[]> {
  const where = [`d.deleted_at IS NULL`]
  const params: unknown[] = []
  if (f.kind) {
    where.push(`d.kind = ?`)
    params.push(f.kind)
  }
  if (f.contactId) {
    where.push(`d.contact_id = ?`)
    params.push(f.contactId)
  }
  const rows = await db.all<{
    id: string; kind: DebtKind; contact_id: string; contact_name: string; amount: number
    paid: number; date: string; due_date: string | null; note: string | null
  }>(
    `SELECT d.id, d.kind, d.contact_id, c.name AS contact_name, d.amount, d.date, d.due_date, d.note,
            COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id AND p.deleted_at IS NULL), 0) AS paid
     FROM debts d JOIN contacts c ON c.id = d.contact_id
     WHERE ${where.join(' AND ')} ORDER BY d.date DESC, d.updated_at DESC`,
    params,
  )
  const all: Debt[] = rows.map((r) => {
    const remaining = r.amount - r.paid
    const status: DebtStatus =
      remaining <= 0 ? 'lunas' : r.due_date && r.due_date < today ? 'jatuh-tempo' : 'berjalan'
    return { ...r, remaining, status }
  })
  const state = f.state ?? 'semua'
  if (state === 'aktif') return all.filter((d) => d.remaining > 0)
  if (state === 'lunas') return all.filter((d) => d.remaining <= 0)
  return all
}

export async function listPayments(db: Db, debtId: string): Promise<DebtPayment[]> {
  return db.all<DebtPayment>(
    `SELECT id, debt_id, amount, date, note FROM debt_payments
     WHERE debt_id = ? AND deleted_at IS NULL ORDER BY date, updated_at`,
    [debtId],
  )
}

/** Pembayaran hanya bisa ditambah. Tidak boleh melebihi sisa. */
export async function addPayment(db: Db, debtId: string, amount: number, date: string, note?: string | null) {
  if (!(amount > 0)) throw new Error('Nominal harus lebih dari nol.')
  const r = await db.all<{ amount: number; paid: number }>(
    `SELECT d.amount,
            COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id AND p.deleted_at IS NULL), 0) AS paid
     FROM debts d WHERE d.id = ? AND d.deleted_at IS NULL`,
    [debtId],
  )
  if (!r.length) throw new Error('Catatan utang piutang tidak ditemukan.')
  const remaining = r[0].amount - r[0].paid
  if (amount > remaining) throw new Error('Pembayaran melebihi sisa. Sisanya tinggal ' + remaining + '.')
  await db.run(`INSERT INTO debt_payments (id, debt_id, amount, date, note, updated_at) VALUES (?,?,?,?,?,?)`, [
    uid(), debtId, amount, date, note ?? null, now(),
  ])
}

export async function voidPayment(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE debt_payments SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
}

export interface DebtTotals {
  piutang: number
  utang: number
  piutangCount: number
  utangCount: number
}

export async function debtTotals(db: Db, today: string): Promise<DebtTotals> {
  const active = await listDebts(db, today, { state: 'aktif' })
  const t: DebtTotals = { piutang: 0, utang: 0, piutangCount: 0, utangCount: 0 }
  for (const d of active) {
    if (d.kind === 'piutang') {
      t.piutang += d.remaining
      t.piutangCount += 1
    } else {
      t.utang += d.remaining
      t.utangCount += 1
    }
  }
  return t
}

/** Sisa per pihak, dipakai bot dan tab ringkasan. */
export async function balancesByContact(db: Db, today: string) {
  const active = await listDebts(db, today, { state: 'aktif' })
  const map = new Map<string, { contact_id: string; name: string; piutang: number; utang: number }>()
  for (const d of active) {
    const e = map.get(d.contact_id) ?? { contact_id: d.contact_id, name: d.contact_name, piutang: 0, utang: 0 }
    if (d.kind === 'piutang') e.piutang += d.remaining
    else e.utang += d.remaining
    map.set(d.contact_id, e)
  }
  return [...map.values()].sort((a, b) => b.piutang + b.utang - (a.piutang + a.utang))
}
