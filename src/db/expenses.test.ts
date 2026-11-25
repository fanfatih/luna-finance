import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './adapter'
import { createSqlJsDb } from './sqljs'
import { migrate } from './schema'
import { addCapitalMove, addChannel, archiveChannel, daySummary, saveDailyRecord, summariesBetween } from './finance'
import { addDebt, addPayment, listDebts } from './debts'
import {
  billReminderText, collectDueBillReminders, deleteBill, deleteExpense, dueBillReminders, listBills, listExpenses,
  monthBurden, payBill, saveBill, saveExpense, upcomingBills, yearBurden, type RecurringBill,
} from './expenses'
import { dumpAll, restoreAll } from './backup'

let db: Db
let seabank: string
let flip: string

beforeEach(async () => {
  db = await createSqlJsDb({ persistKey: null })
  await migrate(db)
  seabank = await addChannel(db, 'Seabank', 600_000, '2026-11-01')
  flip = await addChannel(db, 'Flip', 400_000, '2026-11-01')
})

const base = { category: 'server', spreadMonths: 1 as const, note: null }

describe('profit harian dan biaya operasional', () => {
  it('biaya yang dibayar dari saldo channel tidak memotong profit harian', async () => {
    await saveExpense(db, { ...base, date: '2026-11-02', name: 'Hosting', amount: 150_000, channelId: seabank })
    // jualan untung 500rb, lalu bayar hosting 150rb dari Seabank: saldo naik bersih 350rb
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 950_000, [flip]: 400_000 }, null)
    const s = await daySummary(db, '2026-11-02')
    expect(s.delta).toBe(350_000)
    expect(s.operasional).toBe(150_000)
    expect(s.profit).toBe(500_000)
  })

  it('biaya di luar saldo aplikasi tidak mengubah profit harian (saldo memang tidak turun)', async () => {
    await saveExpense(db, { ...base, date: '2026-11-02', name: 'Domain', amount: 180_000, channelId: null })
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 1_100_000, [flip]: 400_000 }, null)
    const s = await daySummary(db, '2026-11-02')
    expect(s.operasional).toBe(0)
    expect(s.profit).toBe(500_000)
  })

  it('biaya yang dihapus atau di tanggal lain tidak ikut', async () => {
    const id = await saveExpense(db, { ...base, date: '2026-11-02', name: 'Iklan', amount: 90_000, channelId: flip })
    await saveExpense(db, { ...base, date: '2026-11-03', name: 'Iklan', amount: 70_000, channelId: flip })
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 600_000, [flip]: 310_000 }, null)
    expect((await daySummary(db, '2026-11-02')).profit).toBe(0)
    await deleteExpense(db, id)
    expect((await daySummary(db, '2026-11-02')).profit).toBe(-90_000)
  })

  it('digabung dengan utang piutang dan modal', async () => {
    await addCapitalMove(db, '2026-11-02', 200_000, 'tambah')
    await addDebt(db, { kind: 'piutang', contactName: 'Budi', amount: 100_000, date: '2026-11-02' })
    await saveExpense(db, { ...base, date: '2026-11-02', name: 'Server', amount: 50_000, channelId: seabank })
    // 1.000.000 + untung 300rb + modal 200rb - piutang 100rb - biaya 50rb = 1.350.000
    await saveDailyRecord(db, '2026-11-02', { [seabank]: 950_000, [flip]: 400_000 }, null)
    expect((await daySummary(db, '2026-11-02')).profit).toBe(300_000)
  })
})

describe('validasi dan ubah biaya', () => {
  const ok = { ...base, date: '2026-11-02', name: 'Hosting', amount: 100_000, channelId: null }

  it('menolak isian yang tidak masuk akal', async () => {
    await expect(saveExpense(db, { ...ok, name: '  ' })).rejects.toThrow(/Nama biaya/)
    await expect(saveExpense(db, { ...ok, name: 'x'.repeat(81) })).rejects.toThrow(/terlalu panjang/)
    await expect(saveExpense(db, { ...ok, amount: 0 })).rejects.toThrow(/Nominal/)
    await expect(saveExpense(db, { ...ok, amount: 1.5 })).rejects.toThrow(/Nominal/)
    await expect(saveExpense(db, { ...ok, date: '2/11/2026' })).rejects.toThrow(/Tanggal/)
    await expect(saveExpense(db, { ...ok, category: 'judi' })).rejects.toThrow(/Kategori/)
    await expect(saveExpense(db, { ...ok, spreadMonths: 6 })).rejects.toThrow(/Pembagian/)
    await expect(saveExpense(db, { ...ok, channelId: 'tidak-ada' })).rejects.toThrow(/Channel/)
    expect((await listExpenses(db, '2026-01-01', '2026-12-31')).length).toBe(0)
  })

  it('mengubah biaya memperbarui baris yang sama dan memberi nama channel', async () => {
    const id = await saveExpense(db, ok)
    await saveExpense(db, { ...ok, name: 'Hosting Niagahoster', amount: 120_000, channelId: seabank }, id)
    const rows = await listExpenses(db, '2026-11-01', '2026-11-30')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Hosting Niagahoster', amount: 120_000, channel_name: 'Seabank' })
    await expect(saveExpense(db, ok, 'hilang')).rejects.toThrow(/tidak ditemukan/)
  })

  it('catatan lama dengan channel yang sudah diarsipkan tetap bisa diubah, tapi tidak bisa dipindah ke channel arsip lain', async () => {
    const id = await saveExpense(db, { ...ok, channelId: flip })
    await archiveChannel(db, flip)
    await saveExpense(db, { ...ok, name: 'Hosting baru', channelId: flip }, id)
    expect((await listExpenses(db, '2026-11-01', '2026-11-30'))[0].channel_name).toBe('Flip')
    await expect(saveExpense(db, { ...ok, channelId: flip })).rejects.toThrow(/Channel/)
  })
})

describe('beban bulanan untuk profit bersih', () => {
  it('biaya tahunan dibagi rata ke 12 bulan dan biaya sekali dihitung di bulannya', async () => {
    await saveExpense(db, { ...base, date: '2026-12-12', name: 'Domain', amount: 180_000, channelId: null, spreadMonths: 12 })
    await saveExpense(db, { ...base, date: '2026-12-05', name: 'Hosting', amount: 150_000, channelId: seabank })
    await saveExpense(db, { ...base, category: 'iklan', date: '2026-12-20', name: 'Iklan', amount: 455_000, channelId: null })

    const des = await monthBurden(db, '2026-12')
    expect(des.total).toBe(15_000 + 150_000 + 455_000)
    expect(des.byCategory).toEqual([
      { category: 'iklan', amount: 455_000 },
      { category: 'server', amount: 165_000 },
    ])
    expect((await monthBurden(db, '2027-01')).total).toBe(15_000)
    expect((await monthBurden(db, '2027-11')).total).toBe(15_000)
    expect((await monthBurden(db, '2027-12')).total).toBe(0)
    expect((await monthBurden(db, '2026-11')).total).toBe(0)
  })

  it('beban setahun menjumlah semua bagian, termasuk yang dibayar di akhir tahun sebelumnya', async () => {
    await saveExpense(db, { ...base, date: '2026-12-12', name: 'Domain', amount: 180_000, channelId: null, spreadMonths: 12 })
    await saveExpense(db, { ...base, date: '2027-03-10', name: 'Hosting', amount: 100_000, channelId: null })
    const y26 = await yearBurden(db, 2026)
    const y27 = await yearBurden(db, 2027)
    expect(y26).toHaveLength(12)
    expect(y26[11]).toBe(15_000)
    expect(y26.reduce((a, b) => a + b, 0)).toBe(15_000)
    expect(y27[0]).toBe(15_000)
    expect(y27[2]).toBe(115_000)
    // 11 bagian domain di 2027 (Jan sampai Nov) + hosting
    expect(y27.reduce((a, b) => a + b, 0)).toBe(11 * 15_000 + 100_000)
  })
})

describe('tagihan rutin', () => {
  const bill = { name: 'Hosting', category: 'server', amount: 150_000, period: 'bulanan', nextDue: '2026-12-05', channelId: seabankPlaceholder() }
  function seabankPlaceholder() { return null as string | null }

  it('menyimpan dan menolak isian tidak valid', async () => {
    const id = await saveBill(db, bill)
    expect((await listBills(db))[0]).toMatchObject({ id, name: 'Hosting', anchor_day: 5, next_due: '2026-12-05' })
    await expect(saveBill(db, { ...bill, name: '' })).rejects.toThrow(/Nama tagihan/)
    await expect(saveBill(db, { ...bill, amount: -5 })).rejects.toThrow(/Nominal/)
    await expect(saveBill(db, { ...bill, period: 'mingguan' })).rejects.toThrow(/Siklus/)
    await expect(saveBill(db, { ...bill, nextDue: 'besok' })).rejects.toThrow(/jatuh tempo/)
    await expect(saveBill(db, bill, 'hilang')).rejects.toThrow(/tidak ditemukan/)
  })

  it('sudah dibayar: membuat catatan biaya dan memajukan jatuh tempo satu siklus', async () => {
    const id = await saveBill(db, { ...bill, channelId: seabank })
    const eid = await payBill(db, id, { date: '2026-12-04', amount: 155_000, channelId: seabank })
    const [b] = await listBills(db)
    expect(b.next_due).toBe('2027-01-05')
    const [e] = await listExpenses(db, '2026-12-01', '2026-12-31')
    expect(e).toMatchObject({ id: eid, name: 'Hosting', amount: 155_000, spread_months: 1, recurring_id: id, channel_name: 'Seabank' })
  })

  it('tagihan tahunan dicatat dengan pembagian 12 bulan', async () => {
    const id = await saveBill(db, { name: 'Domain', category: 'server', amount: 180_000, period: 'tahunan', nextDue: '2026-12-12', channelId: null })
    await payBill(db, id, { date: '2026-12-12', amount: 180_000, channelId: null })
    expect((await listBills(db))[0].next_due).toBe('2027-12-12')
    expect((await listExpenses(db, '2026-12-01', '2026-12-31'))[0].spread_months).toBe(12)
    expect((await monthBurden(db, '2027-06')).total).toBe(15_000)
  })

  it('tanggal 31 tidak bergeser setelah melewati Februari, dan mengubah isian lain tidak mengubah acuannya', async () => {
    const id = await saveBill(db, { ...bill, nextDue: '2027-01-31' })
    await payBill(db, id, { date: '2027-01-31', amount: 150_000, channelId: null })
    expect((await listBills(db))[0].next_due).toBe('2027-02-28')
    await saveBill(db, { ...bill, nextDue: '2027-02-28', amount: 160_000 }, id)
    await payBill(db, id, { date: '2027-02-28', amount: 160_000, channelId: null })
    expect((await listBills(db))[0].next_due).toBe('2027-03-31')
  })

  it('tagihan yang dihapus tidak bisa dibayar, riwayat biayanya tetap', async () => {
    const id = await saveBill(db, bill)
    await payBill(db, id, { date: '2026-12-05', amount: 150_000, channelId: null })
    await deleteBill(db, id)
    expect(await listBills(db)).toHaveLength(0)
    await expect(payBill(db, id, { date: '2027-01-05', amount: 150_000, channelId: null })).rejects.toThrow(/tidak ditemukan/)
    expect(await listExpenses(db, '2026-12-01', '2026-12-31')).toHaveLength(1)
  })

  it('daftar terdekat urut jatuh tempo dan dibatasi', async () => {
    await saveBill(db, { ...bill, name: 'C', nextDue: '2026-12-20' })
    await saveBill(db, { ...bill, name: 'A', nextDue: '2026-12-01' })
    await saveBill(db, { ...bill, name: 'B', nextDue: '2026-12-10' })
    expect((await upcomingBills(db, 2)).map((b) => b.name)).toEqual(['A', 'B'])
  })
})

describe('pengingat tagihan', () => {
  const at = (d: string, h = 9, m = 0) => {
    const [y, mo, da] = d.split('-').map(Number)
    return new Date(y, mo - 1, da, h, m).getTime()
  }
  const mk = (over: Partial<RecurringBill> = {}): RecurringBill => ({
    id: 'b1', name: 'Hosting', category: 'server', amount: 150_000, period: 'bulanan', next_due: '2026-12-05',
    anchor_day: 5, channel_id: null, updated_at: at('2026-11-01'), ...over,
  })
  const none = new Set<string>()

  it('H-3 baru muncul jam 09.00 tiga hari sebelumnya', () => {
    expect(dueBillReminders([mk()], at('2026-12-01', 8, 59), none)).toHaveLength(0)
    const r = dueBillReminders([mk()], at('2026-12-02', 9, 0), none)
    expect(r).toHaveLength(1)
    expect(r[0].kind).toBe('h3')
    expect(billReminderText(r[0])).toEqual({ title: 'Tagihan Hosting', body: 'Jatuh tempo 5 Des, 3 hari lagi. Rp150.000.' })
  })

  it('H-3 tidak terulang dan hari-H muncul sendiri', () => {
    const first = dueBillReminders([mk()], at('2026-12-02', 9, 5), none)
    const logged = new Set(first.map((r) => r.key))
    expect(dueBillReminders([mk()], at('2026-12-03', 12), logged)).toHaveLength(0)
    const h0 = dueBillReminders([mk()], at('2026-12-05', 9, 1), logged)
    expect(h0.map((r) => r.kind)).toEqual(['h0'])
    expect(billReminderText(h0[0]).body).toBe('Jatuh tempo hari ini. Rp150.000.')
  })

  it('aplikasi baru dibuka di H-1 tetap mengingatkan satu kali dengan teks yang benar', () => {
    const r = dueBillReminders([mk()], at('2026-12-04', 14), none)
    expect(r.map((x) => x.kind)).toEqual(['h3'])
    expect(billReminderText(r[0]).body).toBe('Jatuh tempo 5 Des, besok. Rp150.000.')
  })

  it('terlambat diingatkan sekali per hari sampai dibayar', () => {
    const d1 = dueBillReminders([mk()], at('2026-12-07', 10), none)
    expect(d1.map((r) => r.kind)).toEqual(['late'])
    expect(billReminderText(d1[0]).body).toBe('Lewat 2 hari sejak 5 Des. Rp150.000.')
    const logged = new Set(d1.map((r) => r.key))
    expect(dueBillReminders([mk()], at('2026-12-07', 18), logged)).toHaveLength(0)
    expect(dueBillReminders([mk()], at('2026-12-08', 9, 30), logged)).toHaveLength(1)
  })

  it('tagihan yang baru dibuat atau diubah tidak mengingatkan waktu yang sudah lewat sebelumnya', () => {
    const fresh = mk({ updated_at: at('2026-12-03', 15) })
    expect(dueBillReminders([fresh], at('2026-12-03', 16), none)).toHaveLength(0)
    expect(dueBillReminders([fresh], at('2026-12-05', 9, 5), none).map((r) => r.kind)).toEqual(['h0'])
  })

  it('yang masih jauh tidak diingatkan', () => {
    expect(dueBillReminders([mk({ next_due: '2026-12-20' })], at('2026-12-05', 12), none)).toHaveLength(0)
  })

  it('collectDueBillReminders mencatat yang dikirim sehingga tidak muncul dua kali', async () => {
    const id = await saveBill(db, { name: 'Hosting', category: 'server', amount: 150_000, period: 'bulanan', nextDue: '2026-12-05', channelId: null })
    await db.run(`UPDATE recurring_expenses SET updated_at = ? WHERE id = ?`, [at('2026-11-01'), id])
    expect(await collectDueBillReminders(db, at('2026-12-01', 12))).toHaveLength(0)
    expect((await collectDueBillReminders(db, at('2026-12-03', 12))).map((r) => r.kind)).toEqual(['h3'])
    expect(await collectDueBillReminders(db, at('2026-12-03', 13))).toHaveLength(0)
    expect((await collectDueBillReminders(db, at('2026-12-05', 10))).map((r) => r.kind)).toEqual(['h0'])
    await payBill(db, id, { date: '2026-12-05', amount: 150_000, channelId: null })
    expect(await collectDueBillReminders(db, at('2026-12-06', 10))).toHaveLength(0)
  })
})

describe('ringkasan massal sama dengan per hari', () => {
  it('summariesBetween menghasilkan angka yang sama dengan daySummary', async () => {
    await addDebt(db, { kind: 'piutang', contactName: 'Budi', amount: 200_000, date: '2026-11-02' })
    await addDebt(db, { kind: 'utang', contactName: 'Sari', amount: 300_000, date: '2026-11-03' })
    const [piutang] = await listDebts(db, '2026-11-10', { kind: 'piutang' })
    await addPayment(db, piutang.id, 50_000, '2026-11-04')
    const [utang] = await listDebts(db, '2026-11-10', { kind: 'utang' })
    await addPayment(db, utang.id, 100_000, '2026-11-05')
    await addCapitalMove(db, '2026-11-03', 100_000, 'tambah')
    await saveExpense(db, { ...base, date: '2026-11-04', name: 'Hosting', amount: 150_000, channelId: seabank })
    await saveExpense(db, { ...base, date: '2026-11-05', name: 'Iklan', amount: 80_000, channelId: null })

    await saveDailyRecord(db, '2026-11-02', { [seabank]: 600_000, [flip]: 200_000 }, null)
    await saveDailyRecord(db, '2026-11-03', { [seabank]: 900_000, [flip]: 300_000 }, null)
    await saveDailyRecord(db, '2026-11-05', { [seabank]: 800_000, [flip]: 450_000 }, null)
    await saveDailyRecord(db, '2026-11-09', { [seabank]: 800_000, [flip]: 450_000 }, null)

    const bulk = await summariesBetween(db, '2026-11-01', '2026-11-30')
    expect(bulk.map((s) => s.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-09'])
    for (const s of bulk) expect(s).toEqual(await daySummary(db, s.date))
    // rentang yang dimulai di tengah tetap mengambil saldo awal dari catatan sebelumnya
    const tail = await summariesBetween(db, '2026-11-05', '2026-11-30')
    expect(tail[0]).toEqual(await daySummary(db, '2026-11-05'))
    expect(await summariesBetween(db, '2027-01-01', '2027-01-31')).toEqual([])
  })
})

describe('cadangan dan pemulihan', () => {
  it('biaya dan tagihan ikut diekspor dan dipulihkan', async () => {
    await saveExpense(db, { ...base, date: '2026-11-04', name: 'Hosting', amount: 150_000, channelId: seabank })
    await saveBill(db, { name: 'Domain', category: 'server', amount: 180_000, period: 'tahunan', nextDue: '2026-12-12', channelId: null })
    await saveDailyRecord(db, '2026-11-04', { [seabank]: 450_000, [flip]: 400_000 }, null)
    const before = await daySummary(db, '2026-11-04')
    const snap = JSON.parse(JSON.stringify(await dumpAll(db)))

    const other = await createSqlJsDb({ persistKey: null })
    await migrate(other)
    await restoreAll(other, snap)
    expect(await daySummary(other, '2026-11-04')).toEqual(before)
    expect(await listBills(other)).toHaveLength(1)
    expect(await listExpenses(other, '2026-11-01', '2026-11-30')).toHaveLength(1)
  })

  it('cadangan lama tanpa tabel baru tetap bisa dipulihkan', async () => {
    const snap = JSON.parse(JSON.stringify(await dumpAll(db)))
    delete snap.tables.expenses
    delete snap.tables.recurring_expenses
    const other = await createSqlJsDb({ persistKey: null })
    await migrate(other)
    await restoreAll(other, snap)
    expect(await listBills(other)).toHaveLength(0)
  })
})
