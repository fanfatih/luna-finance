import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '@/app/context'
import { loadSyncConfig, syncNow, type SyncResult } from '@/db/sync'

const AUTO_MS = 10 * 60_000

/** Sinkron ke cloud: otomatis saat dibuka dan tiap 10 menit, plus tombol manual. */
export function useSync(onError: (msg: string) => void) {
  const { db, route, version, bump } = useApp()
  const [configured, setConfigured] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const busy = useRef(false)

  useEffect(() => {
    let live = true
    loadSyncConfig(db).then((c) => live && setConfigured(!!c), () => {})
    return () => { live = false }
  }, [db, route.name, version])

  const run = useCallback(async (silent = false): Promise<SyncResult | null> => {
    if (busy.current) return null
    const cfg = await loadSyncConfig(db)
    if (!cfg) return null
    busy.current = true
    setSyncing(true)
    try {
      const r = await syncNow(db, cfg)
      if (r.pulled > 0) bump()
      return r
    } catch (e) {
      if (!silent) onError(e instanceof Error ? e.message : 'Sinkron gagal.')
      return null
    } finally {
      busy.current = false
      setSyncing(false)
    }
  }, [db, bump, onError])

  useEffect(() => {
    if (!configured) return
    run(true)
    const t = setInterval(() => run(true), AUTO_MS)
    return () => clearInterval(t)
  }, [configured, run])

  return { configured, syncing, run }
}
