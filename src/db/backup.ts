import type { Db } from './adapter'
import { todayStr } from '@/lib/date'
import { isTauri } from './index'

/** Urutan tidak penting karena tidak ada kunci asing, tapi dijaga stabil untuk berkas cadangan. */
export const TABLES = [
  'settings', 'channels', 'daily_records', 'daily_balances', 'capital_moves', 'contacts', 'debts',
  'debt_payments', 'products', 'product_variants', 'customers', 'subscriptions', 'events',
  'top_spenders', 'monthly_vouchers', 'team_links', 'expenses', 'recurring_expenses',
] as const

/** Tabel yang boleh tidak ada di berkas cadangan lama (dibuat setelah rilis pertama). */
const OPTIONAL: readonly string[] = [
  'events', 'top_spenders', 'monthly_vouchers', 'team_links', 'expenses', 'recurring_expenses',
]

export interface BackupFile {
  app: 'luna-finance'
  version: 1
  exported_at: string
  tables: Record<string, Record<string, unknown>[]>
}

export async function dumpAll(db: Db): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {}
  for (const t of TABLES) tables[t] = await db.all(`SELECT * FROM ${t}`)
  return { app: 'luna-finance', version: 1, exported_at: new Date().toISOString(), tables }
}

export function validateBackup(raw: unknown): BackupFile {
  const b = raw as Partial<BackupFile> | null
  if (!b || b.app !== 'luna-finance' || b.version !== 1 || typeof b.tables !== 'object' || b.tables === null) {
    throw new Error('Berkas ini bukan cadangan Luna Finance.')
  }
  for (const t of TABLES) {
    if (OPTIONAL.includes(t) && b.tables[t] === undefined) continue
    if (!Array.isArray(b.tables[t])) throw new Error(`Cadangan tidak lengkap: tabel ${t} tidak ada.`)
  }
  return b as BackupFile
}

const IDENT = /^[a-z_][a-z0-9_]*$/

/** Mengganti seluruh isi database dengan isi cadangan. Berkas divalidasi dulu sebelum ada yang dihapus. */
export async function restoreAll(db: Db, raw: unknown): Promise<void> {
  const b = validateBackup(raw)
  for (const t of TABLES) {
    for (const row of b.tables[t] ?? []) {
      for (const k of Object.keys(row)) if (!IDENT.test(k)) throw new Error('Cadangan berisi kolom yang tidak valid.')
    }
  }
  for (const t of TABLES) await db.run(`DELETE FROM ${t}`)
  for (const t of TABLES) {
    for (const row of b.tables[t] ?? []) {
      const cols = Object.keys(row)
      if (!cols.length) continue
      await db.run(
        `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        cols.map((c) => row[c]),
      )
    }
  }
}

/** Cadangan harian otomatis ke folder data aplikasi, simpan 30 terakhir. Hanya di aplikasi desktop. */
export async function runDailyBackup(db: Db, keep = 30): Promise<string | null> {
  if (!isTauri()) return null
  const { BaseDirectory, exists, mkdir, readDir, remove, writeTextFile } = await import('@tauri-apps/plugin-fs')
  const opts = { baseDir: BaseDirectory.AppData }
  const name = `luna-${todayStr()}.json`
  if (!(await exists('backups', opts))) await mkdir('backups', { ...opts, recursive: true })
  if (await exists(`backups/${name}`, opts)) return null
  await writeTextFile(`backups/${name}`, JSON.stringify(await dumpAll(db)), opts)
  const files = (await readDir('backups', opts)).map((f) => f.name).filter((n) => /^luna-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()
  for (const old of files.slice(0, Math.max(0, files.length - keep))) await remove(`backups/${old}`, opts)
  return name
}
