import type { Db } from './adapter'
import { uid } from './finance'
import { addDays, diffDays, formatShort, toDateStr } from '@/lib/date'
import {
  dueDateAfter, isCategory, monthShare, shiftYm, type BillPeriod, type ExpenseCategory,
} from '@/lib/expense'
import { rupiah } from '@/lib/money'

const now = (): number => Date.now()
const DATE = /^\d{4}-\d{2}-\d{2}$/
const NAME_MAX = 80
const NOTE_MAX = 200

/* ---------- Catatan biaya ---------- */

export interface Expense {
  id: string
  /** Tanggal dibayar. */
  date: string
  name: string
  category: ExpenseCategory
  amount: number
  /** Channel yang saldonya terpakai. Kosong = dibayar di luar saldo aplikasi. */
  channel_id: string | null
  channel_name: string | null
  /** 1 = dihitung di bulan dibayar, 12 = dibagi rata ke 12 bulan. */
  spread_months: number
  recurring_id: string | null
  note: string | null
}

export interface ExpenseInput {
  date: string
  name: string
  category: string
  amount: number
  channelId: string | null
  spreadMonths: number
  note?: string | null
  recurringId?: string | null
}

async function channelExists(db: Db, id: string): Promise<boolean> {
  return (await db.all(`SELECT 1 FROM channels WHERE id = ? AND deleted_at IS NULL`, [id])).length > 0
}

async function validateExpense(db: Db, e: ExpenseInput, keepChannel: string | null): Promise<void> {
  if (!e.name.trim()) throw new Error('Nama biaya wajib diisi.')
  if (e.name.trim().length > NAME_MAX) throw new Error(`Nama biaya terlalu panjang (maksimal ${NAME_MAX} karakter).`)
  if ((e.note?.trim().length ?? 0) > NOTE_MAX) throw new Error(`Catatan terlalu panjang (maksimal ${NOTE_MAX} karakter).`)
  if (!DATE.test(e.date)) throw new Error('Tanggal tidak valid.')
  if (!Number.isInteger(e.amount) || e.amount <= 0) throw new Error('Nominal harus lebih dari nol.')
  if (!isCategory(e.category)) throw new Error('Kategori tidak dikenal.')
  if (e.spreadMonths !== 1 && e.spreadMonths !== 12) throw new Error('Pembagian bulan harus 1 atau 12.')
  // Channel yang sudah diarsipkan boleh tetap dipakai oleh catatan lama yang memang memakainya.
  if (e.channelId && e.channelId !== keepChannel && !(await channelExists(db, e.channelId))) {
    throw new Error('Channel tidak ditemukan.')
  }
}

const EXPENSE_SELECT = `SELECT x.id, x.date, x.name, x.category, x.amount, x.channel_id, c.name AS channel_name,
       x.spread_months, x.recurring_id, x.note
     FROM expenses x LEFT JOIN channels c ON c.id = x.channel_id`

/** Biaya yang dibayar antara dua tanggal (termasuk), terbaru dulu. */
export async function listExpenses(db: Db, from: string, to: string): Promise<Expense[]> {
  return db.all<Expense>(
    `${EXPENSE_SELECT} WHERE x.deleted_at IS NULL AND x.date >= ? AND x.date <= ? ORDER BY x.date DESC, x.updated_at DESC`,
    [from, to],
  )
}

export async function saveExpense(db: Db, e: ExpenseInput, id?: string): Promise<string> {
  let keep: string | null = null
  if (id) {
    const cur = await db.all<{ channel_id: string | null }>(`SELECT channel_id FROM expenses WHERE id = ? AND deleted_at IS NULL`, [id])
    if (!cur.length) throw new Error('Catatan biaya tidak ditemukan.')
    keep = cur[0].channel_id
  }
  await validateExpense(db, e, keep)
  const vals = [
    e.date, e.name.trim(), e.category, e.amount, e.channelId || null, e.spreadMonths, e.recurringId ?? null,
    e.note?.trim() || null,
  ]
  if (id) {
    await db.run(
      `UPDATE expenses SET date=?, name=?, category=?, amount=?, channel_id=?, spread_months=?, recurring_id=?, note=?, updated_at=? WHERE id=?`,
      [...vals, now(), id],
    )
    return id
  }
  const nid = uid()
  await db.run(
    `INSERT INTO expenses (id, date, name, category, amount, channel_id, spread_months, recurring_id, note, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [nid, ...vals, now()],
  )
  return nid
}

/** Nama biaya yang pernah dicatat, untuk saran isian. */
export async function listExpenseNames(db: Db): Promise<string[]> {
  const r = await db.all<{ name: string }>(
    `SELECT name FROM expenses WHERE deleted_at IS NULL GROUP BY name ORDER BY MAX(date) DESC LIMIT 40`,
  )
  return r.map((x) => x.name)
}

export async function deleteExpense(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
}

/* ---------- Beban per bulan (untuk profit bersih) ---------- */

export interface Burden {
  total: number
  byCategory: { category: ExpenseCategory; amount: number }[]
}

/** Biaya yang bisa jatuh di rentang bulan ini: dibayar sampai 11 bulan sebelumnya karena dibagi 12 bulan. */
async function burdenRows(db: Db, firstYm: string, lastYm: string) {
  return db.all<{ date: string; amount: number; spread_months: number; category: ExpenseCategory }>(
    `SELECT date, amount, spread_months, category FROM expenses WHERE deleted_at IS NULL AND date >= ? AND date <= ?`,
    [shiftYm(firstYm, -11) + '-01', lastYm + '-31'],
  )
}

export async function monthBurden(db: Db, ym: string): Promise<Burden> {
  const rows = await burdenRows(db, ym, ym)
  const per = new Map<ExpenseCategory, number>()
  let total = 0
  for (const r of rows) {
    const s = monthShare(r.amount, r.spread_months, r.date.slice(0, 7), ym)
    if (!s) continue
    total += s
    per.set(r.category, (per.get(r.category) ?? 0) + s)
  }
  const byCategory = [...per.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)
  return { total, byCategory }
}

/** Beban tiap bulan di satu tahun, indeks 0 = Januari. */
export async function yearBurden(db: Db, year: number): Promise<number[]> {
  const rows = await burdenRows(db, `${year}-01`, `${year}-12`)
  const out: number[] = []
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`
    out.push(rows.reduce((a, r) => a + monthShare(r.amount, r.spread_months, r.date.slice(0, 7), ym), 0))
  }
  return out
}

/* ---------- Tagihan rutin ---------- */

export interface RecurringBill {
  id: string
  name: string
  category: ExpenseCategory
  amount: number
  period: BillPeriod
  next_due: string
  anchor_day: number
  channel_id: string | null
  updated_at: number
}

export interface BillInput {
  name: string
  category: string
  amount: number
  period: string
  nextDue: string
  channelId: string | null
}

const BILL_COLS = 'id, name, category, amount, period, next_due, anchor_day, channel_id, updated_at'

export async function listBills(db: Db): Promise<RecurringBill[]> {
  return db.all<RecurringBill>(
    `SELECT ${BILL_COLS} FROM recurring_expenses WHERE deleted_at IS NULL ORDER BY next_due, name COLLATE NOCASE`,
  )
}

/** Tagihan yang jatuh tempo paling dekat (termasuk yang terlambat), untuk dashboard. */
export async function upcomingBills(db: Db, limit: number): Promise<RecurringBill[]> {
  return db.all<RecurringBill>(
    `SELECT ${BILL_COLS} FROM recurring_expenses WHERE deleted_at IS NULL ORDER BY next_due, name COLLATE NOCASE LIMIT ?`,
    [limit],
  )
}

async function getBill(db: Db, id: string): Promise<RecurringBill> {
  const r = await db.all<RecurringBill>(`SELECT ${BILL_COLS} FROM recurring_expenses WHERE id = ? AND deleted_at IS NULL`, [id])
  if (!r.length) throw new Error('Tagihan rutin tidak ditemukan.')
  return r[0]
}

async function validateBill(db: Db, b: BillInput, keepChannel: string | null): Promise<void> {
  if (!b.name.trim()) throw new Error('Nama tagihan wajib diisi.')
  if (b.name.trim().length > NAME_MAX) throw new Error(`Nama tagihan terlalu panjang (maksimal ${NAME_MAX} karakter).`)
  if (!Number.isInteger(b.amount) || b.amount <= 0) throw new Error('Nominal harus lebih dari nol.')
  if (!isCategory(b.category)) throw new Error('Kategori tidak dikenal.')
  if (b.period !== 'bulanan' && b.period !== 'tahunan') throw new Error('Siklus harus bulanan atau tahunan.')
  if (!DATE.test(b.nextDue)) throw new Error('Tanggal jatuh tempo tidak valid.')
  if (b.channelId && b.channelId !== keepChannel && !(await channelExists(db, b.channelId))) {
    throw new Error('Channel tidak ditemukan.')
  }
}

export async function saveBill(db: Db, b: BillInput, id?: string): Promise<string> {
  const cur = id ? await getBill(db, id) : null
  await validateBill(db, b, cur?.channel_id ?? null)
  // Tanggal acuan hanya dihitung ulang bila jatuh tempo diubah, supaya tagihan tanggal 31 tidak bergeser.
  let anchor = Number(b.nextDue.slice(8, 10))
  if (id && cur) {
    if (cur.next_due === b.nextDue) anchor = cur.anchor_day
    await db.run(
      `UPDATE recurring_expenses SET name=?, category=?, amount=?, period=?, next_due=?, anchor_day=?, channel_id=?, updated_at=? WHERE id=?`,
      [b.name.trim(), b.category, b.amount, b.period, b.nextDue, anchor, b.channelId || null, now(), id],
    )
    return id
  }
  const nid = uid()
  await db.run(
    `INSERT INTO recurring_expenses (id, name, category, amount, period, next_due, anchor_day, channel_id, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [nid, b.name.trim(), b.category, b.amount, b.period, b.nextDue, anchor, b.channelId || null, now()],
  )
  return nid
}

export async function deleteBill(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE recurring_expenses SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
}

export interface BillPayment {
  date: string
  amount: number
  channelId: string | null
  note?: string | null
}

/**
 * Tandai satu putaran tagihan sudah dibayar: catatan biaya dibuat dan jatuh tempo maju satu siklus.
 * Tagihan tahunan dibagi ke 12 bulan, yang bulanan dihitung di bulan dibayar.
 */
export async function payBill(db: Db, billId: string, p: BillPayment): Promise<string> {
  const bill = await getBill(db, billId)
  const expenseId = await saveExpense(db, {
    date: p.date, name: bill.name, category: bill.category, amount: p.amount, channelId: p.channelId,
    spreadMonths: bill.period === 'tahunan' ? 12 : 1, note: p.note ?? null, recurringId: bill.id,
  })
  await db.run(`UPDATE recurring_expenses SET next_due = ?, updated_at = ? WHERE id = ?`, [
    dueDateAfter(bill.next_due, bill.period, bill.anchor_day), now(), bill.id,
  ])
  return expenseId
}

/* ---------- Pengingat tagihan ---------- */

export type BillReminderKind = 'h3' | 'h0' | 'late'

export interface BillReminder {
  bill: RecurringBill
  kind: BillReminderKind
  key: string
  triggerAt: number
  /** Selisih hari ke jatuh tempo saat pengingat dibuat. Negatif bila terlambat. */
  days: number
}

/** Pengingat tagihan muncul jam 09.00. */
const BILL_HOUR = 9

function at9(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, BILL_HOUR, 0).getTime()
}

/**
 * Pengingat tagihan yang sudah waktunya dan belum pernah dikirim. Fungsi murni.
 * H-3 berlaku sejak 3 hari sebelum jatuh tempo, H-0 di hari jatuh tempo, dan tagihan yang terlambat
 * diingatkan sekali tiap hari sampai dibayar. Pengingat yang waktunya lewat sebelum tagihan dibuat
 * atau diubah tidak dimunculkan.
 */
export function dueBillReminders(bills: RecurringBill[], nowMs: number, logged: ReadonlySet<string>): BillReminder[] {
  const today = toDateStr(new Date(nowMs))
  const out: BillReminder[] = []
  for (const bill of bills) {
    const days = diffDays(today, bill.next_due)
    let kind: BillReminderKind
    let triggerAt: number
    let key: string
    if (days < 0) {
      kind = 'late'
      triggerAt = at9(today)
      key = `bill|${bill.id}|${bill.next_due}|late|${today}`
    } else if (days === 0) {
      kind = 'h0'
      triggerAt = at9(bill.next_due)
      key = `bill|${bill.id}|${bill.next_due}|h0`
    } else if (days <= 3) {
      kind = 'h3'
      triggerAt = at9(addDays(bill.next_due, -3))
      key = `bill|${bill.id}|${bill.next_due}|h3`
    } else {
      continue
    }
    if (triggerAt < bill.updated_at || triggerAt > nowMs || logged.has(key)) continue
    out.push({ bill, kind, key, triggerAt, days })
  }
  return out.sort((a, b) => a.bill.next_due.localeCompare(b.bill.next_due))
}

export function billReminderText(r: BillReminder): { title: string; body: string } {
  const title = `Tagihan ${r.bill.name}`
  const amount = rupiah(r.bill.amount)
  if (r.kind === 'late') {
    return { title, body: `Lewat ${-r.days} hari sejak ${formatShort(r.bill.next_due)}. ${amount}.` }
  }
  if (r.kind === 'h0') return { title, body: `Jatuh tempo hari ini. ${amount}.` }
  return { title, body: `Jatuh tempo ${formatShort(r.bill.next_due)}, ${r.days === 1 ? 'besok' : `${r.days} hari lagi`}. ${amount}.` }
}

const HOUR = 3_600_000

/** Ambil pengingat tagihan yang jatuh tempo dan tandai sudah dikirim. Pemanggil yang menampilkannya. */
export async function collectDueBillReminders(db: Db, nowMs = Date.now()): Promise<BillReminder[]> {
  const horizon = addDays(toDateStr(new Date(nowMs)), 3)
  const bills = await db.all<RecurringBill>(
    `SELECT ${BILL_COLS} FROM recurring_expenses WHERE deleted_at IS NULL AND next_due <= ?`,
    [horizon],
  )
  if (!bills.length) return []
  const rows = await db.all<{ key: string }>(`SELECT key FROM reminder_log WHERE key LIKE 'bill|%'`)
  const due = dueBillReminders(bills, nowMs, new Set(rows.map((r) => r.key)))
  for (const r of due) await db.run(`INSERT OR REPLACE INTO reminder_log (key, at) VALUES (?, ?)`, [r.key, nowMs])
  await db.run(`DELETE FROM reminder_log WHERE at < ?`, [nowMs - 14 * 24 * HOUR])
  return due
}
