import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, Loading, Money, NominalInput,
  PageHeader, Field, useToast,
} from '@/components/ui'
import {
  avgProfit7, daySummary, deleteCapitalMove, deleteDailyRecord, getDailyRecord, listCapitalMoves,
  listChannels, previousBalances, saveDailyRecord,
} from '@/db/finance'
import { listDebts } from '@/db/debts'
import { deleteExpense, listExpenses } from '@/db/expenses'
import { addDays, formatDateLong, todayStr } from '@/lib/date'
import { rupiah, rupiahSigned } from '@/lib/money'
import { computeProfit, profitWarning } from '@/lib/profit'
import { CapitalDialog, DebtDialog } from './dialogs'
import { ExpenseDialog } from './expense-dialogs'

interface Row { raw: string; value: number | null }

export function Catat({ initialDate }: { initialDate?: string }) {
  const { db, bump, go } = useApp()
  const toast = useToast()
  const [date, setDate] = useState(initialDate ?? todayStr())
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [debtOpen, setDebtOpen] = useState(false)
  const [capOpen, setCapOpen] = useState(false)
  const [expOpen, setExpOpen] = useState(false)
  const [delRecord, setDelRecord] = useState(false)

  const data = useAsync(async () => {
    const [channels, rec, prev, summary, moves, debts, avg, expenses] = await Promise.all([
      listChannels(db), getDailyRecord(db, date), previousBalances(db, date), daySummary(db, date),
      listCapitalMoves(db, date), listDebts(db, date), avgProfit7(db, date), listExpenses(db, date, date),
    ])
    return { channels, rec, prev, summary, moves, debts: debts.filter((d) => d.date === date), avg, expenses }
  }, [date])

  // Isi kolom saat tanggal atau data dimuat: catatan yang ada, atau saldo hari sebelumnya.
  useEffect(() => {
    if (!data.data || dirty) return
    const { channels, rec, prev } = data.data
    const next: Record<string, Row> = {}
    for (const c of channels) {
      const v = rec ? (rec.balances[c.id] ?? prev[c.id] ?? 0) : (prev[c.id] ?? 0)
      next[c.id] = { raw: String(v), value: v }
    }
    setRows(next)
    setNote(rec?.note ?? '')
  }, [data.data, dirty])

  const changeDate = (d: string) => {
    if (!d) return
    setDirty(false)
    setDate(d)
  }

  const calc = useMemo(() => {
    if (!data.data) return null
    const { channels, summary, avg } = data.data
    const vals = channels.map((c) => rows[c.id]?.value)
    if (vals.some((v) => v === null || v === undefined)) return { invalid: true as const }
    const closing = (vals as number[]).reduce((a, b) => a + b, 0)
    const profit = computeProfit({ ...summary, closingTotal: closing })
    return { invalid: false as const, closing, profit, warning: profitWarning(profit, avg) }
  }, [data.data, rows])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  if (!data.data) return null
  const { channels, rec, prev, summary, moves, debts, expenses } = data.data

  if (channels.length === 0) {
    return (
      <EmptyState
        title="Belum ada channel" body="Tambahkan channel (Seabank, Flip, dan lainnya) di Pengaturan supaya saldo harian bisa dicatat."
        action={<Button variant="primary" onClick={() => go({ name: 'pengaturan', from: { name: 'keuangan', tab: 'catat' } })}>Buka Pengaturan</Button>}
      />
    )
  }

  const save = async () => {
    if (!calc || calc.invalid) return
    setSaving(true)
    try {
      const balances: Record<string, number> = {}
      for (const c of channels) balances[c.id] = rows[c.id].value as number
      await saveDailyRecord(db, date, balances, note.trim() || null)
      setDirty(false)
      bump()
      toast(`Catatan ${formatDateLong(date)} tersimpan.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyimpan.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const isToday = date === todayStr()
  const adj = [
    ['Modal ditambah (setor)', -summary.capitalNet],
    ['Piutang baru', summary.piutangBaru],
    ['Piutang dibayar kembali', -summary.piutangLunas],
    ['Utang baru', -summary.utangBaru],
    ['Utang dibayar', summary.utangBayar],
    ['Biaya operasional', summary.operasional],
  ] as const

  return (
    <div>
      <PageHeader
        title="Catat Keuangan Harian"
        subtitle="Isi saldo akhir tiap channel. Profit dihitung dari selisih saldo, tanpa uang utang, modal, dan biaya operasional."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <IconButton label="Hari sebelumnya" onClick={() => changeDate(addDays(date, -1))} className="border border-line-strong"><ChevronLeft className="size-4" aria-hidden="true" /></IconButton>
        <Input type="date" aria-label="Tanggal catatan" value={date} onChange={(e) => changeDate(e.target.value)} className="w-44" />
        <IconButton label="Hari berikutnya" onClick={() => changeDate(addDays(date, 1))} className="border border-line-strong"><ChevronRight className="size-4" aria-hidden="true" /></IconButton>
        <span className="ml-1 text-muted">{formatDateLong(date)}{isToday ? ' (hari ini)' : ''}</span>
        {rec && <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-soft-fg">Sudah dicatat</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Saldo akhir tiap channel</h2>
            <ul className="flex flex-col gap-4">
              {channels.map((c) => {
                const r = rows[c.id] ?? { raw: '', value: null }
                const before = prev[c.id]
                const diff = r.value !== null && before !== undefined ? r.value - before : null
                return (
                  <li key={c.id} className="grid items-start gap-3 sm:grid-cols-[9rem_1fr_9rem]">
                    <label htmlFor={`bal-${c.id}`} className="pt-2 font-medium">{c.name}</label>
                    <NominalInput
                      id={`bal-${c.id}`} value={r.raw} allowEmpty
                      onChange={(raw, value) => {
                        setDirty(true)
                        setRows((x) => ({ ...x, [c.id]: { raw, value: raw.trim() === '' ? 0 : value } }))
                      }}
                    />
                    <div className="pt-2 text-[13px] text-muted sm:text-right">
                      {before !== undefined && <div>Sebelumnya {rupiah(before)}</div>}
                      {diff !== null && diff !== 0 && <Money value={diff} signed />}
                    </div>
                  </li>
                )
              })}
            </ul>
            <Field label="Catatan hari ini (opsional)" htmlFor="rec-note" className="mt-5">
              <Input id="rec-note" value={note} onChange={(e) => { setDirty(true); setNote(e.target.value) }} />
            </Field>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Penyesuaian hari ini</h2>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setDebtOpen(true)}>Catat utang atau piutang</Button>
                <Button size="sm" onClick={() => setCapOpen(true)}>Setor atau tarik modal</Button>
                <Button size="sm" onClick={() => setExpOpen(true)}>Catat biaya operasional</Button>
              </div>
            </div>
            {moves.length === 0 && debts.length === 0 && expenses.length === 0 ? (
              <p className="text-muted">
                Belum ada. Uang usaha yang dipakai pribadi atau dipinjam orang dicatat sebagai piutang, dan biaya seperti server
                atau iklan dicatat sebagai biaya operasional, supaya tidak dianggap rugi.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {debts.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span>{d.kind === 'piutang' ? 'Piutang' : 'Utang'} {d.contact_name}{d.note ? `, ${d.note}` : ''}</span>
                    <Money value={d.amount} />
                  </li>
                ))}
                {expenses.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span>Biaya {x.name}{x.channel_id ? `, dari saldo ${x.channel_name ?? 'channel'}` : ', di luar saldo'}</span>
                    <span className="flex items-center gap-1">
                      <Money value={x.amount} />
                      <IconButton label={`Hapus biaya ${x.name}`} className="size-8" onClick={async () => { await deleteExpense(db, x.id); bump() }}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </IconButton>
                    </span>
                  </li>
                ))}
                {moves.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span>{m.amount >= 0 ? 'Setor modal' : 'Tarik modal'}{m.note ? `, ${m.note}` : ''}</span>
                    <span className="flex items-center gap-1">
                      <Money value={Math.abs(m.amount)} />
                      <IconButton label="Hapus catatan modal" className="size-8" onClick={async () => { await deleteCapitalMove(db, m.id); bump() }}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </IconButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside aria-label="Hitungan profit" className="lg:sticky lg:top-0 lg:self-start">
          <Card className="p-5">
            <p className="text-muted">Profit {isToday ? 'hari ini' : 'tanggal ini'}</p>
            {calc && !calc.invalid ? (
              <Money value={calc.profit} signed className="mt-1 block text-4xl font-semibold" />
            ) : (
              <p className="mt-1 text-lg font-semibold text-danger-text">Ada nominal yang belum terbaca</p>
            )}
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-line pt-4">
              <dt className="text-muted">Saldo awal</dt><dd className="num text-right">{rupiah(summary.openingTotal)}</dd>
              <dt className="text-muted">Saldo akhir</dt>
              <dd className="num text-right">{calc && !calc.invalid ? rupiah(calc.closing) : 'Belum lengkap'}</dd>
              <dt className="text-muted">Selisih saldo</dt>
              <dd className="text-right">{calc && !calc.invalid ? <Money value={calc.closing - summary.openingTotal} signed /> : '-'}</dd>
              {adj.filter(([, v]) => v !== 0).map(([label, v]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="num text-right">{rupiahSigned(v)}</dd>
                </div>
              ))}
            </dl>
            {calc && !calc.invalid && calc.warning && (
              <p role="status" className="mt-4 rounded-lg bg-warn-soft p-3 text-[13px] text-warn-text">{calc.warning}</p>
            )}
            <Button variant="primary" size="lg" className="mt-5 w-full" onClick={save} loading={saving} disabled={!calc || calc.invalid}>
              {rec ? 'Perbarui catatan' : 'Simpan catatan'}
            </Button>
            {rec && (
              <Button variant="ghost" size="sm" className="mt-2 w-full text-danger-text" onClick={() => setDelRecord(true)}>
                Hapus catatan hari ini
              </Button>
            )}
          </Card>
        </aside>
      </div>

      <DebtDialog open={debtOpen} onClose={() => setDebtOpen(false)} defaultDate={date} />
      <CapitalDialog open={capOpen} onClose={() => setCapOpen(false)} defaultDate={date} />
      <ExpenseDialog open={expOpen} onClose={() => setExpOpen(false)} defaultDate={date} />
      <ConfirmDialog
        open={delRecord} onClose={() => setDelRecord(false)} danger
        title="Hapus catatan harian?" confirmLabel="Hapus catatan"
        body={`Saldo semua channel pada ${formatDateLong(date)} akan dihapus. Utang piutang dan modal di hari itu tetap ada.`}
        onConfirm={async () => { await deleteDailyRecord(db, date); setDirty(false); setDelRecord(false); bump(); toast('Catatan dihapus.') }}
      />
    </div>
  )
}

