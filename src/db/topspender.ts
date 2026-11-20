import type { Db } from './adapter'
import { uid } from './finance'
import { getSetting, setSetting } from './finance'

const now = (): number => Date.now()

export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

export type Place = 1 | 2 | 3
export const PLACES: Place[] = [1, 2, 3]

export interface TopSpender {
  id: string
  year: number
  month: number
  place: Place
  /** Email atau akun asli. Hanya disimpan di sini dan di cloud pribadi, jangan dipasang di poster. */
  account: string
  total_spend: number | null
  voucher_code: string | null
}

export interface TopSpenderInput {
  place: Place
  account: string
  total_spend: number | null
  voucher_code: string
}

type Row = Omit<TopSpender, 'place'> & { place: number; updated_at: number }

/** Satu baris per bulan dan peringkat. Kalau ada kembar (misalnya dari dua perangkat), yang terbaru dipakai. */
export async function listTopSpenders(db: Db, year: number): Promise<TopSpender[]> {
  const rows = await db.all<Row>(
    `SELECT id, year, month, place, account, total_spend, voucher_code, updated_at FROM top_spenders
     WHERE deleted_at IS NULL AND year = ? ORDER BY month, place, updated_at DESC`,
    [year],
  )
  const seen = new Set<string>()
  const out: TopSpender[] = []
  for (const r of rows) {
    const k = `${r.month}-${r.place}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ id: r.id, year: r.year, month: r.month, place: r.place as Place, account: r.account, total_spend: r.total_spend, voucher_code: r.voucher_code })
  }
  return out
}

export async function listTopSpenderYears(db: Db): Promise<number[]> {
  const rows = await db.all<{ year: number }>(`SELECT DISTINCT year FROM top_spenders WHERE deleted_at IS NULL`)
  return rows.map((r) => r.year)
}

const CODE = /^[A-Z0-9]{3,20}$/

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

/**
 * Simpan top spender satu bulan. Baris dengan akun kosong dihapus (kalau sebelumnya ada).
 * Kode voucher harus unik di seluruh data, karena satu kode hanya boleh milik satu orang.
 */
export async function saveTopSpenders(db: Db, year: number, month: number, entries: TopSpenderInput[]): Promise<void> {
  if (!(month >= 1 && month <= 12)) throw new Error('Bulan tidak valid.')
  const filled = entries.filter((e) => e.account.trim())
  const accounts = new Set<string>()
  for (const e of filled) {
    const a = e.account.trim().toLowerCase()
    if (accounts.has(a)) throw new Error(`${e.account.trim()} tertulis dua kali di bulan yang sama.`)
    accounts.add(a)
    if (e.total_spend !== null && (!Number.isInteger(e.total_spend) || e.total_spend < 0)) {
      throw new Error(`Total spend peringkat ${e.place} tidak valid.`)
    }
    const code = normalizeCode(e.voucher_code)
    if (code && !CODE.test(code)) throw new Error(`Kode voucher peringkat ${e.place} hanya boleh huruf dan angka (3 sampai 20 karakter).`)
  }
  const codes = filled.map((e) => normalizeCode(e.voucher_code)).filter(Boolean)
  if (new Set(codes).size !== codes.length) throw new Error('Ada kode voucher yang sama di bulan ini.')
  for (const code of codes) {
    const clash = await db.all<{ year: number; month: number; place: number }>(
      `SELECT year, month, place FROM top_spenders
       WHERE deleted_at IS NULL AND UPPER(voucher_code) = ? AND NOT (year = ? AND month = ?) LIMIT 1`,
      [code, year, month],
    )
    if (clash.length) throw new Error(`Kode ${code} sudah dipakai di ${MONTH_NAMES[clash[0].month - 1]} ${clash[0].year}.`)
  }

  for (const place of PLACES) {
    const e = entries.find((x) => x.place === place)
    const existing = await db.all<{ id: string }>(
      `SELECT id FROM top_spenders WHERE deleted_at IS NULL AND year = ? AND month = ? AND place = ? ORDER BY updated_at DESC`,
      [year, month, place],
    )
    const account = e?.account.trim() ?? ''
    if (!account) {
      for (const r of existing) await db.run(`UPDATE top_spenders SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), r.id])
      continue
    }
    const vals = [account, e!.total_spend, normalizeCode(e!.voucher_code) || null]
    if (existing.length) {
      await db.run(`UPDATE top_spenders SET account = ?, total_spend = ?, voucher_code = ?, updated_at = ? WHERE id = ?`, [...vals, now(), existing[0].id])
      for (const r of existing.slice(1)) await db.run(`UPDATE top_spenders SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), r.id])
    } else {
      await db.run(
        `INSERT INTO top_spenders (id, year, month, place, account, total_spend, voucher_code, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
        [uid(), year, month, place, ...vals, now()],
      )
    }
  }
}

/* ---------- Kode voucher ---------- */

/** Tanpa huruf yang mirip (0/O, 1/I/L) supaya gampang diketik pelanggan. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const SUFFIX_LEN = 4

function randomSuffix(): string {
  const bytes = new Uint32Array(SUFFIX_LEN)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/**
 * Pola yang sama dengan spreadsheet: T{bulan-1}P{peringkat}{4 karakter acak}, misalnya T09P01K7QM
 * untuk Oktober peringkat 1. Akhiran acak supaya kode tidak bisa ditebak orang lain.
 */
export function makeVoucherCode(month: number, place: number, taken: Iterable<string> = [], suffix: () => string = randomSuffix): string {
  const used = new Set(Array.from(taken, (c) => c.toUpperCase()))
  const head = `T${String((month - 1) % 100).padStart(2, '0')}P${String(place).padStart(2, '0')}`
  for (;;) {
    const code = head + suffix()
    if (!used.has(code)) return code
  }
}

export async function allVoucherCodes(db: Db): Promise<string[]> {
  const rows = await db.all<{ voucher_code: string }>(
    `SELECT voucher_code FROM top_spenders WHERE deleted_at IS NULL AND voucher_code IS NOT NULL AND voucher_code <> ''`,
  )
  return rows.map((r) => r.voucher_code)
}

/* ---------- Hadiah per peringkat ---------- */

export type Rewards = Record<1 | 2, string>
export const DEFAULT_REWARDS: Rewards = { 1: 'Voucher 20% up to 20 ribu', 2: 'Voucher 15% up to 15 ribu' }

export async function getRewards(db: Db): Promise<Rewards> {
  const [a, b] = await Promise.all([getSetting(db, 'ts_reward_1'), getSetting(db, 'ts_reward_2')])
  return { 1: a || DEFAULT_REWARDS[1], 2: b || DEFAULT_REWARDS[2] }
}

export async function setRewards(db: Db, r: Rewards): Promise<void> {
  await setSetting(db, 'ts_reward_1', r[1].trim())
  await setSetting(db, 'ts_reward_2', r[2].trim())
}
