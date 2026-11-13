import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import { Button, Card, EmptyState, ErrorState, IconButton, Loading, Money, PageHeader, Table, TD, TH, useToast } from '@/components/ui'
import { daySummary, listRecordDates, type DaySummary } from '@/db/finance'
import { addDays, formatDate, monthLabel, todayStr } from '@/lib/date'
import { rupiah } from '@/lib/money'
import { saveTextFile } from '@/lib/platform'

function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function lastDay(ym: string): string {
  return addDays(shiftMonth(ym, 1) + '-01', -1)
}

function toCsv(rows: DaySummary[]): string {
  const head = ['Tanggal', 'Saldo awal', 'Saldo akhir', 'Selisih saldo', 'Setor modal bersih', 'Piutang baru', 'Piutang dibayar', 'Utang baru', 'Utang dibayar', 'Profit']
  const lines = rows.map((r) =>
    [r.date, r.openingTotal, r.closingTotal, r.delta, r.capitalNet, r.piutangBaru, r.piutangLunas, r.utangBaru, r.utangBayar, r.profit ?? ''].join(','),
  )
  return '﻿' + [head.join(','), ...lines].join('\n')
}

export function Laporan() {
  const { db, go } = useApp()
  const toast = useToast()
  const [month, setMonth] = useState(todayStr().slice(0, 7))

  const data = useAsync(async () => {
    const dates = await listRecordDates(db, month + '-01', lastDay(month))
    const rows: DaySummary[] = []
    for (const d of dates) rows.push(await daySummary(db, d))
    return rows
  }, [month])

  const rows = data.data ?? []
  const profits = rows.map((r) => r.profit ?? 0)
  const total = profits.reduce((a, b) => a + b, 0)
  const best = rows.reduce<DaySummary | null>((m, r) => (m === null || (r.profit ?? 0) > (m.profit ?? 0) ? r : m), null)
  const worst = rows.reduce<DaySummary | null>((m, r) => (m === null || (r.profit ?? 0) < (m.profit ?? 0) ? r : m), null)

  const exportCsv = async () => {
    try {
      const ok = await saveTextFile(`laporan-lunatopup-${month}.csv`, toCsv(rows), 'text/csv')
      if (ok) toast('Laporan diekspor.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengekspor.', 'error')
    }
  }

  return (
    <div>
      <PageHeader
        title="Laporan"
        subtitle="Profit per hari dan rekap per bulan."
        actions={<Button onClick={exportCsv} disabled={rows.length === 0}><Download className="size-4" aria-hidden="true" /> Ekspor CSV</Button>}
      />

      <div className="mb-5 flex items-center gap-2">
        <IconButton label="Bulan sebelumnya" onClick={() => setMonth(shiftMonth(month, -1))} className="border border-line-strong"><ChevronLeft className="size-4" aria-hidden="true" /></IconButton>
        <span className="min-w-40 text-center font-semibold">{monthLabel(month)}</span>
        <IconButton label="Bulan berikutnya" onClick={() => setMonth(shiftMonth(month, 1))} className="border border-line-strong"><ChevronRight className="size-4" aria-hidden="true" /></IconButton>
      </div>

      {data.loading && !data.data ? (
        <Loading />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={`Belum ada catatan di ${monthLabel(month)}`}
          body="Laporan dibuat dari catatan saldo harian."
          action={<Button variant="primary" onClick={() => go({ name: 'keuangan', tab: 'catat' })}>Catat saldo hari ini</Button>}
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
            <Card className="p-5">
              <p className="text-muted">Total profit bulan ini</p>
              <Money value={total} signed className="mt-1 block text-3xl font-semibold" />
              <p className="mt-1 text-[13px] text-muted">
                {rows.length} hari tercatat, rata-rata {rupiah(Math.round(total / rows.length))} per hari.
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-muted">Hari terbaik</p>
              {best && <><Money value={best.profit ?? 0} signed className="mt-1 block text-xl font-semibold" /><p className="text-[13px] text-muted">{formatDate(best.date)}</p></>}
            </Card>
            <Card className="p-5">
              <p className="text-muted">Hari terendah</p>
              {worst && <><Money value={worst.profit ?? 0} signed className="mt-1 block text-xl font-semibold" /><p className="text-[13px] text-muted">{formatDate(worst.date)}</p></>}
            </Card>
          </div>

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
            Koreksi adalah bagian selisih saldo yang bukan hasil usaha: modal, utang, dan piutang. Profit sudah memperhitungkannya.
          </p>
        </>
      )}
    </div>
  )
}
