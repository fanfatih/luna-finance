import type { Db } from '@/db'
import { getSetting, setSetting } from '@/db/finance'
import { expiringWithin } from '@/db/premium'
import { isTauri } from '@/db'
import { todayStr } from './date'

/** Notifikasi Windows sekali sehari untuk langganan Lunapremium yang hampir habis. */
export async function notifyExpiring(db: Db, warnDays: number): Promise<number> {
  if (!isTauri()) return 0
  const today = todayStr()
  if ((await getSetting(db, 'last_notified')) === today) return 0
  const soon = await expiringWithin(db, today, warnDays)
  if (!soon.length) return 0
  const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification')
  let ok = await isPermissionGranted()
  if (!ok) ok = (await requestPermission()) === 'granted'
  if (!ok) return 0
  const names = soon.slice(0, 3).map((s) => `${s.customer_name} (${s.product_name})`).join(', ')
  sendNotification({
    title: `${soon.length} langganan hampir habis`,
    body: soon.length > 3 ? `${names}, dan ${soon.length - 3} lainnya.` : names,
  })
  await setSetting(db, 'last_notified', today)
  return soon.length
}

export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauri()) return false
  const { isEnabled } = await import('@tauri-apps/plugin-autostart')
  return isEnabled()
}

export async function setAutostart(on: boolean): Promise<void> {
  const { enable, disable } = await import('@tauri-apps/plugin-autostart')
  await (on ? enable() : disable())
}
