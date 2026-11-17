import { useCallback, useEffect, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { AppProvider, loadSettings, useApp, type Settings as SettingsT } from '@/app/context'
import { Shell } from '@/components/Shell'
import { TitleBar } from '@/components/TitleBar'
import { ErrorState, Loading, ToastProvider, useToast } from '@/components/ui'
import { openDb, type Db } from '@/db'
import { runDailyBackup } from '@/db/backup'
import { notifyExpiring } from '@/lib/reminders'
import { applyTheme, watchSystemTheme } from '@/lib/theme'
import { useReminders } from '@/lib/useReminders'
import { checkForUpdate } from '@/lib/updater'
import { Lock } from '@/screens/Lock'
import { Beranda, Bisnis, Lunatopup } from '@/screens/Menus'
import { Settings } from '@/screens/Settings'
import { Setup } from '@/screens/Setup'
import { Keuangan } from '@/screens/keuangan'
import { Premium } from '@/screens/premium'
import { Pribadi } from '@/screens/pribadi'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'setup'; db: Db }
  | { kind: 'locked'; db: Db; settings: SettingsT }
  | { kind: 'ready'; db: Db; settings: SettingsT; key: CryptoKey | null }

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  const boot = useCallback(async (existing?: Db) => {
    setPhase({ kind: 'loading' })
    try {
      const db = existing ?? (await openDb())
      const settings = await loadSettings(db)
      applyTheme(settings.theme)
      if (!settings.setupDone) setPhase({ kind: 'setup', db })
      else if (settings.pin) setPhase({ kind: 'locked', db, settings })
      else setPhase({ kind: 'ready', db, settings, key: null })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  useEffect(() => {
    boot()
  }, [boot])

  const retry = useCallback(() => boot(), [boot])

  const theme = phase.kind === 'ready' || phase.kind === 'locked' ? phase.settings.theme : 'sistem'
  useEffect(() => watchSystemTheme(theme), [theme])

  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <div className="flex h-full flex-col">
          <TitleBar />
          <div className="min-h-0 flex-1">
            {phase.kind === 'loading' && <Loading label="Membuka data" />}
            {phase.kind === 'error' && (
              <div className="p-6"><ErrorState message={phase.message} onRetry={retry} /></div>
            )}
            {phase.kind === 'setup' && <Setup db={phase.db} onDone={() => boot(phase.db)} />}
            {phase.kind === 'locked' && (
              <Lock
                pin={phase.settings.pin!} name={phase.settings.name}
                onUnlock={(key) => setPhase({ kind: 'ready', db: phase.db, settings: phase.settings, key })}
              />
            )}
            {phase.kind === 'ready' && (
              <AppProvider
                db={phase.db} initial={phase.settings}
                onLock={() => boot(phase.db)}
              >
                <Ready initialKey={phase.key} />
              </AppProvider>
            )}
          </div>
        </div>
      </ToastProvider>
    </MotionConfig>
  )
}

/** Isi aplikasi setelah terbuka. Memasang kunci enkripsi, cadangan harian, dan pengingat. */
function Ready({ initialKey }: { initialKey: CryptoKey | null }) {
  const { db, settings, setCryptoKey, route } = useApp()
  const toast = useToast()

  useEffect(() => setCryptoKey(initialKey), [initialKey, setCryptoKey])
  useReminders()
  useEffect(() => {
    runDailyBackup(db).catch(() => {})
    if (settings.notif) notifyExpiring(db, settings.warnDays).catch(() => {})
    checkForUpdate()
      .then((u) => u && toast(`Versi ${u.version} sudah tersedia. Pasang lewat Pengaturan.`))
      .catch(() => {})
    // hanya saat aplikasi dibuka
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Shell>
      {route.name === 'beranda' && <Beranda />}
      {route.name === 'bisnis' && <Bisnis />}
      {route.name === 'lunatopup' && <Lunatopup />}
      {route.name === 'keuangan' && <Keuangan tab={route.tab} date={route.date} />}
      {route.name === 'premium' && <Premium tab={route.tab} />}
      {route.name === 'pribadi' && <Pribadi />}
      {route.name === 'pengaturan' && <Settings />}
    </Shell>
  )
}
