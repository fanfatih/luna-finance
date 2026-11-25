import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Button, Dialog, Field, IconButton, Input, NominalInput, Segmented, Select, Textarea, useToast,
} from '@/components/ui'
import {
  listItems, listMomExpenseNames, listProjects, saveMomExpense, savePayment, saveProject, PAYMENT_KINDS,
  type MomExpense, type Payment, type ProjectRow,
} from '@/db/momentum'
import { monthLabel, todayStr } from '@/lib/date'
import { itemsTotal, MOM_CATEGORIES, remaining, STAGES } from '@/lib/momentum'
import { parseNominal, rupiah } from '@/lib/money'

/* ---------- Project ---------- */

interface Row {
  key: number
  id?: string
  name: string
  qty: string
  price: string
}

let rowKey = 0
const blankRow = (): Row => ({ key: ++rowKey, name: '', qty: '1', price: '' })

const priceOf = (raw: string): number | null => {
  const r = parseNominal(raw)
  return r.ok ? r.value : null
}
const qtyOf = (raw: string): number | null => (/^\d{1,4}$/.test(raw.trim()) && Number(raw) >= 1 ? Number(raw) : null)

/** Buat project baru atau ubah yang ada, lengkap dengan klien, acara, dan daftar paketnya. */
export function ProjectDialog({
  open, onClose, project, onSaved,
}: { open: boolean; onClose: () => void; project?: ProjectRow | null; onSaved?: (id: string) => void }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [contact, setContact] = useState('')
  const [address, setAddress] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [venue, setVenue] = useState('')
  const [deliverBy, setDeliverBy] = useState('')
  const [stage, setStage] = useState('inquiry')
  const [rows, setRows] = useState<Row[]>([blankRow()])
  const [discRaw, setDiscRaw] = useState('')
  const [discount, setDiscount] = useState(0)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setError(null)
    if (project) {
      setName(project.name); setClient(project.client_name); setContact(project.client_contact ?? '')
      setAddress(project.client_address ?? ''); setEventDate(project.event_date ?? ''); setVenue(project.venue ?? '')
      setDeliverBy(project.deliver_by ?? ''); setStage(project.stage); setNote(project.note ?? '')
      setDiscRaw(project.discount ? String(project.discount) : ''); setDiscount(project.discount)
      listItems(db, project.id).then((items) => {
        if (!alive) return
        setRows(items.length
          ? items.map((i) => ({ key: ++rowKey, id: i.id, name: i.name, qty: String(i.qty), price: String(i.unit_price) }))
          : [blankRow()])
      }).catch(() => {})
    } else {
      setName(''); setClient(''); setContact(''); setAddress(''); setEventDate(''); setVenue(''); setDeliverBy('')
      setStage('inquiry'); setNote(''); setDiscRaw(''); setDiscount(0); setRows([blankRow()])
    }
    return () => { alive = false }
  }, [open, project, db])

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  // Baris yang sama sekali kosong diabaikan. Baris yang separuh terisi harus dilengkapi.
  const filled = rows.filter((r) => r.name.trim() !== '' || r.price.trim() !== '')
  const rowsOk = filled.every((r) => r.name.trim() !== '' && qtyOf(r.qty) !== null && priceOf(r.price) !== null)
  const parsed = filled.map((r) => ({ qty: qtyOf(r.qty) ?? 0, unit_price: priceOf(r.price) ?? 0 }))
  const sum = itemsTotal(parsed)
  const discountOk = discount <= sum
  const canSave = name.trim() !== '' && client.trim() !== '' && rowsOk && discountOk && !busy

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const id = await saveProject(
        db,
        {
          name, clientName: client, clientContact: contact, clientAddress: address,
          eventDate: eventDate || null, venue, deliverBy: deliverBy || null, stage, discount, note,
          items: filled.map((r) => ({ id: r.id, name: r.name, qty: qtyOf(r.qty)!, unitPrice: priceOf(r.price)! })),
        },
        project?.id,
      )
      bump()
      toast(project ? 'Project diperbarui.' : `Project ${name.trim()} tersimpan.`)
      onClose()
      onSaved?.(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} title={project ? 'Ubah project' : 'Project baru'} width="max-w-3xl"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!canSave}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama project" htmlFor="mp-name" hint="Contoh: Pernikahan Andi dan Sari.">
            <Input id="mp-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
          </Field>
          <Field label="Tahap" htmlFor="mp-stage">
            <Select id="mp-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
        </div>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-[13px] font-semibold text-muted">Klien</legend>
          <Field label="Nama klien" htmlFor="mp-client"><Input id="mp-client" value={client} onChange={(e) => setClient(e.target.value)} autoComplete="off" /></Field>
          <Field label="Kontak (opsional)" htmlFor="mp-contact" hint="Nomor WhatsApp, supaya invoice bisa dikirim dari sini.">
            <Input id="mp-contact" value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="off" inputMode="tel" />
          </Field>
          <Field label="Alamat klien (opsional)" htmlFor="mp-address" className="sm:col-span-2">
            <Input id="mp-address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" />
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-[13px] font-semibold text-muted">Acara</legend>
          <Field label="Tanggal acara" htmlFor="mp-event"><Input id="mp-event" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></Field>
          <Field label="Serah hasil paling lambat" htmlFor="mp-deliver"><Input id="mp-deliver" type="date" value={deliverBy} onChange={(e) => setDeliverBy(e.target.value)} /></Field>
          <Field label="Lokasi (opsional)" htmlFor="mp-venue"><Input id="mp-venue" value={venue} onChange={(e) => setVenue(e.target.value)} autoComplete="off" /></Field>
          <p className="text-[13px] text-muted sm:col-span-3">Tanggal acara dan serah hasil otomatis masuk ke kalender Pribadi dengan pengingat sehari sebelumnya.</p>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-muted">Paket dan item</legend>
          <div className="flex flex-col gap-2">
            {rows.map((r, n) => {
              const price = priceOf(r.price)
              const qty = qtyOf(r.qty)
              const priceBad = r.price.trim() !== '' && price === null
              return (
                <div key={r.key} className="grid grid-cols-[1fr_4.5rem_9rem_7rem_2rem] items-start gap-2 max-sm:grid-cols-[1fr_4.5rem_2rem]">
                  <Input aria-label={`Nama item ${n + 1}`} placeholder="Nama paket atau item" value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} autoComplete="off" />
                  <Input aria-label={`Jumlah item ${n + 1}`} inputMode="numeric" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} className="num text-right" />
                  <Input
                    aria-label={`Harga satuan item ${n + 1}`} aria-invalid={priceBad} placeholder="Harga satuan" inputMode="text"
                    value={r.price} onChange={(e) => setRow(r.key, { price: e.target.value })} autoComplete="off"
                    className={'num max-sm:col-span-2 max-sm:row-start-2' + (priceBad ? ' border-danger' : '')}
                  />
                  <span className="num flex h-10 items-center justify-end text-muted max-sm:row-start-2">
                    {price !== null && qty !== null ? rupiah(price * qty) : ''}
                  </span>
                  <IconButton
                    label={`Hapus item ${n + 1}`} className="size-10"
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blankRow()]))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" onClick={() => setRows((rs) => [...rs, blankRow()])} disabled={rows.length >= 30}>
              <Plus className="size-4" aria-hidden="true" /> Tambah item
            </Button>
            <p className="text-[13px] text-muted">Harga bisa diketik 8jt atau 8.000.000.</p>
          </div>
          {!rowsOk && <p role="alert" className="mt-2 text-[13px] text-danger-text">Setiap item butuh nama, jumlah bulat, dan harga yang terbaca.</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <NominalInput
            id="mp-disc" label="Diskon (opsional)" allowEmpty value={discRaw} placeholder="Kosongkan bila tidak ada"
            onChange={(raw, v) => { setDiscRaw(raw); setDiscount(raw.trim() === '' ? 0 : v ?? 0) }}
          />
          <div className="flex flex-col justify-center gap-1 rounded-lg bg-subtle px-4 py-3">
            <span className="text-[13px] text-muted">Nilai project</span>
            <span className="num text-xl font-semibold">{rupiah(Math.max(0, sum - discount))}</span>
            {!discountOk && <span role="alert" className="text-[13px] text-danger-text">Diskon lebih besar dari total item.</span>}
          </div>
        </div>

        <Field label="Catatan (opsional)" htmlFor="mp-note"><Textarea id="mp-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

/* ---------- Pembayaran klien ---------- */

const projectLabel = (p: ProjectRow) => `${p.name} (${p.client_name})${p.stage === 'batal' ? ', batal' : ''}`

/** Catat uang masuk dari klien. Dengan projectId, project-nya sudah tetap. */
export function PaymentDialog({
  open, onClose, projectId, payment, suggestKind, suggestAmount,
}: {
  open: boolean; onClose: () => void; projectId?: string; payment?: Payment | null
  /** Usulan isian untuk pembayaran baru. */
  suggestKind?: string
  suggestAmount?: number
}) {
  const { db, bump } = useApp()
  const toast = useToast()
  const projects = useAsync(() => listProjects(db), [])
  const [pid, setPid] = useState(projectId ?? '')
  const [kind, setKind] = useState('dp')
  const [raw, setRaw] = useState('')
  const [value, setValue] = useState<number | null>(null)
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (payment) {
      setPid(payment.project_id); setKind(payment.kind); setRaw(String(payment.amount)); setValue(payment.amount)
      setDate(payment.date); setNote(payment.note ?? '')
    } else {
      setPid(projectId ?? '')
      setKind(suggestKind ?? 'dp')
      setRaw(suggestAmount && suggestAmount > 0 ? String(suggestAmount) : '')
      setValue(suggestAmount && suggestAmount > 0 ? suggestAmount : null)
      setDate(todayStr()); setNote('')
    }
  }, [open, payment, projectId, suggestKind, suggestAmount])

  const selected = (projects.data ?? []).find((p) => p.id === pid)
  const canSave = pid !== '' && value !== null && date !== '' && !busy

  const save = async () => {
    if (!canSave || value === null) return
    setBusy(true)
    setError(null)
    try {
      await savePayment(db, { projectId: pid, date, amount: value, kind, note }, payment?.id)
      bump()
      toast(payment ? 'Pembayaran diperbarui.' : `Pembayaran ${rupiah(value)} tercatat.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} title={payment ? 'Ubah pembayaran klien' : 'Catat pembayaran klien'} width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!canSave}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        {!projectId && (
          <Field label="Project" htmlFor="mpay-project">
            <Select id="mpay-project" value={pid} onChange={(e) => setPid(e.target.value)}>
              <option value="">Pilih project</option>
              {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
            </Select>
          </Field>
        )}
        {selected && (
          <p className="rounded-lg bg-subtle px-3 py-2 text-[13px] text-muted">
            Nilai project {rupiah(selected.total)}, sudah dibayar {rupiah(selected.paid)}, sisa {rupiah(remaining(selected.total, selected.paid))}.
          </p>
        )}
        <Field label="Jenis" htmlFor="mpay-kind">
          <Select id="mpay-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {PAYMENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </Select>
        </Field>
        <NominalInput id="mpay-amount" label="Nominal" value={raw} onChange={(r, v) => { setRaw(r); setValue(v) }} />
        <Field label="Tanggal diterima" htmlFor="mpay-date"><Input id="mpay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Catatan (opsional)" htmlFor="mpay-note"><Input id="mpay-note" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" /></Field>
        {payment?.invoice_id && <p className="text-[13px] text-muted">Pembayaran ini berasal dari invoice yang ditandai lunas. Mengubahnya tidak mengubah invoice.</p>}
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

/* ---------- Biaya ---------- */

/** Catat biaya. Biaya project selalu dihitung penuh di bulan dibayar, biaya umum boleh dibagi 12 bulan. */
export function MomExpenseDialog({
  open, onClose, projectId, expense,
}: { open: boolean; onClose: () => void; projectId?: string; expense?: MomExpense | null }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const projects = useAsync(() => listProjects(db), [])
  const names = useAsync(() => listMomExpenseNames(db), [])
  const [name, setName] = useState('')
  const [category, setCategory] = useState('lain')
  const [raw, setRaw] = useState('')
  const [value, setValue] = useState<number | null>(null)
  const [date, setDate] = useState('')
  const [pid, setPid] = useState(projectId ?? '')
  const [spread, setSpread] = useState<'1' | '12'>('1')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (expense) {
      setName(expense.name); setCategory(expense.category); setRaw(String(expense.amount)); setValue(expense.amount)
      setDate(expense.date); setPid(expense.project_id ?? ''); setSpread(expense.spread_months === 12 ? '12' : '1'); setNote(expense.note ?? '')
    } else {
      setName(''); setCategory(projectId ? 'honor' : 'lain'); setRaw(''); setValue(null); setPid(projectId ?? '')
      setSpread('1'); setNote(''); setDate(todayStr())
    }
  }, [open, expense, projectId])

  const list = useMemo(() => projects.data ?? [], [projects.data])
  const canSave = name.trim() !== '' && value !== null && date !== '' && !busy

  const save = async () => {
    if (!canSave || value === null) return
    setBusy(true)
    setError(null)
    try {
      await saveMomExpense(
        db,
        { date, name, category, amount: value, projectId: pid || null, spreadMonths: pid ? 1 : Number(spread), note },
        expense?.id,
      )
      bump()
      toast(expense ? 'Biaya diperbarui.' : `Biaya ${name.trim()} ${rupiah(value)} tersimpan.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} title={expense ? 'Ubah biaya' : 'Catat biaya'} width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!canSave}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Nama biaya" htmlFor="mx-name" hint="Contoh: Honor videografer, Sewa lensa, Langganan editing.">
          <Input id="mx-name" list="mx-names" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
          <datalist id="mx-names">{(names.data ?? []).map((n) => <option key={n} value={n} />)}</datalist>
        </Field>
        <Field label="Kategori" htmlFor="mx-cat">
          <Select id="mx-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {MOM_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
        <NominalInput id="mx-amount" label="Nominal" value={raw} onChange={(r, v) => { setRaw(r); setValue(v) }} />
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <Field label="Tanggal dibayar" htmlFor="mx-date"><Input id="mx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {!projectId && (
            <Field label="Untuk project" htmlFor="mx-project">
              <Select id="mx-project" value={pid} onChange={(e) => setPid(e.target.value)}>
                <option value="">Biaya umum</option>
                {list.map((p) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
              </Select>
            </Field>
          )}
        </div>
        {pid === '' ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Dihitung di laporan</span>
            <Segmented
              label="Pembagian biaya" value={spread} onChange={setSpread}
              options={[{ value: '1', label: 'Bulan ini saja' }, { value: '12', label: 'Dibagi 12 bulan' }]}
            />
            <p className="text-[13px] text-muted">
              {spread === '12'
                ? value !== null && date
                  ? `Cocok untuk biaya tahunan: ${rupiah(Math.round(value / 12))} per bulan, mulai ${monthLabel(date.slice(0, 7))}.`
                  : 'Biaya tahunan dibagi rata, mulai bulan dibayar.'
                : 'Seluruh nominal dihitung di bulan dibayar.'}
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            Biaya project dihitung penuh di bulan dibayar{date ? ` (${monthLabel(date.slice(0, 7))})` : ''} dan mengurangi margin project ini.
          </p>
        )}
        <Field label="Catatan (opsional)" htmlFor="mx-note"><Input id="mx-note" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" /></Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}
