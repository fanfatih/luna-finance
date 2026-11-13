/** Uang selalu disimpan sebagai bilangan bulat Rupiah. */

export type ParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'kosong' | 'ambigu' | 'tidak-valid' | 'nol' }

const SUFFIX: Record<string, number> = {
  rb: 1_000,
  ribu: 1_000,
  k: 1_000,
  jt: 1_000_000,
  juta: 1_000_000,
}

/**
 * Membaca nominal yang diketik bebas.
 * Diterima: 100ribu, 100rb, 100k, 100.000, 100000, Rp 100.000, 1,5jt, 2juta.
 * Titik diikuti tepat 3 digit dianggap pemisah ribuan. Dengan satuan (rb/k/jt),
 * titik atau koma dianggap desimal. "1.5" tanpa satuan dianggap ambigu.
 */
export function parseNominal(raw: string): ParseResult {
  let s = raw.toLowerCase().replace(/rp\.?/g, '').replace(/\s+/g, '')
  if (!s) return { ok: false, reason: 'kosong' }

  let mult = 1
  const m = s.match(/^([\d.,]+)(ribu|rb|k|juta|jt)$/)
  if (m) {
    s = m[1]
    mult = SUFFIX[m[2]]
    if (!/^\d+([.,]\d+)?$/.test(s)) return { ok: false, reason: 'tidak-valid' }
    const n = Number(s.replace(',', '.'))
    return finish(Math.round(n * mult), n * mult)
  }

  if (/^\d+$/.test(s)) return finish(Number(s), Number(s))
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
    const n = Number(s.replace(/[.,]/g, ''))
    return finish(n, n)
  }
  if (/^\d+[.,]\d+$/.test(s)) return { ok: false, reason: 'ambigu' }
  return { ok: false, reason: 'tidak-valid' }
}

function finish(rounded: number, exact: number): ParseResult {
  if (!Number.isFinite(rounded)) return { ok: false, reason: 'tidak-valid' }
  if (Math.abs(rounded - exact) > 1e-6) return { ok: false, reason: 'tidak-valid' }
  if (rounded <= 0) return { ok: false, reason: 'nol' }
  return { ok: true, value: rounded }
}

export function parseMessage(reason: Exclude<ParseResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'kosong':
      return 'Isi nominalnya dulu.'
    case 'ambigu':
      return 'Nominalnya bisa dibaca dua cara. Tulis lengkap, misalnya 1.500 atau 1,5jt.'
    case 'nol':
      return 'Nominal harus lebih dari nol.'
    default:
      return 'Nominal tidak terbaca. Contoh: 100rb, 100.000, 1,5jt.'
  }
}

function group(n: number): string {
  return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Rp1.234.567, negatif jadi -Rp1.234.567 */
export function rupiah(n: number): string {
  return `${n < 0 ? '-' : ''}Rp${group(n)}`
}

/** Dengan tanda + untuk positif, dipakai untuk selisih/profit. */
export function rupiahSigned(n: number): string {
  return `${n > 0 ? '+' : ''}${rupiah(n)}`
}

/** Angka ringkas untuk sumbu grafik: 1,5jt, 250rb */
export function rupiahCompact(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1_000_000) return `${sign}${trim(a / 1_000_000)}jt`
  if (a >= 1_000) return `${sign}${trim(a / 1_000)}rb`
  return `${sign}${a}`
}

function trim(x: number): string {
  return (Math.round(x * 10) / 10).toString().replace('.', ',')
}
