import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import type { Db } from '@/db'
import { getSetting, setSetting } from '@/db/finance'
import type { PinRecord } from '@/lib/crypto'

/* ---------- Rute ---------- */

export type KeuanganTab = 'dashboard' | 'catat' | 'utang' | 'operasional' | 'laporan'
export type PremiumTab = 'pricelist' | 'customer' | 'rekap' | 'template'
export type MomentumTab = 'dashboard' | 'project' | 'keuangan' | 'invoice' | 'laporan'

export type Route =
  | { name: 'beranda' }
  | { name: 'bisnis' }
  | { name: 'lunatopup' }
  | { name: 'keuangan'; tab: KeuanganTab; date?: string }
  | { name: 'premium'; tab: PremiumTab }
  | { name: 'momentum'; tab: MomentumTab; /** Project yang langsung dibuka di tab Project. */ id?: string }
  | { name: 'pribadi' }
  | { name: 'topspender' }
  | { name: 'voucher' }
  | { name: 'pengaturan'; from?: Route }

export function parentOf(r: Route): Route | null {
  switch (r.name) {
    case 'beranda':
      return null
    case 'bisnis':
      return { name: 'beranda' }
    case 'lunatopup':
      return { name: 'bisnis' }
    case 'keuangan':
      return { name: 'lunatopup' }
    case 'premium':
    case 'momentum':
      return { name: 'bisnis' }
    case 'pribadi':
      return { name: 'beranda' }
    case 'topspender':
    case 'voucher':
      return { name: 'lunatopup' }
    case 'pengaturan':
      return r.from ?? { name: 'beranda' }
  }
}

/* ---------- Pengaturan ---------- */

export type Theme = 'terang' | 'gelap' | 'sistem'

export interface Settings {
  name: string
  theme: Theme
  warnDays: number
  idleMin: number
  notif: boolean
  setupDone: boolean
  pin: PinRecord | null
}

export const DEFAULT_SETTINGS: Settings = {
  name: '', theme: 'sistem', warnDays: 3, idleMin: 5, notif: true, setupDone: false, pin: null,
}

export async function loadSettings(db: Db): Promise<Settings> {
  const g = (k: string) => getSetting(db, k)
  const [name, theme, warn, idle, notif, done, pin] = await Promise.all([
    g('name'), g('theme'), g('warn_days'), g('idle_min'), g('notif'), g('setup_done'), g('pin'),
  ])
  let pinRec: PinRecord | null = null
  try {
    pinRec = pin ? (JSON.parse(pin) as PinRecord) : null
  } catch {
    pinRec = null
  }
  return {
    name: name ?? '',
    theme: (theme as Theme) ?? 'sistem',
    warnDays: warn ? Number(warn) : DEFAULT_SETTINGS.warnDays,
    idleMin: idle ? Number(idle) : DEFAULT_SETTINGS.idleMin,
    notif: notif ? notif === '1' : true,
    setupDone: done === '1',
    pin: pinRec,
  }
}

/* ---------- Konteks ---------- */

interface AppCtx {
  db: Db
  settings: Settings
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  /** Kunci enkripsi dari PIN. null bila PIN belum diatur atau aplikasi terkunci. */
  cryptoKey: CryptoKey | null
  setCryptoKey: (k: CryptoKey | null) => void
  route: Route
  go: (r: Route) => void
  back: () => void
  /** Naik tiap kali data berubah, supaya layar memuat ulang. */
  version: number
  bump: () => void
  lock: () => void
}

const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp harus dipakai di dalam AppProvider')
  return c
}

export function AppProvider({
  db, initial, onLock, children,
}: { db: Db; initial: Settings; onLock: () => void; children: ReactNode }) {
  const [settings, setSettings] = useState(initial)
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null)
  const [route, setRoute] = useState<Route>({ name: 'beranda' })
  const [version, setVersion] = useState(0)

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const map: [keyof Settings, string, (v: never) => string][] = [
        ['name', 'name', (v: string) => v],
        ['theme', 'theme', (v: string) => v],
        ['warnDays', 'warn_days', (v: number) => String(v)],
        ['idleMin', 'idle_min', (v: number) => String(v)],
        ['notif', 'notif', (v: boolean) => (v ? '1' : '0')],
        ['setupDone', 'setup_done', (v: boolean) => (v ? '1' : '0')],
        ['pin', 'pin', (v: PinRecord | null) => JSON.stringify(v)],
      ] as never
      for (const [field, key, ser] of map) {
        if (field in patch) await setSetting(db, key, ser(patch[field] as never))
      }
      setSettings((s) => ({ ...s, ...patch }))
    },
    [db],
  )

  const go = useCallback((r: Route) => setRoute(r), [])
  const back = useCallback(() => setRoute((r) => parentOf(r) ?? r), [])
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const value = useMemo<AppCtx>(
    () => ({
      db, settings, saveSettings, cryptoKey, setCryptoKey, route, go, back, version, bump,
      lock: () => {
        setCryptoKey(null)
        onLock()
      },
    }),
    [db, settings, saveSettings, cryptoKey, route, go, back, version, bump, onLock],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/* ---------- Muat data ---------- */

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const { version } = useApp()
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null, loading: true, error: null,
  })
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fnRef.current().then(
      (data) => alive && setState({ data, loading: false, error: null }),
      (e: unknown) => alive && setState({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps])

  return { ...state, reload: () => setTick((t) => t + 1) }
}
