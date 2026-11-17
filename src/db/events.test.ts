import { beforeEach, describe, expect, it } from 'vitest'
import { createSqlJsDb } from './sqljs'
import { migrate } from './schema'
import type { Db } from './adapter'
import { collectDueReminders, deleteEvent, dueReminders, listEvents, reminderText, saveEvent, type EventInput } from './events'
import { saveCustomer, listCustomers } from './premium'

let db: Db
beforeEach(async () => {
  db = await createSqlJsDb({ persistKey: null })
  await migrate(db)
})

const ev = (o: Partial<EventInput> = {}): EventInput => ({
  title: 'Bimbingan tesis', date: '2026-11-20', start_time: '14:00', end_time: '15:00', category: 'kuliah',
  note: null, remind_day: true, remind_hours: true, ...o,
})
const t = (date: string, hhmm: string) => {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi).getTime()
}

describe('kegiatan', () => {
  it('menyimpan, mengurutkan per hari (seharian dulu, lalu per jam), dan menghapus lunak', async () => {
    await saveEvent(db, ev({ title: 'Sore', start_time: '16:00', end_time: null }))
    await saveEvent(db, ev({ title: 'Pagi', start_time: '08:00', end_time: null }))
    const all = await saveEvent(db, ev({ title: 'Seharian', start_time: null, end_time: null, remind_hours: false }))
    expect((await listEvents(db, '2026-11-20', '2026-11-20')).map((e) => e.title)).toEqual(['Seharian', 'Pagi', 'Sore'])
    await deleteEvent(db, all)
    expect(await listEvents(db, '2026-11-01', '2026-11-30')).toHaveLength(2)
    expect(await listEvents(db, '2026-12-01', '2026-12-31')).toHaveLength(0)
  })

  it('menolak masukan yang tidak masuk akal', async () => {
    await expect(saveEvent(db, ev({ title: '  ' }))).rejects.toThrow('Judul')
    await expect(saveEvent(db, ev({ end_time: '13:00' }))).rejects.toThrow('setelah jam mulai')
    await expect(saveEvent(db, ev({ start_time: null, end_time: '10:00' }))).rejects.toThrow('jam mulai')
    await expect(saveEvent(db, ev({ start_time: null, end_time: null, remind_hours: true }))).rejects.toThrow('butuh jam mulai')
    await expect(saveEvent(db, ev({ date: '20-11-2026' }))).rejects.toThrow('Tanggal')
  })

  it('mengubah kegiatan memperbarui barisnya, bukan menambah', async () => {
    const id = await saveEvent(db, ev())
    await saveEvent(db, ev({ title: 'Revisi bab 4', category: 'pribadi' }), id)
    const rows = await listEvents(db, '2026-11-20', '2026-11-20')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Revisi bab 4', category: 'pribadi' })
  })
})

describe('pengingat', () => {
  const base = { id: 'e1', title: 'Rapat', date: '2026-11-20', start_time: '14:00', end_time: null, category: 'mahesa' as const, note: null, remind_day: 1, remind_hours: 1 }

  it('H-1 mulai 24 jam sebelum, 5 jam sebelum mulai 5 jam sebelum, dan tidak lebih awal', () => {
    expect(dueReminders([base], t('2026-11-19', '13:59'), new Set())).toHaveLength(0)
    expect(dueReminders([base], t('2026-11-19', '14:00'), new Set()).map((r) => r.kind)).toEqual(['day'])
    expect(dueReminders([base], t('2026-11-20', '08:59'), new Set()).map((r) => r.kind)).toEqual(['day'])
    expect(dueReminders([base], t('2026-11-20', '09:00'), new Set()).map((r) => r.kind).sort()).toEqual(['day', 'hours'])
  })

  it('tidak mengingatkan kegiatan yang sudah mulai, dan tidak mengulang yang sudah dikirim', () => {
    expect(dueReminders([base], t('2026-11-20', '14:00'), new Set())).toHaveLength(0)
    const first = dueReminders([base], t('2026-11-20', '10:00'), new Set())
    expect(dueReminders([base], t('2026-11-20', '10:05'), new Set(first.map((r) => r.key)))).toHaveLength(0)
  })

  it('kegiatan seharian diingatkan jam 09.00 sehari sebelumnya', () => {
    const allDay = { ...base, start_time: null, remind_hours: 0 }
    expect(dueReminders([allDay], t('2026-11-19', '08:59'), new Set())).toHaveLength(0)
    expect(dueReminders([allDay], t('2026-11-19', '09:00'), new Set())).toHaveLength(1)
    expect(dueReminders([allDay], t('2026-11-20', '12:00'), new Set())).toHaveLength(1)
    expect(dueReminders([allDay], t('2026-11-21', '00:00'), new Set())).toHaveLength(0)
  })

  it('mengubah jam kegiatan membuat pengingat baru (kunci berbeda)', () => {
    const k1 = dueReminders([base], t('2026-11-20', '10:00'), new Set())[0].key
    const moved = { ...base, start_time: '16:00' }
    expect(dueReminders([moved], t('2026-11-20', '12:00'), new Set([k1])).length).toBeGreaterThan(0)
  })

  it('teks pengingat jelas', () => {
    const r = dueReminders([base], t('2026-11-20', '10:00'), new Set())
    const hours = r.find((x) => x.kind === 'hours')!
    expect(reminderText(hours, t('2026-11-20', '10:00'))).toEqual({ title: 'Mahesa: Rapat', body: 'Mulai jam 14:00, sekitar 4 jam lagi.' })
    const day = r.find((x) => x.kind === 'day')!
    expect(reminderText(day, t('2026-11-20', '10:00')).body).toBe('Besok jam 14:00.')
  })

  it('kegiatan yang dibuat setelah waktu pengingatnya lewat tidak langsung berbunyi', () => {
    const made = t('2026-11-20', '11:00')
    expect(dueReminders([{ ...base, updated_at: made }], t('2026-11-20', '11:01'), new Set())).toHaveLength(0)
    // dibuat sebelum waktu pengingat: tetap berbunyi pada waktunya
    expect(dueReminders([{ ...base, updated_at: t('2026-11-20', '08:00') }], t('2026-11-20', '09:00'), new Set()).map((r) => r.kind)).toContain('hours')
  })

  it('collectDueReminders menandai sudah dikirim sehingga panggilan kedua kosong', async () => {
    await saveEvent(db, ev({ date: '2026-11-20', start_time: '14:00', end_time: null }))
    await db.run(`UPDATE events SET updated_at = 1`)
    const n = t('2026-11-20', '10:00')
    // H-1 dan 5 jam sama-sama sudah lewat: hanya satu pemberitahuan (yang 5 jam)
    expect((await collectDueReminders(db, n)).map((r) => r.kind)).toEqual(['hours'])
    expect(await collectDueReminders(db, n + 60_000)).toHaveLength(0)
  })
})

describe('email customer', () => {
  it('disimpan, dan tidak terhapus saat ubah tanpa mengirim email', async () => {
    const id = await saveCustomer(db, { name: 'Budi', contact: '0812', note: null, email: 'budi@mail.com' })
    await saveCustomer(db, { name: 'Budi S', contact: '0812', note: null }, id)
    expect((await listCustomers(db))[0]).toMatchObject({ name: 'Budi S', email: 'budi@mail.com' })
    await saveCustomer(db, { name: 'Budi S', contact: '0812', note: null, email: null }, id)
    expect((await listCustomers(db))[0].email).toBeNull()
  })

  it('menolak email yang formatnya salah dan membersihkan nomor tempelan', async () => {
    await expect(saveCustomer(db, { name: 'A', contact: null, note: null, email: 'bukan-email' })).rejects.toThrow('email')
    const id = await saveCustomer(db, { name: 'A', contact: '+62 812-3456-7890', note: null, email: '  a@b.co ' })
    expect(await listCustomers(db)).toMatchObject([{ contact: '6281234567890', email: 'a@b.co' }])
    await saveCustomer(db, { name: 'A', contact: '@ani', note: null }, id)
    expect((await listCustomers(db))[0].contact).toBe('@ani')
  })
})
