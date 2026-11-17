import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATES, renderTemplate } from './template'

describe('renderTemplate', () => {
  it('mengisi semua isian', () => {
    const t = renderTemplate(DEFAULT_TEMPLATES.tim, {
      nama: 'Budi', produk: 'Canva Pro', durasi: '1 bulan', sampai: '17 Des 2026', link: 'https://canva.com/team/x',
    })
    expect(t).toContain('Halo Budi,')
    expect(t).toContain('Produk: Canva Pro')
    expect(t).toContain('Aktif sampai: 17 Des 2026')
    expect(t).toContain('https://canva.com/team/x')
    expect(t).not.toMatch(/\{\w+\}/)
  })

  it('membuang baris yang isiannya kosong dan merapikan baris kosong berlebih', () => {
    const t = renderTemplate(DEFAULT_TEMPLATES.akun, { nama: 'kak', produk: 'Netflix', durasi: '1 bulan', akun: 'a@b.c' })
    expect(t).not.toContain('Password')
    expect(t).not.toContain('Aktif sampai')
    expect(t).toContain('Akun: a@b.c')
    expect(t).not.toMatch(/\n{3,}/)
  })

  it('isian yang tidak dikenal dibiarkan apa adanya', () => {
    expect(renderTemplate('Kode {voucher} untuk {nama}', { nama: 'Ani' })).toBe('Kode {voucher} untuk Ani')
  })

  it('tidak menafsirkan karakter khusus pada isian', () => {
    expect(renderTemplate('Link: {link}', { link: 'https://x.co/?a=$1&b=$&' })).toBe('Link: https://x.co/?a=$1&b=$&')
  })
})
