import { describe, expect, it } from 'vitest'
import {
  cleanPrefix, DEFAULT_IDENTITY, dpAmount, invoiceMessage, invoiceNumber, invoiceState, itemsTotal, nextInvoiceSeq,
  parseSnapshot, payState, projectTotal, remaining, remainingAfter, safeFileName, suggestDueDate, suggestInvoiceAmount,
  type InvoiceSnapshot,
} from './momentum'

const snap: InvoiceSnapshot = {
  projectName: 'Pernikahan Andi dan Sari', clientName: 'Sari', clientContact: '0812', clientAddress: null,
  eventDate: '2026-12-20', venue: 'Gedung Serbaguna Bogor',
  items: [{ name: 'Paket Video Cinematic', qty: 1, unitPrice: 8_000_000 }],
  discount: 500_000, total: 7_500_000, paidBefore: 0,
}

describe('nilai project dan status bayar', () => {
  it('menjumlah item dan mengurangi diskon, tidak pernah negatif', () => {
    const items = [{ qty: 1, unit_price: 8_000_000 }, { qty: 2, unit_price: 250_000 }]
    expect(itemsTotal(items)).toBe(8_500_000)
    expect(projectTotal(items, 500_000)).toBe(8_000_000)
    expect(projectTotal(items, 99_000_000)).toBe(0)
    expect(projectTotal([], 0)).toBe(0)
  })

  it('status bayar: belum, DP, lunas, kelebihan', () => {
    expect(payState(7_500_000, 0)).toBe('belum')
    expect(payState(7_500_000, 2_250_000)).toBe('dp')
    expect(payState(7_500_000, 7_500_000)).toBe('lunas')
    expect(payState(7_500_000, 7_600_000)).toBe('lebih')
    expect(payState(0, 0)).toBe('belum')
    expect(remaining(7_500_000, 2_250_000)).toBe(5_250_000)
    expect(remaining(7_500_000, 9_000_000)).toBe(0)
  })
})

describe('usulan invoice', () => {
  it('DP 30% dibulatkan ke rupiah, dibatasi 0 sampai 100', () => {
    expect(dpAmount(7_500_000, 30)).toBe(2_250_000)
    expect(dpAmount(1_000_001, 30)).toBe(300_000)
    expect(dpAmount(1_000_000, 150)).toBe(1_000_000)
    expect(dpAmount(1_000_000, -5)).toBe(0)
  })

  it('jumlah: DP persen, pelunasan sisa, penuh seluruhnya, termin lain kosong', () => {
    expect(suggestInvoiceAmount('dp', 7_500_000, 0, 30)).toBe(2_250_000)
    expect(suggestInvoiceAmount('pelunasan', 7_500_000, 2_250_000, 30)).toBe(5_250_000)
    expect(suggestInvoiceAmount('penuh', 7_500_000, 0, 30)).toBe(7_500_000)
    expect(suggestInvoiceAmount('kustom', 7_500_000, 0, 30)).toBe(0)
  })

  it('jatuh tempo: DP 3 hari, pelunasan di hari acara, lainnya 7 hari', () => {
    expect(suggestDueDate('dp', '2026-11-25', '2026-12-20')).toBe('2026-11-28')
    expect(suggestDueDate('pelunasan', '2026-11-25', '2026-12-20')).toBe('2026-12-20')
    expect(suggestDueDate('pelunasan', '2026-11-25', null)).toBe('2026-12-02')
    expect(suggestDueDate('pelunasan', '2026-12-25', '2026-12-20')).toBe('2027-01-01')
    expect(suggestDueDate('penuh', '2026-11-25', '2026-12-20')).toBe('2026-12-02')
  })
})

describe('nomor invoice', () => {
  it('formatnya INV/awalan/tahun/bulan/urut', () => {
    expect(invoiceNumber('MOM', '2026-11-25', 1)).toBe('INV/MOM/2026/11/001')
    expect(invoiceNumber('MOM', '2026-01-02', 42)).toBe('INV/MOM/2026/01/042')
    expect(invoiceNumber('MOM', '2026-01-02', 1234)).toBe('INV/MOM/2026/01/1234')
  })

  it('urutan berikutnya hanya menghitung awalan dan bulan yang sama', () => {
    const all = ['INV/MOM/2026/11/001', 'INV/MOM/2026/11/007', 'INV/MOM/2026/10/050', 'INV/XYZ/2026/11/099', 'asal']
    expect(nextInvoiceSeq(all, 'MOM', '2026-11-30')).toBe(8)
    expect(nextInvoiceSeq(all, 'MOM', '2026-12-01')).toBe(1)
    expect(nextInvoiceSeq(all, 'XYZ', '2026-11-05')).toBe(100)
    expect(nextInvoiceSeq([], 'MOM', '2026-11-05')).toBe(1)
  })

  it('awalan dengan karakter khusus tidak merusak pencocokan', () => {
    expect(nextInvoiceSeq(['INV/M.M/2026/11/003'], 'M.M', '2026-11-05')).toBe(4)
    expect(cleanPrefix(' m.o-m 2026 panjang sekali ')).toBe('MOM2026P')
    expect(cleanPrefix('!!!')).toBe('')
  })
})

describe('status tampilan invoice', () => {
  it('lunas, batal, dan draft tidak pernah terlambat', () => {
    expect(invoiceState('lunas', '2026-01-01', '2026-11-25')).toMatchObject({ label: 'Lunas', overdue: false })
    expect(invoiceState('draft', '2026-01-01', '2026-11-25')).toMatchObject({ label: 'Draft', overdue: false })
    expect(invoiceState('batal', '2026-01-01', '2026-11-25')).toMatchObject({ label: 'Dibatalkan', overdue: false })
  })

  it('invoice terkirim: menunggu, segera, hari ini, terlambat', () => {
    expect(invoiceState('terkirim', '2026-12-25', '2026-11-25')).toMatchObject({ label: 'Menunggu bayar', overdue: false })
    expect(invoiceState('terkirim', '2026-11-27', '2026-11-25')).toMatchObject({ label: '2 hari lagi', tone: 'warn' })
    expect(invoiceState('terkirim', '2026-11-25', '2026-11-25')).toMatchObject({ label: 'Jatuh tempo hari ini', tone: 'warn' })
    expect(invoiceState('terkirim', '2026-11-22', '2026-11-25')).toMatchObject({ label: 'Lewat 3 hari', tone: 'danger', overdue: true })
  })
})

describe('salinan data invoice', () => {
  it('dibaca kembali utuh, dan data rusak ditolak tanpa melempar', () => {
    expect(parseSnapshot(JSON.stringify(snap))).toEqual(snap)
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot('bukan json')).toBeNull()
    expect(parseSnapshot('{"items":"x","total":1}')).toBeNull()
  })

  it('sisa setelah invoice dibayar', () => {
    expect(remainingAfter(snap, 2_250_000)).toBe(5_250_000)
    expect(remainingAfter({ ...snap, paidBefore: 2_250_000 }, 5_250_000)).toBe(0)
    expect(remainingAfter(snap, 9_000_000)).toBe(0)
  })
})

describe('teks WhatsApp invoice', () => {
  const identity = { ...DEFAULT_IDENTITY, bank: 'BCA', accountNo: '1234567890', accountName: 'Luthfan Fatih' }

  it('berisi nomor, jumlah, jatuh tempo, sisa, dan rekening', () => {
    const t = invoiceMessage({ identity, snapshot: snap, kind: 'dp', number: 'INV/MOM/2026/11/001', amount: 2_250_000, dueDate: '2026-11-28' })
    expect(t).toContain('Halo Sari, berikut invoice uang muka (DP) untuk Pernikahan Andi dan Sari (20 Des 2026).')
    expect(t).toContain('Nomor: INV/MOM/2026/11/001')
    expect(t).toContain('Jumlah: Rp2.250.000')
    expect(t).toContain('Jatuh tempo: 28 Nov 2026')
    expect(t).toContain('Sisa setelah ini: Rp5.250.000')
    expect(t).toContain('BCA 1234567890')
    expect(t).toContain('a.n. Luthfan Fatih')
  })

  it('tanpa rekening, bagian pembayaran dilewati. Invoice penuh tidak menyebut sisa', () => {
    const t = invoiceMessage({ identity: DEFAULT_IDENTITY, snapshot: snap, kind: 'penuh', number: 'INV/MOM/2026/11/002', amount: 7_500_000, dueDate: '2026-12-02' })
    expect(t).not.toContain('Pembayaran ke')
    expect(t).not.toContain('Sisa setelah ini')
  })
})

describe('nama file', () => {
  it('karakter terlarang diganti', () => {
    expect(safeFileName('INV/MOM/2026/11/001 Sari: "A"')).toBe('INV-MOM-2026-11-001 Sari- -A-')
    expect(safeFileName('///')).toBe('-')
    expect(safeFileName('   ')).toBe('invoice')
  })
})
