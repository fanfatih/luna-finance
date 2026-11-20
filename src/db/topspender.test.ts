import { beforeEach, describe, expect, it } from 'vitest'
import { createSqlJsDb } from './sqljs'
import { migrate } from './schema'
import type { Db } from './adapter'
import { allVoucherCodes, listTopSpenders, makeVoucherCode, saveTopSpenders } from './topspender'
import { listMonthlyVouchers, saveMonthlyVoucher } from './vouchers'
import { dumpAll, restoreAll } from './backup'

let db: Db
beforeEach(async () => {
  db = await createSqlJsDb({ persistKey: null })
  await migrate(db)
})

const e = (place: 1 | 2 | 3, account: string, total: number | null = 1000, code = '') => ({ place, account, total_spend: total, voucher_code: code })

describe('top spender', () => {
  it('menyimpan per bulan, memperbarui, dan menghapus baris yang dikosongkan', async () => {
    await saveTopSpenders(db, 2026, 10, [e(1, 'a@mail.com', 8_700_000, 't09p01g7nf'), e(2, 'b@mail.com', 7_700_000, 'T09P02935U'), e(3, '')])
    let rows = await listTopSpenders(db, 2026)
    expect(rows.map((r) => [r.place, r.account, r.voucher_code])).toEqual([[1, 'a@mail.com', 'T09P01G7NF'], [2, 'b@mail.com', 'T09P02935U']])
    await saveTopSpenders(db, 2026, 10, [e(1, 'a@mail.com', 9_000_000, 'T09P01G7NF'), e(2, ''), e(3, 'c@mail.com', 100)])
    rows = await listTopSpenders(db, 2026)
    expect(rows.map((r) => [r.place, r.account, r.total_spend])).toEqual([[1, 'a@mail.com', 9_000_000], [3, 'c@mail.com', 100]])
    expect(await listTopSpenders(db, 2025)).toEqual([])
  })

  it('kode voucher harus unik di seluruh data, tapi boleh disimpan ulang untuk bulan yang sama', async () => {
    await saveTopSpenders(db, 2026, 9, [e(1, 'a@mail.com', 1, 'T08P01')])
    await expect(saveTopSpenders(db, 2026, 10, [e(1, 'b@mail.com', 1, 't08p01')])).rejects.toThrow('sudah dipakai di September 2026')
    await expect(saveTopSpenders(db, 2026, 10, [e(1, 'b@mail.com', 1, 'AB'), e(2, '')])).rejects.toThrow('huruf dan angka')
    await expect(saveTopSpenders(db, 2026, 10, [e(1, 'b@mail.com', 1, 'KODE1'), e(2, 'c@mail.com', 1, 'KODE1')])).rejects.toThrow('kode voucher yang sama')
    await saveTopSpenders(db, 2026, 9, [e(1, 'a@mail.com', 5, 'T08P01')])
    expect(await allVoucherCodes(db)).toEqual(['T08P01'])
  })

  it('menolak akun kembar dan total spend tidak valid', async () => {
    await expect(saveTopSpenders(db, 2026, 10, [e(1, 'A@mail.com'), e(2, ' a@mail.com')])).rejects.toThrow('dua kali')
    await expect(saveTopSpenders(db, 2026, 10, [e(1, 'a@mail.com', -5)])).rejects.toThrow('tidak valid')
    await expect(saveTopSpenders(db, 2026, 13, [e(1, 'a@mail.com')])).rejects.toThrow('Bulan')
  })

  it('membuat kode dengan pola spreadsheet dan menghindari yang sudah ada', () => {
    expect(makeVoucherCode(10, 1, [], () => 'K7QM')).toBe('T09P01K7QM')
    expect(makeVoucherCode(1, 2, [], () => 'AAAA')).toBe('T00P02AAAA')
    const seq = ['AAAA', 'BBBB']
    expect(makeVoucherCode(10, 1, ['t09p01aaaa'], () => seq.shift()!)).toBe('T09P01BBBB')
    expect(makeVoucherCode(3, 1)).toMatch(/^T02P01[2-9A-HJKMNP-Z]{4}$/)
  })
})

describe('voucher bulanan', () => {
  it('selalu 12 bulan, menyimpan nama dan terpakai, dan mengosongkan bulan', async () => {
    expect((await listMonthlyVouchers(db, 2026)).every((v) => v.name === null)).toBe(true)
    await saveMonthlyVoucher(db, 2026, 3, { name: 'lunamaret', used: 126 })
    await saveMonthlyVoucher(db, 2026, 11, { name: 'NNNOVEMBER', used: null })
    let v = await listMonthlyVouchers(db, 2026)
    expect(v).toHaveLength(12)
    expect(v[2]).toMatchObject({ month: 3, name: 'LUNAMARET', used: 126 })
    expect(v[10]).toMatchObject({ name: 'NNNOVEMBER', used: null })
    await saveMonthlyVoucher(db, 2026, 11, { name: 'NNNOVEMBER', used: 40 })
    await saveMonthlyVoucher(db, 2026, 3, { name: '', used: null })
    v = await listMonthlyVouchers(db, 2026)
    expect(v[2].name).toBeNull()
    expect(v[10].used).toBe(40)
  })

  it('menolak nama kembar antar bulan dan masukan yang salah', async () => {
    await saveMonthlyVoucher(db, 2026, 6, { name: 'JUNIHEMAT', used: 1 })
    await expect(saveMonthlyVoucher(db, 2026, 7, { name: 'junihemat', used: null })).rejects.toThrow('sudah dipakai di Juni 2026')
    await expect(saveMonthlyVoucher(db, 2026, 7, { name: 'ab', used: null })).rejects.toThrow('Nama voucher')
    await expect(saveMonthlyVoucher(db, 2026, 7, { name: 'JULIMURAH', used: -1 })).rejects.toThrow('terpakai')
    await expect(saveMonthlyVoucher(db, 2026, 7, { name: 'JULIMURAH', used: 1.5 })).rejects.toThrow('terpakai')
  })
})

describe('cadangan', () => {
  it('ikut tercadang dan bisa dipulihkan, dan cadangan lama tanpa tabel ini tetap bisa dipulihkan', async () => {
    await saveTopSpenders(db, 2026, 10, [e(1, 'a@mail.com', 1, 'T09P01AAAA')])
    await saveMonthlyVoucher(db, 2026, 10, { name: 'OKTOBERHEMAT', used: 123 })
    const dump = await dumpAll(db)
    await db.run(`DELETE FROM top_spenders`)
    await restoreAll(db, dump)
    expect(await listTopSpenders(db, 2026)).toHaveLength(1)
    const old = JSON.parse(JSON.stringify(dump))
    delete old.tables.top_spenders
    delete old.tables.monthly_vouchers
    await restoreAll(db, old)
    expect(await listTopSpenders(db, 2026)).toHaveLength(0)
  })
})
