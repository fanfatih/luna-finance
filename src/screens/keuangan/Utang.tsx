import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Loading, Money, PageHeader,
  Segmented, Table, TD, TH, useToast,
} from '@/components/ui'
import {
  balancesByContact, debtTotals, deleteDebt, listDebts, listPayments, voidPayment, type Debt, type DebtKind,
} from '@/db/debts'
import { formatDate, todayStr } from '@/lib/date'
import { rupiah } from '@/lib/money'
import { DebtDialog, PayDialog } from './dialogs'

type KindFilter = 'semua' | DebtKind
type StateFilter = 'aktif' | 'lunas' | 'semua'
type View = 'daftar' | 'pihak'

const STATUS: Record<Debt['status'], { label: string; tone: 'success' | 'neutral' | 'warn' }> = {
  lunas: { label: 'Lunas', tone: 'success' },
  berjalan: { label: 'Berjalan', tone: 'neutral' },
  'jatuh-tempo': { label: 'Lewat jatuh tempo', tone: 'warn' },
}

export function Utang() {
  const { db, bump } = useApp()
  const toast = useToast()
  const today = todayStr()
  const [view, setView] = useState<View>('daftar')
  const [kind, setKind] = useState<KindFilter>('semua')
  const [state, setState] = useState<StateFilter>('aktif')
  const [addOpen, setAddOpen] = useState(false)
  const [pay, setPay] = useState<Debt | null>(null)
  const [del, setDel] = useState<Debt | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const data = useAsync(async () => {
    const [debts, totals, perContact] = await Promise.all([
      listDebts(db, today, { kind: kind === 'semua' ? undefined : kind, state }),
      debtTotals(db, today), balancesByContact(db, today),
    ])
    return { debts, totals, perContact }
  }, [kind, state])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  if (!data.data) return null
  const { debts, totals, perContact } = data.data

  return (
    <div>
      <PageHeader
        title="Data Utang-Piutang"
        subtitle="Catat uang yang keluar dan masuk di luar usaha, supaya profit harian tidak terganggu."
        actions={<Button variant="primary" onClick={() => setAddOpen(true)}><Plus className="size-4" aria-hidden="true" /> Catat baru</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-muted">Piutang berjalan ({totals.piutangCount})</p>
          <Money value={totals.piutang} className="mt-1 block text-2xl font-semibold" />
        </Card>
        <Card className="p-5">
          <p className="text-muted">Utang berjalan ({totals.utangCount})</p>
          <Money value={totals.utang} className="mt-1 block text-2xl font-semibold" />
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented label="Tampilan" value={view} onChange={setView} options={[{ value: 'daftar', label: 'Daftar' }, { value: 'pihak', label: 'Per pihak' }]} />
        {view === 'daftar' && (
          <>
            <Segmented
              label="Jenis" value={kind} onChange={setKind}
              options={[{ value: 'semua', label: 'Semua' }, { value: 'piutang', label: 'Piutang' }, { value: 'utang', label: 'Utang' }]}
            />
            <Segmented
              label="Status" value={state} onChange={setState}
              options={[{ value: 'aktif', label: 'Belum lunas' }, { value: 'lunas', label: 'Lunas' }, { value: 'semua', label: 'Semua' }]}
            />
          </>
        )}
      </div>

      {view === 'pihak' ? (
        perContact.length === 0 ? (
          <EmptyState title="Tidak ada sisa utang atau piutang" body="Semua catatan sudah lunas, atau belum ada yang dicatat." />
        ) : (
          <Table label="Sisa utang piutang per pihak">
            <thead><tr><TH>Pihak</TH><TH right>Piutang (ke kamu)</TH><TH right>Utang (dari kamu)</TH></tr></thead>
            <tbody>
              {perContact.map((p) => (
                <tr key={p.contact_id}>
                  <TD className="font-medium">{p.name}</TD>
                  <TD right>{p.piutang ? <span className="num">{rupiah(p.piutang)}</span> : <span className="text-muted">-</span>}</TD>
                  <TD right>{p.utang ? <span className="num">{rupiah(p.utang)}</span> : <span className="text-muted">-</span>}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      ) : debts.length === 0 ? (
        <EmptyState
          title={state === 'aktif' ? 'Tidak ada utang piutang yang berjalan' : 'Belum ada catatan'}
          body="Kalau uang usaha dipakai pribadi atau dipinjam orang, catat di sini supaya tidak lupa dan tidak dianggap rugi."
          action={<Button variant="primary" onClick={() => setAddOpen(true)}>Catat utang atau piutang</Button>}
        />
      ) : (
        <Table label="Daftar utang piutang">
          <thead>
            <tr><TH className="w-10" /><TH>Pihak</TH><TH>Jenis</TH><TH>Tanggal</TH><TH right>Nominal</TH><TH right>Sisa</TH><TH>Status</TH><TH right>Aksi</TH></tr>
          </thead>
          <tbody>
            {debts.map((d) => (
              <Fragment key={d.id}>
                <tr>
                  <TD className="pr-0">
                    <IconButton
                      label={open === d.id ? 'Tutup riwayat pembayaran' : 'Lihat riwayat pembayaran'} className="size-8"
                      aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id)}
                    >
                      {open === d.id ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                    </IconButton>
                  </TD>
                  <TD>
                    <div className="font-medium">{d.contact_name}</div>
                    {d.note && <div className="text-[13px] text-muted">{d.note}</div>}
                  </TD>
                  <TD>{d.kind === 'piutang' ? 'Piutang' : 'Utang'}</TD>
                  <TD className="whitespace-nowrap">
                    {formatDate(d.date)}
                    {d.due_date && <div className="text-[13px] text-muted">Tempo {formatDate(d.due_date)}</div>}
                  </TD>
                  <TD right><span className="num">{rupiah(d.amount)}</span></TD>
                  <TD right><span className="num font-medium">{rupiah(d.remaining)}</span></TD>
                  <TD><Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge></TD>
                  <TD right>
                    <div className="flex justify-end gap-1">
                      {d.remaining > 0 && (
                        <Button size="sm" onClick={() => setPay(d)}>{d.kind === 'piutang' ? 'Terima' : 'Bayar'}</Button>
                      )}
                      <IconButton label={`Hapus catatan ${d.contact_name}`} className="size-8" onClick={() => setDel(d)}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </IconButton>
                    </div>
                  </TD>
                </tr>
                {open === d.id && (
                  <tr>
                    <TD colSpan={8} className="bg-surface"><Payments debtId={d.id} /></TD>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}

      <DebtDialog open={addOpen} onClose={() => setAddOpen(false)} defaultDate={today} />
      {pay && (
        <PayDialog
          open onClose={() => setPay(null)} debtId={pay.id} remaining={pay.remaining}
          who={pay.contact_name} kind={pay.kind} defaultDate={today}
        />
      )}
      <ConfirmDialog
        open={!!del} onClose={() => setDel(null)} danger confirmLabel="Hapus"
        title="Hapus catatan ini?"
        body={del ? `${del.kind === 'piutang' ? 'Piutang' : 'Utang'} ${rupiah(del.amount)} untuk ${del.contact_name} beserta riwayat pembayarannya akan dihapus dan tidak lagi memengaruhi profit.` : ''}
        onConfirm={async () => { if (del) { await deleteDebt(db, del.id); setDel(null); bump(); toast('Catatan dihapus.') } }}
      />
    </div>
  )
}

function Payments({ debtId }: { debtId: string }) {
  const { db, bump } = useApp()
  const toast = useToast()
  const pays = useAsync(() => listPayments(db, debtId), [debtId])
  if (pays.loading && !pays.data) return <Loading label="Memuat riwayat" />
  if (pays.error) return <ErrorState message={pays.error} onRetry={pays.reload} />
  if (!pays.data?.length) return <p className="text-muted">Belum ada pembayaran.</p>
  return (
    <ul className="flex flex-col gap-1">
      {pays.data.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3">
          <span>{formatDate(p.date)}{p.note ? `, ${p.note}` : ''}</span>
          <span className="flex items-center gap-2">
            <span className="num">{rupiah(p.amount)}</span>
            <Button size="sm" variant="ghost" onClick={async () => { await voidPayment(db, p.id); bump(); toast('Pembayaran dibatalkan.') }}>
              Batalkan
            </Button>
          </span>
        </li>
      ))}
    </ul>
  )
}
