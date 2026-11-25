import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './adapter'
import { createSqlJsDb } from './sqljs'
import { migrate } from './schema'
import { listEvents } from './events'
import { dumpAll, restoreAll } from './backup'
import { syncNow } from './sync'
import {
  collectInvoiceReminders, createInvoice, deleteInvoice, deleteMomExpense, deletePayment, deleteProject,
  dueInvoiceReminders, getInvoice, getProjectRow, invoiceReminderText, listInvoices, listItems, listMomExpenses,
  listOutstandingInvoices, listPayments, listProjectInvoices, listProjects, loadIdentity, momDashboard, monthCosts,
  monthIncome, projectsByEventDate, saveIdentity, saveMomExpense, savePayment, saveProject, setInvoiceStatus,
  setStage, updateInvoice, yearFigures, type Invoice, type ProjectInput,
} from './momentum'
import { DEFAULT_IDENTITY, parseSnapshot, payState } from '@/lib/momentum'

let db: Db
beforeEach(async () => {
  db = await createSqlJsDb({ persistKey: null })
  await migrate(db)
})

const proj = (over: Partial<ProjectInput> = {}): ProjectInput => ({
  name: 'Pernikahan Andi dan Sari', clientName: 'Sari', clientContact: '0812-3456-7890', clientAddress: 'Bogor',
  eventDate: '2026-12-20', venue: 'Gedung Serbaguna', deliverBy: '2027-01-20', stage: 'booking', discount: 500_000, note: null,
  items: [
    { name: 'Paket Video Cinematic', qty: 1, unitPrice: 8_000_000 },
    { name: 'Drone', qty: 1, unitPrice: 750_000 },
  ],
  ...over,
})

describe('project', () => {
  it('menyimpan project dengan item, dan angka ringkasnya terhitung', async () => {
    const id = await saveProject(db, proj())
    const p = (await getProjectRow(db, id))!
    expect(p.items_total).toBe(8_750_000)
    expect(p.total).toBe(8_250_000)
    expect(p.paid).toBe(0)
    expect(p.cost).toBe(0)
    expect((await listItems(db, id)).map((i) => i.name)).toEqual(['Paket Video Cinematic', 'Drone'])
  })

  it('mengubah project: item lama diperbarui, yang tidak ada lagi dihapus, yang baru ditambah', async () => {
    const id = await saveProject(db, proj())
    const [video, drone] = await listItems(db, id)
    await saveProject(
      db,
      proj({
        discount: 0,
        items: [
          { id: video.id, name: 'Paket Video Cinematic', qty: 1, unitPrice: 9_000_000 },
          { name: 'Album 20 halaman', qty: 2, unitPrice: 600_000 },
        ],
      }),
      id,
    )
    const items = await listItems(db, id)
    expect(items.map((i) => i.name)).toEqual(['Paket Video Cinematic', 'Album 20 halaman'])
    expect(items.some((i) => i.id === drone.id)).toBe(false)
    expect((await getProjectRow(db, id))!.total).toBe(10_200_000)
  })

  it('menolak isian yang tidak masuk akal', async () => {
    await expect(saveProject(db, proj({ name: ' ' }))).rejects.toThrow('Nama project wajib')
    await expect(saveProject(db, proj({ clientName: '' }))).rejects.toThrow('Nama klien wajib')
    await expect(saveProject(db, proj({ deliverBy: '2026-12-01' }))).rejects.toThrow('sebelum tanggal acara')
    await expect(saveProject(db, proj({ stage: 'entah' }))).rejects.toThrow('Tahap project')
    await expect(saveProject(db, proj({ discount: 99_000_000 }))).rejects.toThrow('Diskon')
    await expect(saveProject(db, proj({ items: [{ name: 'X', qty: 0, unitPrice: 1 }] }))).rejects.toThrow('Jumlah item')
    await expect(saveProject(db, proj({ items: [{ name: 'X', qty: 1, unitPrice: -1 }] }))).rejects.toThrow('Harga item')
    await expect(saveProject(db, proj({ eventDate: '20-12-2026' }))).rejects.toThrow('Tanggal acara')
    await expect(saveProject(db, proj(), 'tidak-ada')).rejects.toThrow('tidak ditemukan')
  })

  it('acara dan tenggat serah hasil masuk kalender Pribadi dengan pengingat H-1', async () => {
    const id = await saveProject(db, proj())
    const ev = await listEvents(db, '2026-12-01', '2027-02-01')
    expect(ev.map((e) => [e.title, e.date, e.category, e.remind_day])).toEqual([
      ['Acara Pernikahan Andi dan Sari', '2026-12-20', 'momentum', 1],
      ['Serah hasil Pernikahan Andi dan Sari', '2027-01-20', 'momentum', 1],
    ])
    // ubah tanggal: kegiatan yang sama ikut berubah, tidak menggandakan
    await saveProject(db, proj({ eventDate: '2026-12-27', deliverBy: '2027-01-27' }), id)
    const after = await listEvents(db, '2026-12-01', '2027-02-01')
    expect(after.map((e) => e.date)).toEqual(['2026-12-27', '2027-01-27'])
  })

  it('tahap Batal menghapus kegiatan kalender, dan dihidupkan lagi saat tahap kembali', async () => {
    const id = await saveProject(db, proj())
    await setStage(db, id, 'batal')
    expect(await listEvents(db, '2026-12-01', '2027-02-01')).toHaveLength(0)
    await setStage(db, id, 'produksi')
    expect(await listEvents(db, '2026-12-01', '2027-02-01')).toHaveLength(2)
  })

  it('tahap Selesai menghapus tenggat serah hasil tapi acaranya tetap tercatat', async () => {
    const id = await saveProject(db, proj())
    await setStage(db, id, 'selesai')
    expect((await listEvents(db, '2026-12-01', '2027-02-01')).map((e) => e.title)).toEqual(['Acara Pernikahan Andi dan Sari'])
  })

  it('kegiatan yang sengaja dihapus dari kalender tidak dihidupkan lagi saat project disimpan', async () => {
    const id = await saveProject(db, proj())
    const [event] = await listEvents(db, '2026-12-01', '2026-12-31')
    await db.run(`UPDATE events SET deleted_at = 1 WHERE id = ?`, [event.id])
    await saveProject(db, proj({ note: 'tambah catatan' }), id)
    expect(await listEvents(db, '2026-12-01', '2026-12-31')).toHaveLength(0)
  })

  it('project tanpa tanggal acara tidak membuat kegiatan', async () => {
    await saveProject(db, proj({ eventDate: null, deliverBy: null }))
    expect(await listEvents(db, '2026-01-01', '2027-12-31')).toHaveLength(0)
  })

  it('project yang sudah punya pembayaran atau biaya tidak bisa dihapus, yang kosong bisa', async () => {
    const a = await saveProject(db, proj())
    const b = await saveProject(db, proj({ name: 'Wisuda' }))
    await savePayment(db, { projectId: a, date: '2026-11-25', amount: 2_000_000, kind: 'dp' })
    await expect(deleteProject(db, a)).rejects.toThrow('1 pembayaran')
    await saveMomExpense(db, { date: '2026-12-20', name: 'Transport', category: 'transport', amount: 100_000, projectId: b, spreadMonths: 1 })
    await expect(deleteProject(db, b)).rejects.toThrow('1 biaya')
    await deleteMomExpense(db, (await listMomExpenses(db, '2026-12-01', '2026-12-31'))[0].id)
    await deleteProject(db, b)
    expect((await listProjects(db)).map((p) => p.name)).toEqual(['Pernikahan Andi dan Sari'])
  })
})

describe('pembayaran klien', () => {
  it('status bayar mengikuti pembayaran yang masuk, dan hapus pembayaran mengembalikannya', async () => {
    const id = await saveProject(db, proj())
    expect(payState((await getProjectRow(db, id))!.total, 0)).toBe('belum')
    const dp = await savePayment(db, { projectId: id, date: '2026-11-25', amount: 2_475_000, kind: 'dp' })
    let p = (await getProjectRow(db, id))!
    expect(p.paid).toBe(2_475_000)
    expect(payState(p.total, p.paid)).toBe('dp')
    await savePayment(db, { projectId: id, date: '2026-12-20', amount: 5_775_000, kind: 'pelunasan' })
    p = (await getProjectRow(db, id))!
    expect(payState(p.total, p.paid)).toBe('lunas')
    await deletePayment(db, dp)
    p = (await getProjectRow(db, id))!
    expect(payState(p.total, p.paid)).toBe('dp')
  })

  it('menolak nominal nol, jenis aneh, tanggal rusak, dan project yang tidak ada', async () => {
    const id = await saveProject(db, proj())
    await expect(savePayment(db, { projectId: id, date: '2026-11-25', amount: 0, kind: 'dp' })).rejects.toThrow('lebih dari nol')
    await expect(savePayment(db, { projectId: id, date: '2026-11-25', amount: 1.5, kind: 'dp' })).rejects.toThrow('lebih dari nol')
    await expect(savePayment(db, { projectId: id, date: '2026-11-25', amount: 1000, kind: 'x' })).rejects.toThrow('Jenis')
    await expect(savePayment(db, { projectId: id, date: 'besok', amount: 1000, kind: 'dp' })).rejects.toThrow('Tanggal')
    await expect(savePayment(db, { projectId: 'nol', date: '2026-11-25', amount: 1000, kind: 'dp' })).rejects.toThrow('Project')
  })

  it('mengubah pembayaran memperbarui catatan yang sama', async () => {
    const id = await saveProject(db, proj())
    const pay = await savePayment(db, { projectId: id, date: '2026-11-25', amount: 1_000_000, kind: 'dp' })
    await savePayment(db, { projectId: id, date: '2026-11-26', amount: 1_500_000, kind: 'termin', note: 'revisi' }, pay)
    const rows = await listPayments(db, '2026-11-01', '2026-11-30')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ amount: 1_500_000, date: '2026-11-26', kind: 'termin', note: 'revisi', project_name: 'Pernikahan Andi dan Sari' })
  })
})

describe('biaya dan laporan', () => {
  it('biaya project dihitung penuh di bulan dibayar walau diminta dibagi 12 bulan', async () => {
    const id = await saveProject(db, proj())
    await saveMomExpense(db, { date: '2026-12-20', name: 'Honor videografer', category: 'honor', amount: 1_200_000, projectId: id, spreadMonths: 12 })
    expect((await monthCosts(db, '2026-12')).total).toBe(1_200_000)
    expect((await monthCosts(db, '2027-01')).total).toBe(0)
    expect((await getProjectRow(db, id))!.cost).toBe(1_200_000)
  })

  it('biaya umum tahunan dibagi rata ke 12 bulan dan jumlahnya tetap utuh', async () => {
    await saveMomExpense(db, { date: '2026-11-10', name: 'Langganan editing', category: 'software', amount: 1_200_005, spreadMonths: 12 })
    expect((await monthCosts(db, '2026-11')).total).toBe(100_001)
    expect((await monthCosts(db, '2026-12')).total).toBe(100_001)
    expect((await monthCosts(db, '2027-03')).total).toBe(100_001)
    expect((await monthCosts(db, '2027-04')).total).toBe(100_000)
    expect((await monthCosts(db, '2027-11')).total).toBe(0)
    const year = await yearFigures(db, 2026)
    const next = await yearFigures(db, 2027)
    expect(year.reduce((a, m) => a + m.costs, 0) + next.reduce((a, m) => a + m.costs, 0)).toBe(1_200_005)
  })

  it('uang masuk per bulan dan per tahun, profit tunai = masuk dikurangi beban', async () => {
    const id = await saveProject(db, proj())
    await savePayment(db, { projectId: id, date: '2026-11-25', amount: 2_475_000, kind: 'dp' })
    await savePayment(db, { projectId: id, date: '2026-12-20', amount: 5_775_000, kind: 'pelunasan' })
    await saveMomExpense(db, { date: '2026-12-20', name: 'Transport', category: 'transport', amount: 300_000, projectId: id, spreadMonths: 1 })
    expect(await monthIncome(db, '2026-11')).toBe(2_475_000)
    const y = await yearFigures(db, 2026)
    expect(y[10]).toEqual({ ym: '2026-11', income: 2_475_000, costs: 0 })
    expect(y[11]).toEqual({ ym: '2026-12', income: 5_775_000, costs: 300_000 })
  })

  it('margin per project: project di luar rentang atau yang batal tidak ikut', async () => {
    const a = await saveProject(db, proj())
    await saveProject(db, proj({ name: 'Wisuda', eventDate: '2027-02-01', deliverBy: null }))
    await saveProject(db, proj({ name: 'Batal', stage: 'batal' }))
    await saveMomExpense(db, { date: '2026-12-20', name: 'Honor', category: 'honor', amount: 1_000_000, projectId: a, spreadMonths: 1 })
    const rows = await projectsByEventDate(db, '2026-12-01', '2026-12-31')
    expect(rows.map((r) => r.name)).toEqual(['Pernikahan Andi dan Sari'])
    expect(rows[0].total - rows[0].cost).toBe(7_250_000)
  })

  it('menolak biaya tidak valid', async () => {
    await expect(saveMomExpense(db, { date: '2026-12-01', name: '', category: 'honor', amount: 1, spreadMonths: 1 })).rejects.toThrow('Nama biaya')
    await expect(saveMomExpense(db, { date: '2026-12-01', name: 'x', category: 'entah', amount: 1, spreadMonths: 1 })).rejects.toThrow('Kategori')
    await expect(saveMomExpense(db, { date: '2026-12-01', name: 'x', category: 'honor', amount: 1, spreadMonths: 6 })).rejects.toThrow('1 atau 12')
    await expect(saveMomExpense(db, { date: '2026-12-01', name: 'x', category: 'honor', amount: 1, projectId: 'nol', spreadMonths: 1 })).rejects.toThrow('Project')
  })
})

describe('invoice', () => {
  const issue = { issueDate: '2026-11-25', note: null }

  it('nomor berurutan per bulan, dan awalan dari identitas dipakai', async () => {
    const id = await saveProject(db, proj())
    const a = await createInvoice(db, id, { ...issue, kind: 'dp', amount: 2_475_000, dueDate: '2026-11-28' })
    const b = await createInvoice(db, id, { ...issue, kind: 'pelunasan', amount: 5_775_000, dueDate: '2026-12-20' })
    const c = await createInvoice(db, id, { issueDate: '2026-12-01', kind: 'kustom', amount: 100_000, dueDate: '2026-12-05' })
    expect((await getInvoice(db, a)).number).toBe('INV/MOM/2026/11/001')
    expect((await getInvoice(db, b)).number).toBe('INV/MOM/2026/11/002')
    expect((await getInvoice(db, c)).number).toBe('INV/MOM/2026/12/001')
    await saveIdentity(db, { ...DEFAULT_IDENTITY, prefix: 'lun' })
    const d = await createInvoice(db, id, { ...issue, kind: 'kustom', amount: 1000, dueDate: '2026-11-30' })
    expect((await getInvoice(db, d)).number).toBe('INV/LUN/2026/11/001')
  })

  it('nomor invoice yang dihapus tidak dipakai lagi', async () => {
    const id = await saveProject(db, proj())
    const a = await createInvoice(db, id, { ...issue, kind: 'dp', amount: 1000, dueDate: '2026-11-28' })
    await deleteInvoice(db, a)
    const b = await createInvoice(db, id, { ...issue, kind: 'dp', amount: 1000, dueDate: '2026-11-28' })
    expect((await getInvoice(db, b)).number).toBe('INV/MOM/2026/11/002')
  })

  it('isi invoice dibekukan saat dibuat: perubahan project tidak mengubah invoice yang sudah ada', async () => {
    const id = await saveProject(db, proj())
    const inv = await createInvoice(db, id, { ...issue, kind: 'dp', amount: 2_475_000, dueDate: '2026-11-28' })
    await saveProject(db, proj({ discount: 0, items: [{ name: 'Paket Video Cinematic', qty: 1, unitPrice: 20_000_000 }] }), id)
    const snap = parseSnapshot((await getInvoice(db, inv)).snapshot)!
    expect(snap.total).toBe(8_250_000)
    expect(snap.items.map((i) => i.name)).toEqual(['Paket Video Cinematic', 'Drone'])
    expect(snap.eventDate).toBe('2026-12-20')
  })

  it('draft bisa mengambil ulang data project, yang sudah terkirim tidak bisa diubah', async () => {
    const id = await saveProject(db, proj())
    const inv = await createInvoice(db, id, { ...issue, kind: 'penuh', amount: 8_250_000, dueDate: '2026-12-02' })
    await saveProject(db, proj({ discount: 0 }), id)
    await updateInvoice(db, inv, { ...issue, kind: 'penuh', amount: 8_750_000, dueDate: '2026-12-02' }, true)
    expect(parseSnapshot((await getInvoice(db, inv)).snapshot)!.total).toBe(8_750_000)
    await setInvoiceStatus(db, inv, 'terkirim')
    await expect(updateInvoice(db, inv, { ...issue, kind: 'penuh', amount: 1, dueDate: '2026-12-02' })).rejects.toThrow('sudah dikirim')
  })

  it('tandai lunas mencatat pembayaran di project, dan membatalkannya menghapus pembayaran itu', async () => {
    const id = await saveProject(db, proj())
    const inv = await createInvoice(db, id, { ...issue, kind: 'dp', amount: 2_475_000, dueDate: '2026-11-28' })
    await setInvoiceStatus(db, inv, 'terkirim')
    await setInvoiceStatus(db, inv, 'lunas', '2026-11-27')
    let pays = await listPayments(db, '2026-11-01', '2026-11-30')
    expect(pays).toHaveLength(1)
    expect(pays[0]).toMatchObject({ amount: 2_475_000, date: '2026-11-27', kind: 'dp', invoice_id: inv })
    expect((await getProjectRow(db, id))!.paid).toBe(2_475_000)

    await setInvoiceStatus(db, inv, 'terkirim')
    pays = await listPayments(db, '2026-11-01', '2026-11-30')
    expect(pays).toHaveLength(0)
    expect((await getInvoice(db, inv)).status).toBe('terkirim')
  })

  it('menghapus pembayaran dari invoice yang lunas mengembalikan invoice ke Terkirim', async () => {
    const id = await saveProject(db, proj())
    const inv = await createInvoice(db, id, { ...issue, kind: 'dp', amount: 2_475_000, dueDate: '2026-11-28' })
    await setInvoiceStatus(db, inv, 'terkirim')
    await setInvoiceStatus(db, inv, 'lunas')
    await deletePayment(db, (await listPayments(db, '2000-01-01', '2100-01-01'))[0].id)
    expect((await getInvoice(db, inv)).status).toBe('terkirim')
  })

  it('perpindahan status yang tidak masuk akal ditolak, dan hanya draft atau batal yang bisa dihapus', async () => {
    const id = await saveProject(db, proj())
    const inv = await createInvoice(db, id, { ...issue, kind: 'dp', amount: 2_475_000, dueDate: '2026-11-28' })
    await expect(setInvoiceStatus(db, inv, 'lunas')).rejects.toThrow('tidak diizinkan')
    await expect(setInvoiceStatus(db, inv, 'entah')).rejects.toThrow('tidak dikenal')
    await setInvoiceStatus(db, inv, 'terkirim')
    await expect(deleteInvoice(db, inv)).rejects.toThrow('Hanya draft')
    await setInvoiceStatus(db, inv, 'batal')
    await deleteInvoice(db, inv)
    expect(await listProjectInvoices(db, id)).toHaveLength(0)
  })

  it('validasi isian invoice', async () => {
    const id = await saveProject(db, proj())
    await expect(createInvoice(db, id, { ...issue, kind: 'dp', amount: 0, dueDate: '2026-11-28' })).rejects.toThrow('lebih dari nol')
    await expect(createInvoice(db, id, { ...issue, kind: 'dp', amount: 1000, dueDate: '2026-11-20' })).rejects.toThrow('sebelum tanggal terbit')
    await expect(createInvoice(db, id, { ...issue, kind: 'x', amount: 1000, dueDate: '2026-11-28' })).rejects.toThrow('Jenis')
    await expect(createInvoice(db, 'nol', { ...issue, kind: 'dp', amount: 1000, dueDate: '2026-11-28' })).rejects.toThrow('Project')
  })

  it('daftar invoice menunggu bayar hanya berisi yang terkirim, jatuh tempo terdekat dulu', async () => {
    const id = await saveProject(db, proj())
    const late = await createInvoice(db, id, { ...issue, kind: 'kustom', amount: 1000, dueDate: '2026-12-10' })
    const soon = await createInvoice(db, id, { ...issue, kind: 'kustom', amount: 2000, dueDate: '2026-11-28' })
    await createInvoice(db, id, { ...issue, kind: 'kustom', amount: 3000, dueDate: '2026-11-27' }) // draft
    await setInvoiceStatus(db, late, 'terkirim')
    await setInvoiceStatus(db, soon, 'terkirim')
    expect((await listOutstandingInvoices(db, 10)).map((i) => i.amount)).toEqual([2000, 1000])
    expect(await listInvoices(db)).toHaveLength(3)
  })
})

describe('identitas invoice', () => {
  it('nilai bawaan saat belum diisi, tersimpan dan terbaca kembali setelah diisi', async () => {
    expect(await loadIdentity(db)).toEqual(DEFAULT_IDENTITY)
    const logo = 'data:image/png;base64,iVBORw0KGgo='
    await saveIdentity(db, {
      name: 'Momentum by Luna', address: 'Bogor', contact: '0812', bank: 'BCA', accountNo: '123', accountName: 'Luthfan',
      footer: 'Terima kasih', prefix: 'mom', dpPercent: 40, logo, logoW: 300, logoH: 100,
    })
    expect(await loadIdentity(db)).toMatchObject({ bank: 'BCA', prefix: 'MOM', dpPercent: 40, logo, logoW: 300, logoH: 100 })
  })

  it('menolak isian yang tidak valid', async () => {
    const ok = { ...DEFAULT_IDENTITY }
    await expect(saveIdentity(db, { ...ok, name: ' ' })).rejects.toThrow('Nama usaha')
    await expect(saveIdentity(db, { ...ok, prefix: '!!' })).rejects.toThrow('Awalan')
    await expect(saveIdentity(db, { ...ok, dpPercent: 0 })).rejects.toThrow('1 sampai 100')
    await expect(saveIdentity(db, { ...ok, dpPercent: 30.5 })).rejects.toThrow('1 sampai 100')
    await expect(saveIdentity(db, { ...ok, logo: 'http://x/logo.png' })).rejects.toThrow('Logo')
  })
})

describe('pengingat invoice', () => {
  const at = (s: string, h = 10) => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d, h, 0).getTime()
  }
  const inv = (over: Partial<Invoice> = {}): Invoice => ({
    id: 'i1', project_id: 'p1', project_name: 'Wedding', client_name: 'Sari', number: 'INV/MOM/2026/11/001', kind: 'dp',
    issue_date: '2026-11-20', due_date: '2026-11-28', amount: 2_475_000, status: 'terkirim', note: null, snapshot: null,
    updated_at: at('2026-11-20'), ...over,
  })

  it('H-1 jam 09.00, hari jatuh tempo, lalu terlambat tiap hari', () => {
    expect(dueInvoiceReminders([inv()], at('2026-11-26'), new Set())).toHaveLength(0)
    expect(dueInvoiceReminders([inv()], at('2026-11-27', 8), new Set())).toHaveLength(0)
    expect(dueInvoiceReminders([inv()], at('2026-11-27'), new Set()).map((r) => r.kind)).toEqual(['h1'])
    expect(dueInvoiceReminders([inv()], at('2026-11-28'), new Set()).map((r) => r.kind)).toEqual(['h0'])
    const late = dueInvoiceReminders([inv()], at('2026-12-01'), new Set())
    expect(late.map((r) => r.kind)).toEqual(['late'])
    expect(invoiceReminderText(late[0]).body).toContain('Lewat 3 hari')
  })

  it('draft, lunas, dan batal tidak diingatkan, dan yang sudah dikirim tidak diulang', () => {
    for (const status of ['draft', 'lunas', 'batal'] as const) {
      expect(dueInvoiceReminders([inv({ status })], at('2026-11-28'), new Set())).toHaveLength(0)
    }
    const [r] = dueInvoiceReminders([inv()], at('2026-11-28'), new Set())
    expect(dueInvoiceReminders([inv()], at('2026-11-28', 12), new Set([r.key]))).toHaveLength(0)
  })

  it('invoice yang dikirim setelah jam pengingatnya tidak mengingatkan dirinya sendiri', () => {
    const sentLate = inv({ updated_at: at('2026-11-27', 11) })
    expect(dueInvoiceReminders([sentLate], at('2026-11-27', 12), new Set())).toHaveLength(0)
    expect(dueInvoiceReminders([sentLate], at('2026-11-28'), new Set()).map((r) => r.kind)).toEqual(['h0'])
  })

  it('mengumpulkan dari database dan menandainya terkirim supaya tidak muncul dua kali', async () => {
    const id = await saveProject(db, proj())
    const i = await createInvoice(db, id, { issueDate: '2026-11-20', note: null, kind: 'dp', amount: 2_475_000, dueDate: '2026-11-28' })
    await setInvoiceStatus(db, i, 'terkirim')
    await db.run(`UPDATE mom_invoices SET updated_at = ? WHERE id = ?`, [at('2026-11-20'), i])
    const first = await collectInvoiceReminders(db, at('2026-11-28'))
    expect(first).toHaveLength(1)
    expect(invoiceReminderText(first[0]).title).toBe('Invoice INV/MOM/2026/11/001')
    expect(await collectInvoiceReminders(db, at('2026-11-28', 15))).toHaveLength(0)
  })
})

describe('dashboard', () => {
  it('piutang hanya dari project yang sudah dikontrak, acara terdekat urut tanggal', async () => {
    const a = await saveProject(db, proj({ name: 'A booking', stage: 'booking', eventDate: '2026-12-20' }))
    await saveProject(db, proj({ name: 'B inquiry', stage: 'inquiry', eventDate: '2026-12-05' }))
    await saveProject(db, proj({ name: 'C batal', stage: 'batal', eventDate: '2026-12-01' }))
    await saveProject(db, proj({ name: 'D lampau', stage: 'booking', eventDate: '2026-10-01' }))
    await savePayment(db, { projectId: a, date: '2026-11-25', amount: 2_475_000, kind: 'dp' })
    const d = await momDashboard(db, '2026-11-25')
    // A: 8.250.000 - 2.475.000 = 5.775.000, D: 8.250.000 belum dibayar. Inquiry dan batal tidak dihitung.
    expect(d.receivable).toBe(5_775_000 + 8_250_000)
    expect(d.receivableCount).toBe(2)
    expect(d.upcoming.map((p) => p.name)).toEqual(['B inquiry', 'A booking'])
    expect(d.income).toBe(2_475_000)
    expect(d.projectCount).toBe(4)
  })
})

describe('cadangan dan sinkron', () => {
  async function seed(d: Db) {
    const id = await saveProject(d, proj())
    const inv = await createInvoice(d, id, { issueDate: '2026-11-25', note: 'catatan', kind: 'dp', amount: 2_475_000, dueDate: '2026-11-28' })
    await setInvoiceStatus(d, inv, 'terkirim')
    await setInvoiceStatus(d, inv, 'lunas', '2026-11-27')
    await saveMomExpense(d, { date: '2026-12-20', name: 'Honor', category: 'honor', amount: 1_000_000, projectId: id, spreadMonths: 1 })
    return { id, inv }
  }

  it('cadangan dan pemulihan membawa semua tabel Momentum', async () => {
    const { id } = await seed(db)
    const dump = await dumpAll(db)
    const other = await createSqlJsDb({ persistKey: null })
    await migrate(other)
    await restoreAll(other, JSON.parse(JSON.stringify(dump)))
    const p = (await getProjectRow(other, id))!
    expect(p).toMatchObject({ total: 8_250_000, paid: 2_475_000, cost: 1_000_000 })
    expect(await listProjectInvoices(other, id)).toHaveLength(1)
  })

  it('cadangan lama tanpa tabel Momentum tetap bisa dipulihkan', async () => {
    const dump = await dumpAll(db)
    for (const t of ['mom_projects', 'mom_items', 'mom_payments', 'mom_invoices', 'mom_expenses']) delete (dump.tables as Record<string, unknown>)[t]
    await expect(restoreAll(db, dump)).resolves.toBeUndefined()
  })

  it('perangkat kedua mendapat project, item, invoice, pembayaran, dan biaya yang sama', async () => {
    const tables: Record<string, Map<string, Record<string, unknown>>> = {}
    let clock = 1000
    const fetchFake = (async (_u: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { v: number; push: Record<string, Record<string, unknown>[]>; since: Record<string, string> }
      expect(body.v).toBe(6)
      clock += 1
      for (const [t, rows] of Object.entries(body.push)) {
        tables[t] ??= new Map()
        for (const r of rows) {
          const cur = tables[t].get(String(r.id))
          if (!cur || Number(cur.updated_at) < Number(r.updated_at)) tables[t].set(String(r.id), { ...r, synced_at: clock })
        }
      }
      const pull: Record<string, unknown> = {}
      for (const t of Object.keys(body.since)) {
        const [ts, id = '0'] = body.since[t].split('|')
        const rows = [...(tables[t]?.values() ?? [])]
          .filter((r) => Number(r.synced_at) > Number(ts) || (Number(r.synced_at) === Number(ts) && String(r.id) > id))
          .sort((a, b) => Number(a.synced_at) - Number(b.synced_at) || String(a.id).localeCompare(String(b.id)))
        const last = rows[rows.length - 1]
        pull[t] = { rows, next: last ? `${last.synced_at}|${last.id}` : null }
      }
      return new Response(JSON.stringify({ pull, more: false }), { status: 200 })
    }) as unknown as typeof fetch
    const cfg = { url: 'https://x.test', key: 'k' }

    const { id } = await seed(db)
    await syncNow(db, cfg, fetchFake)
    const b = await createSqlJsDb({ persistKey: null })
    await migrate(b)
    await syncNow(b, cfg, fetchFake)
    expect(await getProjectRow(b, id)).toEqual(await getProjectRow(db, id))
    expect(await listItems(b, id)).toEqual(await listItems(db, id))
    expect(await listProjectInvoices(b, id)).toEqual(await listProjectInvoices(db, id))
    expect(await listPayments(b, '2026-01-01', '2026-12-31')).toEqual(await listPayments(db, '2026-01-01', '2026-12-31'))
    expect(await listMomExpenses(b, '2026-01-01', '2026-12-31')).toEqual(await listMomExpenses(db, '2026-01-01', '2026-12-31'))
    expect((await listEvents(b, '2026-12-01', '2027-02-01')).length).toBe(2)
  })
})
