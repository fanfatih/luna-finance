import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, ImagePlus, MessageCircle, Pencil, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Badge, Button, ConfirmDialog, Dialog, ErrorState, Field, Input, Loading, NominalInput, Select, Textarea, useToast,
} from '@/components/ui'
import {
  createInvoice, deleteInvoice, getInvoice, getProjectRow, listProjects, loadIdentity, saveIdentity, setInvoiceStatus,
  updateInvoice, type Invoice,
} from '@/db/momentum'
import { copyText } from '@/lib/clipboard'
import { formatDate, todayStr } from '@/lib/date'
import { prepareLogo } from '@/lib/image'
import { buildInvoicePdf } from '@/lib/invoicePdf'
import {
  INVOICE_KINDS, invoiceKindLabel, invoiceMessage, invoiceState, parseSnapshot, remaining, remainingAfter, safeFileName,
  suggestDueDate, suggestInvoiceAmount, DEFAULT_IDENTITY, type InvoiceIdentity, type InvoiceKind,
} from '@/lib/momentum'
import { rupiah } from '@/lib/money'
import { saveBinaryFile } from '@/lib/platform'
import { errText } from '@/lib/reminders'
import { openWhatsApp, waNumber } from '@/lib/whatsapp'

/* ---------- Buat atau ubah invoice ---------- */

/** Buat invoice baru untuk satu project, atau ubah invoice yang masih draft. */
export function InvoiceFormDialog({
  open, onClose, projectId, invoice, onSaved,
}: { open: boolean; onClose: () => void; projectId?: string; invoice?: Invoice | null; onSaved?: (id: string) => void }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const projects = useAsync(() => listProjects(db), [])
  const identity = useAsync(() => loadIdentity(db), [open])
  const [pid, setPid] = useState(projectId ?? '')
  const project = useAsync(() => (pid ? getProjectRow(db, pid) : Promise.resolve(null)), [pid])
  const [kind, setKind] = useState<InvoiceKind>('dp')
  const [raw, setRaw] = useState('')
  const [value, setValue] = useState<number | null>(null)
  const [amountTouched, setAmountTouched] = useState(false)
  const [issue, setIssue] = useState(todayStr())
  const [due, setDue] = useState('')
  const [dueTouched, setDueTouched] = useState(false)
  const [note, setNote] = useState('')
  const [refresh, setRefresh] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Isian awal setiap kali dialog dibuka.
  useEffect(() => {
    if (!open) return
    setError(null)
    setRefresh(false)
    if (invoice) {
      setPid(invoice.project_id); setKind(invoice.kind); setRaw(String(invoice.amount)); setValue(invoice.amount)
      setAmountTouched(true); setIssue(invoice.issue_date); setDue(invoice.due_date); setDueTouched(true); setNote(invoice.note ?? '')
    } else {
      setPid(projectId ?? ''); setKind('dp'); setRaw(''); setValue(null); setAmountTouched(false)
      setIssue(todayStr()); setDue(''); setDueTouched(false); setNote('')
    }
  }, [open, invoice, projectId])

  const p = project.data
  const ident = identity.data

  // Usulan jumlah dan jatuh tempo, selama belum diubah sendiri.
  useEffect(() => {
    if (!open || amountTouched || !p || !ident) return
    const s = suggestInvoiceAmount(kind, p.total, p.paid, ident.dpPercent)
    setRaw(s > 0 ? String(s) : '')
    setValue(s > 0 ? s : null)
  }, [open, amountTouched, p, ident, kind])

  useEffect(() => {
    if (!open || dueTouched || !issue) return
    setDue(suggestDueDate(kind, issue, p?.event_date ?? null))
  }, [open, dueTouched, kind, issue, p?.event_date])

  const list = useMemo(() => (projects.data ?? []).filter((x) => x.stage !== 'batal' && x.total > 0), [projects.data])
  const owed = p ? remaining(p.total, p.paid) : 0
  const canSave = pid !== '' && value !== null && issue !== '' && due !== '' && !busy

  const hint = !p || !ident ? null
    : kind === 'dp' ? `${ident.dpPercent}% dari nilai project ${rupiah(p.total)}.`
    : kind === 'pelunasan' ? `Sisa tagihan setelah pembayaran yang sudah masuk (${rupiah(p.paid)}).`
    : kind === 'penuh' ? `Seluruh nilai project ${rupiah(p.total)}.`
    : 'Isi jumlah termin sendiri.'

  const save = async () => {
    if (!canSave || value === null) return
    setBusy(true)
    setError(null)
    try {
      const input = { kind, amount: value, issueDate: issue, dueDate: due, note }
      let id: string
      if (invoice) {
        await updateInvoice(db, invoice.id, input, refresh)
        id = invoice.id
      } else {
        id = await createInvoice(db, pid, input)
      }
      bump()
      toast(invoice ? 'Invoice diperbarui.' : 'Invoice dibuat sebagai draft.')
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
      open={open} onClose={onClose} title={invoice ? `Ubah ${invoice.number}` : 'Invoice baru'} width="max-w-lg"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!canSave}>{invoice ? 'Simpan' : 'Buat invoice'}</Button></>}
    >
      <div className="flex flex-col gap-4">
        {!projectId && !invoice && (
          <Field label="Project" htmlFor="iv-project" hint={list.length === 0 ? 'Belum ada project yang punya item. Isi paketnya dulu di tab Project.' : undefined}>
            <Select id="iv-project" value={pid} onChange={(e) => { setPid(e.target.value); setAmountTouched(false) }}>
              <option value="">Pilih project</option>
              {list.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.client_name})</option>)}
            </Select>
          </Field>
        )}
        {p && (
          <p className="rounded-lg bg-subtle px-3 py-2 text-[13px] text-muted">
            {p.name} untuk {p.client_name}. Nilai {rupiah(p.total)}, sudah dibayar {rupiah(p.paid)}, sisa {rupiah(owed)}.
          </p>
        )}
        <Field label="Jenis invoice" htmlFor="iv-kind">
          <Select id="iv-kind" value={kind} onChange={(e) => { setKind(e.target.value as InvoiceKind); if (!invoice) setAmountTouched(false) }}>
            {INVOICE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </Select>
        </Field>
        <div className="flex flex-col gap-1.5">
          <NominalInput id="iv-amount" label="Jumlah ditagih" value={raw} onChange={(r, v) => { setRaw(r); setValue(v); setAmountTouched(true) }} />
          {hint && <p className="text-[13px] text-muted">{hint}</p>}
          {p && value !== null && value > owed && kind !== 'penuh' && (
            <p className="text-[13px] text-warn-text">Jumlah ini lebih besar dari sisa tagihan project ({rupiah(owed)}).</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <Field label="Tanggal terbit" htmlFor="iv-issue"><Input id="iv-issue" type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /></Field>
          <Field label="Jatuh tempo" htmlFor="iv-due"><Input id="iv-due" type="date" value={due} onChange={(e) => { setDue(e.target.value); setDueTouched(true) }} /></Field>
        </div>
        <Field label="Catatan di invoice (opsional)" htmlFor="iv-note"><Textarea id="iv-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {invoice && (
          <label className="flex items-start gap-2.5 text-[13px]">
            <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} className="mt-0.5 size-4" />
            <span>Ambil ulang item, diskon, dan pembayaran dari project. Invoice menyimpan salinan data saat dibuat, jadi centang ini bila project berubah setelahnya.</span>
          </label>
        )}
        {ident && !ident.accountNo.trim() && (
          <p className="text-[13px] text-muted">Rekening pembayaran belum diisi. Isi di Identitas invoice supaya tampil di PDF dan pesan WhatsApp.</p>
        )}
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

/* ---------- Rincian dan tindakan satu invoice ---------- */

export function InvoiceDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const today = todayStr()
  const data = useAsync(async () => ({ inv: await getInvoice(db, id), identity: await loadIdentity(db) }), [id])
  const [busy, setBusy] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [waOpen, setWaOpen] = useState(false)
  const [paidOpen, setPaidOpen] = useState(false)
  const [confirm, setConfirm] = useState<'batal' | 'draft' | 'buka' | 'hapus' | null>(null)

  if (data.loading && !data.data) {
    return <Dialog open onClose={onClose} title="Invoice" width="max-w-2xl"><Loading /></Dialog>
  }
  if (data.error || !data.data) {
    return <Dialog open onClose={onClose} title="Invoice" width="max-w-2xl"><ErrorState message={data.error ?? 'Invoice tidak ditemukan.'} onRetry={data.reload} /></Dialog>
  }
  const { inv, identity } = data.data
  const snap = parseSnapshot(inv.snapshot)
  const st = invoiceState(inv.status, inv.due_date, today)

  const change = async (next: string, doneText: string, paidDate?: string) => {
    setBusy(next)
    try {
      await setInvoiceStatus(db, inv.id, next, paidDate)
      bump()
      toast(doneText)
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const pdf = async () => {
    if (!snap) return
    setBusy('pdf')
    try {
      const bytes = await buildInvoicePdf({
        identity, number: inv.number, kind: inv.kind, status: inv.status, issueDate: inv.issue_date, dueDate: inv.due_date,
        amount: inv.amount, note: inv.note, snapshot: snap,
      })
      const ok = await saveBinaryFile(`${safeFileName(`${inv.number} ${snap.clientName}`)}.pdf`, bytes, 'application/pdf')
      if (ok) toast('PDF invoice disimpan.')
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Dialog
        open onClose={onClose} title="Invoice klien" width="max-w-2xl"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            {inv.status === 'draft' && (
              <>
                <Button variant="danger" onClick={() => setConfirm('hapus')}><Trash2 className="size-4" aria-hidden="true" /> Hapus</Button>
                <Button onClick={() => setEditOpen(true)}><Pencil className="size-4" aria-hidden="true" /> Ubah</Button>
              </>
            )}
            {inv.status === 'batal' && <Button variant="danger" onClick={() => setConfirm('hapus')}><Trash2 className="size-4" aria-hidden="true" /> Hapus</Button>}
            <Button onClick={pdf} loading={busy === 'pdf'} disabled={!snap}><Download className="size-4" aria-hidden="true" /> Unduh PDF</Button>
            <Button onClick={() => setWaOpen(true)} disabled={!snap}><MessageCircle className="size-4" aria-hidden="true" /> Pesan WhatsApp</Button>
            {inv.status === 'draft' && (
              <>
                <Button onClick={() => setConfirm('batal')}>Batalkan</Button>
                <Button variant="primary" loading={busy === 'terkirim'} onClick={() => change('terkirim', 'Invoice ditandai terkirim. Pengingat jatuh tempo aktif.')}>Tandai terkirim</Button>
              </>
            )}
            {inv.status === 'terkirim' && (
              <>
                <Button onClick={() => setConfirm('draft')}>Kembali ke draft</Button>
                <Button onClick={() => setConfirm('batal')}>Batalkan</Button>
                <Button variant="primary" onClick={() => setPaidOpen(true)}>Tandai lunas</Button>
              </>
            )}
            {inv.status === 'lunas' && <Button onClick={() => setConfirm('buka')}>Batalkan pelunasan</Button>}
            {inv.status === 'batal' && <Button variant="primary" loading={busy === 'draft'} onClick={() => change('draft', 'Invoice dikembalikan jadi draft.')}>Jadikan draft</Button>}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="num text-lg font-semibold">{inv.number}</p>
              <p className="text-muted">{inv.project_name}. {inv.client_name}</p>
            </div>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg bg-subtle p-4 sm:grid-cols-4">
            <div><dt className="text-[13px] text-muted">Jumlah ditagih</dt><dd className="num text-lg font-semibold">{rupiah(inv.amount)}</dd></div>
            <div><dt className="text-[13px] text-muted">Jenis</dt><dd className="font-medium">{invoiceKindLabel(inv.kind)}</dd></div>
            <div><dt className="text-[13px] text-muted">Terbit</dt><dd className="font-medium">{formatDate(inv.issue_date)}</dd></div>
            <div><dt className="text-[13px] text-muted">Jatuh tempo</dt><dd className="font-medium">{formatDate(inv.due_date)}</dd></div>
          </dl>

          {snap ? (
            <>
              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-muted">Isi invoice saat dibuat</h3>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {snap.items.map((i, n) => (
                    <li key={n} className="flex items-baseline justify-between gap-4 px-3 py-2">
                      <span className="min-w-0">{i.name}{i.qty > 1 ? <span className="text-muted"> x{i.qty}</span> : null}</span>
                      <span className="num shrink-0">{rupiah(i.qty * i.unitPrice)}</span>
                    </li>
                  ))}
                  {snap.discount > 0 && (
                    <li className="flex items-baseline justify-between gap-4 px-3 py-2 text-muted"><span>Diskon</span><span className="num">-{rupiah(snap.discount)}</span></li>
                  )}
                  <li className="flex items-baseline justify-between gap-4 px-3 py-2 font-semibold"><span>Nilai project</span><span className="num">{rupiah(snap.total)}</span></li>
                </ul>
                <p className="mt-2 text-[13px] text-muted">
                  Dibayar sebelumnya {rupiah(snap.paidBefore)}. Sisa setelah invoice ini {rupiah(remainingAfter(snap, inv.amount))}.
                </p>
              </div>
              {inv.note && <p className="rounded-lg bg-subtle px-3 py-2 text-muted">{inv.note}</p>}
              {!identity.accountNo.trim() && (
                <p className="text-[13px] text-warn-text">Rekening pembayaran belum diisi, jadi tidak tampil di PDF dan pesan WhatsApp. Isi di Identitas invoice.</p>
              )}
            </>
          ) : (
            <p role="alert" className="text-danger-text">Data invoice ini tidak terbaca, jadi PDF tidak bisa dibuat. Hapus lalu buat ulang.</p>
          )}
        </div>
      </Dialog>

      <InvoiceFormDialog open={editOpen} onClose={() => setEditOpen(false)} invoice={inv} />
      {waOpen && snap && <InvoiceWaDialog inv={inv} snapshot={snap} identity={identity} onClose={() => setWaOpen(false)} />}
      <PaidDialog
        open={paidOpen} onClose={() => setPaidOpen(false)} inv={inv}
        onConfirm={async (date) => { setPaidOpen(false); await change('lunas', `Invoice lunas. Pembayaran ${rupiah(inv.amount)} tercatat di project.`, date) }}
      />
      <ConfirmDialog
        open={confirm === 'batal'} onClose={() => setConfirm(null)} danger confirmLabel="Batalkan invoice"
        title="Batalkan invoice ini?"
        body={`${inv.number} ditandai dibatalkan dan pengingatnya mati. Nomornya tidak dipakai lagi. Invoice yang dibatalkan masih bisa dijadikan draft atau dihapus.`}
        onConfirm={async () => { setConfirm(null); await change('batal', 'Invoice dibatalkan.') }}
      />
      <ConfirmDialog
        open={confirm === 'draft'} onClose={() => setConfirm(null)} confirmLabel="Kembali ke draft"
        title="Kembalikan ke draft?"
        body="Invoice bisa diubah lagi, dan pengingat jatuh tempo berhenti sampai ditandai terkirim kembali."
        onConfirm={async () => { setConfirm(null); await change('draft', 'Invoice kembali jadi draft.') }}
      />
      <ConfirmDialog
        open={confirm === 'buka'} onClose={() => setConfirm(null)} danger confirmLabel="Batalkan pelunasan"
        title="Batalkan pelunasan?"
        body={`Pembayaran ${rupiah(inv.amount)} yang tercatat dari invoice ini dihapus dari project, dan invoice kembali jadi Terkirim.`}
        onConfirm={async () => { setConfirm(null); await change('terkirim', 'Pelunasan dibatalkan. Pembayarannya dihapus dari project.') }}
      />
      <ConfirmDialog
        open={confirm === 'hapus'} onClose={() => setConfirm(null)} danger confirmLabel="Hapus invoice"
        title="Hapus invoice ini?"
        body={`${inv.number} dihapus permanen dari daftar. Nomor invoice tidak dipakai ulang.`}
        onConfirm={async () => {
          setConfirm(null)
          try {
            await deleteInvoice(db, inv.id)
            bump()
            toast('Invoice dihapus.')
            onClose()
          } catch (e) {
            toast(errText(e), 'error')
          }
        }}
      />
    </>
  )
}

/** Tanggal uang diterima saat invoice ditandai lunas. */
function PaidDialog({
  open, onClose, inv, onConfirm,
}: { open: boolean; onClose: () => void; inv: Invoice; onConfirm: (date: string) => void | Promise<void> }) {
  const [date, setDate] = useState(todayStr())
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setDate(todayStr()) }, [open])
  return (
    <Dialog
      open={open} onClose={onClose} title="Tandai invoice lunas" width="max-w-sm"
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button
            variant="primary" loading={busy} disabled={!date}
            onClick={async () => { setBusy(true); try { await onConfirm(date) } finally { setBusy(false) } }}
          >
            Tandai lunas
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p>Pembayaran <span className="num font-semibold">{rupiah(inv.amount)}</span> dari {inv.client_name} otomatis dicatat di project dan masuk ke uang masuk bulan itu.</p>
        <Field label="Tanggal uang diterima" htmlFor="paid-date"><Input id="paid-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayStr()} /></Field>
      </div>
    </Dialog>
  )
}

/** Teks WhatsApp untuk mengirim invoice. PDF dilampirkan sendiri di WhatsApp. */
function InvoiceWaDialog({
  inv, snapshot, identity, onClose,
}: { inv: Invoice; snapshot: NonNullable<ReturnType<typeof parseSnapshot>>; identity: InvoiceIdentity; onClose: () => void }) {
  const toast = useToast()
  const number = waNumber(snapshot.clientContact)
  const base = useMemo(
    () => invoiceMessage({ identity, snapshot, kind: inv.kind, number: inv.number, amount: inv.amount, dueDate: inv.due_date }),
    [identity, snapshot, inv],
  )
  const [override, setOverride] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const text = override ?? base

  const copy = async () => {
    toast((await copyText(text)) ? 'Pesan disalin. Tinggal tempel di WhatsApp.' : 'Gagal menyalin. Blok teksnya lalu salin manual.')
  }
  const send = async () => {
    if (!number) return
    setBusy(true)
    setError(null)
    try {
      await copyText(text)
      const { withText } = await openWhatsApp(number, text)
      toast(withText ? 'WhatsApp dibuka dengan pesan terisi. Lampirkan PDF-nya sebelum kirim.' : 'Pesan terlalu panjang untuk dibawa lewat link. Chat dibuka, pesan sudah disalin, tinggal tempel.')
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open onClose={onClose} title={`Pesan untuk ${snapshot.clientName}`} width="max-w-xl"
      footer={
        <>
          <Button onClick={onClose}>Tutup</Button>
          <Button onClick={send} loading={busy} disabled={!number} title={number ? undefined : 'Kontak klien belum berupa nomor WhatsApp'}>
            <MessageCircle className="size-4" aria-hidden="true" /> Buka WhatsApp
          </Button>
          <Button variant="primary" onClick={copy}><Copy className="size-4" aria-hidden="true" /> Salin pesan</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="iw-text" className="mb-1.5 block text-[13px] font-medium">Pesan</label>
          <Textarea id="iw-text" rows={12} className="font-sans text-[14px] leading-relaxed" value={text} onChange={(e) => setOverride(e.target.value)} />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            {override !== null && <button type="button" onClick={() => setOverride(null)} className="underline underline-offset-2 hover:text-fg">Susun ulang dari data</button>}
            {!number && <span>Tombol WhatsApp aktif kalau kontak klien berupa nomor.</span>}
            <span>Unduh PDF-nya dulu, lalu lampirkan di chat. Setelah terkirim, tandai invoice terkirim.</span>
          </div>
        </div>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

/* ---------- Identitas invoice ---------- */

/** Nama usaha, alamat, rekening, logo, awalan nomor, dan persentase DP yang dipakai semua invoice. */
export function IdentityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState(DEFAULT_IDENTITY)
  const [dp, setDp] = useState('30')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setError(null)
    loadIdentity(db).then((i) => {
      if (!alive) return
      setF(i)
      setDp(String(i.dpPercent))
    }).catch((e) => alive && setError(errText(e)))
    return () => { alive = false }
  }, [open, db])

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const r = await prepareLogo(file)
      setF((x) => ({ ...x, logo: r.dataUrl, logoW: r.w, logoH: r.h }))
    } catch (e) {
      setError(errText(e))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const save = async () => {
    const pct = Number(dp)
    setBusy(true)
    setError(null)
    try {
      await saveIdentity(db, { ...f, dpPercent: Number.isFinite(pct) ? Math.round(pct) : 0 })
      bump()
      toast('Identitas invoice tersimpan.')
      onClose()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} title="Identitas invoice" width="max-w-2xl"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-5">
        <p className="text-muted">Dipakai di semua invoice dan pesan WhatsApp. Disimpan di perangkat ini dan ikut ke berkas cadangan, tapi tidak ikut sinkronisasi, jadi di komputer lain perlu diisi sekali lagi.</p>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13px] font-semibold text-muted">Logo</legend>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-20 w-48 items-center justify-center rounded-lg border border-dashed border-line-strong bg-subtle p-2">
              {f.logo
                ? <img src={f.logo} alt="Logo invoice" className="max-h-full max-w-full object-contain" />
                : <span className="text-center text-[13px] text-muted">Belum ada logo. Invoice memakai nama usaha.</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Pilih file logo" onChange={(e) => pick(e.target.files?.[0])} />
              <Button onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" aria-hidden="true" /> {f.logo ? 'Ganti logo' : 'Pilih logo'}</Button>
              {f.logo && <Button onClick={() => setF((x) => ({ ...x, logo: '', logoW: 0, logoH: 0 }))}>Hapus logo</Button>}
            </div>
          </div>
          <p className="text-[13px] text-muted">PNG atau JPG. Logo dengan latar transparan paling pas. Gambar diperkecil otomatis dan hanya disimpan di perangkat ini.</p>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-[13px] font-semibold text-muted">Usaha</legend>
          <Field label="Nama usaha" htmlFor="id-name"><Input id="id-name" value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" /></Field>
          <Field label="Kontak (opsional)" htmlFor="id-contact" hint="Telepon atau email yang tampil di invoice."><Input id="id-contact" value={f.contact} onChange={(e) => set('contact', e.target.value)} autoComplete="off" /></Field>
          <Field label="Alamat (opsional)" htmlFor="id-address" className="sm:col-span-2"><Input id="id-address" value={f.address} onChange={(e) => set('address', e.target.value)} autoComplete="off" /></Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-[13px] font-semibold text-muted">Rekening pembayaran</legend>
          <Field label="Bank" htmlFor="id-bank"><Input id="id-bank" value={f.bank} onChange={(e) => set('bank', e.target.value)} autoComplete="off" /></Field>
          <Field label="Nomor rekening" htmlFor="id-accno"><Input id="id-accno" inputMode="numeric" value={f.accountNo} onChange={(e) => set('accountNo', e.target.value)} autoComplete="off" className="num" /></Field>
          <Field label="Atas nama" htmlFor="id-accname"><Input id="id-accname" value={f.accountName} onChange={(e) => set('accountName', e.target.value)} autoComplete="off" /></Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-[13px] font-semibold text-muted">Penomoran dan DP</legend>
          <Field label="Awalan nomor invoice" htmlFor="id-prefix" hint={`Contoh nomor: INV/${f.prefix.trim() || 'MOM'}/2026/11/001`}>
            <Input id="id-prefix" value={f.prefix} onChange={(e) => set('prefix', e.target.value)} autoComplete="off" className="num uppercase" maxLength={8} />
          </Field>
          <Field label="Persentase DP bawaan" htmlFor="id-dp" hint="Dipakai untuk usulan jumlah invoice DP.">
            <div className="flex items-center gap-2">
              <Input id="id-dp" inputMode="numeric" value={dp} onChange={(e) => setDp(e.target.value.replace(/\D/g, '').slice(0, 3))} className="num w-24" />
              <span className="text-muted">persen</span>
            </div>
          </Field>
        </fieldset>

        <Field label="Catatan di bagian bawah invoice (opsional)" htmlFor="id-footer" hint="Contoh: syarat pembayaran atau ucapan terima kasih.">
          <Textarea id="id-footer" rows={3} value={f.footer} onChange={(e) => set('footer', e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}
