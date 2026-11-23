import type { Db } from './adapter'
import { getSetting, setSetting } from './finance'

/** Tabel yang disinkronkan. Pengaturan dan PIN tetap lokal. */
export const SYNC_TABLES = [
  'channels', 'daily_records', 'daily_balances', 'capital_moves', 'contacts',
  'debts', 'debt_payments', 'products', 'product_variants', 'customers', 'subscriptions', 'events',
  'top_spenders', 'monthly_vouchers', 'team_links',
] as const

export const DEFAULT_SYNC_URL = 'https://qsekvshirabzgsrgyxzk.supabase.co'
const PUSH_BATCH = 500
const MAX_ROUNDS = 200
const COL = /^[a-z_][a-z0-9_]*$/

export interface SyncConfig {
  url: string
  key: string
}

export interface SyncResult {
  pushed: number
  pulled: number
  at: number
}

type Row = Record<string, unknown>
type Fetch = typeof fetch

export async function loadSyncConfig(db: Db): Promise<SyncConfig | null> {
  const [url, key] = await Promise.all([getSetting(db, 'sync_url'), getSetting(db, 'sync_key')])
  if (!key) return null
  return { url: (url || DEFAULT_SYNC_URL).replace(/\/+$/, ''), key }
}

export async function saveSyncConfig(db: Db, cfg: { url: string; key: string }): Promise<void> {
  await setSetting(db, 'sync_url', cfg.url.trim())
  await setSetting(db, 'sync_key', cfg.key.trim())
}

export async function clearSyncConfig(db: Db): Promise<void> {
  await setSetting(db, 'sync_key', '')
}

export async function lastSyncAt(db: Db): Promise<number | null> {
  const v = await getSetting(db, 'sync_last')
  return v ? Number(v) : null
}

const cursorKey = (kind: 'push' | 'pull', t: string) => `sync_${kind}_${t}`

async function getCursor(db: Db, kind: 'push' | 'pull', t: string): Promise<[number, string]> {
  const raw = (await getSetting(db, cursorKey(kind, t))) ?? '0|'
  const [ts, id = ''] = raw.split('|')
  return [Number(ts) || 0, id]
}

/** Simpan kunci kursor di tabel settings lokal (ikut ke cadangan? tidak, settings tidak disinkronkan). */
async function setCursor(db: Db, kind: 'push' | 'pull', t: string, ts: number, id: string) {
  await setSetting(db, cursorKey(kind, t), `${ts}|${id}`)
}

async function localChanges(db: Db, t: string): Promise<{ rows: Row[]; last: [number, string] | null }> {
  const [ts, id] = await getCursor(db, 'push', t)
  const rows = await db.all<Row>(
    `SELECT * FROM ${t} WHERE updated_at > ? OR (updated_at = ? AND id > ?) ORDER BY updated_at, id LIMIT ${PUSH_BATCH}`,
    [ts, ts, id],
  )
  const lastRow = rows[rows.length - 1]
  return { rows, last: lastRow ? [Number(lastRow.updated_at), String(lastRow.id)] : null }
}

/** Terapkan baris dari server. Baris lokal yang lebih baru tidak ditimpa. */
const localCols = new WeakMap<Db, Map<string, Set<string>>>()

/** Kolom yang ada di tabel lokal. Kolom baru dari server yang belum dikenal aplikasi ini diabaikan. */
async function columnsOf(db: Db, t: string): Promise<Set<string>> {
  let per = localCols.get(db)
  if (!per) localCols.set(db, (per = new Map()))
  let cols = per.get(t)
  if (!cols) {
    const info = await db.all<{ name: string }>(`PRAGMA table_info(${t})`)
    per.set(t, (cols = new Set(info.map((c) => c.name))))
  }
  return cols
}

async function applyRow(db: Db, t: string, row: Row): Promise<void> {
  const known = await columnsOf(db, t)
  const cols = Object.keys(row).filter((c) => c !== 'synced_at' && known.has(c))
  if (!cols.every((c) => COL.test(c)) || !cols.includes('id') || !cols.includes('updated_at')) {
    throw new Error(`Baris dari server tidak valid (${t}).`)
  }
  const sets = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')
  await db.run(
    `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
     ON CONFLICT(id) DO UPDATE SET ${sets} WHERE excluded.updated_at > ${t}.updated_at`,
    cols.map((c) => row[c]),
  )
}

/**
 * Kirim perubahan lokal, ambil perubahan baru dari cloud (termasuk yang dicatat lewat bot Telegram).
 * Konflik: updated_at yang lebih baru menang.
 */
export async function syncNow(db: Db, cfg: SyncConfig, doFetch: Fetch = fetch): Promise<SyncResult> {
  let pushed = 0
  let pulled = 0

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const push: Record<string, Row[]> = {}
    const pushLast: Record<string, [number, string]> = {}
    for (const t of SYNC_TABLES) {
      const c = await localChanges(db, t)
      if (c.rows.length && c.last) {
        push[t] = c.rows
        pushLast[t] = c.last
      }
    }
    const since: Record<string, string> = {}
    for (const t of SYNC_TABLES) {
      const [ts, id] = await getCursor(db, 'pull', t)
      since[t] = `${ts}|${id || '0'}`
    }

    let res: Response
    try {
      res = await doFetch(`${cfg.url}/functions/v1/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-key': cfg.key },
        body: JSON.stringify({ v: 4, push, since }),
      })
    } catch {
      throw new Error('Tidak bisa terhubung ke cloud. Cek koneksi internet.')
    }
    if (res.status === 401) throw new Error('Kunci sinkron salah. Cek lagi di Pengaturan.')
    const body = (await res.json().catch(() => null)) as
      | { error?: string; more?: boolean; pull?: Record<string, { rows: Row[]; next: string | null }> }
      | null
    if (!res.ok || !body || body.error || !body.pull) throw new Error(body?.error ?? `Cloud menjawab error ${res.status}.`)

    for (const t of Object.keys(pushLast)) {
      await setCursor(db, 'push', t, pushLast[t][0], pushLast[t][1])
      pushed += push[t].length
    }
    for (const t of SYNC_TABLES) {
      const p = body.pull[t]
      if (!p || !p.rows.length) continue
      for (const row of p.rows) await applyRow(db, t, row)
      if (p.next) {
        const [ts, id] = p.next.split('|')
        await setCursor(db, 'pull', t, Number(ts), id)
      }
      pulled += p.rows.length
    }

    const morePush = Object.values(push).some((r) => r.length === PUSH_BATCH)
    if (!body.more && !morePush) break
  }

  const at = Date.now()
  await setSetting(db, 'sync_last', String(at))
  return { pushed, pulled, at }
}
