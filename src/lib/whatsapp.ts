import { isTauri } from '@/db'
import { cleanPhone } from './phone'

/** Nomor WhatsApp dari isian kontak customer, atau null kalau isinya bukan nomor (misalnya @username Telegram). */
export function waNumber(contact: string | null | undefined): string | null {
  if (!contact) return null
  const digits = cleanPhone(contact.trim())
  if (!/^\d{8,15}$/.test(digits)) return null
  if (digits.startsWith('0')) return `62${digits.slice(1)}`
  if (digits.startsWith('8')) return `62${digits}`
  return digits
}

/** Batas aman panjang alamat. Di atas ini Windows bisa menolak membukanya. */
const MAX_URL = 1900

export function waLink(number: string, text?: string): { url: string; withText: boolean } {
  const base = `https://wa.me/${number}`
  if (!text) return { url: base, withText: false }
  const full = `${base}?text=${encodeURIComponent(text)}`
  return full.length <= MAX_URL ? { url: full, withText: true } : { url: base, withText: false }
}

/** Buka chat WhatsApp di browser atau aplikasi WhatsApp. withText false berarti teks tidak ikut terbawa. */
export async function openWhatsApp(number: string, text: string): Promise<{ withText: boolean }> {
  const { url, withText } = waLink(number, text)
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_whatsapp', { url })
  } else {
    window.open(url, '_blank', 'noopener')
  }
  return { withText }
}
