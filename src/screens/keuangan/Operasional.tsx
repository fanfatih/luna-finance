import { useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Loading, Money, PageHeader, Table, TD, TH,
  useToast,
} from '@/components/ui'
import {
  deleteBill, deleteExpense, listBills, listExpenses, monthBurden, type Expense, type RecurringBill,
} from '@/db/expenses'
import { formatDate, monthLabel, todayStr } from '@/lib/date'
import { billStatus, categoryLabel, periodText, shiftYm, type BillState } from '@/lib/expense'
import { rupiah } from '@/lib/money'
import { BillDialog, ExpenseDialog } from './expense-dialogs'

const BILL_TONE: Record<BillState, 'danger' | 'warn' | 'neutral'> = {
  terlambat: 'danger', 'hari-ini': 'warn', segera: 'warn', nanti: 'neutral',
}

export function Operasional() {
  const { db, bump } = useApp()
  const toast = useToast()
  const today = todayStr()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [expOpen, setExpOpen] = useState(false)
  const [editExp, setEditExp] = useState<Expense | null>(null)
  const [delExp, setDelExp] = useState<Expense | null>(null)
  const [billOpen, setBillOpen] = useState(false)
  const [editBill, setEditBill] = useState<RecurringBill | null>(null)
  const [payFor, setPayFor] = useState<RecurringBill | null>(null)
  const [delBill, setDelBill] = useState<RecurringBill | null>(null)

  const data = useAsync(async () => {
    const [bills, expenses, burden] = await Promise.all([
      listBills(db), listExpenses(db, month + '-01', month + '-31'), monthBurden(db, month),
    ])
    return { bills, expenses, burden }
  }, [month])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  if (!data.data) return null
  const { bills, expenses, burden } = data.data
  const paid = expenses.reduce((a, e) => a + e.amount, 0)

  return (
    <div>
      <PageHeader
        title="Operasional"
        subtitle="Biaya usaha dan tagihan rutin. Profit harian tidak terpotong biaya ini, pengurangannya muncul sebagai profit bersih di Laporan."
        actions={
          <>
            <Button onClick={() => setBillOpen(true)}><Repeat className="size-4" aria-hidden="true" /> Tambah tagihan rutin</Button>
            <Button variant="primary" onClick={() => setExpOpen(true)}><Plus className="size-4" aria-hidden="true" /> Catat biaya</Button>
          </>
        }
      />

      <section aria-labelledby="ops-bills" className="mb-8">
        <h2 id="ops-bills" className="mb-3 text-lg font-semibold">Tagihan rutin</h2>
        {bills.length === 0 ? (
          <EmptyState
            title="Belum ada tagihan rutin"
            body="Catat sekali, misalnya hosting tiap bulan atau domain tiap tahun. Kamu diingatkan 3 hari sebelumnya dan di hari jatuh tempo lewat notifikasi desktop."
            action={<Button variant="primary" onClick={() => setBillOpen(true)}>Tambah tagihan rutin</Button>}
          />
        ) : (
          <Table label="Tagihan rutin">
            <thead>
              <tr><TH>Tagihan</TH><TH>Jatuh tempo</TH><TH right>Nominal</TH><TH right>Aksi</TH></tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const st = billStatus(b.next_due, today)
                return (
                  <tr key={b.id}>
                    <TD>
                      <div className="font-medium">{b.name}</div>
                      <div className="text-[13px] text-muted">{categoryLabel(b.category)}. {periodText(b.period, b.next_due, b.anchor_day)}</div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {formatDate(b.next_due)}
                      <div className="mt-1"><Badge tone={BILL_TONE[st.state]}>{st.label}</Badge></div>
                    </TD>
                    <TD right><span className="num">{rupiah(b.amount)}</span></TD>
                    <TD right>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant={st.state === 'nanti' ? 'secondary' : 'primary'} onClick={() => setPayFor(b)}>Sudah dibayar</Button>
                        <IconButton label={`Ubah tagihan ${b.name}`} className="size-8" onClick={() => setEditBill(b)}>
                          <Pencil className="size-4" aria-hidden="true" />
                        </IconButton>
                        <IconButton label={`Hapus tagihan ${b.name}`} className="size-8" onClick={() => setDelBill(b)}>
                          <Trash2 className="size-4" aria-hidden="true" />
                        </IconButton>
                      </div>
                    </TD>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="ops-expenses">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="ops-expenses" className="text-lg font-semibold">Catatan biaya</h2>
          <div className="flex items-center gap-2">
            <IconButton label="Bulan sebelumnya" onClick={() => setMonth(shiftYm(month, -1))} className="border border-line-strong"><ChevronLeft className="size-4" aria-hidden="true" /></IconButton>
            <span className="min-w-40 text-center font-semibold">{monthLabel(month)}</span>
            <IconButton label="Bulan berikutnya" onClick={() => setMonth(shiftYm(month, 1))} className="border border-line-strong"><ChevronRight className="size-4" aria-hidden="true" /></IconButton>
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Card className="p-5">
            <p className="text-muted">Dibayar bulan ini</p>
            <Money value={paid} className="mt-1 block text-2xl font-semibold" />
            <p className="mt-1 text-[13px] text-muted">{expenses.length} catatan.</p>
          </Card>
          <Card className="p-5">
            <p className="text-muted">Beban untuk profit bersih</p>
            <Money value={burden.total} className="mt-1 block text-2xl font-semibold" />
            <p className="mt-1 text-[13px] text-muted">
              {burden.total === paid ? 'Sama dengan yang dibayar.' : 'Biaya tahunan dibagi rata ke 12 bulan, jadi angkanya beda dengan yang dibayar.'}
            </p>
          </Card>
        </div>

        {expenses.length === 0 ? (
          <EmptyState
            title={`Belum ada biaya di ${monthLabel(month)}`}
            body="Catat biaya server, iklan, langganan, atau gaji supaya profit bersih bulanan terhitung."
            action={<Button variant="primary" onClick={() => setExpOpen(true)}>Catat biaya</Button>}
          />
        ) : (
          <Table label={`Biaya operasional ${monthLabel(month)}`}>
            <thead>
              <tr><TH>Tanggal</TH><TH>Biaya</TH><TH>Kategori</TH><TH>Dibayar dari</TH><TH right>Nominal</TH><TH right>Aksi</TH></tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <TD className="whitespace-nowrap">{formatDate(e.date)}</TD>
                  <TD>
                    <div className="font-medium">{e.name}</div>
                    {e.note && <div className="text-[13px] text-muted">{e.note}</div>}
                  </TD>
                  <TD>{categoryLabel(e.category)}</TD>
                  <TD>{e.channel_id ? `Saldo ${e.channel_name ?? 'channel'}` : 'Di luar saldo'}</TD>
                  <TD right>
                    <span className="num">{rupiah(e.amount)}</span>
                    {e.spread_months === 12 && <div className="text-[13px] text-muted">dibagi 12 bulan</div>}
                  </TD>
                  <TD right>
                    <div className="flex justify-end gap-1">
                      <IconButton label={`Ubah biaya ${e.name}`} className="size-8" onClick={() => setEditExp(e)}>
                        <Pencil className="size-4" aria-hidden="true" />
                      </IconButton>
                      <IconButton label={`Hapus biaya ${e.name}`} className="size-8" onClick={() => setDelExp(e)}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </IconButton>
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <ExpenseDialog open={expOpen} onClose={() => setExpOpen(false)} defaultDate={today} />
      {editExp && <ExpenseDialog open onClose={() => setEditExp(null)} defaultDate={today} expense={editExp} />}
      {payFor && <ExpenseDialog open onClose={() => setPayFor(null)} defaultDate={today} bill={payFor} />}
      <BillDialog open={billOpen} onClose={() => setBillOpen(false)} defaultDate={today} />
      {editBill && <BillDialog open onClose={() => setEditBill(null)} defaultDate={today} bill={editBill} />}
      <ConfirmDialog
        open={!!delExp} onClose={() => setDelExp(null)} danger confirmLabel="Hapus"
        title="Hapus catatan biaya ini?"
        body={delExp ? `${delExp.name} ${rupiah(delExp.amount)} akan dihapus dan tidak lagi memotong profit bersih. Bila biaya ini dibayar dari saldo channel, profit harian di ${formatDate(delExp.date)} dihitung ulang.` : ''}
        onConfirm={async () => { if (delExp) { await deleteExpense(db, delExp.id); setDelExp(null); bump(); toast('Biaya dihapus.') } }}
      />
      <ConfirmDialog
        open={!!delBill} onClose={() => setDelBill(null)} danger confirmLabel="Hapus"
        title="Hapus tagihan rutin?"
        body={delBill ? `${delBill.name} tidak lagi diingatkan. Catatan biaya yang sudah dibayar tetap ada.` : ''}
        onConfirm={async () => { if (delBill) { await deleteBill(db, delBill.id); setDelBill(null); bump(); toast('Tagihan dihapus.') } }}
      />
    </div>
  )
}
