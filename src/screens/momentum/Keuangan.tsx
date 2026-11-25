import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Loading, Money, PageHeader, Table, TD, TH, useToast,
} from '@/components/ui'
import {
  deleteMomExpense, deletePayment, listMomExpenses, listPayments, monthCosts, monthIncome, paymentKindLabel,
  type MomExpense, type Payment,
} from '@/db/momentum'
import { formatDate, monthLabel, todayStr } from '@/lib/date'
import { momCategoryLabel } from '@/lib/momentum'
import { rupiah } from '@/lib/money'
import { MonthNav } from './parts'
import { MomExpenseDialog, PaymentDialog } from './project-dialogs'

export function Keuangan() {
  const { db, bump, go } = useApp()
  const toast = useToast()
  const [month, setMonth] = useState(todayStr().slice(0, 7))
  const [payOpen, setPayOpen] = useState(false)
  const [editPay, setEditPay] = useState<Payment | null>(null)
  const [delPay, setDelPay] = useState<Payment | null>(null)
  const [costOpen, setCostOpen] = useState(false)
  const [editCost, setEditCost] = useState<MomExpense | null>(null)
  const [delCost, setDelCost] = useState<MomExpense | null>(null)

  const data = useAsync(async () => {
    const from = month + '-01'
    const to = month + '-31'
    const [payments, expenses, costs, income] = await Promise.all([
      listPayments(db, from, to), listMomExpenses(db, from, to), monthCosts(db, month), monthIncome(db, month),
    ])
    return { payments, expenses, costs, income }
  }, [month])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  if (!data.data) return null
  const { payments, expenses, costs, income } = data.data
  const net = income - costs.total
  const paidOut = expenses.reduce((a, e) => a + e.amount, 0)

  return (
    <div>
      <PageHeader
        title="Keuangan"
        subtitle="Arus kas Momentum: uang masuk dari klien dan biaya yang keluar, per bulan."
        actions={
          <>
            <Button onClick={() => setCostOpen(true)}><Plus className="size-4" aria-hidden="true" /> Catat biaya</Button>
            <Button variant="primary" onClick={() => setPayOpen(true)}><Plus className="size-4" aria-hidden="true" /> Catat pembayaran</Button>
          </>
        }
      />

      <div className="mb-4"><MonthNav month={month} onChange={setMonth} /></div>

      <section aria-label={`Ringkasan ${monthLabel(month)}`} className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-muted">Uang masuk</p>
          <Money value={income} className="mt-1 block text-2xl font-semibold" />
          <p className="mt-1 text-[13px] text-muted">{payments.length} pembayaran klien.</p>
        </Card>
        <Card className="p-5">
          <p className="text-muted">Biaya</p>
          <span className="num mt-1 block text-2xl font-semibold">{costs.total > 0 ? `-${rupiah(costs.total)}` : rupiah(0)}</span>
          <p className="mt-1 text-[13px] text-muted">
            {costs.total === paidOut ? `${expenses.length} catatan biaya.` : 'Termasuk bagian bulan ini dari biaya yang dibagi 12 bulan.'}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-muted">Selisih bulan ini</p>
          <Money value={net} signed className="mt-1 block text-2xl font-semibold" />
          <p className="mt-1 text-[13px] text-muted">Uang masuk dikurangi biaya.</p>
        </Card>
      </section>

      <section aria-labelledby="kk-in" className="mb-8">
        <h2 id="kk-in" className="mb-3 text-lg font-semibold">Uang masuk</h2>
        {payments.length === 0 ? (
          <EmptyState
            title={`Belum ada uang masuk di ${monthLabel(month)}`}
            body="Catat pembayaran klien di sini, atau tandai invoice lunas dan pembayarannya tercatat otomatis."
            action={<Button variant="primary" onClick={() => setPayOpen(true)}>Catat pembayaran</Button>}
          />
        ) : (
          <Table label={`Uang masuk ${monthLabel(month)}`}>
            <thead><tr><TH>Tanggal</TH><TH>Project</TH><TH>Jenis</TH><TH right>Nominal</TH><TH right>Aksi</TH></tr></thead>
            <tbody>
              {payments.map((a) => (
                <tr key={a.id}>
                  <TD className="whitespace-nowrap">{formatDate(a.date)}</TD>
                  <TD>
                    <button type="button" onClick={() => go({ name: 'momentum', tab: 'project', id: a.project_id })} className="text-left font-medium hover:underline">{a.project_name}</button>
                    {a.note && <div className="text-[13px] text-muted">{a.note}</div>}
                  </TD>
                  <TD>{paymentKindLabel(a.kind)}</TD>
                  <TD right><span className="num">{rupiah(a.amount)}</span></TD>
                  <TD right>
                    <div className="flex justify-end gap-1">
                      <IconButton label={`Ubah pembayaran ${a.project_name}`} className="size-8" onClick={() => setEditPay(a)}><Pencil className="size-4" aria-hidden="true" /></IconButton>
                      <IconButton label={`Hapus pembayaran ${a.project_name}`} className="size-8" onClick={() => setDelPay(a)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="kk-out">
        <h2 id="kk-out" className="mb-3 text-lg font-semibold">Biaya</h2>
        {costs.byCategory.length > 0 && (
          <Card className="mb-4 p-5">
            <p className="text-muted">Biaya per kategori</p>
            <ul className="mt-2 divide-y divide-line border-t border-line">
              {costs.byCategory.map((c) => (
                <li key={c.category} className="flex items-center justify-between py-1.5">
                  <span className="text-muted">{momCategoryLabel(c.category)}</span>
                  <span className="num">{rupiah(c.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {expenses.length === 0 ? (
          <EmptyState
            title={`Belum ada biaya di ${monthLabel(month)}`}
            body="Catat honor crew, sewa alat, transport, atau langganan. Biaya yang dikaitkan ke project mengurangi laba project itu."
            action={<Button variant="primary" onClick={() => setCostOpen(true)}>Catat biaya</Button>}
          />
        ) : (
          <Table label={`Biaya ${monthLabel(month)}`}>
            <thead><tr><TH>Tanggal</TH><TH>Biaya</TH><TH>Kategori</TH><TH>Untuk</TH><TH right>Nominal</TH><TH right>Aksi</TH></tr></thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <TD className="whitespace-nowrap">{formatDate(e.date)}</TD>
                  <TD>
                    <div className="font-medium">{e.name}</div>
                    {e.note && <div className="text-[13px] text-muted">{e.note}</div>}
                  </TD>
                  <TD>{momCategoryLabel(e.category)}</TD>
                  <TD>
                    {e.project_id
                      ? <button type="button" onClick={() => go({ name: 'momentum', tab: 'project', id: e.project_id! })} className="text-left hover:underline">{e.project_name}</button>
                      : <span className="text-muted">Biaya umum</span>}
                  </TD>
                  <TD right>
                    <span className="num">{rupiah(e.amount)}</span>
                    {e.spread_months === 12 && <div className="text-[13px] text-muted">dibagi 12 bulan</div>}
                  </TD>
                  <TD right>
                    <div className="flex justify-end gap-1">
                      <IconButton label={`Ubah biaya ${e.name}`} className="size-8" onClick={() => setEditCost(e)}><Pencil className="size-4" aria-hidden="true" /></IconButton>
                      <IconButton label={`Hapus biaya ${e.name}`} className="size-8" onClick={() => setDelCost(e)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <PaymentDialog open={payOpen} onClose={() => setPayOpen(false)} />
      {editPay && <PaymentDialog open onClose={() => setEditPay(null)} payment={editPay} />}
      <MomExpenseDialog open={costOpen} onClose={() => setCostOpen(false)} />
      {editCost && <MomExpenseDialog open onClose={() => setEditCost(null)} expense={editCost} />}
      <ConfirmDialog
        open={!!delPay} onClose={() => setDelPay(null)} danger confirmLabel="Hapus"
        title="Hapus pembayaran ini?"
        body={delPay ? `Pembayaran ${rupiah(delPay.amount)} dari ${delPay.project_name} tanggal ${formatDate(delPay.date)} dihapus.${delPay.invoice_id ? ' Invoice yang ditandai lunas dari pembayaran ini kembali jadi Terkirim.' : ''}` : ''}
        onConfirm={async () => { if (delPay) { await deletePayment(db, delPay.id); setDelPay(null); bump(); toast('Pembayaran dihapus.') } }}
      />
      <ConfirmDialog
        open={!!delCost} onClose={() => setDelCost(null)} danger confirmLabel="Hapus"
        title="Hapus biaya ini?"
        body={delCost ? `${delCost.name} ${rupiah(delCost.amount)} dihapus dan tidak lagi mengurangi laba.` : ''}
        onConfirm={async () => { if (delCost) { await deleteMomExpense(db, delCost.id); setDelCost(null); bump(); toast('Biaya dihapus.') } }}
      />
    </div>
  )
}
