import type { Db } from './adapter'
import { addDays } from '@/lib/date'
import { computeProfit, profitWarning } from '@/lib/profit'

export const uid = (): string => crypto.randomUUID()
const now = (): number => Date.now()

/* ---------- Pengaturan ---------- */

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const r = await db.all<{ value: string | null }>(`SELECT value FROM settings WHERE key = ?`, [key])
  return r.length ? r[0].value : null
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`, [key, value, now()])
}

/* ---------- Channel ---------- */

export interface Channel {
  id: string
  name: string
  initial_balance: number
  initial_date: string
  sort: number
}

export async function listChannels(db: Db): Promise<Channel[]> {
  return db.all<Channel>(
    `SELECT id, name, initial_balance, initial_date, sort FROM channels
     WHERE deleted_at IS NULL ORDER BY sort, name`,
  )
}

/**
 * Tambah channel. Bila sudah ada catatan harian sebelumnya, saldo awal channel
 * dicatat juga sebagai setor modal pada tanggalnya, agar tidak dihitung sebagai profit.
 */
export async function addChannel(db: Db, name: string, initialBalance: number, date: string): Promise<string> {
  const id = uid()
  const max = await db.all<{ m: number | null }>(`SELECT MAX(sort) AS m FROM channels WHERE deleted_at IS NULL`)
  const sort = (max[0]?.m ?? -1) + 1
  await db.run(
    `INSERT INTO channels (id, name, initial_balance, initial_date, sort, updated_at) VALUES (?,?,?,?,?,?)`,
    [id, name.trim(), initialBalance, date, sort, now()],
  )
  const prior = await db.all(`SELECT 1 FROM daily_records WHERE deleted_at IS NULL AND date < ? LIMIT 1`, [date])
  if (prior.length && initialBalance > 0) {
    await addCapitalMove(db, date, initialBalance, `Saldo awal channel ${name.trim()}`)
  }
  return id
}

export async function renameChannel(db: Db, id: string, name: string): Promise<void> {
  await db.run(`UPDATE channels SET name = ?, updated_at = ? WHERE id = ?`, [name.trim(), now(), id])
}

export async function archiveChannel(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE channels SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
}

/** Saldo terakhir yang tercatat untuk satu channel (atau saldo awalnya). */
export async function latestChannelBalance(db: Db, channelId: string): Promise<number> {
  const r = await db.all<{ balance: number }>(
    `SELECT b.balance FROM daily_balances b
     JOIN daily_records r ON r.id = b.record_id
     WHERE b.channel_id = ? AND b.deleted_at IS NULL AND r.deleted_at IS NULL
     ORDER BY r.date DESC LIMIT 1`,
    [channelId],
  )
  if (r.length) return r[0].balance
  const c = await db.all<{ initial_balance: number }>(`SELECT initial_balance FROM channels WHERE id = ?`, [channelId])
  return c[0]?.initial_balance ?? 0
}

/* ---------- Catatan harian ---------- */

export interface DailyRecord {
  id: string
  date: string
  note: string | null
  balances: Record<string, number>
}

export async function getDailyRecord(db: Db, date: string): Promise<DailyRecord | null> {
  const r = await db.all<{ id: string; date: string; note: string | null }>(
    `SELECT id, date, note FROM daily_records WHERE date = ? AND deleted_at IS NULL LIMIT 1`,
    [date],
  )
  if (!r.length) return null
  const rows = await db.all<{ channel_id: string; balance: number }>(
    `SELECT channel_id, balance FROM daily_balances WHERE record_id = ? AND deleted_at IS NULL`,
    [r[0].id],
  )
  const balances: Record<string, number> = {}
  for (const x of rows) balances[x.channel_id] = x.balance
  return { ...r[0], balances }
}

export async function saveDailyRecord(
  db: Db,
  date: string,
  balances: Record<string, number>,
  note: string | null,
): Promise<void> {
  const existing = await db.all<{ id: string }>(
    `SELECT id FROM daily_records WHERE date = ? AND deleted_at IS NULL LIMIT 1`,
    [date],
  )
  let recordId: string
  if (existing.length) {
    recordId = existing[0].id
    await db.run(`UPDATE daily_records SET note = ?, updated_at = ? WHERE id = ?`, [note, now(), recordId])
  } else {
    recordId = uid()
    await db.run(`INSERT INTO daily_records (id, date, note, updated_at) VALUES (?,?,?,?)`, [
      recordId, date, note, now(),
    ])
  }
  for (const [channelId, balance] of Object.entries(balances)) {
    const row = await db.all<{ id: string }>(
      `SELECT id FROM daily_balances WHERE record_id = ? AND channel_id = ? AND deleted_at IS NULL LIMIT 1`,
      [recordId, channelId],
    )
    if (row.length) {
      await db.run(`UPDATE daily_balances SET balance = ?, updated_at = ? WHERE id = ?`, [balance, now(), row[0].id])
    } else {
      await db.run(
        `INSERT INTO daily_balances (id, record_id, channel_id, balance, updated_at) VALUES (?,?,?,?,?)`,
        [uid(), recordId, channelId, balance, now()],
      )
    }
  }
}

export async function deleteDailyRecord(db: Db, date: string): Promise<void> {
  await db.run(`UPDATE daily_records SET deleted_at = ?, updated_at = ? WHERE date = ? AND deleted_at IS NULL`, [
    now(), now(), date,
  ])
}

export async function listRecordDates(db: Db, from: string, to: string): Promise<string[]> {
  const r = await db.all<{ date: string }>(
    `SELECT date FROM daily_records WHERE deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date`,
    [from, to],
  )
  return r.map((x) => x.date)
}

/* ---------- Setor / tarik modal ---------- */

export interface CapitalMove {
  id: string
  date: string
  amount: number
  note: string | null
}

export async function addCapitalMove(db: Db, date: string, amount: number, note: string | null): Promise<void> {
  await db.run(`INSERT INTO capital_moves (id, date, amount, note, updated_at) VALUES (?,?,?,?,?)`, [
    uid(), date, amount, note, now(),
  ])
}

export async function listCapitalMoves(db: Db, date: string): Promise<CapitalMove[]> {
  return db.all<CapitalMove>(
    `SELECT id, date, amount, note FROM capital_moves WHERE date = ? AND deleted_at IS NULL ORDER BY updated_at`,
    [date],
  )
}

export async function deleteCapitalMove(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE capital_moves SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), id])
}

/* ---------- Ringkasan & profit harian ---------- */

export interface DaySummary {
  date: string
  hasRecord: boolean
  openingTotal: number
  closingTotal: number
  delta: number
  capitalNet: number
  piutangBaru: number
  piutangLunas: number
  utangBaru: number
  utangBayar: number
  /** Biaya operasional yang dibayar dari saldo channel hari itu (sudah dikembalikan ke profit). */
  operasional: number
  profit: number | null
}

async function sumOne(db: Db, sql: string, params: unknown[]): Promise<number> {
  const r = await db.all<{ s: number | null }>(sql, params)
  return r[0]?.s ?? 0
}

export async function openingTotalFor(db: Db, date: string): Promise<number> {
  const prev = await db.all<{ id: string }>(
    `SELECT id FROM daily_records WHERE deleted_at IS NULL AND date < ? ORDER BY date DESC LIMIT 1`,
    [date],
  )
  if (prev.length) {
    return sumOne(db, `SELECT SUM(balance) AS s FROM daily_balances WHERE record_id = ? AND deleted_at IS NULL`, [
      prev[0].id,
    ])
  }
  return sumOne(
    db,
    `SELECT SUM(initial_balance) AS s FROM channels WHERE deleted_at IS NULL AND initial_date <= ?`,
    [date],
  )
}

export async function daySummary(db: Db, date: string): Promise<DaySummary> {
  const rec = await db.all<{ id: string }>(
    `SELECT id FROM daily_records WHERE date = ? AND deleted_at IS NULL LIMIT 1`,
    [date],
  )
  const openingTotal = await openingTotalFor(db, date)
  const closingTotal = rec.length
    ? await sumOne(db, `SELECT SUM(balance) AS s FROM daily_balances WHERE record_id = ? AND deleted_at IS NULL`, [
        rec[0].id,
      ])
    : openingTotal
  const capitalNet = await sumOne(db, `SELECT SUM(amount) AS s FROM capital_moves WHERE date = ? AND deleted_at IS NULL`, [
    date,
  ])
  const newDebt = (kind: string) =>
    sumOne(db, `SELECT SUM(amount) AS s FROM debts WHERE kind = ? AND date = ? AND deleted_at IS NULL`, [kind, date])
  const paid = (kind: string) =>
    sumOne(
      db,
      `SELECT SUM(p.amount) AS s FROM debt_payments p JOIN debts d ON d.id = p.debt_id
       WHERE d.kind = ? AND p.date = ? AND p.deleted_at IS NULL AND d.deleted_at IS NULL`,
      [kind, date],
    )
  const [piutangBaru, utangBaru, piutangLunas, utangBayar, operasional] = await Promise.all([
    newDebt('piutang'), newDebt('utang'), paid('piutang'), paid('utang'),
    sumOne(
      db,
      `SELECT SUM(amount) AS s FROM expenses WHERE date = ? AND channel_id IS NOT NULL AND deleted_at IS NULL`,
      [date],
    ),
  ])
  const hasRecord = rec.length > 0
  const profit = hasRecord
    ? computeProfit({ openingTotal, closingTotal, capitalNet, piutangBaru, piutangLunas, utangBaru, utangBayar, operasional })
    : null
  return {
    date, hasRecord, openingTotal, closingTotal, delta: closingTotal - openingTotal,
    capitalNet, piutangBaru, piutangLunas, utangBaru, utangBayar, operasional, profit,
  }
}

/**
 * Ringkasan semua hari yang punya catatan di rentang tanggal, dengan sedikit query saja.
 * Hasilnya sama dengan memanggil daySummary per tanggal. Dipakai laporan tahunan yang bisa 365 hari.
 */
export async function summariesBetween(db: Db, from: string, to: string): Promise<DaySummary[]> {
  const recs = await db.all<{ date: string; total: number | null }>(
    `SELECT r.date, (SELECT SUM(b.balance) FROM daily_balances b WHERE b.record_id = r.id AND b.deleted_at IS NULL) AS total
     FROM daily_records r WHERE r.deleted_at IS NULL AND r.date BETWEEN ? AND ? ORDER BY r.date, r.rowid`,
    [from, to],
  )
  // Satu catatan per tanggal, sama seperti daySummary yang mengambil satu baris.
  const records = recs.filter((r, i) => i === 0 || recs[i - 1].date !== r.date)
  if (!records.length) return []

  const byDate = async (sql: string): Promise<Map<string, number>> => {
    const rows = await db.all<{ k: string; s: number | null }>(sql, [from, to])
    return new Map(rows.map((r) => [r.k, r.s ?? 0]))
  }
  const [capital, newPiutang, newUtang, paidPiutang, paidUtang, operasional] = await Promise.all([
    byDate(`SELECT date AS k, SUM(amount) AS s FROM capital_moves WHERE deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY date`),
    byDate(`SELECT date AS k, SUM(amount) AS s FROM debts WHERE kind = 'piutang' AND deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY date`),
    byDate(`SELECT date AS k, SUM(amount) AS s FROM debts WHERE kind = 'utang' AND deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY date`),
    byDate(
      `SELECT p.date AS k, SUM(p.amount) AS s FROM debt_payments p JOIN debts d ON d.id = p.debt_id
       WHERE d.kind = 'piutang' AND p.deleted_at IS NULL AND d.deleted_at IS NULL AND p.date BETWEEN ? AND ? GROUP BY p.date`,
    ),
    byDate(
      `SELECT p.date AS k, SUM(p.amount) AS s FROM debt_payments p JOIN debts d ON d.id = p.debt_id
       WHERE d.kind = 'utang' AND p.deleted_at IS NULL AND d.deleted_at IS NULL AND p.date BETWEEN ? AND ? GROUP BY p.date`,
    ),
    byDate(`SELECT date AS k, SUM(amount) AS s FROM expenses WHERE channel_id IS NOT NULL AND deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY date`),
  ])

  let openingTotal = await openingTotalFor(db, records[0].date)
  const out: DaySummary[] = []
  for (const r of records) {
    const closingTotal = r.total ?? 0
    const s: DaySummary = {
      date: r.date, hasRecord: true, openingTotal, closingTotal, delta: closingTotal - openingTotal,
      capitalNet: capital.get(r.date) ?? 0,
      piutangBaru: newPiutang.get(r.date) ?? 0, piutangLunas: paidPiutang.get(r.date) ?? 0,
      utangBaru: newUtang.get(r.date) ?? 0, utangBayar: paidUtang.get(r.date) ?? 0,
      operasional: operasional.get(r.date) ?? 0, profit: null,
    }
    s.profit = computeProfit({ ...s })
    out.push(s)
    openingTotal = closingTotal
  }
  return out
}

/** Profit per tanggal yang punya catatan, dari `from` sampai `to`. */
export async function profitSeries(db: Db, from: string, to: string): Promise<{ date: string; profit: number }[]> {
  const dates = await listRecordDates(db, from, to)
  const out: { date: string; profit: number }[] = []
  for (const date of dates) {
    const s = await daySummary(db, date)
    if (s.profit !== null) out.push({ date, profit: s.profit })
  }
  return out
}

/** Rata-rata profit 7 hari sebelum tanggal ini (hanya hari yang punya catatan). */
export async function avgProfit7(db: Db, date: string): Promise<number | null> {
  const s = await profitSeries(db, addDays(date, -7), addDays(date, -1))
  if (!s.length) return null
  return Math.round(s.reduce((a, b) => a + b.profit, 0) / s.length)
}

export async function dayWarning(db: Db, summary: DaySummary): Promise<string | null> {
  if (summary.profit === null) return null
  return profitWarning(summary.profit, await avgProfit7(db, summary.date))
}

export async function totalBalanceNow(db: Db): Promise<{ total: number; asOf: string | null }> {
  const last = await db.all<{ id: string; date: string }>(
    `SELECT id, date FROM daily_records WHERE deleted_at IS NULL ORDER BY date DESC LIMIT 1`,
  )
  if (!last.length) {
    return { total: await sumOne(db, `SELECT SUM(initial_balance) AS s FROM channels WHERE deleted_at IS NULL`, []), asOf: null }
  }
  const total = await sumOne(db, `SELECT SUM(balance) AS s FROM daily_balances WHERE record_id = ? AND deleted_at IS NULL`, [
    last[0].id,
  ])
  return { total, asOf: last[0].date }
}

/** Saldo tiap channel pada catatan terakhir (atau saldo awal bila belum ada catatan). */
export async function latestBalances(db: Db): Promise<{ channel: Channel; balance: number }[]> {
  const channels = await listChannels(db)
  const last = await db.all<{ id: string }>(
    `SELECT id FROM daily_records WHERE deleted_at IS NULL ORDER BY date DESC LIMIT 1`,
  )
  if (!last.length) return channels.map((channel) => ({ channel, balance: channel.initial_balance }))
  const rows = await db.all<{ channel_id: string; balance: number }>(
    `SELECT channel_id, balance FROM daily_balances WHERE record_id = ? AND deleted_at IS NULL`,
    [last[0].id],
  )
  const map = new Map(rows.map((r) => [r.channel_id, r.balance]))
  return channels.map((channel) => ({ channel, balance: map.get(channel.id) ?? 0 }))
}

/** Saldo tiap channel pada hari pencatatan sebelum `date`, dipakai sebagai isian awal. */
export async function previousBalances(db: Db, date: string): Promise<Record<string, number>> {
  const channels = await listChannels(db)
  const prev = await db.all<{ id: string }>(
    `SELECT id FROM daily_records WHERE deleted_at IS NULL AND date < ? ORDER BY date DESC LIMIT 1`,
    [date],
  )
  const out: Record<string, number> = {}
  if (!prev.length) {
    for (const c of channels) if (c.initial_date <= date) out[c.id] = c.initial_balance
    return out
  }
  const rows = await db.all<{ channel_id: string; balance: number }>(
    `SELECT channel_id, balance FROM daily_balances WHERE record_id = ? AND deleted_at IS NULL`,
    [prev[0].id],
  )
  for (const r of rows) out[r.channel_id] = r.balance
  return out
}
