import { useEffect } from 'react'
import { useApp } from '@/app/context'
import { useToast } from '@/components/ui'
import { collectDueReminders, reminderText } from '@/db/events'
import { notifyNative } from './reminders'

const EVERY_MS = 60_000

/**
 * Cek pengingat kegiatan saat aplikasi dibuka (menyusul yang terlewat) lalu tiap menit.
 * Notifikasi Windows dipakai bila bisa, supaya tetap terlihat saat jendela disembunyikan ke tray.
 */
export function useReminders() {
  const { db, bump } = useApp()
  const toast = useToast()

  useEffect(() => {
    let alive = true
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
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
      } catch (e) {
        // pengingat gagal tidak boleh mengganggu aplikasi
        console.error('Pengingat gagal diperiksa', e)
      } finally {
        busy = false
      }
    }
    tick()
    const id = setInterval(tick, EVERY_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [db, bump, toast])
}
