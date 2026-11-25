import { diffDays } from './date'

/** Kategori biaya operasional. Urutan tampil di pilihan. */
export const EXPENSE_CATEGORIES = [
  { id: 'server', label: 'Server dan domain' },
  { id: 'iklan', label: 'Iklan' },
  { id: 'langganan', label: 'Langganan' },
  { id: 'gaji', label: 'Gaji' },
  { id: 'lain', label: 'Lain-lain' },
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]['id']

export const categoryLabel = (id: string): string =>
  EXPENSE_CATEGORIES.find((c) => c.id === id)?.label ?? 'Lain-lain'

export const isCategory = (id: string): id is ExpenseCategory => EXPENSE_CATEGORIES.some((c) => c.id === id)

export type BillPeriod = 'bulanan' | 'tahunan'

const pad = (n: number) => String(n).padStart(2, '0')

/** Nomor bulan berurutan dari 'YYYY-MM', dipakai untuk menghitung jarak antar bulan. */
export function monthIndex(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return y * 12 + (m - 1)
}

export function shiftYm(ym: string, n: number): string {
  const i = monthIndex(ym) + n
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`
}

/**
 * Jatuh tempo berikutnya setelah `due`. Tanggal dijaga mengikuti `anchorDay`, jadi tagihan tiap
 * tanggal 31 jatuh di 28 Februari lalu kembali ke 31 Maret (tidak bergeser ke 28 seterusnya).
 */
export function dueDateAfter(due: string, period: BillPeriod, anchorDay: number): string {
  const idx = monthIndex(due.slice(0, 7)) + (period === 'bulanan' ? 1 : 12)
  const y = Math.floor(idx / 12)
  const m = idx % 12
  const dim = new Date(y, m + 1, 0).getDate()
  return `${y}-${pad(m + 1)}-${pad(Math.min(Math.max(anchorDay, 1), dim))}`
}

/**
 * Bagian biaya yang jatuh di bulan `ym`. Biaya yang dibagi ke `spread` bulan dimulai dari bulan
 * dibayar. Sisa pembulatan masuk ke bulan-bulan paling awal, jadi jumlah seluruh bagian = nominal.
 */
export function monthShare(amount: number, spread: number, startYm: string, ym: string): number {
  const n = Math.max(1, Math.floor(spread))
  const idx = monthIndex(ym) - monthIndex(startYm)
  if (idx < 0 || idx >= n) return 0
  const base = Math.floor(amount / n)
  return base + (idx < amount - base * n ? 1 : 0)
}

export type BillState = 'terlambat' | 'hari-ini' | 'segera' | 'nanti'

export interface BillStatus {
  state: BillState
  /** Selisih hari ke jatuh tempo. Negatif bila sudah lewat. */
  days: number
  label: string
}

/** Status tagihan terhadap hari ini. "Segera" berarti 3 hari atau kurang. */
export function billStatus(nextDue: string, today: string): BillStatus {
  const days = diffDays(today, nextDue)
  if (days < 0) return { state: 'terlambat', days, label: `Terlambat ${-days} hari` }
  if (days === 0) return { state: 'hari-ini', days, label: 'Jatuh tempo hari ini' }
  return { state: days <= 3 ? 'segera' : 'nanti', days, label: days === 1 ? 'Besok' : `${days} hari lagi` }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** "Tiap tanggal 5" atau "Tiap tahun, 12 Des". */
export function periodText(period: BillPeriod, nextDue: string, anchorDay: number): string {
  if (period === 'bulanan') return `Tiap bulan, tanggal ${anchorDay}`
  return `Tiap tahun, ${anchorDay} ${MONTHS[Number(nextDue.slice(5, 7)) - 1]}`
}
