import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './adapter'
import { createSqlJsDb } from './sqljs'
import { migrate } from './schema'
import {
  expiringWithin, groupByTeam, listProducts, listSubscriptions, renewSubscription, saveCustomer,
  saveProduct, saveSubscription, saveVariant, subStatus, deleteCustomer,
} from './premium'
import { createPinRecord, decryptText, deriveKey, encryptText, verifyPin } from '@/lib/crypto'

let db: Db
let canva: string
let budi: string

const base = (over: Record<string, unknown> = {}) => ({
  customerId: budi, productId: canva, variantId: null, startDate: '2026-11-01', durationDays: 30,
  price: 20_000, accountLogin: null, accountPasswordEnc: null, team: 'Tim A', note: null, ...over,
}) as Parameters<typeof saveSubscription>[1]

beforeEach(async () => {
  db = await createSqlJsDb({ persistKey: null })
  await migrate(db)
  canva = await saveProduct(db, { name: 'Canva', hasAccount: false, hasTeam: true, teamCapacity: 100 })
  budi = await saveCustomer(db, { name: 'Budi', contact: '0812', note: null })
})

describe('status langganan', () => {
  it('aktif, hampir habis, habis', () => {
    expect(subStatus('2026-11-20', '2026-11-13', 3)).toBe('aktif')
    expect(subStatus('2026-11-16', '2026-11-13', 3)).toBe('hampir-habis')
    expect(subStatus('2026-11-13', '2026-11-13', 3)).toBe('hampir-habis')
    expect(subStatus('2026-11-12', '2026-11-13', 3)).toBe('habis')
  })
})

describe('langganan', () => {
  it('tanggal berakhir = mulai + durasi', async () => {
    await saveSubscription(db, base())
    const [s] = await listSubscriptions(db)
    expect(s.end_date).toBe('2026-12-01')
    expect(s.customer_name).toBe('Budi')
    expect(s.product_name).toBe('Canva')
  })

  it('perpanjang yang belum habis menyambung, yang sudah habis mulai hari ini', async () => {
    const a = await saveSubscription(db, base()) // berakhir 2026-12-01
    await renewSubscription(db, a, 30, '2026-11-13')
    let s = (await listSubscriptions(db)).find((x) => x.id === a)!
    expect(s.end_date).toBe('2026-12-31')
    const b = await saveSubscription(db, base({ startDate: '2026-09-01', durationDays: 30 })) // berakhir 2026-10-01
    await renewSubscription(db, b, 30, '2026-11-13')
    s = (await listSubscriptions(db)).find((x) => x.id === b)!
    expect(s.start_date).toBe('2026-11-13')
    expect(s.end_date).toBe('2026-12-13')
  })

  it('pengingat mengambil yang hampir habis saja', async () => {
    await saveSubscription(db, base({ startDate: '2026-10-15', durationDays: 30 })) // berakhir 11-14
    await saveSubscription(db, base({ startDate: '2026-11-10', durationDays: 30 })) // jauh
    await saveSubscription(db, base({ startDate: '2026-09-01', durationDays: 30 })) // sudah habis
    const soon = await expiringWithin(db, '2026-11-13', 3)
    expect(soon.length).toBe(1)
    expect(soon[0].end_date).toBe('2026-11-14')
  })

  it('hapus customer ikut menyembunyikan langganannya', async () => {
    await saveSubscription(db, base())
    await deleteCustomer(db, budi)
    expect((await listSubscriptions(db)).length).toBe(0)
  })

  it('tim dikelompokkan dan kapasitas hanya menghitung yang masih aktif', async () => {
    await saveSubscription(db, base({ team: 'Tim A' }))
    await saveSubscription(db, base({ team: 'Tim A', startDate: '2026-09-01' })) // habis
    await saveSubscription(db, base({ team: 'Tim B' }))
    const groups = groupByTeam(await listSubscriptions(db), '2026-11-13', 100)
    expect(groups.map((g) => g.team)).toEqual(['Tim A', 'Tim B'])
    expect(groups[0].members.length).toBe(2)
    expect(groups[0].activeCount).toBe(1)
  })
})

describe('produk', () => {
  it('varian dimuat bersama produk', async () => {
    await saveVariant(db, { productId: canva, name: '1 bulan', durationDays: 30, price: 20_000 })
    await saveVariant(db, { productId: canva, name: '1 tahun', durationDays: 365, price: 150_000 })
    const [p] = await listProducts(db)
    expect(p.variants.map((v) => v.name)).toEqual(['1 bulan', '1 tahun'])
  })
  it('menolak durasi nol', async () => {
    await expect(saveVariant(db, { productId: canva, name: 'x', durationDays: 0, price: 1 })).rejects.toThrow()
  })
})

describe('PIN dan enkripsi', () => {
  it('PIN benar lolos, salah ditolak', async () => {
    const rec = await createPinRecord('123456')
    expect(await verifyPin('123456', rec)).toBe(true)
    expect(await verifyPin('654321', rec)).toBe(false)
  })
  it('kata sandi terenkripsi bisa dibuka dengan kunci dari PIN yang sama saja', async () => {
    const rec = await createPinRecord('123456')
    const key = await deriveKey('123456', rec)
    const payload = await encryptText(key, 'rahasia!')
    expect(payload).not.toContain('rahasia')
    expect(await decryptText(key, payload)).toBe('rahasia!')
    const other = await deriveKey('000000', rec)
    await expect(decryptText(other, payload)).rejects.toThrow()
  })
})

describe('ensureCustomer', () => {
  it('memakai customer yang sudah ada tanpa peduli huruf besar kecil', async () => {
    const { ensureCustomer } = await import('./premium')
    expect(await ensureCustomer(db, ' budi ')).toBe(budi)
    const baru = await ensureCustomer(db, 'Sari')
    expect(baru).not.toBe(budi)
  })
})
