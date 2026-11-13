import type { Db } from './adapter'
import { migrate } from './schema'

export type { Db } from './adapter'

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Buka database: file SQLite di Tauri, sql.js yang disimpan di localStorage di peramban. */
let opening: Promise<Db> | null = null

/** Dibuka sekali saja, walau dipanggil dua kali (misalnya StrictMode saat pengembangan). */
export function openDb(): Promise<Db> {
  opening ??= openDbOnce()
  return opening
}

async function openDbOnce(): Promise<Db> {
  let db: Db
  if (isTauri()) {
    const { createTauriDb } = await import('./tauri')
    db = await createTauriDb()
  } else {
    const [{ createSqlJsDb }, wasm] = await Promise.all([
      import('./sqljs'),
      import('sql.js/dist/sql-wasm.wasm?url'),
    ])
    db = await createSqlJsDb({ wasmUrl: wasm.default, persistKey: 'luna-finance-db' })
  }
  await migrate(db)
  return db
}
