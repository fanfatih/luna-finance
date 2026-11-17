import type { Db } from './adapter'
import { uid } from './finance'
import { addDays } from '@/lib/date'

const now = (): number => Date.now()

/* ---------- Kategori ---------- */

export type EventCategory = 'pribadi' | 'kuliah' | 'momentum' | 'mahesa' | 'lunatopup'

/** Warna hanya penanda kategori (kegiatan harus bisa dibedakan sekilas di kalender). */
export const CATEGORIES: { id: EventCategory; label: string; color: string }[] = [
  { id: 'pribadi', label: 'Pribadi', color: '#8b5cf6' },
  { id: 'kuliah', label: 'Kuliah', color: '#f59e0b' },
  { id: 'momentum', label: 'Momentum', color: '#ec4899' },
  { id: 'mahesa', label: 'Mahesa', color: '#10b981' },
  { id: 'lunatopup', label: 'Lunatopup', color: '#2563eb' },
]

export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0]

/* ---------- Data kegiatan ---------- */

export interface EventRow {
  id: string
  title: string
  /** YYYY-MM-DD, waktu lokal */
  date: string
  /** HH:MM. Kosong berarti kegiatan seharian. */
  start_time: string | null
  end_time: string | null
  category: EventCategory
  note: string | null
  /** Ingatkan sehari sebelumnya (H-1). */
  remind_day: number
  /** Ingatkan 5 jam sebelum mulai. Hanya untuk kegiatan yang punya jam. */
  remind_hours: number
  /** Kapan terakhir dibuat atau diubah (ms). Pengingat yang waktunya sudah lewat sebelum itu tidak dimunculkan. */
  updated_at?: number
}

export interface EventInput {
  title: string
  date: string
  start_time: string | null
  end_time: string | null
  category: EventCategory
  note: string | null
  remind_day: boolean
  remind_hours: boolean
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function validateEvent(e: EventInput): void {
  if (!e.title.trim()) throw new Error('Judul kegiatan wajib diisi.')
  if (!DATE.test(e.date)) throw new Error('Tanggal tidak valid.')
  if (e.start_time && !TIME.test(e.start_time)) throw new Error('Jam mulai tidak valid.')
  if (e.end_time && !TIME.test(e.end_time)) throw new Error('Jam selesai tidak valid.')
  if (e.end_time && !e.start_time) throw new Error('Isi jam mulai dulu sebelum jam selesai.')
  if (e.start_time && e.end_time && e.end_time <= e.start_time) throw new Error('Jam selesai harus setelah jam mulai.')
  if (e.remind_hours && !e.start_time) throw new Error('Pengingat 5 jam sebelum butuh jam mulai.')
  if (!CATEGORIES.some((c) => c.id === e.category)) throw new Error('Kategori tidak dikenal.')
}

const COLS = 'id, title, date, start_time, end_time, category, note, remind_day, remind_hours, updated_at'

export async function listEvents(db: Db, from: string, to: string): Promise<EventRow[]> {
  return db.all<EventRow>(
    `SELECT ${COLS} FROM events WHERE deleted_at IS NULL AND date >= ? AND date <= ?
     ORDER BY date, start_time IS NOT NULL, start_time, title COLLATE NOCASE`,
    [from, to],
  )
}

export async function saveEvent(db: Db, e: EventInput, id?: string): Promise<string> {
  validateEvent(e)
  const vals = [
    e.title.trim(), e.date, e.start_time || null, e.end_time || null, e.category, e.note?.trim() || null,
    e.remind_day ? 1 : 0, e.start_time && e.remind_hours ? 1 : 0,
  ]
  if (id) {
    await db.run(
      `UPDATE events SET title=?, date=?, start_time=?, end_time=?, category=?, note=?, remind_day=?, remind_hours=?, updated_at=? WHERE id=?`,
      [...vals, now(), id],
    )
    return id
  }
  const nid = uid()
  await db.run(
    `INSERT INTO events (id, title, date, start_time, end_time, category, note, remind_day, remind_hours, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [nid, ...vals, now()],
  )
  return nid
}

export async function deleteEvent(db: Db, id: string): Promise<void> {
  await db.run(`UPDATE events SET deleted_at=?, updated_at=? WHERE id=?`, [now(), now(), id])
}

/* ---------- Pengingat ---------- */

export type ReminderKind = 'day' | 'hours'

export interface Reminder {
  event: EventRow
  kind: ReminderKind
  /** Kapan pengingat ini mulai berlaku (ms). */
  triggerAt: number
  /** Kapan kegiatan mulai (ms). Untuk kegiatan seharian: awal hari itu. */
  startAt: number
  key: string
}

/** Kegiatan seharian diingatkan jam 09.00 sehari sebelumnya. */
const ALL_DAY_REMIND_HOUR = 9
const HOUR = 3_600_000

function at(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm).getTime()
}

/** Pengingat yang sudah waktunya, belum pernah dikirim, dan kegiatannya belum lewat. Fungsi murni. */
export function dueReminders(events: EventRow[], nowMs: number, logged: ReadonlySet<string>): Reminder[] {
  const out: Reminder[] = []
  for (const e of events) {
    const startAt = at(e.date, e.start_time ?? '00:00')
    const endOfEvent = e.start_time ? startAt : at(addDays(e.date, 1), '00:00')
    const add = (kind: ReminderKind, triggerAt: number) => {
      const key = `${e.id}|${kind}|${e.date}|${e.start_time ?? ''}`
      // Kegiatan yang baru dibuat setelah waktu pengingatnya lewat tidak perlu mengingatkan pembuatnya sendiri.
      if (triggerAt < (e.updated_at ?? 0)) return
      if (triggerAt <= nowMs && nowMs < endOfEvent && !logged.has(key)) out.push({ event: e, kind, triggerAt, startAt, key })
    }
    if (e.remind_day) {
      add('day', e.start_time ? startAt - 24 * HOUR : at(addDays(e.date, -1), `${String(ALL_DAY_REMIND_HOUR).padStart(2, '0')}:00`))
    }
    if (e.remind_hours && e.start_time) add('hours', startAt - 5 * HOUR)
  }
  return out.sort((a, b) => a.startAt - b.startAt)
}

export function reminderText(r: Reminder, nowMs: number): { title: string; body: string } {
  const cat = categoryOf(r.event.category).label
  const when = r.event.start_time ? `jam ${r.event.start_time}` : 'seharian'
  if (r.kind === 'day') return { title: `${cat}: ${r.event.title}`, body: `Besok ${when}.` }
  const hours = Math.round((r.startAt - nowMs) / HOUR)
  const left = hours < 1 ? 'kurang dari 1 jam lagi' : `sekitar ${hours} jam lagi`
  return { title: `${cat}: ${r.event.title}`, body: `Mulai ${when}, ${left}.` }
}

/** Ambil pengingat yang jatuh tempo dan tandai sudah dikirim. Pemanggil yang menampilkannya. */
export async function collectDueReminders(db: Db, nowMs = Date.now()): Promise<Reminder[]> {
  const today = new Date(nowMs)
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const from = ymd(today)
  const to = ymd(new Date(nowMs + 2 * 24 * HOUR))
  const events = await listEvents(db, from, to)
  if (!events.length) return []
  const rows = await db.all<{ key: string }>(`SELECT key FROM reminder_log`)
  const due = dueReminders(events, nowMs, new Set(rows.map((r) => r.key)))
  for (const r of due) await db.run(`INSERT OR REPLACE INTO reminder_log (key, at) VALUES (?, ?)`, [r.key, nowMs])
  await db.run(`DELETE FROM reminder_log WHERE at < ?`, [nowMs - 14 * 24 * HOUR])
  // H-1 dan 5 jam sekaligus jatuh tempo (misalnya aplikasi baru dibuka): cukup satu pemberitahuan, yang terdekat.
  return due.filter((r) => r.kind === 'hours' || !due.some((o) => o.event.id === r.event.id && o.kind === 'hours'))
}
