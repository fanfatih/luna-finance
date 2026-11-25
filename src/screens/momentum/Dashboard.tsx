import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Badge, Button, Card, EmptyState, ErrorState, Loading, Money, PageHeader, Stagger, StaggerItem,
} from '@/components/ui'
import { momDashboard } from '@/db/momentum'
import { diffDays, formatDate, monthLabel, todayStr } from '@/lib/date'
import { invoiceState } from '@/lib/momentum'
import { rupiah } from '@/lib/money'
import { daysText, PayBadge, StageBadge } from './parts'
import { ProjectDialog } from './project-dialogs'

export function Dashboard() {
  const { db, go } = useApp()
  const today = todayStr()
  const [newOpen, setNewOpen] = useState(false)
  const data = useAsync(() => momDashboard(db, today), [today])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  if (!data.data) return null
  const d = data.data
  const ym = today.slice(0, 7)

  return (
    <div>
      <PageHeader
        title="Momentum"
        subtitle={`Ringkasan ${monthLabel(ym)}. Uang masuk dihitung dari pembayaran klien yang dicatat.`}
        actions={<Button variant="primary" onClick={() => setNewOpen(true)}><Plus className="size-4" aria-hidden="true" /> Project baru</Button>}
      />

      {d.projectCount === 0 ? (
        <EmptyState
          title="Belum ada project"
          body="Catat project klien beserta paketnya, lalu buat invoice DP dan pelunasan dari sana. Acara dan tenggat serah hasil otomatis masuk ke kalender Pribadi."
          action={<Button variant="primary" onClick={() => setNewOpen(true)}>Buat project pertama</Button>}
        />
      ) : (
        <Stagger>
          <StaggerItem>
            <section aria-label="Ringkasan bulan ini" className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="p-5">
                <p className="text-muted">Uang masuk</p>
                <Money value={d.income} countUp className="mt-1 block text-2xl font-semibold" />
                <p className="mt-1 text-[13px] text-muted">Pembayaran klien bulan ini.</p>
              </Card>
              <Card className="p-5">
                <p className="text-muted">Biaya</p>
                <Money value={d.costs} countUp className="mt-1 block text-2xl font-semibold" />
                <p className="mt-1 text-[13px] text-muted">Biaya project dan operasional.</p>
              </Card>
              <Card className="p-5">
                <p className="text-muted">Piutang klien</p>
                <Money value={d.receivable} countUp className="mt-1 block text-2xl font-semibold" />
                <p className="mt-1 text-[13px] text-muted">{d.receivableCount} project belum lunas.</p>
              </Card>
              <Card className="p-5">
                <p className="text-muted">Project</p>
                <span className="num mt-1 block text-2xl font-semibold">{d.projectCount}</span>
                <p className="mt-1 text-[13px] text-muted">{d.upcoming.length} acara akan datang.</p>
              </Card>
            </section>
          </StaggerItem>

          <StaggerItem>
            <div className="grid gap-4 lg:grid-cols-2">
              <section aria-labelledby="mom-upcoming">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 id="mom-upcoming" className="text-lg font-semibold">Acara mendatang</h2>
                  <Button size="sm" onClick={() => go({ name: 'momentum', tab: 'project' })}>Semua project</Button>
                </div>
                {d.upcoming.length === 0 ? (
                  <Card className="p-5"><p className="text-muted">Tidak ada acara yang menunggu. Isi tanggal acara di project supaya muncul di sini dan di kalender.</p></Card>
                ) : (
                  <Card>
                    <ul className="divide-y divide-line">
                      {d.upcoming.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => go({ name: 'momentum', tab: 'project', id: p.id })}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{p.name}</span>
                              <span className="block truncate text-[13px] text-muted">
                                {p.client_name}. {formatDate(p.event_date!)}, {daysText(diffDays(today, p.event_date!)).toLowerCase()}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              <StageBadge stage={p.stage} />
                              <PayBadge total={p.total} paid={p.paid} />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </section>

              <section aria-labelledby="mom-outstanding">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 id="mom-outstanding" className="text-lg font-semibold">Invoice menunggu bayar</h2>
                  <Button size="sm" onClick={() => go({ name: 'momentum', tab: 'invoice' })}>Semua invoice</Button>
                </div>
                {d.outstanding.length === 0 ? (
                  <Card className="p-5"><p className="text-muted">Tidak ada invoice yang menunggu pembayaran.</p></Card>
                ) : (
                  <Card>
                    <ul className="divide-y divide-line">
                      {d.outstanding.map((v) => {
                        const st = invoiceState(v.status, v.due_date, today)
                        return (
                          <li key={v.id}>
                            <button
                              type="button"
                              onClick={() => go({ name: 'momentum', tab: 'invoice' })}
                              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{v.client_name}</span>
                                <span className="num block truncate text-[13px] text-muted">{v.number}. Tempo {formatDate(v.due_date)}</span>
                              </span>
                              <span className="flex shrink-0 flex-col items-end gap-1">
                                <span className="num font-medium">{rupiah(v.amount)}</span>
                                <Badge tone={st.tone}>{st.label}</Badge>
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </Card>
                )}
              </section>
            </div>
          </StaggerItem>
        </Stagger>
      )}

      <ProjectDialog
        open={newOpen} onClose={() => setNewOpen(false)}
        onSaved={(id) => go({ name: 'momentum', tab: 'project', id })}
      />
    </div>
  )
}
