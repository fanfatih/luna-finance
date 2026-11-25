import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { parentOf, useApp, type Route } from '@/app/context'
import { useSync } from '@/lib/useSync'
import { IconButton, useToast } from './ui'

export function crumb(r: Route): string {
  switch (r.name) {
    case 'beranda': return 'Beranda'
    case 'bisnis': return 'Bisnis'
    case 'lunatopup': return 'Lunatopup'
    case 'keuangan': return 'Data Keuangan'
    case 'premium': return 'Lunapremium App'
    case 'momentum': return 'Momentum'
    case 'pribadi': return 'Pribadi'
    case 'topspender': return 'Data Top Spender'
    case 'voucher': return 'Data Voucher'
    case 'pengaturan': return 'Pengaturan'
  }
}

function routeKey(r: Route): string {
  return r.name
}

function depthOf(r: Route): number {
  let d = 0
  for (let p = parentOf(r); p !== null; p = parentOf(p)) d++
  return d
}

/** Kunci otomatis setelah tidak ada aktivitas selama idleMin menit, bila PIN diatur. */
function useIdleLock() {
  const { settings, lock } = useApp()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!settings.pin) return
    const reset = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(lock, settings.idleMin * 60_000)
    }
    const events = ['pointerdown', 'keydown', 'wheel'] as const
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(timer.current)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [settings.pin, settings.idleMin, lock])
}

export function Shell({ children }: { children: ReactNode }) {
  const { route, go, back } = useApp()
  useIdleLock()
  const toast = useToast()
  const onSyncError = useCallback((m: string) => toast(m, 'error'), [toast])
  const sync = useSync(onSyncError)
  const hasParent = parentOf(route) !== null
  // Maju ke menu yang lebih dalam: halaman masuk dari kanan. Kembali: dari kiri.
  const depth = depthOf(route)
  const lastDepth = useRef(depth)
  const dir = Math.sign(depth - lastDepth.current)
  useEffect(() => { lastDepth.current = depth }, [depth])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-bg px-4">
        <div className="flex items-center gap-1">
          {hasParent && (
            <IconButton label="Kembali" onClick={back} className="-ml-2">
              <ArrowLeft className="size-5" aria-hidden="true" />
            </IconButton>
          )}
          <span className="text-[15px] font-semibold tracking-tight">{crumb(route)}</span>
        </div>
        <div className="flex items-center gap-1">
          {sync.configured && (
            <IconButton
              label={sync.syncing ? 'Menyinkronkan data' : 'Perbarui data'}
              disabled={sync.syncing}
              onClick={async () => {
                const r = await sync.run()
                if (r) toast(r.pulled || r.pushed ? `Data diperbarui. Terkirim ${r.pushed}, diterima ${r.pulled}.` : 'Data sudah yang terbaru.')
              }}
            >
              <RefreshCw className={'size-5' + (sync.syncing ? ' animate-spin' : '')} aria-hidden="true" />
            </IconButton>
          )}
          {route.name !== 'pengaturan' && (
            <IconButton label="Pengaturan" onClick={() => go({ name: 'pengaturan', from: route })}>
              <SettingsIcon className="size-5" aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <motion.div
          key={routeKey(route)}
          className="h-full"
          initial={{ opacity: 0, x: dir * 28, y: dir === 0 ? 8 : 0, scale: 0.992 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30, opacity: { duration: 0.2 } }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  )
}

/** Tata letak dua kolom: menu samping + isi. Dipakai Data Keuangan dan Lunapremium. */
export function SidebarLayout({
  items, active, onSelect, children,
}: {
  items: { id: string; label: string; icon: ReactNode }[]
  active: string
  onSelect: (id: string) => void
  children: ReactNode
}) {
  return (
    <div className="flex h-full">
      <nav aria-label="Menu" className="flex w-60 shrink-0 flex-col gap-1 border-r border-line bg-bg p-3">
        {items.map((it) => {
          const on = active === it.id
          return (
            <button
              key={it.id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => onSelect(it.id)}
              className={
                'relative flex h-11 items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors duration-150 active:scale-[0.98] ' +
                (on ? 'text-accent-soft-fg' : 'text-muted hover:bg-subtle hover:text-fg')
              }
            >
              {on && (
                <motion.span
                  layoutId="sidebar-pill" aria-hidden="true"
                  className="absolute inset-0 rounded-lg bg-accent-soft"
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                />
              )}
              <span aria-hidden="true" className="relative shrink-0">{it.icon}</span>
              <span className="relative">{it.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <motion.div
          key={active} className="mx-auto max-w-5xl p-6"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30, opacity: { duration: 0.18 } }}
        >
          {children}
        </motion.div>
      </div>
    </div>
  )
}
