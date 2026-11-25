import { useEffect } from 'react'
import { isTauri } from '@/db'
import { useApp } from '@/app/context'
import { useToast } from '@/components/ui'
import { collectDueReminders, reminderText } from '@/db/events'
import { billReminderText, collectDueBillReminders } from '@/db/expenses'
import { collectInvoiceReminders, invoiceReminderText } from '@/db/momentum'
import { notifyExpiring, notifyNative } from './reminders'

const EVERY_MS = 60_000
/** Setelah hari berganti, pengingat langganan baru dikirim mulai jam ini. Saat aplikasi dibuka, langsung. */
const EXPIRY_FROM_HOUR = 8

/**
 * Cek pengingat saat aplikasi dibuka (menyusul yang terlewat) lalu tiap menit: kegiatan di kalender,
 * tagihan rutin yang jatuh tempo, invoice klien Momentum yang menunggu bayar, dan langganan yang hampir habis. Semuanya muncul sebagai notifikasi desktop
 * Windows, jadi tetap terlihat saat jendela disembunyikan ke tray. Detak dari sisi Rust ikut memicu pengecekan karena
 * timer webview diperlambat saat jendela tersembunyi.
 */
export function useReminders() {
  const { db, bump, settings } = useApp()
  const toast = useToast()
  const { notif, warnDays } = settings

  useEffect(() => {
    let alive = true
    let busy = false
    let first = true

    const tick = async () => {
      if (busy) return
      busy = true
      const launch = first
      first = false
      try {
        const now = Date.now()
        const due = await collectDueReminders(db, now)
        for (const r of due) {
          if (!alive) return
          const { title, body } = reminderText(r, now)
          const native = await notifyNative(title, body)
          if (!native || document.visibilityState === 'visible') toast(`${title}. ${body}`)
        }
        if (due.length) bump()

        for (const r of await collectDueBillReminders(db, now)) {
          if (!alive) return
          const { title, body } = billReminderText(r)
          const native = await notifyNative(title, body)
          if (!native || document.visibilityState === 'visible') toast(`${title}. ${body}`)
        }

        for (const r of await collectInvoiceReminders(db, now)) {
          if (!alive) return
          const { title, body } = invoiceReminderText(r)
          const native = await notifyNative(title, body)
          if (!native || document.visibilityState === 'visible') toast(`${title}. ${body}`)
        }

        if (notif && (launch || new Date().getHours() >= EXPIRY_FROM_HOUR)) {
          await notifyExpiring(db, warnDays)
        }
      } catch (e) {
        // pengingat gagal tidak boleh mengganggu aplikasi
        console.error('Pengingat gagal diperiksa', e)
      } finally {
        busy = false
      }
    }

    tick()
    const id = setInterval(tick, EVERY_MS)
    let unlisten: (() => void) | null = null
    if (isTauri()) {
      import('@tauri-apps/api/event')
        .then(({ listen }) => listen('tick', () => { tick() }))
        .then((u) => { if (alive) unlisten = u; else u() })
        .catch(() => {})
    }
    return () => {
      alive = false
      clearInterval(id)
      unlisten?.()
    }
  }, [db, bump, toast, notif, warnDays])
}
