import { stageLabel } from './momentum'

/** Satu sel CSV. Teks yang diawali = + - @ diberi petik supaya tidak terbaca sebagai rumus di Excel. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v)
  let s = v
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const csvRow = (cells: (string | number | null | undefined)[]): string => cells.map(csvCell).join(',')

const BOM = '﻿'

export interface ProjectFigures {
  name: string
  client_name: string
  event_date: string | null
  stage: string
  total: number
  paid: number
  cost: number
}

/** Margin dalam persen bulat, atau null bila nilai project nol. */
export const marginPct = (total: number, cost: number): number | null => (total > 0 ? Math.round(((total - cost) / total) * 100) : null)

/** Laporan project: nilai, dibayar, biaya, laba (nilai dikurangi biaya), dan margin. */
export function projectsCsv(rows: ProjectFigures[]): string {
  const head = ['Project', 'Klien', 'Tanggal acara', 'Tahap', 'Nilai project', 'Sudah dibayar', 'Biaya project', 'Laba project', 'Margin (%)']
  const lines = rows.map((r) =>
    csvRow([r.name, r.client_name, r.event_date ?? '', stageLabel(r.stage), r.total, r.paid, r.cost, r.total - r.cost, marginPct(r.total, r.cost)]),
  )
  return BOM + [csvRow(head), ...lines].join('\n')
}

/** Laporan tahunan per bulan: uang masuk, biaya, dan selisihnya. */
export function yearCsv(rows: { ym: string; income: number; costs: number }[]): string {
  const head = ['Bulan', 'Uang masuk', 'Biaya', 'Laba bersih']
  const lines = rows.map((r) => csvRow([r.ym, r.income, r.costs, r.income - r.costs]))
  return BOM + [csvRow(head), ...lines].join('\n')
}
