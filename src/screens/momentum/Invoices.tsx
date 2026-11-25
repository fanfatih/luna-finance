import { useState } from 'react'
import { Plus, Settings2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import { Badge, Button, EmptyState, ErrorState, Loading, PageHeader, Segmented, Table, TD, TH } from '@/components/ui'
import { listInvoices } from '@/db/momentum'
import { formatDate, todayStr } from '@/lib/date'
import { invoiceKindLabel, invoiceState } from '@/lib/momentum'
import { rupiah } from '@/lib/money'
import { IdentityDialog, InvoiceDetailDialog, InvoiceFormDialog } from './invoice-dialogs'

type Filter = 'semua' | 'draft' | 'terkirim' | 'lunas' | 'batal'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'semua', label: 'Semua' },
  { value: 'draft', label: 'Draft' },
  { value: 'terkirim', label: 'Menunggu bayar' },
  { value: 'lunas', label: 'Lunas' },
  { value: 'batal', label: 'Dibatalkan' },
]

export function Invoices() {
  const { db } = useApp()
  const today = todayStr()
  const [filter, setFilter] = useState<Filter>('semua')
  const [newOpen, setNewOpen] = useState(false)
  const [identOpen, setIdentOpen] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)
  const data = useAsync(() => listInvoices(db), [])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  const all = data.data ?? []
  const rows = filter === 'semua' ? all : all.filter((v) => v.status === filter)
  const waiting = all.filter((v) => v.status === 'terkirim')
  const waitingSum = waiting.reduce((a, v) => a + v.amount, 0)

  return (
    <div>
      <PageHeader
        title="Invoice klien"
        subtitle={waiting.length > 0 ? `${waiting.length} invoice menunggu pembayaran, total ${rupiah(waitingSum)}.` : 'Tagihan DP dan pelunasan untuk klien, lengkap dengan PDF dan pesan WhatsApp.'}
        actions={
          <>
            <Button onClick={() => setIdentOpen(true)}><Settings2 className="size-4" aria-hidden="true" /> Identitas invoice</Button>
            <Button variant="primary" onClick={() => setNewOpen(true)}><Plus className="size-4" aria-hidden="true" /> Invoice baru</Button>
          </>
        }
      />

      {all.length === 0 ? (
        <EmptyState
          title="Belum ada invoice"
          body="Isi dulu nama usaha, rekening, dan logo di Identitas invoice. Setelah itu buat invoice DP dari sebuah project, jumlahnya terisi otomatis."
          action={<Button variant="primary" onClick={() => setNewOpen(true)}>Buat invoice pertama</Button>}
        />
      ) : (
        <>
          <div className="mb-4"><Segmented label="Filter invoice" value={filter} onChange={setFilter} options={FILTERS} /></div>
          {rows.length === 0 ? (
            <EmptyState title="Tidak ada invoice di sini" body="Ganti filter untuk melihat invoice dengan status lain." />
          ) : (
            <Table label="Daftar invoice">
              <thead><tr><TH>Nomor</TH><TH>Klien</TH><TH>Jenis</TH><TH>Jatuh tempo</TH><TH right>Jumlah</TH><TH>Status</TH></tr></thead>
              <tbody>
                {rows.map((v) => {
                  const st = invoiceState(v.status, v.due_date, today)
                  return (
                    <tr key={v.id} className="cursor-pointer transition-colors hover:bg-subtle" onClick={() => setViewId(v.id)}>
                      <TD>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setViewId(v.id) }} className="num text-left font-medium hover:underline">{v.number}</button>
                      </TD>
                      <TD>
                        <div className="font-medium">{v.client_name}</div>
                        <div className="text-[13px] text-muted">{v.project_name}</div>
                      </TD>
                      <TD>{invoiceKindLabel(v.kind)}</TD>
                      <TD className="whitespace-nowrap">{formatDate(v.due_date)}</TD>
                      <TD right><span className="num">{rupiah(v.amount)}</span></TD>
                      <TD><Badge tone={st.tone}>{st.label}</Badge></TD>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </>
      )}

      <InvoiceFormDialog open={newOpen} onClose={() => setNewOpen(false)} onSaved={setViewId} />
      <IdentityDialog open={identOpen} onClose={() => setIdentOpen(false)} />
      {viewId && <InvoiceDetailDialog id={viewId} onClose={() => setViewId(null)} />}
    </div>
  )
}
