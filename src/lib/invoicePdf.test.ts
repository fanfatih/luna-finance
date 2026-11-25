import { describe, expect, it } from 'vitest'
import { buildInvoicePdf, fitLogo, pdfSafe, type InvoicePdfInput } from './invoicePdf'
import { DEFAULT_IDENTITY, type InvoiceSnapshot } from './momentum'
import { logoSize } from './image'

const snapshot: InvoiceSnapshot = {
  projectName: 'Pernikahan Andi dan Sari', clientName: 'Sari', clientContact: '0812', clientAddress: 'Jl. Melati 5, Bogor',
  eventDate: '2026-12-20', venue: 'Gedung Serbaguna Bogor',
  items: [{ name: 'Paket Video Cinematic', qty: 1, unitPrice: 8_000_000 }, { name: 'Drone', qty: 2, unitPrice: 250_000 }],
  discount: 500_000, total: 8_000_000, paidBefore: 0,
}

const base: InvoicePdfInput = {
  identity: { ...DEFAULT_IDENTITY, bank: 'BCA', accountNo: '1234567890', accountName: 'Luthfan', footer: 'Terima kasih.' },
  number: 'INV/MOM/2026/11/001', kind: 'dp', status: 'draft', issueDate: '2026-11-25', dueDate: '2026-11-28',
  amount: 2_400_000, note: null, snapshot,
}

const header = (b: Uint8Array) => String.fromCharCode(...b.slice(0, 5))
/** Jumlah halaman dari objek /Type /Page di PDF (tanpa /Pages). */
const pageCount = (b: Uint8Array) => (Buffer.from(b).toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length

describe('PDF invoice', () => {
  it('menghasilkan berkas PDF satu halaman untuk invoice biasa', async () => {
    const bytes = await buildInvoicePdf(base)
    expect(header(bytes)).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1500)
    expect(pageCount(bytes)).toBe(1)
  })

  it('invoice lunas, dibatalkan, dan tanpa item tetap terbentuk', async () => {
    for (const status of ['lunas', 'batal'] as const) {
      expect(header(await buildInvoicePdf({ ...base, status }))).toBe('%PDF-')
    }
    const empty = await buildInvoicePdf({ ...base, snapshot: { ...snapshot, items: [], total: 0, discount: 0 } })
    expect(header(empty)).toBe('%PDF-')
  })

  it('item yang banyak membuat halaman bertambah dan tidak terpotong', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ name: `Item nomor ${i + 1} dengan nama yang cukup panjang`, qty: 1, unitPrice: 100_000 }))
    const bytes = await buildInvoicePdf({ ...base, snapshot: { ...snapshot, items, total: 6_000_000, discount: 0 } })
    expect(pageCount(bytes)).toBeGreaterThanOrEqual(2)
  })

  it('teks panjang, emoji, dan aksara lain tidak merusak PDF', async () => {
    const long = 'Nama klien yang sangat panjang sekali '.repeat(8)
    const bytes = await buildInvoicePdf({
      ...base, note: 'Catatan dengan emoji 🎉 dan aksara 日本語.',
      snapshot: { ...snapshot, clientName: long, projectName: long, venue: long },
      identity: { ...base.identity, name: 'Momentum 🎬', footer: long },
    })
    expect(header(bytes)).toBe('%PDF-')
  })

  it('logo yang rusak dilewati, PDF tetap jadi', async () => {
    const bytes = await buildInvoicePdf({ ...base, identity: { ...base.identity, logo: 'data:image/png;base64,AAAA', logoW: 100, logoH: 40 } })
    expect(header(bytes)).toBe('%PDF-')
  })

  it('logo PNG sungguhan ikut tertanam', async () => {
    // PNG 1x1 putih
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const withLogo = await buildInvoicePdf({ ...base, identity: { ...base.identity, logo: png, logoW: 1, logoH: 1 } })
    const without = await buildInvoicePdf(base)
    expect(header(withLogo)).toBe('%PDF-')
    expect(Buffer.from(withLogo).toString('latin1')).toContain('/Subtype /Image')
    expect(Buffer.from(without).toString('latin1')).not.toContain('/Subtype /Image')
  })
})

describe('pembantu PDF', () => {
  it('pdfSafe mengganti karakter di luar huruf Latin dengan tanda tanya', () => {
    expect(pdfSafe('Halo 🎉 dunia')).toBe('Halo ? dunia')
    expect(pdfSafe('Café Ñandú')).toBe('Café Ñandú')
    expect(pdfSafe('a\tb\r\nc')).toBe('a b\nc')
    expect(pdfSafe('日本')).toBe('??')
  })

  it('fitLogo menjaga perbandingan dan tidak melebihi kotak', () => {
    expect(fitLogo(600, 240, 46, 18)).toEqual({ w: 45, h: 18 })
    const r = fitLogo(100, 100, 46, 18)
    expect(r.h).toBeCloseTo(18)
    expect(r.w).toBeCloseTo(18)
    expect(fitLogo(0, 10, 46, 18)).toEqual({ w: 0, h: 0 })
  })

  it('logoSize memperkecil gambar besar saja', () => {
    expect(logoSize(1200, 480)).toEqual({ w: 600, h: 240 })
    expect(logoSize(3000, 3000)).toEqual({ w: 240, h: 240 })
    expect(logoSize(200, 100)).toEqual({ w: 200, h: 100 })
    expect(logoSize(0, 0)).toEqual({ w: 0, h: 0 })
  })
})
