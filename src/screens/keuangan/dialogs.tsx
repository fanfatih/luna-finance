import { useEffect, useState } from 'react'
import { Button, Dialog, Field, Input, NominalInput, Segmented, useToast } from '@/components/ui'
import { useApp, useAsync } from '@/app/context'
import { addDebt, addPayment, listContacts, type DebtKind } from '@/db/debts'
import { addCapitalMove } from '@/db/finance'
import { rupiah } from '@/lib/money'

function useFormError() {
  const [error, setError] = useState<string | null>(null)
  return { error, setError }
}

/** Catat utang atau piutang baru. Pihak bisa dipilih dari kontak yang pernah dipakai, atau diketik baru. */
export function DebtDialog({
  open, onClose, defaultDate, defaultKind = 'piutang',
}: { open: boolean; onClose: () => void; defaultDate: string; defaultKind?: DebtKind }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const contacts = useAsync(() => listContacts(db), [])
  const [kind, setKind] = useState<DebtKind>(defaultKind)
  const [who, setWho] = useState('')
  const [raw, setRaw] = useState('')
  const [value, setValue] = useState<number | null>(null)
  const [date, setDate] = useState(defaultDate)
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const { error, setError } = useFormError()

  useEffect(() => {
    if (!open) return
    setKind(defaultKind); setWho(''); setRaw(''); setValue(null); setDate(defaultDate); setDue(''); setNote(''); setError(null)
  }, [open, defaultDate, defaultKind, setError])

  const canSave = who.trim() !== '' && value !== null && date !== ''

  const save = async () => {
    if (!canSave || value === null) return
    setBusy(true)
    try {
      await addDebt(db, { kind, contactName: who, amount: value, date, dueDate: due || null, note: note.trim() || null })
      bump()
      toast(`${kind === 'piutang' ? 'Piutang' : 'Utang'} ${rupiah(value)} untuk ${who.trim()} tersimpan.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} title="Catat utang atau piutang"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!canSave}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Jenis</span>
          <Segmented
            label="Jenis catatan" value={kind} onChange={setKind}
            options={[{ value: 'piutang', label: 'Piutang (uang keluar)' }, { value: 'utang', label: 'Utang (uang masuk)' }]}
          />
          <p className="text-[13px] text-muted">
            {kind === 'piutang'
              ? 'Piutang: uang kamu dipakai orang lain, termasuk dirimu sendiri, dan akan dikembalikan.'
              : 'Utang: kamu menerima uang yang harus dikembalikan.'}
          </p>
        </div>
        <Field label="Pihak" htmlFor="debt-who" hint="Pilih dari yang pernah dipakai atau ketik nama baru.">
          <Input id="debt-who" list="debt-contacts" value={who} onChange={(e) => setWho(e.target.value)} autoComplete="off" />
          <datalist id="debt-contacts">
            {(contacts.data ?? []).map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
        </Field>
        <NominalInput id="debt-amount" label="Nominal" value={raw} onChange={(r, v) => { setRaw(r); setValue(v) }} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal" htmlFor="debt-date"><Input id="debt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Jatuh tempo (opsional)" htmlFor="debt-due"><Input id="debt-due" type="date" value={due} min={date} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label="Catatan (opsional)" htmlFor="debt-note"><Input id="debt-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

/** Setor atau tarik modal. Tidak dihitung sebagai profit. */
export function CapitalDialog({ open, onClose, defaultDate }: { open: boolean; onClose: () => void; defaultDate: string }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const [dir, setDir] = useState<'setor' | 'tarik'>('setor')
  const [raw, setRaw] = useState('')
  const [value, setValue] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const { error, setError } = useFormError()

  useEffect(() => {
    if (!open) return
    setDir('setor'); setRaw(''); setValue(null); setNote(''); setError(null)
  }, [open, setError])

  const save = async () => {
    if (value === null) return
    setBusy(true)
    try {
      await addCapitalMove(db, defaultDate, dir === 'setor' ? value : -value, note.trim() || null)
      bump()
      toast(`${dir === 'setor' ? 'Setor' : 'Tarik'} modal ${rupiah(value)} tersimpan.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} title="Setor atau tarik modal" width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={value === null}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted">Dipakai saat kamu menambah saldo dari uang pribadi, atau menarik uang dari saldo usaha. Tidak dihitung sebagai profit.</p>
        <Segmented
          label="Arah" value={dir} onChange={setDir}
          options={[{ value: 'setor', label: 'Setor modal' }, { value: 'tarik', label: 'Tarik modal' }]}
        />
        <NominalInput id="cap-amount" label="Nominal" value={raw} onChange={(r, v) => { setRaw(r); setValue(v) }} />
        <Field label="Catatan (opsional)" htmlFor="cap-note"><Input id="cap-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

/** Bayar sebagian atau lunasi. Tidak boleh melebihi sisa. */
export function PayDialog({
  open, onClose, debtId, remaining, who, kind, defaultDate,
}: { open: boolean; onClose: () => void; debtId: string; remaining: number; who: string; kind: DebtKind; defaultDate: string }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const [raw, setRaw] = useState('')
  const [value, setValue] = useState<number | null>(null)
  const [date, setDate] = useState(defaultDate)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const { error, setError } = useFormError()

  useEffect(() => {
    if (!open) return
    setRaw(''); setValue(null); setDate(defaultDate); setNote(''); setError(null)
  }, [open, defaultDate, setError])

  const over = value !== null && value > remaining
  const save = async () => {
    if (value === null || over) return
    setBusy(true)
    try {
      await addPayment(db, debtId, value, date, note.trim() || null)
      bump()
      toast(value === remaining ? `Lunas. ${who} sudah tidak punya sisa.` : `Pembayaran ${rupiah(value)} dari ${who} tercatat.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} title={kind === 'piutang' ? `Terima pembayaran dari ${who}` : `Bayar utang ke ${who}`} width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={value === null || over}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <p>Sisa saat ini <strong className="num">{rupiah(remaining)}</strong>.</p>
        <div className="flex flex-col gap-2">
          <NominalInput id="pay-amount" label="Nominal dibayar" value={raw} onChange={(r, v) => { setRaw(r); setValue(v) }} />
          <div>
            <Button size="sm" onClick={() => { setRaw(String(remaining)); setValue(remaining) }}>Lunasi semua</Button>
          </div>
          {over && <p role="alert" className="text-[13px] text-danger-text">Melebihi sisa. Maksimal {rupiah(remaining)}.</p>}
        </div>
        <Field label="Tanggal" htmlFor="pay-date"><Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Catatan (opsional)" htmlFor="pay-note"><Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}
