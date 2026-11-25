import { useEffect, useState } from 'react'
import { Button, Dialog, Field, Input, NominalInput, Segmented, Select, useToast } from '@/components/ui'
import { useApp, useAsync } from '@/app/context'
import {
  listExpenseNames, payBill, saveBill, saveExpense, type Expense, type RecurringBill,
} from '@/db/expenses'
import { getSetting, listChannels, setSetting } from '@/db/finance'
import { formatDate, monthLabel } from '@/lib/date'
import { dueDateAfter, EXPENSE_CATEGORIES, type BillPeriod } from '@/lib/expense'
import { rupiah } from '@/lib/money'

/** Pilihan terakhir dipakai lagi sebagai isian awal. Disimpan di perangkat ini saja. */
const SOURCE_KEY = 'expense_source'

function CategorySelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {EXPENSE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </Select>
  )
}

/** Dibayar dari channel mana, atau dari luar saldo aplikasi (nilai kosong). */
function SourceSelect({
  id, value, onChange, keep,
}: { id: string; value: string; onChange: (v: string) => void; keep?: { id: string; name: string } | null }) {
  const { db } = useApp()
  const channels = useAsync(() => listChannels(db), [])
  const list = channels.data ?? []
  const extra = keep && !list.some((c) => c.id === keep.id) ? keep : null
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Di luar saldo aplikasi</option>
      {list.map((c) => <option key={c.id} value={c.id}>Saldo {c.name}</option>)}
      {extra && <option value={extra.id}>Saldo {extra.name} (diarsipkan)</option>}
    </Select>
  )
}

const sourceHint = (source: string) =>
  source
    ? 'Isi saldo akhir channel itu setelah dipotong biaya ini. Profit harian tidak ikut turun, biayanya dipotong di profit bersih.'
    : 'Uang pribadi atau kartu lain, saldo channel tidak berubah. Biayanya tetap dipotong di profit bersih.'

/** Catat biaya baru, ubah yang ada, atau bayar satu putaran tagihan rutin. */
export function ExpenseDialog({
  open, onClose, defaultDate, expense, bill,
}: { open: boolean; onClose: () => void; defaultDate: string; expense?: Expense | null; bill?: RecurringBill | null }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const names = useAsync(() => listExpenseNames(db), [])
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>('server')
  const [raw, setRaw] = useState('')
  const [value, setValue] = useState<number | null>(null)
  const [date, setDate] = useState(defaultDate)
  const [source, setSource] = useState('')
  const [spread, setSpread] = useState<'1' | '12'>('1')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setError(null)
    setNote('')
    setDate(defaultDate)
    if (expense) {
      setName(expense.name); setCategory(expense.category); setRaw(String(expense.amount)); setValue(expense.amount)
      setDate(expense.date); setSource(expense.channel_id ?? ''); setSpread(expense.spread_months === 12 ? '12' : '1')
      setNote(expense.note ?? '')
    } else if (bill) {
      // Tagihan punya sumber dana bawaannya sendiri, termasuk "di luar saldo", jadi pilihan terakhir tidak dipakai.
      setName(bill.name); setCategory(bill.category); setRaw(String(bill.amount)); setValue(bill.amount)
      setSpread(bill.period === 'tahunan' ? '12' : '1'); setSource(bill.channel_id ?? '')
    } else {
      setName(''); setCategory('server'); setRaw(''); setValue(null); setSpread('1'); setSource('')
      Promise.all([getSetting(db, SOURCE_KEY), listChannels(db)]).then(([saved, channels]) => {
        if (alive && saved && channels.some((c) => c.id === saved)) setSource(saved)
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [open, defaultDate, expense, bill, db])

  const canSave = value !== null && date !== '' && (bill ? true : name.trim() !== '')

  const save = async () => {
    if (!canSave || value === null) return
    setBusy(true)
    setError(null)
    try {
      if (bill) {
        await payBill(db, bill.id, { date, amount: value, channelId: source || null, note: note.trim() || null })
        toast(`${bill.name} ${rupiah(value)} tercatat. Jatuh tempo berikutnya ${formatDate(dueDateAfter(bill.next_due, bill.period, bill.anchor_day))}.`)
      } else {
        await saveExpense(
          db,
          {
            date, name, category, amount: value, channelId: source || null, spreadMonths: Number(spread),
            note: note.trim() || null, recurringId: expense?.recurring_id ?? null,
          },
          expense?.id,
        )
        toast(expense ? 'Biaya diperbarui.' : `Biaya ${name.trim()} ${rupiah(value)} tersimpan.`)
      }
      await setSetting(db, SOURCE_KEY, source)
      bump()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  const title = expense ? 'Ubah biaya operasional' : bill ? `Bayar tagihan ${bill.name}` : 'Catat biaya operasional'
  return (
    <Dialog
      open={open} onClose={onClose} title={title}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!canSave}>{bill ? 'Sudah dibayar' : 'Simpan'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {bill ? (
          <p className="text-muted">
            Tagihan {bill.period === 'bulanan' ? 'bulanan' : 'tahunan'}, jatuh tempo {formatDate(bill.next_due)}.
            Setelah disimpan, jatuh tempo berikutnya maju otomatis.
          </p>
        ) : (
          <>
            <Field label="Nama biaya" htmlFor="exp-name">
              <Input id="exp-name" list="exp-names" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
              <datalist id="exp-names">{(names.data ?? []).map((n) => <option key={n} value={n} />)}</datalist>
            </Field>
            <Field label="Kategori" htmlFor="exp-cat"><CategorySelect id="exp-cat" value={category} onChange={setCategory} /></Field>
          </>
        )}
        <NominalInput id="exp-amount" label="Nominal" value={raw} onChange={(r, v) => { setRaw(r); setValue(v) }} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal dibayar" htmlFor="exp-date"><Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Dibayar dari" htmlFor="exp-source">
            <SourceSelect id="exp-source" value={source} onChange={setSource} keep={expense?.channel_id ? { id: expense.channel_id, name: expense.channel_name ?? 'channel' } : null} />
          </Field>
        </div>
        <p className="-mt-2 text-[13px] text-muted">{sourceHint(source)}</p>
        {!bill && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Dihitung di laporan</span>
            <Segmented
              label="Pembagian biaya" value={spread} onChange={setSpread}
              options={[{ value: '1', label: 'Bulan ini saja' }, { value: '12', label: 'Dibagi 12 bulan' }]}
            />
            <p className="text-[13px] text-muted">
              {spread === '12'
                ? value !== null && date
                  ? `Biaya tahunan seperti domain: ${rupiah(Math.round(value / 12))} per bulan, mulai ${monthLabel(date.slice(0, 7))}.`
                  : 'Biaya tahunan seperti domain dibagi rata, mulai bulan dibayar.'
                : 'Seluruh nominal dihitung di bulan dibayar.'}
            </p>
          </div>
        )}
        <Field label="Catatan (opsional)" htmlFor="exp-note"><Input id="exp-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

/** Tambah atau ubah tagihan rutin. */
export function BillDialog({
  open, onClose, defaultDate, bill,
}: { open: boolean; onClose: () => void; defaultDate: string; bill?: RecurringBill | null }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>('server')
  const [raw, setRaw] = useState('')
  const [value, setValue] = useState<number | null>(null)
  const [period, setPeriod] = useState<BillPeriod>('bulanan')
  const [due, setDue] = useState(defaultDate)
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (bill) {
      setName(bill.name); setCategory(bill.category); setRaw(String(bill.amount)); setValue(bill.amount)
      setPeriod(bill.period); setDue(bill.next_due); setSource(bill.channel_id ?? '')
    } else {
      setName(''); setCategory('server'); setRaw(''); setValue(null); setPeriod('bulanan'); setDue(defaultDate); setSource('')
    }
  }, [open, bill, defaultDate])

  const canSave = name.trim() !== '' && value !== null && due !== ''

  const save = async () => {
    if (!canSave || value === null) return
    setBusy(true)
    setError(null)
    try {
      await saveBill(db, { name, category, amount: value, period, nextDue: due, channelId: source || null }, bill?.id)
      bump()
      toast(bill ? 'Tagihan diperbarui.' : `Tagihan ${name.trim()} tersimpan. Kamu akan diingatkan 3 hari sebelumnya.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open} onClose={onClose} title={bill ? 'Ubah tagihan rutin' : 'Tambah tagihan rutin'}
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!canSave}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Nama tagihan" htmlFor="bill-name" hint="Contoh: Hosting, Domain, Langganan tools.">
          <Input id="bill-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
        </Field>
        <Field label="Kategori" htmlFor="bill-cat"><CategorySelect id="bill-cat" value={category} onChange={setCategory} /></Field>
        <NominalInput id="bill-amount" label="Nominal tiap tagih" value={raw} onChange={(r, v) => { setRaw(r); setValue(v) }} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Berulang</span>
          <Segmented
            label="Siklus tagihan" value={period} onChange={setPeriod}
            options={[{ value: 'bulanan', label: 'Tiap bulan' }, { value: 'tahunan', label: 'Tiap tahun' }]}
          />
          {period === 'tahunan' && <p className="text-[13px] text-muted">Biaya tahunan dibagi rata ke 12 bulan di laporan, supaya satu bulan tidak terlihat rugi sendirian.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jatuh tempo berikutnya" htmlFor="bill-due"><Input id="bill-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="Biasa dibayar dari" htmlFor="bill-source">
            <SourceSelect id="bill-source" value={source} onChange={setSource} keep={bill?.channel_id ? { id: bill.channel_id, name: 'channel' } : null} />
          </Field>
        </div>
        <p className="-mt-2 text-[13px] text-muted">Pengingat muncul di desktop 3 hari sebelum dan di hari jatuh tempo. Saat dibayar, pilihan ini masih bisa diganti.</p>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}
