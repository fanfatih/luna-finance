import { isTauri } from '@/db'

export { isTauri }

/** Simpan teks sebagai file. Di Tauri lewat dialog simpan, di peramban lewat unduhan. */
export async function saveTextFile(defaultName: string, content: string, mime = 'text/plain'): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])
    const path = await save({ defaultPath: defaultName })
    if (!path) return false
    await writeTextFile(path, content)
    return true
  }
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = defaultName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

export async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close'): Promise<void> {
  if (!isTauri()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const w = getCurrentWindow()
  await w[action]()
}
