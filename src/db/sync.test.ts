import { describe, expect, it } from 'vitest'
import { createSqlJsDb } from './sqljs'
import { migrate } from './schema'
import { SYNC_TABLES, syncNow } from './sync'
import { addChannel, daySummary, saveDailyRecord } from './finance'
import { addDebt, addPayment, listDebts } from './debts'
import { listBills, listExpenses, monthBurden, payBill, saveBill, saveExpense } from './expenses'

/** Server palsu yang meniru fungsi sync di Supabase: LWW per id, kursor (synced_at, id). */
function fakeServer(key = 'rahasia') {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {}
  for (const t of SYNC_TABLES) tables[t] = new Map()
  let clock = 1000
  const handler = async (_url: unknown, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    if (headers['x-sync-key'] !== key) return new Response(JSON.stringify({ error: 'salah' }), { status: 401 })
    const body = JSON.parse(String(init.body))
    clock += 1
    for (const t of SYNC_TABLES) {
      for (const r of (body.push?.[t] ?? []) as Record<string, unknown>[]) {
        const cur = tables[t].get(String(r.id))
        if (!cur || Number(cur.updated_at) < Number(r.updated_at)) tables[t].set(String(r.id), { ...r, synced_at: clock })
      }
    }
    const pull: Record<string, unknown> = {}
    let more = false
    for (const t of SYNC_TABLES) {
      const [tsRaw, id = '0'] = String(body.since?.[t] ?? '0|0').split('|')
      const ts = Number(tsRaw)
      const rows = [...tables[t].values()]
        .filter((r) => Number(r.synced_at) > ts || (Number(r.synced_at) === ts && String(r.id) > id))
        .sort((a, b) => Number(a.synced_at) - Number(b.synced_at) || String(a.id).localeCompare(String(b.id)))
        .slice(0, 2)
      const last = rows[rows.length - 1]
      pull[t] = { rows, next: last ? `${last.synced_at}|${last.id}` : null }
      if (rows.length === 2) more = true
    }
    return new Response(JSON.stringify({ pull, more }), { status: 200 })
  }
  return { tables, fetch: handler as unknown as typeof fetch, tick: () => (clock += 10) }
}

async function fresh() {
  const db = await createSqlJsDb({ persistKey: null })
  await migrate(db)
  return db
}
const cfg = { url: 'https://x.test', key: 'rahasia' }

describe('sinkron', () => {
  it('perangkat kedua mendapat data dari yang pertama, termasuk profit yang sama', async () => {
    const srv = fakeServer()
    const a = await fresh()
    const sb = await addChannel(a, 'Seabank', 1_000_000, '2026-11-01')
    await addDebt(a, { kind: 'piutang', contactName: 'Budi', amount: 200_000, date: '2026-11-02' })
    await saveDailyRecord(a, '2026-11-02', { [sb]: 850_000 }, null)
    const r = await syncNow(a, cfg, srv.fetch)
    expect(r.pushed).toBeGreaterThan(0)

    const b = await fresh()
    await syncNow(b, cfg, srv.fetch)
    expect((await daySummary(b, '2026-11-02')).profit).toBe(50_000)
  })

  it('catatan yang masuk dari luar (bot) muncul setelah sinkron, tanpa menggandakan', async () => {
    const srv = fakeServer()
    const a = await fresh()
    await syncNow(a, cfg, srv.fetch)
    const now = Date.now()
    srv.tick()
    srv.tables.contacts.set('c1', { id: 'c1', name: 'Siti', phone: null, note: null, updated_at: now, deleted_at: null, synced_at: 5000 })
    srv.tables.debts.set('d1', { id: 'd1', kind: 'piutang', contact_id: 'c1', amount: 75_000, date: '2026-11-13', due_date: null, note: null, updated_at: now, deleted_at: null, synced_at: 5000 })
    await syncNow(a, cfg, srv.fetch)
    await syncNow(a, cfg, srv.fetch)
    const list = await listDebts(a, '2026-11-13')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ contact_name: 'Siti', remaining: 75_000 })
  })

  it('perubahan terbaru menang, dan hapus lunak ikut tersinkron', async () => {
    const srv = fakeServer()
    const a = await fresh()
    const b = await fresh()
    const id = await addDebt(a, { kind: 'utang', contactName: 'Andi', amount: 100_000, date: '2026-11-03' })
    await syncNow(a, cfg, srv.fetch)
    await syncNow(b, cfg, srv.fetch)
    await addPayment(b, id, 40_000, '2026-11-04')
    await new Promise((r) => setTimeout(r, 5))
    await a.run(`UPDATE debts SET deleted_at = ?, updated_at = ? WHERE id = ?`, [Date.now(), Date.now(), id])
    await syncNow(a, cfg, srv.fetch)
    await syncNow(b, cfg, srv.fetch)
    expect(await listDebts(b, '2026-11-05')).toHaveLength(0)
    expect(srv.tables.debt_payments.size).toBe(1)
  })

  it('mengambil banyak baris bertahap sampai habis', async () => {
    const srv = fakeServer()
    const a = await fresh()
    for (let i = 0; i < 5; i++) await addDebt(a, { kind: 'piutang', contactName: `P${i}`, amount: 1000 + i, date: '2026-11-05' })
    await syncNow(a, cfg, srv.fetch)
    const b = await fresh()
    const r = await syncNow(b, cfg, srv.fetch)
    expect(r.pulled).toBe(10)
    expect(await listDebts(b, '2026-11-05')).toHaveLength(5)
  })

  it('biaya operasional dan tagihan rutin tersinkron, profit dan jatuh tempo sama di perangkat kedua', async () => {
    const srv = fakeServer()
    const a = await fresh()
    const sb = await addChannel(a, 'Seabank', 1_000_000, '2026-11-01')
    await saveExpense(a, { date: '2026-12-02', name: 'Hosting', category: 'server', amount: 150_000, channelId: sb, spreadMonths: 1 })
    await saveExpense(a, { date: '2026-12-02', name: 'Domain', category: 'server', amount: 180_000, channelId: null, spreadMonths: 12 })
    const bill = await saveBill(a, { name: 'Hosting', category: 'server', amount: 150_000, period: 'bulanan', nextDue: '2026-12-05', channelId: sb })
    await payBill(a, bill, { date: '2026-12-02', amount: 150_000, channelId: sb })
    await saveDailyRecord(a, '2026-12-02', { [sb]: 700_000 }, null)
    await syncNow(a, cfg, srv.fetch)

    const b = await fresh()
    await syncNow(b, cfg, srv.fetch)
    expect((await listExpenses(b, '2026-12-01', '2026-12-31')).length).toBe(3)
    expect((await listBills(b))[0].next_due).toBe('2027-01-05')
    expect((await monthBurden(b, '2027-03')).total).toBe(15_000)
    expect(await daySummary(b, '2026-12-02')).toEqual(await daySummary(a, '2026-12-02'))
  })

  it('kunci salah memberi pesan yang jelas', async () => {
    const srv = fakeServer()
    const a = await fresh()
    await expect(syncNow(a, { ...cfg, key: 'salah' }, srv.fetch)).rejects.toThrow('Kunci sinkron salah')
  })
})
