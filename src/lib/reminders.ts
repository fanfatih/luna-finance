import type { Db } from '@/db'
import { getSetting, setSetting } from '@/db/finance'
import { expiringWithin } from '@/db/premium'
import { isTauri } from '@/db'
import { todayStr } from './date'

import { invoke } from '@tauri-apps/api/core'

/** Pesan galat yang bisa dibaca. Galat dari sisi Rust datang sebagai teks biasa, bukan Error. */
export function errText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Terjadi kesalahan yang tidak diketahui.'
}

/**
 * Kirim notifikasi desktop lewat sisi Rust. Mengembalikan null bila berhasil dikirim,
 * atau teks galat. Bukan aplikasi desktop berarti galat juga.
 */
export async function desktopNotify(title: string, body: string): Promise<string | null> {
  if (!isTauri()) return 'Notifikasi desktop hanya ada di aplikasi Windows.'
  try {
    await invoke('show_notification', { title, body })
    return null
  } catch (e) {
    return errText(e)
  }
}

/** Notifikasi desktop biasa. false bila bukan aplikasi desktop atau gagal dikirim. */
export async function notifyNative(title: string, body: string): Promise<boolean> {
  return (await desktopNotify(title, body)) === null
}

/**
 * Notifikasi desktop untuk langganan Lunapremium yang hampir habis. Sekali sehari:
 * `last_notified` mencegah pengulangan di hari yang sama.
 */
export async function notifyExpiring(db: Db, warnDays: number): Promise<number> {
  if (!isTauri()) return 0
  const today = todayStr()
  if ((await getSetting(db, 'last_notified')) === today) return 0
  const soon = await expiringWithin(db, today, warnDays)
  if (!soon.length) return 0
  const names = soon.slice(0, 3).map((s) => `${s.customer_name} (${s.product_name})`).join(', ')
  const sent = await notifyNative(
    `${soon.length} langganan hampir habis`,
    soon.length > 3 ? `${names}, dan ${soon.length - 3} lainnya.` : names,
  )
  if (!sent) return 0
  await setSetting(db, 'last_notified', today)
  return soon.length
}

export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauri()) return false
  return invoke<boolean>('autostart_enabled')
}

export async function setAutostart(on: boolean): Promise<void> {
  await invoke('autostart_set', { on })
}
