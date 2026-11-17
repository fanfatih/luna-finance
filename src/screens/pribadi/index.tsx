import { useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, IconButton, Input, Loading, Textarea, useToast,
} from '@/components/ui'
import {
  CATEGORIES, categoryOf, deleteEvent, listEvents, saveEvent, type EventCategory, type EventRow,
} from '@/db/events'
import { addDays, formatDateLong, toDateStr, todayStr } from '@/lib/date'
import { cn } from '@/lib/cn'

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

/** Warna kategori dipakai sebagai penanda data, jadi teksnya tetap warna biasa agar terbaca. */
const tint = (color: string) => ({ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` })

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
}

function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const weeks = Math.ceil((offset + days) / 7)
  const start = addDays(toDateStr(first), -offset)
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
}

const timeLabel = (e: EventRow) =>
  !e.start_time ? 'Seharian' : e.end_time ? `${e.start_time} - ${e.end_time}` : e.start_time

export function Pribadi() {
  const { db, bump } = useApp()
  const toast = useToast()
  const today = todayStr()
  const [ym, setYm] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() }))
  const [selected, setSelected] = useState(today)
  const [hidden, setHidden] = useState<ReadonlySet<EventCategory>>(new Set())
  const [edit, setEdit] = useState<{ e?: EventRow; date: string } | null>(null)
  const [del, setDel] = useState<EventRow | null>(null)

  const cells = useMemo(() => monthGrid(ym.y, ym.m), [ym])
  const data = useAsync(() => listEvents(db, cells[0], cells[cells.length - 1]), [cells])

  // Ganti bulan: tanggal terpilih ikut pindah ke bulan itu supaya panel kanan tidak kosong makna.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    const prefix = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}`
    if (!selected.startsWith(prefix)) {
      const t = todayStr()
      setSelected(t.startsWith(prefix) ? t : `${prefix}-01`)
    }
    // hanya saat bulan berganti
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym])

  const events = (data.data ?? []).filter((e) => !hidden.has(e.category))
  const byDate = useMemo(() => {
    const m = new Map<string, EventRow[]>()
    for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data, hidden])
  const dayEvents = byDate.get(selected) ?? []

  const move = (n: number) => setYm(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  const toggle = (c: EventCategory) =>
    setHidden((h) => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n })

  if (data.error) return <div className="p-6"><ErrorState message={data.error} onRetry={data.reload} /></div>

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Kalender</h1>
            <p className="mt-1 text-muted">Kegiatan pribadi, kuliah, dan bisnis. Pengingat muncul di komputer.</p>
          </div>
          <Button variant="primary" onClick={() => setEdit({ date: selected })}>
            <Plus className="size-4" aria-hidden="true" /> Tambah kegiatan
          </Button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1">
            <IconButton label="Bulan sebelumnya" onClick={() => move(-1)}><ChevronLeft className="size-5" aria-hidden="true" /></IconButton>
            <h2 className="min-w-40 text-center text-lg font-semibold" aria-live="polite">{MONTHS[ym.m]} {ym.y}</h2>
            <IconButton label="Bulan berikutnya" onClick={() => move(1)}><ChevronRight className="size-5" aria-hidden="true" /></IconButton>
            <Button
              size="sm" className="ml-2"
              onClick={() => { setYm({ y: new Date().getFullYear(), m: new Date().getMonth() }); setSelected(today) }}
            >
              Hari ini
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tampilkan kategori">
            {CATEGORIES.map((c) => {
              const on = !hidden.has(c.id)
              return (
                <button
                  key={c.id} type="button" aria-pressed={on} onClick={() => toggle(c.id)}
                  className={cn(
                    'inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium transition-colors duration-150',
                    on ? 'border-line-strong bg-bg text-fg' : 'border-line bg-surface text-muted line-through',
                  )}
                >
                  <Dot color={c.color} />{c.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-label={`Kalender ${MONTHS[ym.m]} ${ym.y}`}>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line">
              {WEEKDAYS.map((d) => (
                <div key={d} className="bg-surface px-2 py-1.5 text-center text-[12px] font-medium text-muted">{d}</div>
              ))}
              {cells.map((d) => {
                const inMonth = Number(d.slice(5, 7)) - 1 === ym.m
                const list = byDate.get(d) ?? []
                const isSel = d === selected
                const isToday = d === today
                return (
                  <button
                    key={d} type="button"
                    onClick={() => setSelected(d)}
                    onDoubleClick={() => setEdit({ date: d })}
                    aria-pressed={isSel}
                    aria-label={`${formatDateLong(d)}, ${list.length ? `${list.length} kegiatan` : 'tidak ada kegiatan'}`}
                    className={cn(
                      'flex min-h-24 flex-col gap-1 p-1.5 text-left transition-colors duration-150 focus-visible:z-10',
                      inMonth ? 'bg-bg hover:bg-subtle' : 'bg-surface text-muted hover:bg-subtle',
                      isSel && 'z-[1] outline-2 -outline-offset-2 outline-accent-text',
                    )}
                  >
                    <span
                      className={cn(
                        'num flex size-6 items-center justify-center rounded-full text-[13px] font-medium',
                        isToday && 'bg-accent text-white',
                      )}
                    >
                      {Number(d.slice(8))}
                    </span>
                    {list.slice(0, 3).map((e) => (
                      <span
                        key={e.id} style={tint(categoryOf(e.category).color)}
                        className="flex items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-[12px] leading-tight text-fg"
                      >
                        <Dot color={categoryOf(e.category).color} />
                        <span className="truncate">{e.start_time ? `${e.start_time} ` : ''}{e.title}</span>
                      </span>
                    ))}
                    {list.length > 3 && <span className="px-1 text-[12px] text-muted">+{list.length - 3} lagi</span>}
                  </button>
                )
              })}
            </div>
            {data.loading && !data.data && <Loading />}
          </section>

          <aside aria-label="Kegiatan hari terpilih" className="h-fit rounded-xl border border-line bg-bg p-4 shadow-card">
            <h3 className="text-[15px] font-semibold">{formatDateLong(selected)}</h3>
            {dayEvents.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="Belum ada kegiatan" body="Klik tombol di bawah, atau klik dua kali tanggal di kalender."
                  action={<Button onClick={() => setEdit({ date: selected })}>Tambah kegiatan</Button>}
                />
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {dayEvents.map((e) => {
                  const cat = categoryOf(e.category)
                  return (
                    <li key={e.id} className="rounded-lg border border-line p-3" style={tint(cat.color)}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium break-words">{e.title}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                            <span className="inline-flex items-center gap-1.5"><Dot color={cat.color} />{cat.label}</span>
                            <span className="num">{timeLabel(e)}</span>
                            {(e.remind_day === 1 || e.remind_hours === 1) && (
                              <span className="inline-flex items-center gap-1">
                                <BellRing className="size-3.5" aria-label="Pengingat aktif" />
                                {[e.remind_day === 1 && 'H-1', e.remind_hours === 1 && '5 jam'].filter(Boolean).join(', ')}
                              </span>
                            )}
                          </p>
                          {e.note && <p className="mt-1.5 text-[13px] break-words whitespace-pre-wrap">{e.note}</p>}
                        </div>
                        <div className="flex shrink-0">
                          <IconButton label={`Ubah ${e.title}`} className="size-8" onClick={() => setEdit({ e, date: e.date })}><Pencil className="size-4" aria-hidden="true" /></IconButton>
                          <IconButton label={`Hapus ${e.title}`} className="size-8" onClick={() => setDel(e)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {dayEvents.length > 0 && (
              <Button className="mt-3 w-full" onClick={() => setEdit({ date: selected })}><Plus className="size-4" aria-hidden="true" /> Tambah kegiatan</Button>
            )}
          </aside>
        </div>

        <p className="mt-4 text-[13px] text-muted">
          Pengingat berjalan selama aplikasi menyala (termasuk saat disembunyikan ke tray). Kalau komputer mati saat waktunya, pengingat yang terlewat muncul begitu aplikasi dibuka lagi.
        </p>
      </div>

      {edit && (
        <EventDialog
          edit={edit.e} date={edit.date} onClose={() => setEdit(null)}
          onSaved={(date) => { bump(); setSelected(date); const [y, m] = date.split('-').map(Number); setYm({ y, m: m - 1 }); toast('Kegiatan tersimpan.') }}
        />
      )}
      <ConfirmDialog
        open={!!del} onClose={() => setDel(null)} danger confirmLabel="Hapus kegiatan"
        title={`Hapus ${del?.title ?? ''}?`} body="Kegiatan dan pengingatnya dihapus."
        onConfirm={async () => { if (del) { await deleteEvent(db, del.id); setDel(null); bump(); toast('Kegiatan dihapus.') } }}
      />
    </div>
  )
}

function EventDialog({
  edit, date, onClose, onSaved,
}: { edit?: EventRow; date: string; onClose: () => void; onSaved: (date: string) => void }) {
  const { db } = useApp()
  const [title, setTitle] = useState(edit?.title ?? '')
  const [d, setD] = useState(edit?.date ?? date)
  const [allDay, setAllDay] = useState(edit ? !edit.start_time : false)
  const [start, setStart] = useState(edit?.start_time ?? '09:00')
  const [end, setEnd] = useState(edit?.end_time ?? '')
  const [category, setCategory] = useState<EventCategory>(edit?.category ?? 'pribadi')
  const [note, setNote] = useState(edit?.note ?? '')
  const [remDay, setRemDay] = useState(edit ? edit.remind_day === 1 : true)
  const [remHours, setRemHours] = useState(edit ? edit.remind_hours === 1 : true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await saveEvent(db, {
        title, date: d, category, note: note || null,
        start_time: allDay ? null : start || null,
        end_time: allDay ? null : end || null,
        remind_day: remDay,
        remind_hours: !allDay && remHours,
      }, edit?.id)
      onSaved(d)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open onClose={onClose} title={edit ? 'Ubah kegiatan' : 'Tambah kegiatan'} width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!title.trim() || !d}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Kegiatan" htmlFor="e-title"><Input id="e-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Kategori</legend>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <label
                key={c.id}
                className={cn(
                  'inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-text',
                  category === c.id ? 'border-fg bg-subtle' : 'border-line hover:bg-subtle',
                )}
              >
                <input type="radio" name="e-cat" className="sr-only" checked={category === c.id} onChange={() => setCategory(c.id)} />
                <Dot color={c.color} />{c.label}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Tanggal" htmlFor="e-date"><Input id="e-date" type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>

        <label className="flex items-center gap-3">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span className="font-medium">Seharian (tanpa jam)</span>
        </label>
        {!allDay && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mulai" htmlFor="e-start"><Input id="e-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Selesai (opsional)" htmlFor="e-end"><Input id="e-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">Pengingat</legend>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={remDay} onChange={(e) => setRemDay(e.target.checked)} />
            <span>
              <span className="block font-medium">H-1</span>
              <span className="text-[13px] text-muted">{allDay ? 'Sehari sebelumnya jam 09.00.' : 'Tepat 24 jam sebelum mulai.'}</span>
            </span>
          </label>
          <label className={cn('flex items-start gap-3', allDay && 'opacity-60')}>
            <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={!allDay && remHours} disabled={allDay} onChange={(e) => setRemHours(e.target.checked)} />
            <span>
              <span className="block font-medium">5 jam sebelumnya</span>
              <span className="text-[13px] text-muted">{allDay ? 'Butuh jam mulai.' : 'Muncul 5 jam sebelum jam mulai.'}</span>
            </span>
          </label>
        </fieldset>

        <Field label="Catatan (opsional)" htmlFor="e-note"><Textarea id="e-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}
