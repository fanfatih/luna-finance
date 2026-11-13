import { ChevronRight } from 'lucide-react'
import { useApp } from '@/app/context'
import { Badge, Button, Money } from '@/components/ui'
import { daySummary } from '@/db/finance'
import { expiringWithin } from '@/db/premium'
import { useAsync } from '@/app/context'
import { formatDateLong, greeting, todayStr } from '@/lib/date'
import { cn } from '@/lib/cn'

interface MenuItem {
  title: string
  desc: string
  onClick?: () => void
  /** Fitur belum dibuat: tampil jelas sebagai "Segera hadir" dan tidak bisa diklik. */
  soon?: boolean
}

function MenuList({ items }: { items: MenuItem[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => (
        <li key={it.title}>
          <button
            type="button"
            disabled={it.soon}
            onClick={it.onClick}
            className={cn(
              'group flex w-full items-center justify-between gap-4 rounded-xl border border-line p-5 text-left transition-colors duration-150',
              it.soon ? 'bg-surface' : 'hover:border-accent-text hover:bg-accent-soft/40',
            )}
          >
            <span>
              <span className={cn('block text-base font-semibold', it.soon && 'text-muted')}>{it.title}</span>
              <span className="mt-0.5 block text-muted">{it.desc}</span>
            </span>
            {it.soon ? (
              <Badge>Segera hadir</Badge>
            ) : (
              <ChevronRight className="size-5 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Narrow({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 mb-8 text-muted">{subtitle}</p>}
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
          { title: 'Lunatopup', desc: 'Keuangan harian, utang piutang, dan laporan.', onClick: () => go({ name: 'lunatopup' }) },
          { title: 'Lunapremium App', desc: 'Pricelist, customer, dan rekap langganan aplikasi premium.', onClick: () => go({ name: 'premium', tab: 'rekap' }) },
          { title: 'Momentum', desc: 'Belum dibuat.', soon: true },
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
          { title: 'Data Keuangan', desc: 'Saldo channel, profit harian, utang piutang, laporan.', onClick: () => go({ name: 'keuangan', tab: 'dashboard' }) },
          { title: 'Data Top Spender', desc: 'Belum dibuat.', soon: true },
          { title: 'Data Voucher', desc: 'Belum dibuat.', soon: true },
        ]}
      />
    </Narrow>
  )
}

export function Beranda() {
  const { db, go, settings } = useApp()
  const today = todayStr()
  const day = useAsync(() => daySummary(db, today), [today])
  const soon = useAsync(() => expiringWithin(db, today, settings.warnDays), [today, settings.warnDays])
  const name = settings.name.trim()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-muted">{formatDateLong(today)}</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight">
          {greeting()}{name ? `, ${name}` : ''}
        </h1>

        <section aria-label="Hari ini" className="mt-8 rounded-xl border border-line bg-surface p-5">
          {day.data?.hasRecord ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-muted">Profit hari ini</p>
                <Money value={day.data.profit ?? 0} signed className="text-3xl font-semibold" />
              </div>
              <Button onClick={() => go({ name: 'keuangan', tab: 'catat' })}>Ubah catatan hari ini</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">Catatan hari ini belum diisi</p>
                <p className="text-muted">Isi saldo tiap channel supaya profit hari ini bisa dihitung.</p>
              </div>
              <Button variant="primary" onClick={() => go({ name: 'keuangan', tab: 'catat' })}>Isi saldo hari ini</Button>
            </div>
          )}
          {soon.data && soon.data.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p>
                <span className="font-semibold">{soon.data.length} langganan</span> Lunapremium hampir habis dalam {settings.warnDays} hari.
              </p>
              <Button size="sm" onClick={() => go({ name: 'premium', tab: 'rekap' })}>Lihat rekap</Button>
            </div>
          )}
        </section>

        <div className="mt-6 grid gap-3 sm:grid-cols-[2fr_1fr]">
          <button
            type="button"
            onClick={() => go({ name: 'bisnis' })}
            className="group rounded-xl bg-accent p-6 text-left text-white transition-colors duration-150 hover:bg-accent-hover"
          >
            <span className="block text-2xl font-semibold">Bisnis</span>
            <span className="mt-1 block max-w-xs text-white">Lunatopup dan Lunapremium: keuangan, utang piutang, dan langganan.</span>
          </button>
          <button
            type="button" disabled
            className="rounded-xl border border-line bg-surface p-6 text-left"
          >
            <span className="block text-2xl font-semibold text-muted">Pribadi</span>
            <span className="mt-1 mb-3 block text-muted">To-do dan keuangan pribadi.</span>
            <Badge>Segera hadir</Badge>
          </button>
        </div>
      </div>
    </div>
  )
}
