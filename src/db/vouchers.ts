import type { Db } from './adapter'
import { uid } from './finance'
import { MONTH_NAMES } from './topspender'

const now = (): number => Date.now()

export interface MonthlyVoucher {
  year: number
  month: number
  /** Kosong bila bulan itu belum diisi. */
  name: string | null
  /** Berapa kali terpakai. Diisi setelah bulannya berjalan. */
  used: number | null
}

type Row = { id: string; year: number; month: number; name: string | null; used: number | null; updated_at: number }

/** Selalu 12 baris, Januari sampai Desember, termasuk bulan yang belum diisi. */
export async function listMonthlyVouchers(db: Db, year: number): Promise<MonthlyVoucher[]> {
  const rows = await db.all<Row>(
    `SELECT id, year, month, name, used, updated_at FROM monthly_vouchers
     WHERE deleted_at IS NULL AND year = ? ORDER BY month, updated_at DESC`,
    [year],
  )
  const byMonth = new Map<number, Row>()
  for (const r of rows) if (!byMonth.has(r.month)) byMonth.set(r.month, r)
  return Array.from({ length: 12 }, (_, i) => {
    const r = byMonth.get(i + 1)
    return { year, month: i + 1, name: r?.name ?? null, used: r?.used ?? null }
  })
}

export async function listVoucherYears(db: Db): Promise<number[]> {
  const rows = await db.all<{ year: number }>(`SELECT DISTINCT year FROM monthly_vouchers WHERE deleted_at IS NULL`)
  return rows.map((r) => r.year)
}

const NAME = /^[A-Z0-9_-]{3,30}$/

export function normalizeVoucherName(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

export async function saveMonthlyVoucher(db: Db, year: number, month: number, input: { name: string; used: number | null }): Promise<void> {
  if (!(month >= 1 && month <= 12)) throw new Error('Bulan tidak valid.')
  const name = normalizeVoucherName(input.name)
  if (name && !NAME.test(name)) throw new Error('Nama voucher hanya boleh huruf, angka, strip, dan garis bawah (3 sampai 30 karakter).')
  if (input.used !== null && (!Number.isInteger(input.used) || input.used < 0)) throw new Error('Jumlah terpakai harus bilangan bulat, nol atau lebih.')
  if (name) {
    const clash = await db.all<{ year: number; month: number }>(
      `SELECT year, month FROM monthly_vouchers
       WHERE deleted_at IS NULL AND UPPER(name) = ? AND NOT (year = ? AND month = ?) LIMIT 1`,
      [name, year, month],
    )
    if (clash.length) throw new Error(`Nama ${name} sudah dipakai di ${MONTH_NAMES[clash[0].month - 1]} ${clash[0].year}.`)
  }
  const existing = await db.all<{ id: string }>(
    `SELECT id FROM monthly_vouchers WHERE deleted_at IS NULL AND year = ? AND month = ? ORDER BY updated_at DESC`,
    [year, month],
  )
  if (!name && input.used === null) {
    for (const r of existing) await db.run(`UPDATE monthly_vouchers SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), r.id])
    return
  }
  if (existing.length) {
    await db.run(`UPDATE monthly_vouchers SET name = ?, used = ?, updated_at = ? WHERE id = ?`, [name || null, input.used, now(), existing[0].id])
    for (const r of existing.slice(1)) await db.run(`UPDATE monthly_vouchers SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), r.id])
  } else {
    await db.run(
      `INSERT INTO monthly_vouchers (id, year, month, name, used, updated_at) VALUES (?,?,?,?,?,?)`,
      [uid(), year, month, name || null, input.used, now()],
    )
  }
}
