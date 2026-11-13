import initSqlJs, { type Database } from 'sql.js'
import type { Db } from './adapter'

export interface SqlJsOptions {
  /** URL file sql-wasm.wasm. Kosongkan di Node (tes). */
  wasmUrl?: string
  /** Kunci localStorage untuk menyimpan database. null = tidak disimpan (tes). */
  persistKey?: string | null
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export async function createSqlJsDb(opts: SqlJsOptions = {}): Promise<Db & { export(): Uint8Array }> {
  const SQL = await initSqlJs(opts.wasmUrl ? { locateFile: () => opts.wasmUrl as string } : undefined)

  let saved: Uint8Array | undefined
  if (opts.persistKey) {
    try {
      const raw = localStorage.getItem(opts.persistKey)
      if (raw) saved = fromBase64(raw)
    } catch {
      saved = undefined
    }
  }
  const db: Database = saved ? new SQL.Database(saved) : new SQL.Database()

  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (!opts.persistKey) return
    clearTimeout(timer)
    try {
      localStorage.setItem(opts.persistKey, toBase64(db.export()))
    } catch {
      // penyimpanan penuh atau diblokir: data tetap ada selama aplikasi terbuka
    }
  }
  const persist = () => {
    if (!opts.persistKey) return
    clearTimeout(timer)
    timer = setTimeout(flush, 150)
  }
  if (opts.persistKey && typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
  }

  return {
    async run(sql, params = []) {
      db.run(sql, params as never[])
      persist()
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql)
      try {
        stmt.bind(params as never[])
        const rows: T[] = []
        while (stmt.step()) rows.push(stmt.getAsObject() as T)
        return rows
      } finally {
        stmt.free()
      }
    },
    export: () => db.export(),
  }
}
