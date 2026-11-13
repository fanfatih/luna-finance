import { isTauri } from '@/lib/platform'

export interface UpdateInfo {
  version: string
  notes: string | null
  /** Unduh, pasang, lalu mulai ulang aplikasi. onProgress menerima persen, atau null bila ukuran tidak diketahui. */
  install: (onProgress: (pct: number | null) => void) => Promise<void>
}

/** Cek versi baru di GitHub Releases. Hanya ada di aplikasi desktop. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return null
  return {
    version: update.version,
    notes: update.body?.trim() || null,
    install: async (onProgress) => {
      let total = 0
      let got = 0
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') {
          total = e.data.contentLength ?? 0
          onProgress(total ? 0 : null)
        } else if (e.event === 'Progress') {
          got += e.data.chunkLength
          onProgress(total ? Math.min(100, Math.round((got / total) * 100)) : null)
        } else {
          onProgress(100)
        }
      })
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    },
  }
}

export async function currentVersion(): Promise<string | null> {
  if (!isTauri()) return null
  const { getVersion } = await import('@tauri-apps/api/app')
  return getVersion()
}
