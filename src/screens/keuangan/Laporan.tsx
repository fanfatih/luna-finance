import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Button, Card, EmptyState, ErrorState, IconButton, Loading, Money, PageHeader, Segmented, Table, TD, TH, useToast,
} from '@/components/ui'
import { monthBurden, yearBurden } from '@/db/expenses'
import { daySummary, listRecordDates, summariesBetween, type DaySummary } from '@/db/finance'
import { addDays, formatDate, monthLabel, todayStr } from '@/lib/date'
import { categoryLabel, shiftYm } from '@/lib/expense'
import { rupiah } from '@/lib/money'
import { saveTextFile } from '@/lib/platform'

type View = 'bulan' | 'tahun'

function lastDay(ym: string): string {
  return addDays(shiftYm(ym, 1) + '-01', -1)
}

function toCsv(rows: DaySummary[]): string {
  const head = ['Tanggal', 'Saldo awal', 'Saldo akhir', 'Selisih saldo', 'Setor modal bersih', 'Piutang baru', 'Piutang dibayar', 'Utang baru', 'Utang dibayar', 'Biaya operasional dari saldo', 'Profit']
  const lines = rows.map((r) =>
    [r.date, r.openingTotal, r.closingTotal, r.delta, r.capitalNet, r.piutangBaru, r.piutangLunas, r.utangBaru, r.utangBayar, r.operasional, r.profit ?? ''].join(','),
  )
  return '﻿' + [head.join(','), ...lines].join('\n')
}

interface YearRow { ym: string; days: number; gross: number; burden: number }

function yearCsv(rows: YearRow[]): string {
  const head = ['Bulan', 'Hari tercatat', 'Profit kotor', 'Biaya operasional', 'Profit bersih']
  const lines = rows.map((r) => [r.ym, r.days, r.gross, r.burden, r.gross - r.burden].join(','))
  return '﻿' + [head.join(','), ...lines].join('\n')
}

export function Laporan() {
  const { db, go } = useApp()
  const toast = useToast()
  const [view, setView] = useState<View>('bulan')
  const [month, setMonth] = useState(todayStr().slice(0, 7))
  const [year, setYear] = useState(Number(todayStr().slice(0, 4)))

  const data = useAsync(async () => {
    if (view !== 'bulan') return null
    const dates = await listRecordDates(db, month + '-01', lastDay(month))
    const rows: DaySummary[] = []
    for (const d of dates) rows.push(await daySummary(db, d))
    return { rows, burden: await monthBurden(db, month) }
  }, [month, view])

  const yearData = useAsync(async () => {
    if (view !== 'tahun') return null
    const [sums, burden] = await Promise.all([summariesBetween(db, `${year}-01-01`, `${year}-12-31`), yearBurden(db, year)])
    const rows: YearRow[] = burden.map((b, i) => ({ ym: `${year}-${String(i + 1).padStart(2, '0')}`, days: 0, gross: 0, burden: b }))
    for (const s of sums) {
      const r = rows[Number(s.date.slice(5, 7)) - 1]
      r.days += 1
      r.gross += s.profit ?? 0
    }
    return rows
  }, [year, view])

  const rows = data.data?.rows ?? []
  const burden = data.data?.burden ?? { total: 0, byCategory: [] }
  const total = rows.reduce((a, r) => a + (r.profit ?? 0), 0)
  const net = total - burden.total
  const best = rows.reduce<DaySummary | null>((m, r) => (m === null || (r.profit ?? 0) > (m.profit ?? 0) ? r : m), null)
  const worst = rows.reduce<DaySummary | null>((m, r) => (m === null || (r.profit ?? 0) < (m.profit ?? 0) ? r : m), null)

  const yrows = yearData.data ?? []
  const yGross = yrows.reduce((a, r) => a + r.gross, 0)
  const yBurden = yrows.reduce((a, r) => a + r.burden, 0)
  const yDays = yrows.reduce((a, r) => a + r.days, 0)

  const exportCsv = async () => {
    try {
      const ok =
        view === 'bulan'
          ? await saveTextFile(`laporan-lunatopup-${month}.csv`, toCsv(rows), 'text/csv')
          : await saveTextFile(`laporan-lunatopup-${year}.csv`, yearCsv(yrows), 'text/csv')
      if (ok) toast('Laporan diekspor.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengekspor.', 'error')
    }
  }

  const canExport = view === 'bulan' ? rows.length > 0 : yDays > 0 || yBurden > 0

  return (
    <div>
      <PageHeader
        title="Laporan"
        subtitle="Profit kotor dari saldo harian, dikurangi biaya operasional menjadi profit bersih."
        actions={<Button onClick={exportCsv} disabled={!canExport}><Download className="size-4" aria-hidden="true" /> Ekspor CSV</Button>}
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          label="Periode laporan" value={view} onChange={setView}
          options={[{ value: 'bulan', label: 'Bulanan' }, { value: 'tahun', label: 'Tahunan' }]}
        />
        {view === 'bulan' ? (
          <div className="flex items-center gap-2">
            <IconButton label="Bulan sebelumnya" onClick={() => setMonth(shiftYm(month, -1))} className="border border-line-strong"><ChevronLeft className="size-4" aria-hidden="true" /></IconButton>
            <span className="min-w-40 text-center font-semibold">{monthLabel(month)}</span>
            <IconButton label="Bulan berikutnya" onClick={() => setMonth(shiftYm(month, 1))} className="border border-line-strong"><ChevronRight className="size-4" aria-hidden="true" /></IconButton>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <IconButton label="Tahun sebelumnya" onClick={() => setYear(year - 1)} className="border border-line-strong"><ChevronLeft className="size-4" aria-hidden="true" /></IconButton>
            <span className="min-w-24 text-center font-semibold">{year}</span>
            <IconButton label="Tahun berikutnya" onClick={() => setYear(year + 1)} className="border border-line-strong"><ChevronRight className="size-4" aria-hidden="true" /></IconButton>
          </div>
        )}
      </div>

      {view === 'bulan' ? (
        data.loading && !data.data ? (
          <Loading />
        ) : data.error ? (
          <ErrorState message={data.error} onRetry={data.reload} />
        ) : rows.length === 0 && burden.total === 0 ? (
          <EmptyState
            title={`Belum ada catatan di ${monthLabel(month)}`}
            body="Laporan dibuat dari catatan saldo harian dan biaya operasional."
            action={<Button variant="primary" onClick={() => go({ name: 'keuangan', tab: 'catat' })}>Catat saldo hari ini</Button>}
          />
        ) : (
          <>
            <div className="mb-3 grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
              <Card className="p-5">
                <p className="text-muted">Profit kotor bulan ini</p>
                <Money value={total} signed className="mt-1 block text-3xl font-semibold" />
                <p className="mt-1 text-[13px] text-muted">
                  {rows.length > 0
                    ? `${rows.length} hari tercatat, rata-rata ${rupiah(Math.round(total / rows.length))} per hari.`
                    : 'Belum ada catatan saldo harian di bulan ini.'}
                </p>
              </Card>
              <Card className="p-5">
                <p className="text-muted">Hari terbaik</p>
                {best ? <><Money value={best.profit ?? 0} signed className="mt-1 block text-xl font-semibold" /><p className="text-[13px] text-muted">{formatDate(best.date)}</p></> : <p className="mt-1 text-muted">-</p>}
              </Card>
              <Card className="p-5">
                <p className="text-muted">Hari terendah</p>
                {worst ? <><Money value={worst.profit ?? 0} signed className="mt-1 block text-xl font-semibold" /><p className="text-[13px] text-muted">{formatDate(worst.date)}</p></> : <p className="mt-1 text-muted">-</p>}
              </Card>
            </div>

            <div className="mb-5 grid gap-3 sm:grid-cols-2">
              <Card className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-muted">Biaya operasional</p>
                  <Button size="sm" onClick={() => go({ name: 'keuangan', tab: 'operasional' })}>Kelola</Button>
                </div>
                <span className="num mt-1 block text-2xl font-semibold">{burden.total > 0 ? `-${rupiah(burden.total)}` : rupiah(0)}</span>
                {burden.byCategory.length > 0 ? (
                  <ul className="mt-3 divide-y divide-line border-t border-line">
                    {burden.byCategory.map((c) => (
                      <li key={c.category} className="flex items-center justify-between py-1.5">
                        <span className="text-muted">{categoryLabel(c.category)}</span>
                        <span className="num">{rupiah(c.amount)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[13px] text-muted">Belum ada biaya operasional di bulan ini.</p>
                )}
                <p className="mt-2 text-[13px] text-muted">Biaya tahunan dibagi rata ke 12 bulan.</p>
              </Card>
              <Card className="p-5">
                <p className="text-muted">Profit bersih</p>
                <Money value={net} signed className="mt-1 block text-3xl font-semibold" />
                <p className="mt-1 text-[13px] text-muted">Profit kotor {rupiah(total)} dikurangi biaya operasional {rupiah(burden.total)}.</p>
              </Card>
            </div>

            {rows.length > 0 && (
              <>
                <Table label={`Rekap harian ${monthLabel(month)}`}>
                  <thead>
                    <tr><TH>Tanggal</TH><TH right>Saldo awal</TH><TH right>Saldo akhir</TH><TH right>Selisih</TH><TH right>Koreksi</TH><TH right>Profit</TH></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const correction = r.profit! - r.delta
                      return (
                        <tr key={r.date}>
                          <TD className="whitespace-nowrap">{formatDate(r.date)}</TD>
                          <TD right><span className="num">{rupiah(r.openingTotal)}</span></TD>
                          <TD right><span className="num">{rupiah(r.closingTotal)}</span></TD>
                          <TD right><Money value={r.delta} signed /></TD>
                          <TD right>{correction === 0 ? <span className="text-muted">-</span> : <Money value={correction} signed />}</TD>
                          <TD right><Money value={r.profit ?? 0} signed className="font-semibold" /></TD>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
                <p className="mt-3 text-[13px] text-muted">
                  Koreksi adalah bagian selisih saldo yang bukan hasil usaha: modal, utang, piutang, dan biaya operasional yang dibayar dari saldo. Profit harian sudah memperhitungkannya, jadi biaya operasional baru mengurangi profit di kartu Profit bersih.
                </p>
              </>
            )}
          </>
        )
      ) : yearData.loading && !yearData.data ? (
        <Loading />
      ) : yearData.error ? (
        <ErrorState message={yearData.error} onRetry={yearData.reload} />
      ) : yDays === 0 && yBurden === 0 ? (
        <EmptyState
          title={`Belum ada catatan di ${year}`}
          body="Laporan tahunan dijumlahkan dari catatan saldo harian dan biaya operasional."
          action={<Button variant="primary" onClick={() => go({ name: 'keuangan', tab: 'catat' })}>Catat saldo hari ini</Button>}
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Card className="p-5">
              <p className="text-muted">Profit kotor {year}</p>
              <Money value={yGross} signed className="mt-1 block text-2xl font-semibold" />
              <p className="mt-1 text-[13px] text-muted">{yDays} hari tercatat.</p>
            </Card>
            <Card className="p-5">
              <p className="text-muted">Biaya operasional {year}</p>
              <span className="num mt-1 block text-2xl font-semibold">{yBurden > 0 ? `-${rupiah(yBurden)}` : rupiah(0)}</span>
              <p className="mt-1 text-[13px] text-muted">Biaya tahunan dibagi rata ke 12 bulan.</p>
            </Card>
            <Card className="p-5">
              <p className="text-muted">Profit bersih {year}</p>
              <Money value={yGross - yBurden} signed className="mt-1 block text-2xl font-semibold" />
            </Card>
          </div>

          <Table label={`Rekap bulanan ${year}`}>
            <thead>
              <tr><TH>Bulan</TH><TH right>Hari tercatat</TH><TH right>Profit kotor</TH><TH right>Biaya operasional</TH><TH right>Profit bersih</TH></tr>
            </thead>
            <tbody>
              {yrows.map((r) => {
                const empty = r.days === 0 && r.burden === 0
                return (
                  <tr key={r.ym}>
                    <TD className="whitespace-nowrap">{monthLabel(r.ym).replace(` ${year}`, '')}</TD>
                    <TD right>{r.days || <span className="text-muted">-</span>}</TD>
                    <TD right>{r.days === 0 ? <span className="text-muted">-</span> : <Money value={r.gross} signed />}</TD>
                    <TD right>{r.burden > 0 ? <span className="num">-{rupiah(r.burden)}</span> : <span className="text-muted">-</span>}</TD>
                    <TD right>{empty ? <span className="text-muted">-</span> : <Money value={r.gross - r.burden} signed className="font-semibold" />}</TD>
                  </tr>
                )
              })}
              <tr>
                <TD className="font-semibold">Total {year}</TD>
                <TD right><span className="font-semibold">{yDays}</span></TD>
                <TD right><Money value={yGross} signed className="font-semibold" /></TD>
                <TD right><span className="num font-semibold">{yBurden > 0 ? `-${rupiah(yBurden)}` : rupiah(0)}</span></TD>
                <TD right><Money value={yGross - yBurden} signed className="font-semibold" /></TD>
              </tr>
            </tbody>
          </Table>
        </>
      )}
    </div>
  )
}
