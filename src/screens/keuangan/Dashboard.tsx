import { useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { HandCoins, Landmark, TrendingUp, Undo2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Money, PageHeader, Segmented, Stagger, StaggerItem } from '@/components/ui'
import { daySummary, latestBalances, profitSeries, totalBalanceNow } from '@/db/finance'
import { debtTotals, listDebts } from '@/db/debts'
import { addDays, formatDate, formatShort, todayStr } from '@/lib/date'
import { rupiah, rupiahCompact } from '@/lib/money'

type Range = '7' | '30' | 'bulan'

function rangeStart(range: Range, today: string): string {
  if (range === '7') return addDays(today, -6)
  if (range === '30') return addDays(today, -29)
  return today.slice(0, 8) + '01'
}

export function Dashboard() {
  const { db, go } = useApp()
  const [range, setRange] = useState<Range>('7')
  const today = todayStr()

  const data = useAsync(async () => {
    const from = rangeStart(range, today)
    const [day, series, total, balances, totals, overdue] = await Promise.all([
      daySummary(db, today), profitSeries(db, from, today), totalBalanceNow(db), latestBalances(db),
      debtTotals(db, today), listDebts(db, today, { state: 'aktif' }),
    ])
    const map = new Map(series.map((s) => [s.date, s.profit]))
    const days: { date: string; label: string; profit: number | null }[] = []
    for (let d = from; d <= today; d = addDays(d, 1)) {
      days.push({ date: d, label: formatShort(d), profit: map.get(d) ?? null })
    }
    return { day, series, days, total, balances, totals, overdue: overdue.filter((d) => d.status === 'jatuh-tempo').length }
  }, [range])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  if (!data.data) return null
  const { day, series, days, total, balances, totals, overdue } = data.data

  const sum = series.reduce((a, b) => a + b.profit, 0)
  const avg = series.length ? Math.round(sum / series.length) : 0
  const best = series.reduce<{ date: string; profit: number } | null>((m, s) => (m === null || s.profit > m.profit ? s : m), null)
  const rangeLabel = range === '7' ? '7 hari terakhir' : range === '30' ? '30 hari terakhir' : 'bulan ini'
  const summary = series.length
    ? `Profit ${rangeLabel}: ${rupiah(sum)} dari ${series.length} hari tercatat.`
    : `Belum ada catatan pada ${rangeLabel}.`

  const spark = days.map((d) => ({ label: d.label, profit: d.profit ?? 0 })).slice(-14)

  return (
    <Stagger>
      <StaggerItem><PageHeader title="Dashboard" subtitle="Ringkasan keuangan Lunatopup." /></StaggerItem>

      <StaggerItem className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="relative overflow-hidden p-6">
          <p className="flex items-center gap-2 text-muted">
            <TrendingUp className="size-4 text-accent-text" aria-hidden="true" />
            Profit hari ini
          </p>
          {day.hasRecord ? (
            <>
              <Money value={day.profit ?? 0} signed countUp className="relative mt-1 block text-5xl font-bold" />
              <p className="relative mt-3 text-muted">
                Saldo berubah <Money value={day.delta} signed />
                {day.piutangBaru - day.piutangLunas - day.utangBaru + day.utangBayar !== 0 && ', sudah dikoreksi utang piutang'}
                {day.capitalNet !== 0 && ' dan modal'}.
              </p>
            </>
          ) : (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-sm text-lg font-medium">Catatan hari ini belum diisi, jadi profitnya belum bisa dihitung.</p>
              <Button variant="primary" onClick={() => go({ name: 'keuangan', tab: 'catat' })}>Isi saldo hari ini</Button>
            </div>
          )}
          {day.hasRecord && spark.length > 1 && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 opacity-70">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="profit" stroke="var(--accent)" strokeWidth={2} fill="url(#spark)" animationDuration={1100} animationEasing="ease-out" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <p className="flex items-center gap-2 text-muted">
            <Landmark className="size-4 text-accent-text" aria-hidden="true" />
            Total saldo semua channel
          </p>
          <Money value={total.total} countUp className="mt-1 block text-3xl font-bold" />
          <p className="mt-1 text-[13px] text-muted">
            {total.asOf ? `Per catatan ${formatDate(total.asOf)}` : 'Dari saldo awal, belum ada catatan harian'}
          </p>
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {balances.map(({ channel, balance }) => (
              <li key={channel.id} className="flex items-center justify-between py-2">
                <span>{channel.name}</span>
                <span className="num">{rupiah(balance)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </StaggerItem>

      <StaggerItem><Card className="mt-4 p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">
              Profit per hari, {rangeLabel}
            </h2>
            <p className="mt-0.5 text-muted">
              {series.length > 0
                ? `Rata-rata ${rupiah(avg)} per hari tercatat. Terbaik ${formatShort(best!.date)} ${rupiah(best!.profit)}.`
                : 'Belum ada hari yang dicatat pada rentang ini.'}
            </p>
          </div>
          <Segmented
            label="Rentang waktu" value={range} onChange={setRange} size="sm"
            options={[{ value: '7', label: '7 hari' }, { value: '30', label: '30 hari' }, { value: 'bulan', label: 'Bulan ini' }]}
          />
        </div>
        {series.length === 0 ? (
          <EmptyState title="Grafik belum bisa digambar" body="Isi catatan harian minimal sekali, lalu profit per hari akan muncul di sini." />
        ) : (
          <div role="img" aria-label={summary} className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="barUp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={1} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} width={52} tick={{ fill: 'var(--muted)', fontSize: 12 }} tickFormatter={rupiahCompact} />
                <Tooltip
                  cursor={{ fill: 'var(--subtle)' }}
                  contentStyle={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--fg)', boxShadow: 'var(--shadow-lift)' }}
                  formatter={(v) => [rupiah(Number(v)), 'Profit']}
                />
                <Bar dataKey="profit" radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive animationDuration={900} animationEasing="ease-out">
                  {days.map((d) => (
                    <Cell key={d.date} fill={(d.profit ?? 0) < 0 ? 'var(--danger)' : 'url(#barUp)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card></StaggerItem>

      <StaggerItem className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-2 text-muted"><HandCoins className="size-4 text-accent-text" aria-hidden="true" />Piutang berjalan</p>
            <Badge tone="neutral">{totals.piutangCount} catatan</Badge>
          </div>
          <Money value={totals.piutang} countUp className="mt-1 block text-2xl font-bold" />
          <p className="mt-1 text-[13px] text-muted">Uang yang masih harus kembali ke kamu.</p>
        </Card>
        <Card className="p-6">
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-2 text-muted"><Undo2 className="size-4 text-accent-text" aria-hidden="true" />Utang berjalan</p>
            <Badge tone="neutral">{totals.utangCount} catatan</Badge>
          </div>
          <Money value={totals.utang} countUp className="mt-1 block text-2xl font-bold" />
          <p className="mt-1 text-[13px] text-muted">Uang yang masih harus kamu kembalikan.</p>
        </Card>
      </StaggerItem>
      <StaggerItem className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={() => go({ name: 'keuangan', tab: 'utang' })}>Lihat daftar utang piutang</Button>
        {overdue > 0 && <Badge tone="warn">{overdue} catatan lewat jatuh tempo</Badge>}
      </StaggerItem>
    </Stagger>
  )
}
