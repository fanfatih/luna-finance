/**
 * Sensor identitas top spender dengan pola tetap, sama dengan skrip poster Top Spender.
 * Email: 3 huruf awal + bintang + 2 karakter akhir bagian lokal, domain tetap tampil.
 *   budisantoso99@gmail.com -> BUD********99@GMAIL.COM
 * Nama: kata pertama 3 huruf awal, kata tengah disensor penuh, kata terakhir 2 huruf akhir.
 *   Budiman Santoso -> BUD**** *****SO
 */
function maskToken(s: string, head = 3, tail = 2, minStars = 3, maxStars = 10): string {
  const n = s.length
  if (n <= 2) return s.slice(0, 1) + '*'.repeat(Math.max(n - 1, 1))
  if (n <= head + tail + 1) { head = 1; tail = 1 }
  const mid = Math.max(minStars, Math.min(maxStars, n - head - tail))
  return s.slice(0, head) + '*'.repeat(mid) + (tail ? s.slice(-tail) : '')
}

function maskEmail(addr: string): string {
  const raw = addr.trim()
  const at = raw.indexOf('@')
  const local = at < 0 ? raw : raw.slice(0, at)
  const domain = at < 0 ? '' : raw.slice(at + 1)
  return `${maskToken(local)}@${domain}`.toUpperCase()
}

function maskName(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 1) return maskToken(words[0]).toUpperCase()
  const last = words.length - 1
  return words
    .map((w, i) => {
      if (i === 0) return w.slice(0, 3) + '*'.repeat(Math.max(w.length - 3, 0))
      if (i === last) return '*'.repeat(Math.max(w.length - 2, 2)) + w.slice(-2)
      return '*'.repeat(Math.min(w.length, 6))
    })
    .join(' ')
    .toUpperCase()
}

export function maskIdentity(raw: string): string {
  const v = (raw ?? '').trim()
  if (!v) return ''
  return v.includes('@') ? maskEmail(v) : maskName(v)
}
