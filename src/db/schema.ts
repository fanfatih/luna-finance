import type { Db } from './adapter'

/**
 * Semua tabel punya updated_at (ms) dan deleted_at (hapus lunak) agar siap disinkronkan.
 * Uang disimpan sebagai bilangan bulat Rupiah. Tanggal berbentuk YYYY-MM-DD.
 */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER NOT NULL)`,

    // Keuangan Lunatopup
    `CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, initial_balance INTEGER NOT NULL DEFAULT 0,
      initial_date TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS daily_records (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, note TEXT,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_daily_records_date ON daily_records(date)`,
    `CREATE TABLE IF NOT EXISTS daily_balances (
      id TEXT PRIMARY KEY, record_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      balance INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_daily_balances_record ON daily_balances(record_id)`,
    `CREATE TABLE IF NOT EXISTS capital_moves (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, amount INTEGER NOT NULL, note TEXT,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_capital_date ON capital_moves(date)`,

    // Utang piutang
    `CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, note TEXT,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('utang','piutang')),
      contact_id TEXT NOT NULL, amount INTEGER NOT NULL, date TEXT NOT NULL,
      due_date TEXT, note TEXT, updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_debts_date ON debts(date)`,
    `CREATE TABLE IF NOT EXISTS debt_payments (
      id TEXT PRIMARY KEY, debt_id TEXT NOT NULL, amount INTEGER NOT NULL, date TEXT NOT NULL,
      note TEXT, updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_debt ON debt_payments(debt_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_date ON debt_payments(date)`,

    // Lunapremium
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, has_account INTEGER NOT NULL DEFAULT 0,
      has_team INTEGER NOT NULL DEFAULT 0, team_capacity INTEGER,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, name TEXT NOT NULL,
      duration_days INTEGER NOT NULL, price INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT, note TEXT,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, product_id TEXT NOT NULL, variant_id TEXT,
      start_date TEXT NOT NULL, duration_days INTEGER NOT NULL, end_date TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0, account_login TEXT, account_password_enc TEXT,
      team TEXT, note TEXT, updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_subs_end ON subscriptions(end_date)`,
  ],
  // v2: email customer, kalender kegiatan pribadi, dan catatan pengingat yang sudah dikirim (tidak disinkronkan)
  [
    `ALTER TABLE customers ADD COLUMN email TEXT`,
    `CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT, end_time TEXT,
      category TEXT NOT NULL DEFAULT 'pribadi', note TEXT,
      remind_day INTEGER NOT NULL DEFAULT 0, remind_hours INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_events_date ON events(date)`,
    `CREATE TABLE IF NOT EXISTS reminder_log (key TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  ],
  // v3: data Top Spender bulanan dan voucher default bulanan Lunatopup
  [
    `CREATE TABLE IF NOT EXISTS top_spenders (
      id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL, place INTEGER NOT NULL,
      account TEXT NOT NULL, total_spend INTEGER, voucher_code TEXT,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_top_spenders_period ON top_spenders(year, month)`,
    `CREATE TABLE IF NOT EXISTS monthly_vouchers (
      id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL, name TEXT, used INTEGER,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_monthly_vouchers_period ON monthly_vouchers(year, month)`,
  ],
  // v4: langkah pesan WhatsApp per aplikasi dan link undangan per tim
  [
    `ALTER TABLE products ADD COLUMN wa_steps TEXT`,
    `CREATE TABLE IF NOT EXISTS team_links (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, team TEXT NOT NULL, link TEXT,
      updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_team_links_product ON team_links(product_id)`,
  ],
  // v5: biaya operasional dan tagihan rutin. channel_id kosong berarti dibayar di luar saldo aplikasi.
  // spread_months: 1 = dihitung di bulan dibayar, 12 = dibagi rata ke 12 bulan (biaya tahunan).
  [
    `CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'lain',
      amount INTEGER NOT NULL, channel_id TEXT, spread_months INTEGER NOT NULL DEFAULT 1,
      recurring_id TEXT, note TEXT, updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)`,
    `CREATE TABLE IF NOT EXISTS recurring_expenses (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'lain', amount INTEGER NOT NULL,
      period TEXT NOT NULL CHECK (period IN ('bulanan','tahunan')), next_due TEXT NOT NULL,
      anchor_day INTEGER NOT NULL, channel_id TEXT, updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_expenses(next_due)`,
  ],
]

export async function migrate(db: Db): Promise<void> {
  await db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`)
  const rows = await db.all<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`)
  let version = rows.length ? Number(rows[0].value) : 0
  while (version < MIGRATIONS.length) {
    for (const stmt of MIGRATIONS[version]) await db.run(stmt)
    version += 1
    await db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)`, [String(version)])
  }
}
