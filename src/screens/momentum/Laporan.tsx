import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Button, Card, EmptyState, ErrorState, IconButton, Loading, Money, PageHeader, Segmented, Table, TD, TH, useToast,
} from '@/components/ui'
import { monthCosts, monthIncome, projectsByEventDate, yearFigures } from '@/db/momentum'
import { addDays, formatDate, monthLabel, todayStr } from '@/lib/date'
import { shiftYm } from '@/lib/expense'
import { momCategoryLabel } from '@/lib/momentum'
import { marginPct, projectsCsv, yearCsv } from '@/lib/momentumCsv'
import { rupiah } from '@/lib/money'
import { saveTextFile } from '@/lib/platform'
import { MonthNav, StageBadge } from './parts'

type View = 'bulan' | 'tahun'

const lastDay = (ym: string) => addDays(shiftYm(ym, 1) + '-01', -1)
const pct = (n: number | null) => (n === null ? '-' : `${n}%`)

export function Laporan() {
  const { db, go } = useApp()
  const toast = useToast()
  const [view, setView] = useState<View>('bulan')
  const [month, setMonth] = useState(todayStr().slice(0, 7))
  const [year, setYear] = useState(Number(todayStr().slice(0, 4)))

  const monthData = useAsync(async () => {
    if (view !== 'bulan') return null
    const [income, costs, projects] = await Promise.all([
      monthIncome(db, month), monthCosts(db, month), projectsByEventDate(db, month + '-01', lastDay(month)),
    ])
    return { income, costs, projects }
  }, [month, view])

  const yearData = useAsync(async () => {
    if (view !== 'tahun') return null
    const [months, projects] = await Promise.all([yearFigures(db, year), projectsByEventDate(db, `${year}-01-01`, `${year}-12-31`)])
    return { months, projects }
  }, [year, view])

  const m = monthData.data
  const y = yearData.data
  const yIncome = y?.months.reduce((a, r) => a + r.income, 0) ?? 0
  const yCosts = y?.months.reduce((a, r) => a + r.costs, 0) ?? 0

  const projects = (view === 'bulan' ? m?.projects : y?.projects) ?? []
  const canExport = view === 'bulan' ? !!m && (m.income > 0 || m.costs.total > 0 || m.projects.length > 0) : !!y && (yIncome > 0 || yCosts > 0 || y.projects.length > 0)

  const exportCsv = async () => {
    try {
      const ok = view === 'bulan'
        ? await saveTextFile(`laporan-momentum-project-${month}.csv`, projectsCsv(projects), 'text/csv')
        : await saveTextFile(`laporan-momentum-${year}.csv`, yearCsv(y?.months ?? []), 'text/csv')
      if (ok) toast('Laporan diekspor.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengekspor.', 'error')
    }
  }

  const projectTable = (label: string) => (
    <Table label={label}>
      <thead>
        <tr><TH>Project</TH><TH>Tahap</TH><TH right>Nilai</TH><TH right>Dibayar</TH><TH right>Biaya</TH><TH right>Laba</TH><TH right>Margin</TH></tr>
      </thead>
      <tbody>
        {projects.map((p) => (
          <tr key={p.id}>
            <TD>
              <button type="button" onClick={() => go({ name: 'momentum', tab: 'project', id: p.id })} className="text-left font-medium hover:underline">{p.name}</button>
              <div className="text-[13px] text-muted">{p.client_name}. {p.event_date ? formatDate(p.event_date) : ''}</div>
            </TD>
            <TD><StageBadge stage={p.stage} /></TD>
            <TD right><span className="num">{rupiah(p.total)}</span></TD>
            <TD right><span className="num">{rupiah(p.paid)}</span></TD>
            <TD right><span className="num">{rupiah(p.cost)}</span></TD>
            <TD right><Money value={p.total - p.cost} signed /></TD>
            <TD right><span className="num">{pct(marginPct(p.total, p.cost))}</span></TD>
          </tr>
        ))}
      </tbody>
    </Table>
  )

  const projectNote = 'Tabel project dihitung per tanggal acara: laba = nilai project dikurangi biaya project. Angka uang masuk dan biaya di atas dihitung per tanggal bayar, jadi dua-duanya bisa berbeda.'

  return (
    <div>
      <PageHeader
        title="Laporan"
        subtitle="Uang masuk, biaya, dan laba Momentum, per bulan atau per tahun."
        actions={<Button onClick={exportCsv} disabled={!canExport}><Download className="size-4" aria-hidden="true" /> Ekspor CSV</Button>}
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented label="Periode laporan" value={view} onChange={setView} options={[{ value: 'bulan', label: 'Bulanan' }, { value: 'tahun', label: 'Tahunan' }]} />
        {view === 'bulan' ? (
          <MonthNav month={month} onChange={setMonth} />
        ) : (
          <div className="flex items-center gap-2">
            <IconButton label="Tahun sebelumnya" onClick={() => setYear(year - 1)} className="border border-line-strong"><ChevronLeft className="size-4" aria-hidden="true" /></IconButton>
            <span className="min-w-24 text-center font-semibold">{year}</span>
            <IconButton label="Tahun berikutnya" onClick={() => setYear(year + 1)} className="border border-line-strong"><ChevronRight className="size-4" aria-hidden="true" /></IconButton>
          </div>
        )}
      </div>

      {view === 'bulan' ? (
        monthData.loading && !m ? (
          <Loading />
        ) : monthData.error ? (
          <ErrorState message={monthData.error} onRetry={monthData.reload} />
        ) : !m || (m.income === 0 && m.costs.total === 0 && m.projects.length === 0) ? (
          <EmptyState
            title={`Belum ada data di ${monthLabel(month)}`}
            body="Laporan dibuat dari pembayaran klien, biaya, dan project yang acaranya jatuh di bulan ini."
            action={<Button variant="primary" onClick={() => go({ name: 'momentum', tab: 'project' })}>Buka project</Button>}
          />
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <Card className="p-5">
                <p className="text-muted">Uang masuk</p>
                <Money value={m.income} className="mt-1 block text-2xl font-semibold" />
              </Card>
              <Card className="p-5">
                <p className="text-muted">Biaya</p>
                <span className="num mt-1 block text-2xl font-semibold">{m.costs.total > 0 ? `-${rupiah(m.costs.total)}` : rupiah(0)}</span>
                <p className="mt-1 text-[13px] text-muted">Biaya tahunan dibagi rata ke 12 bulan.</p>
              </Card>
              <Card className="p-5">
                <p className="text-muted">Laba bersih</p>
                <Money value={m.income - m.costs.total} signed className="mt-1 block text-2xl font-semibold" />
                <p className="mt-1 text-[13px] text-muted">{m.income > 0 ? `Margin ${Math.round(((m.income - m.costs.total) / m.income) * 100)}% dari uang masuk.` : 'Belum ada uang masuk bulan ini.'}</p>
              </Card>
            </div>

            {m.costs.byCategory.length > 0 && (
              <Card className="mb-6 p-5">
                <p className="text-muted">Biaya per kategori</p>
                <ul className="mt-2 divide-y divide-line border-t border-line">
                  {m.costs.byCategory.map((c) => (
                    <li key={c.category} className="flex items-center justify-between py-1.5">
                      <span className="text-muted">{momCategoryLabel(c.category)}</span>
                      <span className="num">{rupiah(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <h2 className="mb-3 text-lg font-semibold">Project dengan acara di {monthLabel(month)}</h2>
            {m.projects.length === 0 ? (
              <Card className="p-5"><p className="text-muted">Tidak ada project dengan tanggal acara di bulan ini.</p></Card>
            ) : (
              <>
                {projectTable(`Project ${monthLabel(month)}`)}
                <p className="mt-3 text-[13px] text-muted">{projectNote}</p>
              </>
            )}
          </>
        )
      ) : yearData.loading && !y ? (
        <Loading />
      ) : yearData.error ? (
        <ErrorState message={yearData.error} onRetry={yearData.reload} />
      ) : !y || (yIncome === 0 && yCosts === 0 && y.projects.length === 0) ? (
        <EmptyState title={`Belum ada data di ${year}`} body="Laporan tahunan dijumlahkan dari pembayaran klien, biaya, dan project di tahun itu." />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Card className="p-5">
              <p className="text-muted">Uang masuk {year}</p>
              <Money value={yIncome} className="mt-1 block text-2xl font-semibold" />
            </Card>
            <Card className="p-5">
              <p className="text-muted">Biaya {year}</p>
              <span className="num mt-1 block text-2xl font-semibold">{yCosts > 0 ? `-${rupiah(yCosts)}` : rupiah(0)}</span>
            </Card>
            <Card className="p-5">
              <p className="text-muted">Laba bersih {year}</p>
              <Money value={yIncome - yCosts} signed className="mt-1 block text-2xl font-semibold" />
            </Card>
          </div>

          <Table label={`Rekap bulanan ${year}`}>
            <thead><tr><TH>Bulan</TH><TH right>Uang masuk</TH><TH right>Biaya</TH><TH right>Laba bersih</TH></tr></thead>
            <tbody>
              {y.months.map((r) => {
                const empty = r.income === 0 && r.costs === 0
                return (
                  <tr key={r.ym}>
                    <TD className="whitespace-nowrap">{monthLabel(r.ym).replace(` ${year}`, '')}</TD>
                    <TD right>{r.income > 0 ? <span className="num">{rupiah(r.income)}</span> : <span className="text-muted">-</span>}</TD>
                    <TD right>{r.costs > 0 ? <span className="num">-{rupiah(r.costs)}</span> : <span className="text-muted">-</span>}</TD>
                    <TD right>{empty ? <span className="text-muted">-</span> : <Money value={r.income - r.costs} signed className="font-semibold" />}</TD>
                  </tr>
                )
              })}
              <tr>
                <TD className="font-semibold">Total {year}</TD>
                <TD right><span className="num font-semibold">{rupiah(yIncome)}</span></TD>
                <TD right><span className="num font-semibold">{yCosts > 0 ? `-${rupiah(yCosts)}` : rupiah(0)}</span></TD>
                <TD right><Money value={yIncome - yCosts} signed className="font-semibold" /></TD>
              </tr>
            </tbody>
          </Table>

          {y.projects.length > 0 && (
            <>
              <h2 className="mt-8 mb-3 text-lg font-semibold">Project dengan acara di {year}</h2>
              {projectTable(`Project ${year}`)}
              <p className="mt-3 text-[13px] text-muted">{projectNote}</p>
            </>
          )}
        </>
      )}
    </div>
  )
}
