/** Antarmuka tipis supaya kode yang sama jalan di Tauri (SQLite file) dan di peramban/tes (sql.js). */
export interface Db {
  run(sql: string, params?: unknown[]): Promise<void>
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}
