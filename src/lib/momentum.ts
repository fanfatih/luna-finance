import { addDays, diffDays, formatDate } from './date'
import { rupiah } from './money'

/* ---------- Kategori biaya ---------- */

export const MOM_CATEGORIES = [
  { id: 'honor', label: 'Honor crew' },
  { id: 'transport', label: 'Transport dan akomodasi' },
  { id: 'alat', label: 'Sewa atau beli alat' },
  { id: 'cetak', label: 'Cetak dan album' },
  { id: 'konsumsi', label: 'Konsumsi' },
  { id: 'software', label: 'Software dan penyimpanan' },
  { id: 'iklan', label: 'Iklan' },
  { id: 'lain', label: 'Lain-lain' },
] as const

export type MomCategory = (typeof MOM_CATEGORIES)[number]['id']

export const momCategoryLabel = (id: string): string => MOM_CATEGORIES.find((c) => c.id === id)?.label ?? 'Lain-lain'
export const isMomCategory = (id: string): id is MomCategory => MOM_CATEGORIES.some((c) => c.id === id)

/* ---------- Tahap project ---------- */

export const STAGES = [
  { id: 'inquiry', label: 'Inquiry' },
  { id: 'booking', label: 'Booking' },
  { id: 'produksi', label: 'Produksi' },
  { id: 'selesai', label: 'Selesai' },
  { id: 'batal', label: 'Batal' },
] as const

export type Stage = (typeof STAGES)[number]['id']

export const stageLabel = (id: string): string => STAGES.find((s) => s.id === id)?.label ?? id
export const isStage = (id: string): id is Stage => STAGES.some((s) => s.id === id)

/** Project yang sudah dikontrak: tagihannya dihitung sebagai piutang klien. */
export const isCommitted = (stage: string): boolean => stage === 'booking' || stage === 'produksi' || stage === 'selesai'

/** Project yang acaranya masih perlu dipersiapkan. */
export const isUpcoming = (stage: string): boolean => stage === 'inquiry' || stage === 'booking' || stage === 'produksi'

/* ---------- Nilai project dan pembayaran ---------- */

export interface LineItem {
  qty: number
  unit_price: number
}

export const lineTotal = (i: LineItem): number => i.qty * i.unit_price

export const itemsTotal = (items: readonly LineItem[]): number => items.reduce((a, i) => a + lineTotal(i), 0)

/** Nilai project setelah diskon. Tidak pernah negatif. */
export const projectTotal = (items: readonly LineItem[], discount: number): number =>
  Math.max(0, itemsTotal(items) - Math.max(0, discount))

export type PayState = 'belum' | 'dp' | 'lunas' | 'lebih'

/** Status pembayaran klien dari nilai project dan jumlah yang sudah masuk. */
export function payState(total: number, paid: number): PayState {
  if (paid <= 0) return 'belum'
  if (total > 0 && paid === total) return 'lunas'
  if (paid > total) return 'lebih'
  return 'dp'
}

export const PAY_LABEL: Record<PayState, string> = {
  belum: 'Belum bayar',
  dp: 'Sudah DP',
  lunas: 'Lunas',
  lebih: 'Kelebihan bayar',
}

/** Sisa tagihan. Nol bila sudah lunas atau lebih. */
export const remaining = (total: number, paid: number): number => Math.max(0, total - paid)

/* ---------- Invoice ---------- */

export const INVOICE_KINDS = [
  { id: 'dp', label: 'Uang muka (DP)' },
  { id: 'pelunasan', label: 'Pelunasan' },
  { id: 'penuh', label: 'Pembayaran penuh' },
  { id: 'kustom', label: 'Termin lain' },
] as const

export type InvoiceKind = (typeof INVOICE_KINDS)[number]['id']

export const invoiceKindLabel = (id: string): string => INVOICE_KINDS.find((k) => k.id === id)?.label ?? id
export const isInvoiceKind = (id: string): id is InvoiceKind => INVOICE_KINDS.some((k) => k.id === id)

/** Sebutan jenis invoice di tengah kalimat. */
const KIND_PHRASE: Record<InvoiceKind, string> = {
  dp: 'uang muka (DP)', pelunasan: 'pelunasan', penuh: 'pembayaran penuh', kustom: 'termin pembayaran',
}

export type InvoiceStatus = 'draft' | 'terkirim' | 'lunas' | 'batal'

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  terkirim: 'Terkirim',
  lunas: 'Lunas',
  batal: 'Dibatalkan',
}

export const isInvoiceStatus = (s: string): s is InvoiceStatus => s in INVOICE_STATUS_LABEL

/** Jumlah DP dari persentase nilai project, dibulatkan ke rupiah. */
export function dpAmount(total: number, percent: number): number {
  const p = Math.min(100, Math.max(0, percent))
  return Math.round((total * p) / 100)
}

/**
 * Usulan jumlah tagihan. DP = persentase dari nilai project, pelunasan = sisa yang belum dibayar,
 * pembayaran penuh = seluruh nilai project. Termin lain tidak diusulkan, diisi sendiri.
 */
export function suggestInvoiceAmount(kind: InvoiceKind, total: number, paid: number, dpPercent: number): number {
  switch (kind) {
    case 'dp': return dpAmount(total, dpPercent)
    case 'pelunasan': return remaining(total, paid)
    case 'penuh': return total
    case 'kustom': return 0
  }
}

/** Usulan jatuh tempo. DP 3 hari setelah terbit, pelunasan di hari acara, lainnya 7 hari. Bisa diubah. */
export function suggestDueDate(kind: InvoiceKind, issueDate: string, eventDate: string | null): string {
  if (kind === 'dp') return addDays(issueDate, 3)
  if (kind === 'pelunasan' && eventDate && eventDate >= issueDate) return eventDate
  return addDays(issueDate, 7)
}

const pad = (n: number, w: number) => String(n).padStart(w, '0')

/** INV/MOM/2026/11/001 */
export function invoiceNumber(prefix: string, issueDate: string, seq: number): string {
  return `INV/${prefix}/${issueDate.slice(0, 4)}/${issueDate.slice(5, 7)}/${pad(seq, 3)}`
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Nomor urut berikutnya untuk prefix dan bulan itu, dari nomor invoice yang pernah dibuat. */
export function nextInvoiceSeq(existing: readonly string[], prefix: string, issueDate: string): number {
  const re = new RegExp(`^INV/${escapeRe(prefix)}/${issueDate.slice(0, 4)}/${issueDate.slice(5, 7)}/(\\d+)$`)
  let max = 0
  for (const n of existing) {
    const m = re.exec(n)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

/** Prefix nomor invoice: huruf dan angka saja, huruf besar, maksimal 8 karakter. */
export function cleanPrefix(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

export type InvoiceTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger'

export interface InvoiceState {
  label: string
  tone: InvoiceTone
  /** Terkirim dan sudah lewat jatuh tempo. */
  overdue: boolean
  /** Selisih hari ke jatuh tempo, negatif bila lewat. */
  days: number
}

/** Status tampilan sebuah invoice terhadap hari ini. */
export function invoiceState(status: InvoiceStatus, dueDate: string, today: string): InvoiceState {
  const days = diffDays(today, dueDate)
  if (status === 'lunas') return { label: 'Lunas', tone: 'success', overdue: false, days }
  if (status === 'batal') return { label: 'Dibatalkan', tone: 'neutral', overdue: false, days }
  if (status === 'draft') return { label: 'Draft', tone: 'neutral', overdue: false, days }
  if (days < 0) return { label: `Lewat ${-days} hari`, tone: 'danger', overdue: true, days }
  if (days === 0) return { label: 'Jatuh tempo hari ini', tone: 'warn', overdue: false, days }
  return { label: days <= 3 ? `${days} hari lagi` : 'Menunggu bayar', tone: days <= 3 ? 'warn' : 'accent', overdue: false, days }
}

/* ---------- Isi invoice yang dibekukan ---------- */

/** Salinan data project saat invoice dibuat, supaya invoice yang sudah dikirim tidak berubah diam-diam. */
export interface InvoiceSnapshot {
  projectName: string
  clientName: string
  clientContact: string | null
  clientAddress: string | null
  eventDate: string | null
  venue: string | null
  items: { name: string; qty: number; unitPrice: number }[]
  discount: number
  total: number
  /** Total pembayaran klien yang sudah masuk saat invoice dibuat. */
  paidBefore: number
}

export function parseSnapshot(raw: string | null): InvoiceSnapshot | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Partial<InvoiceSnapshot>
    if (!s || typeof s !== 'object' || !Array.isArray(s.items) || typeof s.total !== 'number') return null
    return {
      projectName: String(s.projectName ?? ''),
      clientName: String(s.clientName ?? ''),
      clientContact: s.clientContact ?? null,
      clientAddress: s.clientAddress ?? null,
      eventDate: s.eventDate ?? null,
      venue: s.venue ?? null,
      items: s.items.map((i) => ({ name: String(i.name), qty: Number(i.qty), unitPrice: Number(i.unitPrice) })),
      discount: Number(s.discount ?? 0),
      total: s.total,
      paidBefore: Number(s.paidBefore ?? 0),
    }
  } catch {
    return null
  }
}

/** Sisa tagihan project setelah invoice ini dibayar. */
export const remainingAfter = (s: InvoiceSnapshot, amount: number): number => remaining(s.total, s.paidBefore + amount)

/* ---------- Identitas dan teks pesan ---------- */

export interface InvoiceIdentity {
  name: string
  address: string
  contact: string
  bank: string
  accountNo: string
  accountName: string
  footer: string
  prefix: string
  dpPercent: number
  /** Gambar logo sebagai data URL, atau kosong. */
  logo: string
  logoW: number
  logoH: number
}

export const DEFAULT_IDENTITY: InvoiceIdentity = {
  name: 'Momentum by Luna',
  address: '',
  contact: '',
  bank: '',
  accountNo: '',
  accountName: '',
  footer: '',
  prefix: 'MOM',
  dpPercent: 30,
  logo: '',
  logoW: 0,
  logoH: 0,
}

export interface InvoiceMessageInput {
  identity: InvoiceIdentity
  snapshot: InvoiceSnapshot
  kind: InvoiceKind
  number: string
  amount: number
  dueDate: string
}

/** Teks WhatsApp untuk mengirim invoice. PDF dilampirkan sendiri oleh pengirim. */
export function invoiceMessage(i: InvoiceMessageInput): string {
  const s = i.snapshot
  const acara = s.eventDate ? `${s.projectName} (${formatDate(s.eventDate)})` : s.projectName
  const lines = [
    `Halo ${s.clientName}, berikut invoice ${KIND_PHRASE[i.kind]} untuk ${acara}.`,
    '',
    `Nomor: ${i.number}`,
    `Jumlah: ${rupiah(i.amount)}`,
    `Jatuh tempo: ${formatDate(i.dueDate)}`,
  ]
  const sisa = remainingAfter(s, i.amount)
  if (i.kind !== 'penuh' && s.total > 0) lines.push(`Sisa setelah ini: ${rupiah(sisa)}`)
  const pay = [i.identity.bank && i.identity.accountNo ? `${i.identity.bank} ${i.identity.accountNo}` : i.identity.accountNo, i.identity.accountName ? `a.n. ${i.identity.accountName}` : '']
    .filter(Boolean)
  if (pay.length) lines.push('', 'Pembayaran ke:', ...pay)
  lines.push('', 'Invoice PDF terlampir. Terima kasih.')
  return lines.join('\n')
}

/** Teks lain-lain yang aman dipakai sebagai nama file. */
export function safeFileName(raw: string, max = 60): string {
  return raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, max) || 'invoice'
}
