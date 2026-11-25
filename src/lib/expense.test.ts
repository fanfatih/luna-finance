import { describe, expect, it } from 'vitest'
import { billStatus, dueDateAfter, monthShare, periodText, shiftYm } from './expense'

describe('jatuh tempo berikutnya', () => {
  it('bulanan maju satu bulan, termasuk pergantian tahun', () => {
    expect(dueDateAfter('2026-11-05', 'bulanan', 5)).toBe('2026-12-05')
    expect(dueDateAfter('2026-12-05', 'bulanan', 5)).toBe('2027-01-05')
  })

  it('tanggal 31 jatuh di akhir bulan pendek lalu kembali ke 31', () => {
    const feb = dueDateAfter('2027-01-31', 'bulanan', 31)
    expect(feb).toBe('2027-02-28')
    expect(dueDateAfter(feb, 'bulanan', 31)).toBe('2027-03-31')
    expect(dueDateAfter('2027-03-31', 'bulanan', 31)).toBe('2027-04-30')
  })

  it('tahun kabisat: 29 Februari menjadi 28 Februari di tahun biasa', () => {
    expect(dueDateAfter('2028-02-29', 'tahunan', 29)).toBe('2029-02-28')
    expect(dueDateAfter('2029-02-28', 'tahunan', 29)).toBe('2030-02-28')
  })

  it('tahunan maju satu tahun di tanggal yang sama', () => {
    expect(dueDateAfter('2026-12-12', 'tahunan', 12)).toBe('2027-12-12')
  })
})

describe('pembagian biaya ke bulan', () => {
  it('biaya sekali dihitung penuh di bulan dibayar saja', () => {
    expect(monthShare(150_000, 1, '2026-12', '2026-12')).toBe(150_000)
    expect(monthShare(150_000, 1, '2026-12', '2027-01')).toBe(0)
    expect(monthShare(150_000, 1, '2026-12', '2026-11')).toBe(0)
  })

  it('biaya tahunan dibagi rata ke 12 bulan mulai bulan dibayar', () => {
    expect(monthShare(180_000, 12, '2026-12', '2026-12')).toBe(15_000)
    expect(monthShare(180_000, 12, '2026-12', '2027-11')).toBe(15_000)
    expect(monthShare(180_000, 12, '2026-12', '2027-12')).toBe(0)
    expect(monthShare(180_000, 12, '2026-12', '2026-11')).toBe(0)
  })

  it('sisa pembulatan tidak hilang: jumlah 12 bagian sama dengan nominal', () => {
    let sum = 0
    for (let i = 0; i < 12; i++) sum += monthShare(100_005, 12, '2026-12', shiftYm('2026-12', i))
    expect(sum).toBe(100_005)
    // 100.005 / 12 = 8.333 sisa 9, jadi 9 bulan pertama dapat 8.334 dan 3 bulan terakhir 8.333
    expect(monthShare(100_005, 12, '2026-12', '2026-12')).toBe(8_334)
    expect(monthShare(100_005, 12, '2026-12', '2027-08')).toBe(8_334)
    expect(monthShare(100_005, 12, '2026-12', '2027-09')).toBe(8_333)
    expect(monthShare(100_005, 12, '2026-12', '2027-11')).toBe(8_333)
  })
})

describe('status tagihan', () => {
  it('terlambat, hari ini, segera, nanti', () => {
    expect(billStatus('2026-11-23', '2026-11-25')).toMatchObject({ state: 'terlambat', days: -2, label: 'Terlambat 2 hari' })
    expect(billStatus('2026-11-25', '2026-11-25')).toMatchObject({ state: 'hari-ini' })
    expect(billStatus('2026-11-26', '2026-11-25')).toMatchObject({ state: 'segera', label: 'Besok' })
    expect(billStatus('2026-11-28', '2026-11-25')).toMatchObject({ state: 'segera', label: '3 hari lagi' })
    expect(billStatus('2026-11-29', '2026-11-25')).toMatchObject({ state: 'nanti', label: '4 hari lagi' })
  })

  it('teks siklus', () => {
    expect(periodText('bulanan', '2026-12-05', 5)).toBe('Tiap bulan, tanggal 5')
    expect(periodText('tahunan', '2026-12-12', 12)).toBe('Tiap tahun, 12 Des')
  })
})
