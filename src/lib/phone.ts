/**
 * Nomor yang ditempel dari WhatsApp biasanya berbentuk "+62 812-3456-7890".
 * Kalau isinya cuma angka dan tanda baca nomor, sisakan angkanya saja.
 * Isian lain (misalnya @username Telegram) dibiarkan apa adanya.
 */
const PHONE_CHARS = /^[\d\s+\-(). ‎‏‪-‬]*$/

export function cleanPhone(raw: string): string {
  if (!PHONE_CHARS.test(raw)) return raw
  return raw.replace(/\D/g, '')
}
