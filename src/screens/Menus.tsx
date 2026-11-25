import type { ReactNode } from 'react'
import { AppWindow, BellRing, CalendarDays, ChevronRight, Clapperboard, HandCoins, Landmark, Ticket, TrendingUp, Trophy, UserRound, Wallet } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import { Badge, Button, Money, Stagger, StaggerItem } from '@/components/ui'
import { daySummary } from '@/db/finance'
import { debtTotals } from '@/db/debts'
import { expiringWithin } from '@/db/premium'
import { categoryOf, listEvents } from '@/db/events'
import { formatDateLong, greeting, todayStr } from '@/lib/date'
import { cn } from '@/lib/cn'

interface MenuItem {
  title: string
  desc: string
  icon: ReactNode
  onClick?: () => void
  /** Fitur belum dibuat: tampil jelas sebagai "Segera hadir" dan tidak bisa diklik. */
  soon?: boolean
}

function IconTile({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-xl',
        muted ? 'bg-subtle text-muted' : 'bg-accent-soft text-accent-soft-fg',
      )}
    >
      {children}
    </span>
  )
}

function MenuList({ items }: { items: MenuItem[] }) {
  return (
    <Stagger as="ul" className="flex flex-col gap-3">
      {items.map((it) => (
        <StaggerItem as="li" key={it.title}>
          <button
            type="button"
            disabled={it.soon}
            onClick={it.onClick}
            className={cn(
              'group flex w-full items-center gap-4 rounded-xl border border-line p-4 text-left transition-[transform,box-shadow,border-color] duration-200',
              it.soon
                ? 'bg-surface'
                : 'shadow-card bg-bg hover:-translate-y-0.5 hover:border-accent-text/40 hover:shadow-lift active:translate-y-0 active:scale-[0.99]',
            )}
          >
            <IconTile muted={it.soon}>{it.icon}</IconTile>
            <span className="min-w-0 flex-1">
              <span className={cn('block text-base font-semibold', it.soon && 'text-muted')}>{it.title}</span>
              <span className="mt-0.5 block text-muted">{it.desc}</span>
            </span>
            {it.soon ? (
              <Badge>Segera hadir</Badge>
            ) : (
              <ChevronRight className="size-5 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
            )}
          </button>
        </StaggerItem>
      ))}
    </Stagger>
  )
}

function Narrow({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 mb-8 text-muted">{subtitle}</p>}
        {!subtitle && <div className="mb-8" />}
        {children}
      </div>
    </div>
  )
}

export function Bisnis() {
  const { go } = useApp()
  return (
    <Narrow title="Bisnis" subtitle="Pilih bisnis yang mau dibuka.">
      <MenuList
        items={[
          { title: 'Lunatopup', desc: 'Keuangan harian, utang piutang, biaya operasional, dan laporan.', icon: <Wallet className="size-5" />, onClick: () => go({ name: 'lunatopup' }) },
          { title: 'Lunapremium App', desc: 'Pricelist, customer, dan rekap langganan aplikasi premium.', icon: <AppWindow className="size-5" />, onClick: () => go({ name: 'premium', tab: 'rekap' }) },
          { title: 'Momentum', desc: 'Project klien, keuangan, invoice, dan laporan.', icon: <Clapperboard className="size-5" />, onClick: () => go({ name: 'momentum', tab: 'dashboard' }) },
          { title: 'Mahesa', desc: 'Belum dibuat.', icon: <Landmark className="size-5" />, soon: true },
        ]}
      />
    </Narrow>
  )
}

export function Lunatopup() {
  const { go } = useApp()
  return (
    <Narrow title="Lunatopup" subtitle="Pilih data yang mau dikelola.">
      <MenuList
        items={[
          { title: 'Data Keuangan', desc: 'Saldo channel, profit harian, utang piutang, biaya operasional, laporan.', icon: <TrendingUp className="size-5" />, onClick: () => go({ name: 'keuangan', tab: 'dashboard' }) },
          { title: 'Data Top Spender', desc: 'Top spender bulanan dan kode voucher hadiahnya.', icon: <Trophy className="size-5" />, onClick: () => go({ name: 'topspender' }) },
          { title: 'Data Voucher', desc: 'Voucher bulanan dan berapa kali terpakai.', icon: <Ticket className="size-5" />, onClick: () => go({ name: 'voucher' }) },
        ]}
      />
    </Narrow>
  )
}

function Kpi({ icon, label, children, hint }: { icon: ReactNode; label: string; children: ReactNode; hint: string }) {
  return (
    <div className="shadow-card flex flex-col gap-3 rounded-xl border border-line bg-bg p-4">
      <div className="flex items-center gap-2.5 text-muted">
        <IconTile>{icon}</IconTile>
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight">{children}</div>
      <p className="-mt-1 text-[13px] text-muted">{hint}</p>
    </div>
  )
}

export function Beranda() {
  const { db, go, settings } = useApp()
  const today = todayStr()
  const day = useAsync(() => daySummary(db, today), [today])
  const totals = useAsync(() => debtTotals(db, today), [today])
  const soon = useAsync(() => expiringWithin(db, today, settings.warnDays), [today, settings.warnDays])
  const agenda = useAsync(() => listEvents(db, today, today), [today])
  const name = settings.name.trim()
  const hasRecord = !!day.data?.hasRecord
  const expiring = soon.data?.length ?? 0

  return (
    <div className="h-full overflow-y-auto">
      <Stagger className="mx-auto max-w-4xl px-6 py-10">
        <StaggerItem>
          <p className="flex items-center gap-2 text-muted">
            <CalendarDays className="size-4" aria-hidden="true" />
            {formatDateLong(today)}
          </p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight">
            {greeting()}{name ? `, ${name}` : ''}
          </h1>
        </StaggerItem>

        <StaggerItem>
          <section aria-label="Ringkasan hari ini" className="mt-8 grid gap-3 sm:grid-cols-3">
            <Kpi
              icon={<TrendingUp className="size-5" />} label="Profit hari ini"
              hint={hasRecord ? 'Dari selisih saldo semua channel.' : 'Catatan hari ini belum diisi.'}
            >
              {hasRecord ? <Money value={day.data?.profit ?? 0} signed countUp /> : <span className="text-muted">Belum ada</span>}
            </Kpi>
            <Kpi icon={<HandCoins className="size-5" />} label="Piutang berjalan" hint={`${totals.data?.piutangCount ?? 0} catatan belum lunas.`}>
              <Money value={totals.data?.piutang ?? 0} countUp />
            </Kpi>
            <Kpi
              icon={<BellRing className="size-5" />} label="Langganan hampir habis"
              hint={`Berakhir dalam ${settings.warnDays} hari.`}
            >
              <span className="num">{expiring}</span>
            </Kpi>
          </section>
        </StaggerItem>

        {(!hasRecord || expiring > 0) && (
          <StaggerItem>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!hasRecord && <Button variant="primary" onClick={() => go({ name: 'keuangan', tab: 'catat' })}>Isi saldo hari ini</Button>}
              {hasRecord && <Button onClick={() => go({ name: 'keuangan', tab: 'catat' })}>Ubah catatan hari ini</Button>}
              {expiring > 0 && <Button onClick={() => go({ name: 'premium', tab: 'rekap' })}>Lihat langganan hampir habis</Button>}
            </div>
          </StaggerItem>
        )}

        {(agenda.data?.length ?? 0) > 0 && (
          <StaggerItem>
            <section aria-label="Agenda hari ini" className="shadow-card mt-3 rounded-xl border border-line bg-bg p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Agenda hari ini</h2>
                <Button size="sm" onClick={() => go({ name: 'pribadi' })}>Buka kalender</Button>
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {agenda.data!.slice(0, 4).map((e) => (
                  <li key={e.id} className="flex items-center gap-2.5">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: categoryOf(e.category).color }} />
                    <span className="num w-12 shrink-0 text-muted">{e.start_time ?? 'Seharian'}</span>
                    <span className="min-w-0 flex-1 truncate">{e.title}</span>
                    <span className="text-[13px] text-muted">{categoryOf(e.category).label}</span>
                  </li>
                ))}
              </ul>
              {agenda.data!.length > 4 && <p className="mt-2 text-[13px] text-muted">dan {agenda.data!.length - 4} kegiatan lain.</p>}
            </section>
          </StaggerItem>
        )}

        <StaggerItem>
          <div className="mt-8 grid gap-3 sm:grid-cols-[2fr_1fr]">
            <button
              type="button"
              onClick={() => go({ name: 'bisnis' })}
              className="group flex min-h-40 flex-col justify-between rounded-xl bg-[linear-gradient(135deg,#2563eb_0%,#1d4ed8_100%)] p-6 text-left text-white shadow-lift transition-[transform,filter] duration-200 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.99]"
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-white/15" aria-hidden="true">
                <Wallet className="size-5" />
              </span>
              <span>
                <span className="flex items-center gap-1.5 text-2xl font-bold">
                  Bisnis
                  <ChevronRight className="size-5 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
                </span>
                <span className="mt-1 block max-w-sm text-white">Lunatopup, Lunapremium, dan Momentum: keuangan, langganan, project, dan invoice.</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => go({ name: 'pribadi' })}
              className="group shadow-card flex min-h-40 flex-col justify-between rounded-xl border border-line bg-bg p-6 text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-accent-text/40 hover:shadow-lift active:translate-y-0 active:scale-[0.99]"
            >
              <IconTile><UserRound className="size-5" /></IconTile>
              <span>
                <span className="flex items-center gap-1.5 text-2xl font-bold">
                  Pribadi
                  <ChevronRight className="size-5 text-muted transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
                </span>
                <span className="mt-1 block text-muted">Kalender kegiatan dan pengingat.</span>
              </span>
            </button>
          </div>
        </StaggerItem>
      </Stagger>
    </div>
  )
}
