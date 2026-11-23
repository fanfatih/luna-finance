/** Template teks WhatsApp. Baris yang butuh isian kosong dibuang supaya hasilnya tidak bolong. */

export type TemplateKind = 'tim' | 'akun'

export const PLACEHOLDERS = ['nama', 'produk', 'durasi', 'sampai', 'link', 'akun', 'password', 'langkah'] as const
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
    '{langkah}',
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
    '{langkah}',
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

/** Isian yang boleh dipakai di dalam langkah aplikasi. {langkah} sendiri tidak, supaya tidak berputar. */
export const STEP_PLACEHOLDERS = PLACEHOLDERS.filter((p) => p !== 'langkah')

/** Contoh yang tampil di kolom langkah selagi masih kosong. */
export const STEPS_EXAMPLE = [
  'Cara bergabung:',
  '1. Buka link undangan di atas',
  '2. Masuk dengan email yang kamu kasih tadi',
  '3. Terima undangan timnya',
].join('\n')

/**
 * Susun pesan lengkap. Langkah aplikasi dirender dulu dengan isian yang sama, lalu dimasukkan ke {langkah}.
 * Aplikasi tanpa langkah membuat bagian {langkah} hilang tanpa meninggalkan baris kosong.
 */
export function buildMessage(tpl: string, steps: string | null | undefined, vars: Partial<Record<Placeholder, string>>): string {
  const { langkah: _ignored, ...rest } = vars
  void _ignored
  const rendered = steps ? renderTemplate(steps, rest) : ''
  return renderTemplate(tpl, { ...rest, langkah: rendered })
}

/** Template lama yang sudah diubah tidak punya {langkah}. Sisipkan sebelum paragraf penutup. */
export function addStepsPlaceholder(tpl: string): string {
  if (tpl.includes('{langkah}')) return tpl
  const text = tpl.replace(/\s+$/, '')
  const i = text.lastIndexOf('\n\n')
  if (i < 0) return `${text}\n\n{langkah}`
  return `${text.slice(0, i)}\n\n{langkah}${text.slice(i)}`
}

/** Jenis template yang cocok untuk satu langganan, dilihat dari tipe aplikasinya. */
export function kindFor(p: { has_team: number; has_account: number }, accountLogin: string | null): TemplateKind {
  if (p.has_team && !p.has_account) return 'tim'
  if (p.has_account && !p.has_team) return 'akun'
  if (p.has_team && p.has_account) return accountLogin ? 'akun' : 'tim'
  return 'akun'
}

/** Template yang sudah pernah diubah belum punya {langkah}. Aplikasi yang punya langkah tetap menampilkannya. */
export function effectiveTemplate(tpl: string, steps: string | null | undefined): string {
  return steps && steps.trim() ? addStepsPlaceholder(tpl) : tpl
}
