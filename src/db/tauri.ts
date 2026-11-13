import Database from '@tauri-apps/plugin-sql'
import type { Db } from './adapter'

/** SQLite di folder data aplikasi Windows (AppData\Roaming\<identifier>\luna.db). */
export async function createTauriDb(): Promise<Db> {
  const db = await Database.load('sqlite:luna.db')
  return {
    async run(sql, params = []) {
      await db.execute(sql, params)
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return (await db.select<T[]>(sql, params)) as T[]
    },
  }
}
