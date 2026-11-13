import { describe, expect, it } from 'vitest'
import { createSqlJsDb } from './sqljs'
import { migrate } from './schema'
import { dumpAll, restoreAll, validateBackup } from './backup'
import { addChannel, daySummary, saveDailyRecord } from './finance'
import { addDebt } from './debts'

async function fresh() {
  const db = await createSqlJsDb({ persistKey: null })
  await migrate(db)
  return db
}

describe('cadangan', () => {
  it('ekspor lalu pulihkan ke database kosong menghasilkan profit yang sama', async () => {
    const a = await fresh()
    const sb = await addChannel(a, 'Seabank', 1_000_000, '2026-11-01')
    await addDebt(a, { kind: 'piutang', contactName: 'Budi', amount: 200_000, date: '2026-11-02' })
    await saveDailyRecord(a, '2026-11-02', { [sb]: 850_000 }, 'tes')
    const before = await daySummary(a, '2026-11-02')

    const json = JSON.parse(JSON.stringify(await dumpAll(a)))
    const b = await fresh()
    await restoreAll(b, json)
    const after = await daySummary(b, '2026-11-02')
    expect(after).toEqual(before)
    expect(after.profit).toBe(50_000)
  })

  it('memulihkan menimpa isi lama', async () => {
    const a = await fresh()
    await addChannel(a, 'Flip', 100, '2026-11-01')
    const snap = JSON.parse(JSON.stringify(await dumpAll(a)))
    await addChannel(a, 'Jago', 200, '2026-11-01')
    await restoreAll(a, snap)
    const rows = await a.all(`SELECT name FROM channels`)
    expect(rows).toEqual([{ name: 'Flip' }])
  })

  it('menolak berkas yang bukan cadangan dan tidak menghapus apa pun', async () => {
    const a = await fresh()
    await addChannel(a, 'Flip', 100, '2026-11-01')
    await expect(restoreAll(a, { hello: 'world' })).rejects.toThrow(/bukan cadangan/)
    expect((await a.all(`SELECT * FROM channels`)).length).toBe(1)
    expect(() => validateBackup({ app: 'luna-finance', version: 1, tables: {} })).toThrow(/tidak lengkap/)
  })

  it('menolak nama kolom berbahaya', async () => {
    const a = await fresh()
    const snap = JSON.parse(JSON.stringify(await dumpAll(a)))
    snap.tables.channels = [{ 'id) VALUES (1); DROP TABLE debts; --': 'x' }]
    await expect(restoreAll(a, snap)).rejects.toThrow(/tidak valid/)
  })
})
