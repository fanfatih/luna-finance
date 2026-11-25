import type { Db } from './adapter'
import { deleteEvent, saveEvent, type EventInput } from './events'
import { getSetting, setSetting, uid } from './finance'
import { addDays, diffDays, formatShort, toDateStr } from '@/lib/date'
import { monthShare, shiftYm } from '@/lib/expense'
import {
  cleanPrefix, DEFAULT_IDENTITY, invoiceNumber, isInvoiceKind, isInvoiceStatus, isMomCategory,
  isStage, itemsTotal, nextInvoiceSeq, projectTotal, remaining, type InvoiceIdentity, type InvoiceKind,
  type InvoiceSnapshot, type InvoiceStatus, type MomCategory, type Stage,
} from '@/lib/momentum'
import { rupiah } from '@/lib/money'

const now = (): number => Date.now()
const DATE = /^\d{4}-\d{2}-\d{2}$/
const NAME_MAX = 80
const NOTE_MAX = 500

const text = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

/* ---------- Project ---------- */

export interface Project {
  id: string
  name: string
  client_name: string
  client_contact: string | null
  client_address: string | null
  event_date: string | null
  venue: string | null
  deliver_by: string | null
  stage: Stage
  discount: number
  note: string | null
  event_id: string | null
  deliver_event_id: string | null
  updated_at: number
}

/** Project beserta angka ringkasnya. total = nilai setelah diskon, paid = pembayaran masuk, cost = biaya project. */
export interface ProjectRow extends Project {
  items_total: number
  total: number
  paid: number
  cost: number
}

export interface Item {
  id: string
  project_id: string
  name: string
  qty: number
  unit_price: number
  sort: number
}

export interface ItemInput {
  /** Kosong untuk item baru. */
  id?: string
  name: string
  qty: number
  unitPrice: number
}

export interface ProjectInput {
  name: string
  clientName: string
  clientContact?: string | null
  clientAddress?: string | null
  eventDate?: string | null
  venue?: string | null
  deliverBy?: string | null
  stage: string
  discount: number
  note?: string | null
  items: ItemInput[]
}

const PROJECT_COLS = `p.id, p.name, p.client_name, p.client_contact, p.client_address, p.event_date, p.venue, p.deliver_by,
  p.stage, p.discount, p.note, p.event_id, p.deliver_event_id, p.updated_at`

const PROJECT_ROW = `SELECT ${PROJECT_COLS},
  COALESCE((SELECT SUM(i.qty * i.unit_price) FROM mom_items i WHERE i.project_id = p.id AND i.deleted_at IS NULL), 0) AS items_total,
  COALESCE((SELECT SUM(a.amount) FROM mom_payments a WHERE a.project_id = p.id AND a.deleted_at IS NULL), 0) AS paid,
  COALESCE((SELECT SUM(e.amount) FROM mom_expenses e WHERE e.project_id = p.id AND e.deleted_at IS NULL), 0) AS cost
  FROM mom_projects p`

function withTotal(r: Omit<ProjectRow, 'total'>): ProjectRow {
  return { ...r, total: Math.max(0, r.items_total - r.discount) }
}

/** Semua project, yang acaranya paling baru di atas. Project tanpa tanggal acara di bawah. */
export async function listProjects(db: Db): Promise<ProjectRow[]> {
  const rows = await db.all<Omit<ProjectRow, 'total'>>(
    `${PROJECT_ROW} WHERE p.deleted_at IS NULL
     ORDER BY p.event_date IS NULL, p.event_date DESC, p.name COLLATE NOCASE`,
  )
  return rows.map(withTotal)
}

export async function getProjectRow(db: Db, id: string): Promise<ProjectRow | null> {
  const rows = await db.all<Omit<ProjectRow, 'total'>>(`${PROJECT_ROW} WHERE p.id = ? AND p.deleted_at IS NULL`, [id])
  return rows.length ? withTotal(rows[0]) : null
}

export async function listItems(db: Db, projectId: string): Promise<Item[]> {
  return db.all<Item>(
    `SELECT id, project_id, name, qty, unit_price, sort FROM mom_items
     WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort, name COLLATE NOCASE`,
    [projectId],
  )
}

function validateProject(p: ProjectInput): void {
  if (!p.name.trim()) throw new Error('Nama project wajib diisi.')
  if (p.name.trim().length > NAME_MAX) throw new Error(`Nama project terlalu panjang (maksimal ${NAME_MAX} karakter).`)
  if (!p.clientName.trim()) throw new Error('Nama klien wajib diisi.')
  if (p.clientName.trim().length > NAME_MAX) throw new Error(`Nama klien terlalu panjang (maksimal ${NAME_MAX} karakter).`)
  if ((p.clientContact?.trim().length ?? 0) > 60) throw new Error('Kontak klien terlalu panjang (maksimal 60 karakter).')
  if ((p.clientAddress?.trim().length ?? 0) > 200) throw new Error('Alamat klien terlalu panjang (maksimal 200 karakter).')
  if ((p.venue?.trim().length ?? 0) > 100) throw new Error('Lokasi acara terlalu panjang (maksimal 100 karakter).')
  if ((p.note?.trim().length ?? 0) > NOTE_MAX) throw new Error(`Catatan terlalu panjang (maksimal ${NOTE_MAX} karakter).`)
  if (p.eventDate && !DATE.test(p.eventDate)) throw new Error('Tanggal acara tidak valid.')
  if (p.deliverBy && !DATE.test(p.deliverBy)) throw new Error('Tenggat serah hasil tidak valid.')
  if (p.eventDate && p.deliverBy && p.deliverBy < p.eventDate) throw new Error('Tenggat serah hasil tidak boleh sebelum tanggal acara.')
  if (!isStage(p.stage)) throw new Error('Tahap project tidak dikenal.')
  if (!Number.isInteger(p.discount) || p.discount < 0) throw new Error('Diskon tidak valid.')
  if (p.items.length > 30) throw new Error('Maksimal 30 item per project.')
  for (const i of p.items) {
    if (!i.name.trim()) throw new Error('Nama item wajib diisi.')
    if (i.name.trim().length > 100) throw new Error('Nama item terlalu panjang (maksimal 100 karakter).')
    if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 9999) throw new Error('Jumlah item harus bilangan bulat 1 atau lebih.')
    if (!Number.isInteger(i.unitPrice) || i.unitPrice < 0) throw new Error('Harga item tidak valid.')
  }
  if (p.discount > 0 && p.discount > itemsTotal(p.items.map((i) => ({ qty: i.qty, unit_price: i.unitPrice })))) {
    throw new Error('Diskon tidak boleh lebih besar dari total item.')
  }
}

/** Satu baris kalender Pribadi yang dibuat dari project. Kosong = kegiatan perlu dihapus. */
async function upsertEvent(db: Db, existing: string | null, ev: EventInput | null): Promise<string | null> {
  if (!ev) {
    if (existing) await deleteEvent(db, existing)
    return null
  }
  if (!existing) return saveEvent(db, ev)
  const alive = await db.all(`SELECT 1 FROM events WHERE id = ? AND deleted_at IS NULL`, [existing])
  // Kegiatan yang sengaja dihapus dari kalender tidak dihidupkan lagi.
  if (alive.length) await saveEvent(db, ev, existing)
  return existing
}

/** Acara dan tenggat serah hasil ikut muncul di kalender Pribadi (kategori Momentum) dengan pengingat H-1. */
async function syncCalendar(db: Db, id: string, p: ProjectInput, cur: { event_id: string | null; deliver_event_id: string | null }) {
  const live = p.stage !== 'batal'
  const event: EventInput | null =
    live && p.eventDate
      ? { title: `Acara ${p.name.trim()}`, date: p.eventDate, start_time: null, end_time: null, category: 'momentum', note: text(p.venue), remind_day: true, remind_hours: false }
      : null
  const deliver: EventInput | null =
    live && p.stage !== 'selesai' && p.deliverBy
      ? { title: `Serah hasil ${p.name.trim()}`, date: p.deliverBy, start_time: null, end_time: null, category: 'momentum', note: `Klien: ${p.clientName.trim()}`, remind_day: true, remind_hours: false }
      : null
  const eventId = await upsertEvent(db, cur.event_id, event)
  const deliverId = await upsertEvent(db, cur.deliver_event_id, deliver)
  if (eventId !== cur.event_id || deliverId !== cur.deliver_event_id) {
    await db.run(`UPDATE mom_projects SET event_id = ?, deliver_event_id = ? WHERE id = ?`, [eventId, deliverId, id])
  }
}

export async function saveProject(db: Db, p: ProjectInput, id?: string): Promise<string> {
  validateProject(p)
  let cur: { event_id: string | null; deliver_event_id: string | null } = { event_id: null, deliver_event_id: null }
  if (id) {
    const r = await db.all<{ event_id: string | null; deliver_event_id: string | null }>(
      `SELECT event_id, deliver_event_id FROM mom_projects WHERE id = ? AND deleted_at IS NULL`, [id],
    )
    if (!r.length) throw new Error('Project tidak ditemukan.')
    cur = r[0]
  }
  const vals = [
    p.name.trim(), p.clientName.trim(), text(p.clientContact), text(p.clientAddress), p.eventDate || null,
    text(p.venue), p.deliverBy || null, p.stage, p.discount, text(p.note),
  ]
  let pid = id
  if (pid) {
    await db.run(
      `UPDATE mom_projects SET name=?, client_name=?, client_contact=?, client_address=?, event_date=?, venue=?, deliver_by=?, stage=?, discount=?, note=?, updated_at=? WHERE id=?`,
      [...vals, now(), pid],
    )
  } else {
    pid = uid()
    await db.run(
      `INSERT INTO mom_projects (id, name, client_name, client_contact, client_address, event_date, venue, deliver_by, stage, discount, note, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, ...vals, now()],
    )
  }

  const existing = await db.all<{ id: string }>(`SELECT id FROM mom_items WHERE project_id = ? AND deleted_at IS NULL`, [pid])
  const keep = new Set(p.items.map((i) => i.id).filter(Boolean) as string[])
  for (const e of existing) {
    if (!keep.has(e.id)) await db.run(`UPDATE mom_items SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), e.id])
  }
  const known = new Set(existing.map((e) => e.id))
  for (const [n, i] of p.items.entries()) {
    if (i.id && known.has(i.id)) {
      await db.run(`UPDATE mom_items SET name=?, qty=?, unit_price=?, sort=?, updated_at=? WHERE id=?`, [i.name.trim(), i.qty, i.unitPrice, n, now(), i.id])
    } else {
      await db.run(
        `INSERT INTO mom_items (id, project_id, name, qty, unit_price, sort, updated_at) VALUES (?,?,?,?,?,?,?)`,
        [uid(), pid, i.name.trim(), i.qty, i.unitPrice, n, now()],
      )
    }
  }
  await syncCalendar(db, pid, p, cur)
  return pid
}

/** Ubah tahap saja, tanpa menyentuh data lain. Kalender ikut diperbarui. */
export async function setStage(db: Db, id: string, stage: string): Promise<void> {
  if (!isStage(stage)) throw new Error('Tahap project tidak dikenal.')
  const p = await getProjectRow(db, id)
  if (!p) throw new Error('Project tidak ditemukan.')
  const items = await listItems(db, id)
  await saveProject(
    db,
    {
      name: p.name, clientName: p.client_name, clientContact: p.client_contact, clientAddress: p.client_address,
      eventDate: p.event_date, venue: p.venue, deliverBy: p.deliver_by, stage, discount: p.discount, note: p.note,
      items: items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, unitPrice: i.unit_price })),
    },
    id,
  )
}

/** Project yang sudah punya pembayaran atau biaya tidak dihapus, supaya angka keuangan tidak hilang diam-diam. */
export async function deleteProject(db: Db, id: string): Promise<void> {
  const [pay, exp] = await Promise.all([
    db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM mom_payments WHERE project_id = ? AND deleted_at IS NULL`, [id]),
    db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM mom_expenses WHERE project_id = ? AND deleted_at IS NULL`, [id]),
  ])
  if (pay[0].n > 0 || exp[0].n > 0) {
    throw new Error(`Project ini punya ${pay[0].n} pembayaran dan ${exp[0].n} biaya. Ubah tahapnya jadi Batal, atau hapus catatan itu dulu.`)
  }
  const r = await db.all<{ event_id: string | null; deliver_event_id: string | null }>(
    `SELECT event_id, deliver_event_id FROM mom_projects WHERE id = ?`, [id],
  )
  for (const e of [r[0]?.event_id, r[0]?.deliver_event_id]) if (e) await deleteEvent(db, e)
  const t = now()
  await db.run(`UPDATE mom_items SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL`, [t, t, id])
  await db.run(`UPDATE mom_invoices SET deleted_at = ?, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL`, [t, t, id])
  await db.run(`UPDATE mom_projects SET deleted_at = ?, updated_at = ? WHERE id = ?`, [t, t, id])
}

/* ---------- Pembayaran klien ---------- */

export type PaymentKind = 'dp' | 'termin' | 'pelunasan' | 'lain'

export const PAYMENT_KINDS: { id: PaymentKind; label: string }[] = [
  { id: 'dp', label: 'Uang muka (DP)' },
  { id: 'termin', label: 'Termin' },
  { id: 'pelunasan', label: 'Pelunasan' },
  { id: 'lain', label: 'Lain-lain' },
]

export const paymentKindLabel = (id: string): string => PAYMENT_KINDS.find((k) => k.id === id)?.label ?? id

export interface Payment {
  id: string
  project_id: string
  project_name: string
  date: string
  amount: number
  kind: PaymentKind
  invoice_id: string | null
  note: string | null
}

export interface PaymentInput {
  projectId: string
  date: string
  amount: number
  kind: string
  note?: string | null
  invoiceId?: string | null
}

const PAYMENT_SELECT = `SELECT a.id, a.project_id, p.name AS project_name, a.date, a.amount, a.kind, a.invoice_id, a.note
  FROM mom_payments a JOIN mom_projects p ON p.id = a.project_id`

export async function listPayments(db: Db, from: string, to: string): Promise<Payment[]> {
  return db.all<Payment>(
    `${PAYMENT_SELECT} WHERE a.deleted_at IS NULL AND a.date >= ? AND a.date <= ? ORDER BY a.date DESC, a.updated_at DESC`,
    [from, to],
  )
}

export async function listProjectPayments(db: Db, projectId: string): Promise<Payment[]> {
  return db.all<Payment>(
    `${PAYMENT_SELECT} WHERE a.deleted_at IS NULL AND a.project_id = ? ORDER BY a.date, a.updated_at`,
    [projectId],
  )
}

export async function savePayment(db: Db, p: PaymentInput, id?: string): Promise<string> {
  if (!DATE.test(p.date)) throw new Error('Tanggal tidak valid.')
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new Error('Nominal harus lebih dari nol.')
  if (!PAYMENT_KINDS.some((k) => k.id === p.kind)) throw new Error('Jenis pembayaran tidak dikenal.')
  if ((p.note?.trim().length ?? 0) > 200) throw new Error('Catatan terlalu panjang (maksimal 200 karakter).')
  const proj = await db.all(`SELECT 1 FROM mom_projects WHERE id = ? AND deleted_at IS NULL`, [p.projectId])
  if (!proj.length) throw new Error('Project tidak ditemukan.')
  if (id) {
    const cur = await db.all(`SELECT 1 FROM mom_payments WHERE id = ? AND deleted_at IS NULL`, [id])
    if (!cur.length) throw new Error('Catatan pembayaran tidak ditemukan.')
    await db.run(
      `UPDATE mom_payments SET project_id=?, date=?, amount=?, kind=?, note=?, updated_at=? WHERE id=?`,
      [p.projectId, p.date, p.amount, p.kind, text(p.note), now(), id],
    )
    return id
  }
  const nid = uid()
  await db.run(
    `INSERT INTO mom_payments (id, project_id, date, amount, kind, invoice_id, note, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [nid, p.projectId, p.date, p.amount, p.kind, p.invoiceId ?? null, text(p.note), now()],
  )
  return nid
}

/** Hapus pembayaran. Invoice yang ditandai lunas dari pembayaran ini kembali jadi Terkirim. */
export async function deletePayment(db: Db, id: string): Promise<void> {
  const r = await db.all<{ invoice_id: string | null }>(`SELECT invoice_id FROM mom_payments WHERE id = ? AND deleted_at IS NULL`, [id])
  await db.run(`UPDATE mom_payments SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
  const inv = r[0]?.invoice_id
  if (inv) {
    await db.run(`UPDATE mom_invoices SET status = 'terkirim', updated_at = ? WHERE id = ? AND status = 'lunas'`, [now(), inv])
  }
}

/* ---------- Biaya ---------- */

export interface MomExpense {
  id: string
  date: string
  name: string
  category: MomCategory
  amount: number
  project_id: string | null
  project_name: string | null
  /** 1 = dihitung di bulan dibayar, 12 = dibagi rata ke 12 bulan. */
  spread_months: number
  note: string | null
}

export interface MomExpenseInput {
  date: string
  name: string
  category: string
  amount: number
  projectId?: string | null
  spreadMonths: number
  note?: string | null
}

const EXPENSE_SELECT = `SELECT x.id, x.date, x.name, x.category, x.amount, x.project_id, p.name AS project_name, x.spread_months, x.note
  FROM mom_expenses x LEFT JOIN mom_projects p ON p.id = x.project_id`

export async function listMomExpenses(db: Db, from: string, to: string): Promise<MomExpense[]> {
  return db.all<MomExpense>(
    `${EXPENSE_SELECT} WHERE x.deleted_at IS NULL AND x.date >= ? AND x.date <= ? ORDER BY x.date DESC, x.updated_at DESC`,
    [from, to],
  )
}

export async function listProjectExpenses(db: Db, projectId: string): Promise<MomExpense[]> {
  return db.all<MomExpense>(
    `${EXPENSE_SELECT} WHERE x.deleted_at IS NULL AND x.project_id = ? ORDER BY x.date, x.updated_at`,
    [projectId],
  )
}

export async function listMomExpenseNames(db: Db): Promise<string[]> {
  const r = await db.all<{ name: string }>(
    `SELECT name FROM mom_expenses WHERE deleted_at IS NULL GROUP BY name ORDER BY MAX(date) DESC LIMIT 40`,
  )
  return r.map((x) => x.name)
}

export async function saveMomExpense(db: Db, e: MomExpenseInput, id?: string): Promise<string> {
  if (!e.name.trim()) throw new Error('Nama biaya wajib diisi.')
  if (e.name.trim().length > NAME_MAX) throw new Error(`Nama biaya terlalu panjang (maksimal ${NAME_MAX} karakter).`)
  if ((e.note?.trim().length ?? 0) > 200) throw new Error('Catatan terlalu panjang (maksimal 200 karakter).')
  if (!DATE.test(e.date)) throw new Error('Tanggal tidak valid.')
  if (!Number.isInteger(e.amount) || e.amount <= 0) throw new Error('Nominal harus lebih dari nol.')
  if (!isMomCategory(e.category)) throw new Error('Kategori tidak dikenal.')
  if (e.spreadMonths !== 1 && e.spreadMonths !== 12) throw new Error('Pembagian bulan harus 1 atau 12.')
  if (e.projectId) {
    const proj = await db.all(`SELECT 1 FROM mom_projects WHERE id = ? AND deleted_at IS NULL`, [e.projectId])
    if (!proj.length) throw new Error('Project tidak ditemukan.')
  }
  // Biaya project selalu dihitung penuh di bulan dibayar, supaya margin project langsung terbaca.
  const spread = e.projectId ? 1 : e.spreadMonths
  const vals = [e.date, e.name.trim(), e.category, e.amount, e.projectId || null, spread, text(e.note)]
  if (id) {
    const cur = await db.all(`SELECT 1 FROM mom_expenses WHERE id = ? AND deleted_at IS NULL`, [id])
    if (!cur.length) throw new Error('Catatan biaya tidak ditemukan.')
    await db.run(
      `UPDATE mom_expenses SET date=?, name=?, category=?, amount=?, project_id=?, spread_months=?, note=?, updated_at=? WHERE id=?`,
      [...vals, now(), id],
    )
    return id
  }
  const nid = uid()
  await db.run(
    `INSERT INTO mom_expenses (id, date, name, category, amount, project_id, spread_months, note, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [nid, ...vals, now()],
  )
  return nid
}

export async function deleteMomExpense(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE mom_expenses SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
}

/* ---------- Uang masuk dan keluar per periode ---------- */

export interface MomCosts {
  total: number
  byCategory: { category: MomCategory; amount: number }[]
}

/** Biaya yang bisa jatuh di rentang ini: dibayar sampai 11 bulan sebelumnya karena dibagi 12 bulan. */
async function costRows(db: Db, firstYm: string, lastYm: string) {
  return db.all<{ date: string; amount: number; spread_months: number; category: MomCategory }>(
    `SELECT date, amount, spread_months, category FROM mom_expenses WHERE deleted_at IS NULL AND date >= ? AND date <= ?`,
    [shiftYm(firstYm, -11) + '-01', lastYm + '-31'],
  )
}

export async function monthCosts(db: Db, ym: string): Promise<MomCosts> {
  const rows = await costRows(db, ym, ym)
  const per = new Map<MomCategory, number>()
  let total = 0
  for (const r of rows) {
    const s = monthShare(r.amount, r.spread_months, r.date.slice(0, 7), ym)
    if (!s) continue
    total += s
    per.set(r.category, (per.get(r.category) ?? 0) + s)
  }
  return { total, byCategory: [...per.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount) }
}

/** Uang masuk dari klien di satu bulan. */
export async function monthIncome(db: Db, ym: string): Promise<number> {
  const r = await db.all<{ s: number | null }>(
    `SELECT SUM(amount) AS s FROM mom_payments WHERE deleted_at IS NULL AND date >= ? AND date <= ?`,
    [ym + '-01', ym + '-31'],
  )
  return r[0]?.s ?? 0
}

export interface MonthFigures {
  ym: string
  income: number
  costs: number
}

/** Uang masuk dan beban tiap bulan di satu tahun, urut Januari sampai Desember. */
export async function yearFigures(db: Db, year: number): Promise<MonthFigures[]> {
  const [pays, costs] = await Promise.all([
    db.all<{ date: string; amount: number }>(
      `SELECT date, amount FROM mom_payments WHERE deleted_at IS NULL AND date >= ? AND date <= ?`,
      [`${year}-01-01`, `${year}-12-31`],
    ),
    costRows(db, `${year}-01`, `${year}-12`),
  ])
  const out: MonthFigures[] = []
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`
    out.push({
      ym,
      income: pays.filter((p) => p.date.startsWith(ym)).reduce((a, p) => a + p.amount, 0),
      costs: costs.reduce((a, r) => a + monthShare(r.amount, r.spread_months, r.date.slice(0, 7), ym), 0),
    })
  }
  return out
}

/** Project yang acaranya jatuh di rentang tanggal ini (selain yang batal), untuk margin per project. */
export async function projectsByEventDate(db: Db, from: string, to: string): Promise<ProjectRow[]> {
  const rows = await db.all<Omit<ProjectRow, 'total'>>(
    `${PROJECT_ROW} WHERE p.deleted_at IS NULL AND p.stage <> 'batal' AND p.event_date >= ? AND p.event_date <= ?
     ORDER BY p.event_date, p.name COLLATE NOCASE`,
    [from, to],
  )
  return rows.map(withTotal)
}

/* ---------- Invoice ---------- */

export interface Invoice {
  id: string
  project_id: string
  project_name: string
  client_name: string
  number: string
  kind: InvoiceKind
  issue_date: string
  due_date: string
  amount: number
  status: InvoiceStatus
  note: string | null
  snapshot: string | null
  updated_at: number
}

export interface InvoiceInput {
  kind: string
  amount: number
  issueDate: string
  dueDate: string
  note?: string | null
}

const INVOICE_SELECT = `SELECT v.id, v.project_id, p.name AS project_name, p.client_name, v.number, v.kind, v.issue_date, v.due_date,
  v.amount, v.status, v.note, v.snapshot, v.updated_at
  FROM mom_invoices v JOIN mom_projects p ON p.id = v.project_id`

export async function listInvoices(db: Db): Promise<Invoice[]> {
  return db.all<Invoice>(`${INVOICE_SELECT} WHERE v.deleted_at IS NULL ORDER BY v.issue_date DESC, v.number DESC`)
}

export async function listProjectInvoices(db: Db, projectId: string): Promise<Invoice[]> {
  return db.all<Invoice>(`${INVOICE_SELECT} WHERE v.deleted_at IS NULL AND v.project_id = ? ORDER BY v.issue_date, v.number`, [projectId])
}

export async function getInvoice(db: Db, id: string): Promise<Invoice> {
  const r = await db.all<Invoice>(`${INVOICE_SELECT} WHERE v.id = ? AND v.deleted_at IS NULL`, [id])
  if (!r.length) throw new Error('Invoice tidak ditemukan.')
  return r[0]
}

/** Invoice yang masih menunggu pembayaran, yang jatuh temponya paling dekat dulu. */
export async function listOutstandingInvoices(db: Db, limit: number): Promise<Invoice[]> {
  return db.all<Invoice>(
    `${INVOICE_SELECT} WHERE v.deleted_at IS NULL AND v.status = 'terkirim' ORDER BY v.due_date, v.number LIMIT ?`,
    [limit],
  )
}

/** Salinan data project saat ini untuk dibekukan di invoice. */
async function buildSnapshot(db: Db, projectId: string): Promise<InvoiceSnapshot> {
  const p = await getProjectRow(db, projectId)
  if (!p) throw new Error('Project tidak ditemukan.')
  const items = await listItems(db, projectId)
  return {
    projectName: p.name, clientName: p.client_name, clientContact: p.client_contact, clientAddress: p.client_address,
    eventDate: p.event_date, venue: p.venue,
    items: items.map((i) => ({ name: i.name, qty: i.qty, unitPrice: i.unit_price })),
    discount: p.discount, total: projectTotal(items, p.discount), paidBefore: p.paid,
  }
}

function validateInvoice(i: InvoiceInput): void {
  if (!isInvoiceKind(i.kind)) throw new Error('Jenis invoice tidak dikenal.')
  if (!Number.isInteger(i.amount) || i.amount <= 0) throw new Error('Jumlah tagihan harus lebih dari nol.')
  if (!DATE.test(i.issueDate)) throw new Error('Tanggal terbit tidak valid.')
  if (!DATE.test(i.dueDate)) throw new Error('Tanggal jatuh tempo tidak valid.')
  if (i.dueDate < i.issueDate) throw new Error('Jatuh tempo tidak boleh sebelum tanggal terbit.')
  if ((i.note?.trim().length ?? 0) > NOTE_MAX) throw new Error(`Catatan terlalu panjang (maksimal ${NOTE_MAX} karakter).`)
}

export async function createInvoice(db: Db, projectId: string, i: InvoiceInput): Promise<string> {
  validateInvoice(i)
  const snapshot = await buildSnapshot(db, projectId)
  const identity = await loadIdentity(db)
  const nums = await db.all<{ number: string }>(`SELECT number FROM mom_invoices`)
  const number = invoiceNumber(identity.prefix, i.issueDate, nextInvoiceSeq(nums.map((n) => n.number), identity.prefix, i.issueDate))
  const id = uid()
  await db.run(
    `INSERT INTO mom_invoices (id, project_id, number, kind, issue_date, due_date, amount, status, note, snapshot, updated_at) VALUES (?,?,?,?,?,?,?,'draft',?,?,?)`,
    [id, projectId, number, i.kind, i.issueDate, i.dueDate, i.amount, text(i.note), JSON.stringify(snapshot), now()],
  )
  return id
}

/** Ubah invoice yang masih draft. refresh = ambil ulang data project (item, diskon, pembayaran) ke invoice. */
export async function updateInvoice(db: Db, id: string, i: InvoiceInput, refresh = false): Promise<void> {
  validateInvoice(i)
  const cur = await getInvoice(db, id)
  if (cur.status !== 'draft') throw new Error('Invoice yang sudah dikirim tidak bisa diubah. Kembalikan ke draft dulu.')
  const snapshot = refresh ? JSON.stringify(await buildSnapshot(db, cur.project_id)) : cur.snapshot
  await db.run(
    `UPDATE mom_invoices SET kind=?, amount=?, issue_date=?, due_date=?, note=?, snapshot=?, updated_at=? WHERE id=?`,
    [i.kind, i.amount, i.issueDate, i.dueDate, text(i.note), snapshot, now(), id],
  )
}

const PAYMENT_FOR: Record<InvoiceKind, PaymentKind> = { dp: 'dp', pelunasan: 'pelunasan', penuh: 'pelunasan', kustom: 'termin' }

/**
 * Pindah status invoice. Draft ke Terkirim, Terkirim ke Lunas (mencatat pembayaran di project),
 * Lunas kembali ke Terkirim (pembayarannya dihapus), Terkirim kembali ke Draft, atau dibatalkan.
 */
export async function setInvoiceStatus(db: Db, id: string, next: string, paidDate?: string): Promise<void> {
  if (!isInvoiceStatus(next)) throw new Error('Status invoice tidak dikenal.')
  const inv = await getInvoice(db, id)
  const from = inv.status
  if (from === next) return
  const ok =
    (from === 'draft' && (next === 'terkirim' || next === 'batal')) ||
    (from === 'terkirim' && (next === 'lunas' || next === 'draft' || next === 'batal')) ||
    (from === 'lunas' && next === 'terkirim') ||
    (from === 'batal' && next === 'draft')
  if (!ok) throw new Error('Perubahan status ini tidak diizinkan.')

  if (next === 'lunas') {
    const date = paidDate ?? toDateStr(new Date())
    if (!DATE.test(date)) throw new Error('Tanggal pembayaran tidak valid.')
    await savePayment(db, {
      projectId: inv.project_id, date, amount: inv.amount, kind: PAYMENT_FOR[inv.kind], invoiceId: inv.id,
      note: `Invoice ${inv.number}`,
    })
  }
  if (from === 'lunas') {
    await db.run(`UPDATE mom_payments SET deleted_at = ?, updated_at = ? WHERE invoice_id = ? AND deleted_at IS NULL`, [now(), now(), id])
  }
  await db.run(`UPDATE mom_invoices SET status = ?, updated_at = ? WHERE id = ?`, [next, now(), id])
}

/** Hanya draft dan invoice yang dibatalkan yang boleh dihapus. */
export async function deleteInvoice(db: Db, id: string): Promise<void> {
  const inv = await getInvoice(db, id)
  if (inv.status !== 'draft' && inv.status !== 'batal') throw new Error('Hanya draft atau invoice yang dibatalkan yang bisa dihapus.')
  await db.run(`UPDATE mom_invoices SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
}

/* ---------- Identitas invoice (disimpan di perangkat ini) ---------- */

const IDENT_KEYS = {
  name: 'inv_name', address: 'inv_address', contact: 'inv_contact', bank: 'inv_bank', accountNo: 'inv_account_no',
  accountName: 'inv_account_name', footer: 'inv_footer', prefix: 'inv_prefix', dpPercent: 'inv_dp_percent',
  logo: 'inv_logo', logoW: 'inv_logo_w', logoH: 'inv_logo_h',
} as const

export async function loadIdentity(db: Db): Promise<InvoiceIdentity> {
  const entries = await Promise.all(Object.entries(IDENT_KEYS).map(async ([f, k]) => [f, await getSetting(db, k)] as const))
  const v = Object.fromEntries(entries) as Record<keyof typeof IDENT_KEYS, string | null>
  const d = DEFAULT_IDENTITY
  const pct = Number(v.dpPercent)
  return {
    name: v.name?.trim() || d.name,
    address: v.address ?? d.address,
    contact: v.contact ?? d.contact,
    bank: v.bank ?? d.bank,
    accountNo: v.accountNo ?? d.accountNo,
    accountName: v.accountName ?? d.accountName,
    footer: v.footer ?? d.footer,
    prefix: cleanPrefix(v.prefix ?? '') || d.prefix,
    dpPercent: Number.isInteger(pct) && pct >= 1 && pct <= 100 ? pct : d.dpPercent,
    logo: v.logo ?? '',
    logoW: Number(v.logoW) || 0,
    logoH: Number(v.logoH) || 0,
  }
}

const LOGO_MAX = 700_000

export async function saveIdentity(db: Db, i: InvoiceIdentity): Promise<void> {
  if (!i.name.trim()) throw new Error('Nama usaha wajib diisi.')
  if (i.name.trim().length > 60) throw new Error('Nama usaha terlalu panjang (maksimal 60 karakter).')
  if (!cleanPrefix(i.prefix)) throw new Error('Awalan nomor invoice wajib diisi (huruf dan angka).')
  if (!Number.isInteger(i.dpPercent) || i.dpPercent < 1 || i.dpPercent > 100) throw new Error('Persentase DP harus 1 sampai 100.')
  if (i.logo && (!i.logo.startsWith('data:image/') || i.logo.length > LOGO_MAX)) throw new Error('Logo terlalu besar atau bukan gambar.')
  const out: Record<keyof typeof IDENT_KEYS, string> = {
    name: i.name.trim(), address: i.address.trim(), contact: i.contact.trim(), bank: i.bank.trim(),
    accountNo: i.accountNo.trim(), accountName: i.accountName.trim(), footer: i.footer.trim(),
    prefix: cleanPrefix(i.prefix), dpPercent: String(i.dpPercent), logo: i.logo, logoW: String(i.logoW), logoH: String(i.logoH),
  }
  for (const [f, k] of Object.entries(IDENT_KEYS)) await setSetting(db, k, out[f as keyof typeof IDENT_KEYS])
}

/* ---------- Pengingat invoice ---------- */

export type InvoiceReminderKind = 'h1' | 'h0' | 'late'

export interface InvoiceReminder {
  invoice: Invoice
  kind: InvoiceReminderKind
  key: string
  triggerAt: number
  days: number
}

const REMIND_HOUR = 9

function at9(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, REMIND_HOUR, 0).getTime()
}

/**
 * Pengingat invoice yang sudah waktunya dan belum pernah dikirim. Fungsi murni. Hanya untuk invoice yang
 * terkirim dan belum dibayar: H-1 jam 09.00, di hari jatuh tempo, lalu sekali tiap hari bila terlambat.
 * Pengingat yang waktunya lewat sebelum invoice dikirim atau diubah tidak dimunculkan.
 */
export function dueInvoiceReminders(invoices: Invoice[], nowMs: number, logged: ReadonlySet<string>): InvoiceReminder[] {
  const today = toDateStr(new Date(nowMs))
  const out: InvoiceReminder[] = []
  for (const invoice of invoices) {
    if (invoice.status !== 'terkirim') continue
    const days = diffDays(today, invoice.due_date)
    let kind: InvoiceReminderKind
    let triggerAt: number
    let key: string
    if (days < 0) {
      kind = 'late'
      triggerAt = at9(today)
      key = `inv|${invoice.id}|${invoice.due_date}|late|${today}`
    } else if (days === 0) {
      kind = 'h0'
      triggerAt = at9(invoice.due_date)
      key = `inv|${invoice.id}|${invoice.due_date}|h0`
    } else if (days === 1) {
      kind = 'h1'
      triggerAt = at9(addDays(invoice.due_date, -1))
      key = `inv|${invoice.id}|${invoice.due_date}|h1`
    } else {
      continue
    }
    if (triggerAt < invoice.updated_at || triggerAt > nowMs || logged.has(key)) continue
    out.push({ invoice, kind, key, triggerAt, days })
  }
  return out.sort((a, b) => a.invoice.due_date.localeCompare(b.invoice.due_date))
}

export function invoiceReminderText(r: InvoiceReminder): { title: string; body: string } {
  const title = `Invoice ${r.invoice.number}`
  const who = `${r.invoice.client_name}, ${rupiah(r.invoice.amount)}`
  if (r.kind === 'late') return { title, body: `${who}. Lewat ${-r.days} hari sejak ${formatShort(r.invoice.due_date)}, belum dibayar.` }
  if (r.kind === 'h0') return { title, body: `${who}. Jatuh tempo hari ini.` }
  return { title, body: `${who}. Jatuh tempo besok.` }
}

const HOUR = 3_600_000

/** Ambil pengingat invoice yang jatuh tempo dan tandai sudah dikirim. Pemanggil yang menampilkannya. */
export async function collectInvoiceReminders(db: Db, nowMs = Date.now()): Promise<InvoiceReminder[]> {
  const horizon = addDays(toDateStr(new Date(nowMs)), 1)
  const invoices = await db.all<Invoice>(
    `${INVOICE_SELECT} WHERE v.deleted_at IS NULL AND v.status = 'terkirim' AND v.due_date <= ?`,
    [horizon],
  )
  if (!invoices.length) return []
  const rows = await db.all<{ key: string }>(`SELECT key FROM reminder_log WHERE key LIKE 'inv|%'`)
  const due = dueInvoiceReminders(invoices, nowMs, new Set(rows.map((r) => r.key)))
  for (const r of due) await db.run(`INSERT OR REPLACE INTO reminder_log (key, at) VALUES (?, ?)`, [r.key, nowMs])
  await db.run(`DELETE FROM reminder_log WHERE at < ?`, [nowMs - 14 * HOUR * 24])
  return due
}

/* ---------- Ringkasan dashboard ---------- */

export interface MomDashboard {
  income: number
  costs: number
  /** Piutang klien: sisa tagihan project yang sudah dikontrak. */
  receivable: number
  receivableCount: number
  upcoming: ProjectRow[]
  outstanding: Invoice[]
  projectCount: number
}

export async function momDashboard(db: Db, today: string): Promise<MomDashboard> {
  const ym = today.slice(0, 7)
  const [income, costs, projects, outstanding] = await Promise.all([
    monthIncome(db, ym), monthCosts(db, ym), listProjects(db), listOutstandingInvoices(db, 5),
  ])
  const owed = projects.filter((p) => (p.stage === 'booking' || p.stage === 'produksi' || p.stage === 'selesai') && remaining(p.total, p.paid) > 0)
  const upcoming = projects
    .filter((p) => (p.stage === 'inquiry' || p.stage === 'booking' || p.stage === 'produksi') && p.event_date !== null && p.event_date >= today)
    .sort((a, b) => a.event_date!.localeCompare(b.event_date!))
    .slice(0, 5)
  return {
    income, costs: costs.total,
    receivable: owed.reduce((a, p) => a + remaining(p.total, p.paid), 0),
    receivableCount: owed.length,
    upcoming, outstanding, projectCount: projects.length,
  }
}

