import { useState } from 'react'
import { ArrowLeft, Pencil, Plus, ReceiptText, Settings2, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Loading, Money, PageHeader, Segmented, Select, Table, TD, TH,
  useToast,
} from '@/components/ui'
import {
  deleteMomExpense, deletePayment, deleteProject, getProjectRow, listItems, listProjectExpenses, listProjectInvoices,
  listProjectPayments, listProjects, paymentKindLabel, setStage, type Invoice, type MomExpense, type Payment,
} from '@/db/momentum'
import { formatDate, todayStr } from '@/lib/date'
import { invoiceKindLabel, invoiceState, momCategoryLabel, remaining, STAGES } from '@/lib/momentum'
import { rupiah } from '@/lib/money'
import { IdentityDialog, InvoiceDetailDialog, InvoiceFormDialog } from './invoice-dialogs'
import { PayBadge, StageBadge } from './parts'
import { MomExpenseDialog, PaymentDialog, ProjectDialog } from './project-dialogs'

type Filter = 'jalan' | 'selesai' | 'batal' | 'semua'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'jalan', label: 'Berjalan' },
  { value: 'selesai', label: 'Selesai' },
  { value: 'batal', label: 'Batal' },
  { value: 'semua', label: 'Semua' },
]

const inFilter = (stage: string, f: Filter) =>
  f === 'semua' ? true : f === 'jalan' ? stage === 'inquiry' || stage === 'booking' || stage === 'produksi' : stage === f

export function Projects({ openId }: { openId?: string }) {
  return openId ? <ProjectDetail id={openId} /> : <ProjectList />
}

/* ---------- Daftar ---------- */

function ProjectList() {
  const { db, go } = useApp()
  const [filter, setFilter] = useState<Filter>('jalan')
  const [newOpen, setNewOpen] = useState(false)
  const data = useAsync(() => listProjects(db), [])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  const all = data.data ?? []
  const rows = all.filter((p) => inFilter(p.stage, filter))
  const open = (id: string) => go({ name: 'momentum', tab: 'project', id })

  return (
    <div>
      <PageHeader
        title="Project"
        subtitle="Setiap klien dan acaranya, dari inquiry sampai selesai."
        actions={<Button variant="primary" onClick={() => setNewOpen(true)}><Plus className="size-4" aria-hidden="true" /> Project baru</Button>}
      />

      {all.length === 0 ? (
        <EmptyState
          title="Belum ada project"
          body="Mulai dari klien pertama. Isi paket dan harganya, nanti invoice DP dan pelunasan dibuat dari data ini."
          action={<Button variant="primary" onClick={() => setNewOpen(true)}>Buat project pertama</Button>}
        />
      ) : (
        <>
          <div className="mb-4">
            <Segmented label="Tampilkan project" value={filter} onChange={setFilter} options={FILTERS} />
          </div>
          {rows.length === 0 ? (
            <EmptyState title="Tidak ada project di sini" body="Ganti filter untuk melihat project dengan tahap lain." />
          ) : (
            <Table label="Daftar project">
              <thead>
                <tr><TH>Project</TH><TH>Acara</TH><TH>Tahap</TH><TH right>Nilai</TH><TH>Pembayaran</TH></tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="cursor-pointer transition-colors hover:bg-subtle" onClick={() => open(p.id)}>
                    <TD>
                      <button
                        type="button" onClick={(e) => { e.stopPropagation(); open(p.id) }}
                        className="text-left font-medium hover:underline"
                      >
                        {p.name}
                      </button>
                      <div className="text-[13px] text-muted">{p.client_name}</div>
                    </TD>
                    <TD className="whitespace-nowrap">{p.event_date ? formatDate(p.event_date) : <span className="text-muted">Belum ada tanggal</span>}</TD>
                    <TD><StageBadge stage={p.stage} /></TD>
                    <TD right><span className="num">{rupiah(p.total)}</span></TD>
                    <TD>
                      <div className="flex flex-col items-start gap-1">
                        <PayBadge total={p.total} paid={p.paid} />
                        {p.total > 0 && p.paid > 0 && remaining(p.total, p.paid) > 0 && (
                          <span className="num text-[13px] text-muted">sisa {rupiah(remaining(p.total, p.paid))}</span>
                        )}
                      </div>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}

      <ProjectDialog open={newOpen} onClose={() => setNewOpen(false)} onSaved={open} />
    </div>
  )
}

/* ---------- Rincian satu project ---------- */

function ProjectDetail({ id }: { id: string }) {
  const { db, go, bump } = useApp()
  const toast = useToast()
  const today = todayStr()
  const [editOpen, setEditOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [editPay, setEditPay] = useState<Payment | null>(null)
  const [delPay, setDelPay] = useState<Payment | null>(null)
  const [costOpen, setCostOpen] = useState(false)
  const [editCost, setEditCost] = useState<MomExpense | null>(null)
  const [delCost, setDelCost] = useState<MomExpense | null>(null)
  const [invOpen, setInvOpen] = useState(false)
  const [viewInv, setViewInv] = useState<string | null>(null)
  const [identOpen, setIdentOpen] = useState(false)

  const data = useAsync(async () => {
    const [row, items, payments, costs, invoices] = await Promise.all([
      getProjectRow(db, id), listItems(db, id), listProjectPayments(db, id), listProjectExpenses(db, id), listProjectInvoices(db, id),
    ])
    return { row, items, payments, costs, invoices }
  }, [id])

  const toList = () => go({ name: 'momentum', tab: 'project' })

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  if (!data.data) return null
  const { row: p, items, payments, costs, invoices } = data.data
  if (!p) {
    return (
      <EmptyState
        title="Project tidak ditemukan"
        body="Project ini sudah dihapus, mungkin dari perangkat lain."
        action={<Button variant="primary" onClick={toList}>Kembali ke daftar project</Button>}
      />
    )
  }

  const owed = remaining(p.total, p.paid)
  const profit = p.total - p.cost
  const margin = p.total > 0 ? Math.round((profit / p.total) * 100) : null

  const changeStage = async (stage: string) => {
    try {
      await setStage(db, p.id, stage)
      bump()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengubah tahap.', 'error')
    }
  }

  return (
    <div>
      <button
        type="button" onClick={toList}
        className="mb-3 inline-flex items-center gap-1.5 text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Semua project
      </button>
      <PageHeader
        title={p.name}
        subtitle={`${p.client_name}${p.event_date ? `. Acara ${formatDate(p.event_date)}${p.venue ? ` di ${p.venue}` : ''}` : ''}`}
        actions={
          <>
            <Button onClick={() => setEditOpen(true)}><Pencil className="size-4" aria-hidden="true" /> Ubah</Button>
            <Button variant="danger" onClick={() => setDelOpen(true)}><Trash2 className="size-4" aria-hidden="true" /> Hapus</Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-muted">Tahap</span>
          <Select aria-label="Tahap project" value={p.stage} onChange={(e) => changeStage(e.target.value)} className="h-9 w-40">
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </label>
        {p.deliver_by && <span className="text-muted">Serah hasil paling lambat {formatDate(p.deliver_by)}</span>}
        {p.client_contact && <span className="text-muted">Kontak {p.client_contact}</span>}
      </div>
      {p.note && <p className="mb-5 rounded-lg bg-subtle px-4 py-3 text-muted">{p.note}</p>}

      <section aria-label="Ringkasan project" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="text-muted">Nilai project</p>
          <Money value={p.total} className="mt-1 block text-2xl font-semibold" />
          <p className="mt-1 text-[13px] text-muted">{p.discount > 0 ? `Sudah dipotong diskon ${rupiah(p.discount)}.` : `${items.length} item.`}</p>
        </Card>
        <Card className="p-5">
          <p className="text-muted">Sudah dibayar</p>
          <Money value={p.paid} className="mt-1 block text-2xl font-semibold" />
          <div className="mt-1.5"><PayBadge total={p.total} paid={p.paid} /></div>
        </Card>
        <Card className="p-5">
          <p className="text-muted">Sisa tagihan</p>
          <Money value={owed} className="mt-1 block text-2xl font-semibold" />
          <p className="mt-1 text-[13px] text-muted">{p.paid > p.total ? `Kelebihan bayar ${rupiah(p.paid - p.total)}.` : owed === 0 && p.total > 0 ? 'Sudah lunas.' : p.paid === 0 ? 'Belum ada pembayaran masuk.' : 'Sisa yang belum dibayar klien.'}</p>
        </Card>
        <Card className="p-5">
          <p className="text-muted">Laba project</p>
          <Money value={profit} signed className="mt-1 block text-2xl font-semibold" />
          <p className="mt-1 text-[13px] text-muted">
            Nilai dikurangi biaya {rupiah(p.cost)}{margin !== null ? `, margin ${margin}%` : ''}.
          </p>
        </Card>
      </section>

      <section aria-labelledby="pd-items" className="mb-8">
        <h2 id="pd-items" className="mb-3 text-lg font-semibold">Paket dan item</h2>
        {items.length === 0 ? (
          <EmptyState title="Belum ada item" body="Tambahkan paket yang dijual lewat tombol Ubah, supaya nilai project dan invoice terisi." action={<Button onClick={() => setEditOpen(true)}>Ubah project</Button>} />
        ) : (
          <Table label="Item project">
            <thead><tr><TH>Item</TH><TH right>Jumlah</TH><TH right>Harga satuan</TH><TH right>Total</TH></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <TD>{i.name}</TD>
                  <TD right><span className="num">{i.qty}</span></TD>
                  <TD right><span className="num">{rupiah(i.unit_price)}</span></TD>
                  <TD right><span className="num">{rupiah(i.qty * i.unit_price)}</span></TD>
                </tr>
              ))}
              {p.discount > 0 && (
                <tr>
                  <TD colSpan={3} className="text-muted">Diskon</TD>
                  <TD right><span className="num">-{rupiah(p.discount)}</span></TD>
                </tr>
              )}
              <tr>
                <TD colSpan={3} className="font-semibold">Nilai project</TD>
                <TD right><span className="num font-semibold">{rupiah(p.total)}</span></TD>
              </tr>
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="pd-inv" className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="pd-inv" className="text-lg font-semibold">Invoice</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setIdentOpen(true)}><Settings2 className="size-4" aria-hidden="true" /> Identitas invoice</Button>
            <Button variant="primary" onClick={() => setInvOpen(true)} disabled={p.total === 0} title={p.total === 0 ? 'Isi item project dulu' : undefined}>
              <ReceiptText className="size-4" aria-hidden="true" /> Buat invoice
            </Button>
          </div>
        </div>
        {invoices.length === 0 ? (
          <Card className="p-5"><p className="text-muted">Belum ada invoice. Buat invoice DP lebih dulu, lalu pelunasan setelah acara.</p></Card>
        ) : (
          <InvoiceTable invoices={invoices} today={today} onOpen={setViewInv} />
        )}
      </section>

      <section aria-labelledby="pd-pay" className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="pd-pay" className="text-lg font-semibold">Pembayaran klien</h2>
          <Button onClick={() => setPayOpen(true)}><Plus className="size-4" aria-hidden="true" /> Catat pembayaran</Button>
        </div>
        {payments.length === 0 ? (
          <Card className="p-5"><p className="text-muted">Belum ada pembayaran. Menandai invoice lunas otomatis mencatat pembayarannya di sini.</p></Card>
        ) : (
          <Table label="Pembayaran klien">
            <thead><tr><TH>Tanggal</TH><TH>Jenis</TH><TH right>Nominal</TH><TH right>Aksi</TH></tr></thead>
            <tbody>
              {payments.map((a) => (
                <tr key={a.id}>
                  <TD className="whitespace-nowrap">{formatDate(a.date)}</TD>
                  <TD>
                    {paymentKindLabel(a.kind)}
                    {a.note && <div className="text-[13px] text-muted">{a.note}</div>}
                  </TD>
                  <TD right><span className="num">{rupiah(a.amount)}</span></TD>
                  <TD right>
                    <div className="flex justify-end gap-1">
                      <IconButton label={`Ubah pembayaran ${formatDate(a.date)}`} className="size-8" onClick={() => setEditPay(a)}><Pencil className="size-4" aria-hidden="true" /></IconButton>
                      <IconButton label={`Hapus pembayaran ${formatDate(a.date)}`} className="size-8" onClick={() => setDelPay(a)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="pd-cost">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="pd-cost" className="text-lg font-semibold">Biaya project</h2>
          <Button onClick={() => setCostOpen(true)}><Plus className="size-4" aria-hidden="true" /> Catat biaya</Button>
        </div>
        {costs.length === 0 ? (
          <Card className="p-5"><p className="text-muted">Belum ada biaya. Catat honor crew, transport, atau sewa alat untuk melihat laba sebenarnya.</p></Card>
        ) : (
          <Table label="Biaya project">
            <thead><tr><TH>Tanggal</TH><TH>Biaya</TH><TH>Kategori</TH><TH right>Nominal</TH><TH right>Aksi</TH></tr></thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id}>
                  <TD className="whitespace-nowrap">{formatDate(c.date)}</TD>
                  <TD>
                    <div className="font-medium">{c.name}</div>
                    {c.note && <div className="text-[13px] text-muted">{c.note}</div>}
                  </TD>
                  <TD>{momCategoryLabel(c.category)}</TD>
                  <TD right><span className="num">{rupiah(c.amount)}</span></TD>
                  <TD right>
                    <div className="flex justify-end gap-1">
                      <IconButton label={`Ubah biaya ${c.name}`} className="size-8" onClick={() => setEditCost(c)}><Pencil className="size-4" aria-hidden="true" /></IconButton>
                      <IconButton label={`Hapus biaya ${c.name}`} className="size-8" onClick={() => setDelCost(c)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <ProjectDialog open={editOpen} onClose={() => setEditOpen(false)} project={p} />
      <PaymentDialog open={payOpen} onClose={() => setPayOpen(false)} projectId={p.id} suggestKind={p.paid === 0 ? 'dp' : 'pelunasan'} suggestAmount={owed} />
      {editPay && <PaymentDialog open onClose={() => setEditPay(null)} projectId={p.id} payment={editPay} />}
      <MomExpenseDialog open={costOpen} onClose={() => setCostOpen(false)} projectId={p.id} />
      {editCost && <MomExpenseDialog open onClose={() => setEditCost(null)} projectId={p.id} expense={editCost} />}
      <InvoiceFormDialog open={invOpen} onClose={() => setInvOpen(false)} projectId={p.id} onSaved={setViewInv} />
      {viewInv && <InvoiceDetailDialog id={viewInv} onClose={() => setViewInv(null)} />}
      <IdentityDialog open={identOpen} onClose={() => setIdentOpen(false)} />

      <ConfirmDialog
        open={delOpen} onClose={() => setDelOpen(false)} danger confirmLabel="Hapus project"
        title="Hapus project ini?"
        body={`${p.name} beserta item dan invoicenya akan dihapus, dan acaranya hilang dari kalender. Project yang sudah punya pembayaran atau biaya tidak bisa dihapus, ubah tahapnya jadi Batal.`}
        onConfirm={async () => {
          try {
            await deleteProject(db, p.id)
            setDelOpen(false)
            bump()
            toast('Project dihapus.')
            toList()
          } catch (e) {
            setDelOpen(false)
            toast(e instanceof Error ? e.message : 'Gagal menghapus.', 'error')
          }
        }}
      />
      <ConfirmDialog
        open={!!delPay} onClose={() => setDelPay(null)} danger confirmLabel="Hapus"
        title="Hapus pembayaran ini?"
        body={delPay ? `Pembayaran ${rupiah(delPay.amount)} tanggal ${formatDate(delPay.date)} dihapus dari project.${delPay.invoice_id ? ' Invoice yang ditandai lunas dari pembayaran ini kembali jadi Terkirim.' : ''}` : ''}
        onConfirm={async () => { if (delPay) { await deletePayment(db, delPay.id); setDelPay(null); bump(); toast('Pembayaran dihapus.') } }}
      />
      <ConfirmDialog
        open={!!delCost} onClose={() => setDelCost(null)} danger confirmLabel="Hapus"
        title="Hapus biaya ini?"
        body={delCost ? `${delCost.name} ${rupiah(delCost.amount)} dihapus dan tidak lagi mengurangi laba project.` : ''}
        onConfirm={async () => { if (delCost) { await deleteMomExpense(db, delCost.id); setDelCost(null); bump(); toast('Biaya dihapus.') } }}
      />
    </div>
  )
}

/** Tabel invoice satu project. */
function InvoiceTable({ invoices, today, onOpen }: { invoices: Invoice[]; today: string; onOpen: (id: string) => void }) {
  return (
    <Table label="Invoice project">
      <thead><tr><TH>Nomor</TH><TH>Jenis</TH><TH>Jatuh tempo</TH><TH right>Jumlah</TH><TH>Status</TH></tr></thead>
      <tbody>
        {invoices.map((v) => {
          const st = invoiceState(v.status, v.due_date, today)
          return (
            <tr key={v.id}>
              <TD>
                <button type="button" onClick={() => onOpen(v.id)} className="num text-left font-medium hover:underline">{v.number}</button>
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
  )
}
