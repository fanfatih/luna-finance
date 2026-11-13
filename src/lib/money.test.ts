import { describe, expect, it } from 'vitest'
import { parseNominal, rupiah, rupiahCompact } from './money'
import { computeProfit, profitWarning } from './profit'

const ok = (v: number) => ({ ok: true, value: v })

describe('parseNominal', () => {
  it.each([
    ['100ribu', 100_000],
    ['100rb', 100_000],
    ['100k', 100_000],
    ['100.000', 100_000],
    ['100000', 100_000],
    ['Rp 100.000', 100_000],
    ['Rp100.000', 100_000],
    ['1,5jt', 1_500_000],
    ['1.5jt', 1_500_000],
    ['2juta', 2_000_000],
    ['1.250.000', 1_250_000],
    ['  75 rb ', 75_000],
    ['2,5k', 2_500],
  ])('%s -> %i', (input, value) => {
    expect(parseNominal(input)).toEqual(ok(value))
  })

  it('menolak yang ambigu', () => {
    expect(parseNominal('1.5')).toEqual({ ok: false, reason: 'ambigu' })
    expect(parseNominal('100,5')).toEqual({ ok: false, reason: 'ambigu' })
  })

  it('menolak kosong, nol, dan sampah', () => {
    expect(parseNominal('')).toEqual({ ok: false, reason: 'kosong' })
    expect(parseNominal('0')).toEqual({ ok: false, reason: 'nol' })
    expect(parseNominal('abc')).toEqual({ ok: false, reason: 'tidak-valid' })
    expect(parseNominal('12rb3')).toEqual({ ok: false, reason: 'tidak-valid' })
  })

  it('menolak hasil pecahan Rupiah', () => {
    expect(parseNominal('1,2345rb')).toEqual({ ok: false, reason: 'tidak-valid' })
  })
})

describe('format', () => {
  it('rupiah', () => {
    expect(rupiah(1_234_567)).toBe('Rp1.234.567')
    expect(rupiah(-150_000)).toBe('-Rp150.000')
    expect(rupiah(0)).toBe('Rp0')
  })
  it('ringkas', () => {
    expect(rupiahCompact(1_500_000)).toBe('1,5jt')
    expect(rupiahCompact(250_000)).toBe('250rb')
    expect(rupiahCompact(900)).toBe('900')
  })
})

describe('computeProfit', () => {
  const base = {
    openingTotal: 1_000_000,
    closingTotal: 1_000_000,
    capitalNet: 0,
    piutangBaru: 0,
    piutangLunas: 0,
    utangBaru: 0,
    utangBayar: 0,
  }

  it('contoh PRD: pakai pribadi 200rb dicatat piutang -> profit 50rb', () => {
    // omzet 500rb, modal produk 450rb, 200rb dipakai pribadi, saldo akhir 850rb
    expect(computeProfit({ ...base, closingTotal: 850_000, piutangBaru: 200_000 })).toBe(50_000)
  })

  it('tanpa utang piutang, profit = selisih saldo', () => {
    expect(computeProfit({ ...base, closingTotal: 1_250_000 })).toBe(250_000)
  })

  it('setor modal tidak dihitung profit', () => {
    expect(computeProfit({ ...base, closingTotal: 1_500_000, capitalNet: 500_000 })).toBe(0)
  })

  it('tarik modal tidak dihitung rugi', () => {
    expect(computeProfit({ ...base, closingTotal: 800_000, capitalNet: -300_000 })).toBe(100_000)
  })

  it('piutang dibayar kembali bukan profit', () => {
    expect(computeProfit({ ...base, closingTotal: 1_200_000, piutangLunas: 200_000 })).toBe(0)
  })

  it('utang baru bukan profit, bayar utang bukan rugi', () => {
    expect(computeProfit({ ...base, closingTotal: 1_300_000, utangBaru: 300_000 })).toBe(0)
    expect(computeProfit({ ...base, closingTotal: 900_000, utangBayar: 100_000 })).toBe(0)
  })
})

describe('profitWarning', () => {
  it('negatif memberi peringatan', () => {
    expect(profitWarning(-1, null)).toMatch(/negatif/)
  })
  it('jauh di bawah rata-rata memberi peringatan', () => {
    expect(profitWarning(20_000, 100_000)).toMatch(/rata-rata/)
  })
  it('normal tanpa peringatan', () => {
    expect(profitWarning(90_000, 100_000)).toBeNull()
    expect(profitWarning(10_000, null)).toBeNull()
  })
})
