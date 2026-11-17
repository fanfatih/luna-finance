/** Template teks WhatsApp. Baris yang butuh isian kosong dibuang supaya hasilnya tidak bolong. */

export type TemplateKind = 'tim' | 'akun'

export const PLACEHOLDERS = ['nama', 'produk', 'durasi', 'sampai', 'link', 'akun', 'password'] as const
export type Placeholder = (typeof PLACEHOLDERS)[number]

export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  tim: [
    'Halo {nama}, terima kasih sudah order di Lunapremium.',
    '',
    'Pesanan kamu sudah aktif:',
    'Produk: {produk}',
    'Durasi: {durasi}',
    'Aktif sampai: {sampai}',
    '',
    'Link undangan tim:',
    '{link}',
    '',
    'Buka link di atas untuk bergabung. Kalau ada kendala, kabari aja ya.',
  ].join('\n'),
  akun: [
    'Halo {nama}, terima kasih sudah order di Lunapremium.',
    '',
    'Pesanan kamu sudah aktif:',
    'Produk: {produk}',
    'Durasi: {durasi}',
    'Aktif sampai: {sampai}',
    '',
    'Akun: {akun}',
    'Password: {password}',
    '',
    'Kalau ada kendala, kabari aja ya.',
  ].join('\n'),
}

export function renderTemplate(tpl: string, vars: Partial<Record<Placeholder, string>>): string {
  const lines: string[] = []
  for (const line of tpl.split(/\r?\n/)) {
    let skip = false
    const out = line.replace(/\{(\w+)\}/g, (whole, key: string) => {
      if (!(PLACEHOLDERS as readonly string[]).includes(key)) return whole
      const v = (vars[key as Placeholder] ?? '').trim()
      if (!v) skip = true
      return v
    })
    if (!skip) lines.push(out)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export const templateKey = (k: TemplateKind) => `wa_tpl_${k}`
