import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './adapter'
import { createSqlJsDb } from './sqljs'
import { migrate } from './schema'
import {
  addCapitalMove, addChannel, daySummary, avgProfit7, dayWarning, getDailyRecord,
  listChannels, saveDailyRecord, profitSeries, totalBalanceNow,
} from './finance'
import { addDebt, addPayment, balancesByContact, debtTotals, listDebts, listPayments } from './debts'

let db: Db
let seabank: string
let flip: string

beforeEach(async () => {
  db = await createSqlJsDb({ persistKey: null })
  await migrate(db)
  seabank = await addChannel(db, 'Seabank', 600_000, '2026-11-01')
  flip = await addChannel(db, 'Flip', 400_000, '2026-11-01')
})

describe('profit harian dari saldo channel', () => {
  it('contoh PRD: pakai pribadi 200rb dicatat piutang -> profit 50rb', async () => {
    await addDebt(db, { kind: 'piutang', contactName: 'Luthfan (pribadi)', amount: 200_000, date: '2026-11-02' })
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 500_000, [flip]: 350_000 }, null)
    const s = await daySummary(db, '2026-11-02')
    expect(s.openingTotal).toBe(1_000_000)
    expect(s.closingTotal).toBe(850_000)
    expect(s.delta).toBe(-150_000)
    expect(s.piutangBaru).toBe(200_000)
    expect(s.profit).toBe(50_000)
  })

  it('tanpa catatan hari itu, profit kosong', async () => {
    const s = await daySummary(db, '2026-11-02')
    expect(s.hasRecord).toBe(false)
    expect(s.profit).toBeNull()
  })

  it('saldo awal hari berikutnya mengikuti saldo akhir hari sebelumnya', async () => {
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 700_000, [flip]: 450_000 }, null)
    await saveDailyRecord(db, '2026-11-03', { [seabank]: 720_000, [flip]: 480_000 }, null)
    const s = await daySummary(db, '2026-11-03')
    expect(s.openingTotal).toBe(1_150_000)
    expect(s.profit).toBe(50_000)
  })

  it('simpan ulang hari yang sama memperbarui, bukan menggandakan', async () => {
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 700_000, [flip]: 450_000 }, 'awal')
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 710_000, [flip]: 450_000 }, 'revisi')
    const rec = await getDailyRecord(db, '2026-11-02')
    expect(rec?.balances[seabank]).toBe(710_000)
    expect(rec?.note).toBe('revisi')
    expect((await profitSeries(db, '2026-11-01', '2026-11-30')).length).toBe(1)
  })

  it('pindah saldo antar channel tidak mengubah profit', async () => {
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 300_000, [flip]: 800_000 }, null)
    expect((await daySummary(db, '2026-11-02')).profit).toBe(100_000)
  })

  it('setor modal tidak dihitung profit', async () => {
    await addCapitalMove(db, '2026-11-02', 500_000, 'Tambah modal')
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 1_100_000, [flip]: 400_000 }, null)
    expect((await daySummary(db, '2026-11-02')).profit).toBe(0)
  })

  it('channel baru setelah ada catatan otomatis dicatat sebagai setor modal', async () => {
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 600_000, [flip]: 400_000 }, null)
    const gopay = await addChannel(db, 'Gopay', 250_000, '2026-11-03')
    await saveDailyRecord(db, '2026-11-03', { [seabank]: 600_000, [flip]: 400_000, [gopay]: 250_000 }, null)
    const s = await daySummary(db, '2026-11-03')
    expect(s.capitalNet).toBe(250_000)
    expect(s.profit).toBe(0)
    expect((await listChannels(db)).length).toBe(3)
  })

  it('total saldo terkini mengikuti catatan terakhir', async () => {
    expect((await totalBalanceNow(db)).total).toBe(1_000_000)
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 700_000, [flip]: 450_000 }, null)
    expect(await totalBalanceNow(db)).toEqual({ total: 1_150_000, asOf: '2026-11-02' })
  })
})

describe('utang piutang', () => {
  it('piutang dibayar kembali bukan profit', async () => {
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 500_000, [flip]: 300_000 }, null) // profit 0? lihat di bawah
    const id = await addDebt(db, { kind: 'piutang', contactName: 'Budi', amount: 200_000, date: '2026-11-02' })
    await addPayment(db, id, 200_000, '2026-11-03')
    await saveDailyRecord(db, '2026-11-03', { [seabank]: 650_000, [flip]: 350_000 }, null)
    const s = await daySummary(db, '2026-11-03')
    expect(s.piutangLunas).toBe(200_000)
    // saldo naik 200rb dari pelunasan dan 0 dari usaha
    expect(s.delta).toBe(200_000)
    expect(s.profit).toBe(0)
  })

  it('utang baru bukan profit, bayar utang bukan rugi', async () => {
    await addDebt(db, { kind: 'utang', contactName: 'Supplier', amount: 300_000, date: '2026-11-02' })
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 900_000, [flip]: 400_000 }, null)
    expect((await daySummary(db, '2026-11-02')).profit).toBe(0)
  })

  it('pihak yang sama dikenali tanpa peduli huruf besar kecil', async () => {
    await addDebt(db, { kind: 'piutang', contactName: 'Budi', amount: 100_000, date: '2026-11-02' })
    await addDebt(db, { kind: 'piutang', contactName: ' budi ', amount: 50_000, date: '2026-11-03' })
    const per = await balancesByContact(db, '2026-11-04')
    expect(per.length).toBe(1)
    expect(per[0].piutang).toBe(150_000)
  })

  it('pembayaran sebagian, status, dan batas sisa', async () => {
    const id = await addDebt(db, {
      kind: 'piutang', contactName: 'Sari', amount: 300_000, date: '2026-11-02', dueDate: '2026-11-05',
    })
    await addPayment(db, id, 100_000, '2026-11-03')
    let [d] = await listDebts(db, '2026-11-04')
    expect(d.remaining).toBe(200_000)
    expect(d.status).toBe('berjalan')
    ;[d] = await listDebts(db, '2026-11-06')
    expect(d.status).toBe('jatuh-tempo')
    await expect(addPayment(db, id, 300_000, '2026-11-06')).rejects.toThrow(/melebihi/)
    await addPayment(db, id, 200_000, '2026-11-06')
    ;[d] = await listDebts(db, '2026-11-06')
    expect(d.status).toBe('lunas')
    expect((await listPayments(db, id)).length).toBe(2)
    expect(await debtTotals(db, '2026-11-06')).toEqual({ piutang: 0, utang: 0, piutangCount: 0, utangCount: 0 })
  })

  it('menolak nominal nol', async () => {
    await expect(addDebt(db, { kind: 'utang', contactName: 'X', amount: 0, date: '2026-11-02' })).rejects.toThrow()
  })
})

describe('peringatan profit', () => {
  it('memberi peringatan bila negatif', async () => {
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 500_000, [flip]: 400_000 }, null)
    const s = await daySummary(db, '2026-11-02')
    expect(s.profit).toBe(-100_000)
    expect(await dayWarning(db, s)).toMatch(/negatif/)
  })

  it('rata-rata 7 hari memakai hari yang punya catatan saja', async () => {
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 700_000, [flip]: 400_000 }, null) // +100rb
    await saveDailyRecord(db, '2026-11-03', { [seabank]: 800_000, [flip]: 500_000 }, null) // +200rb
    expect(await avgProfit7(db, '2026-11-04')).toBe(150_000)
  })
})
