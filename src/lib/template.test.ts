import { describe, expect, it } from 'vitest'
import { addStepsPlaceholder, buildMessage, DEFAULT_TEMPLATES, effectiveTemplate, kindFor, renderTemplate } from './template'

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

describe('langkah per aplikasi', () => {
  const vars = { nama: 'Budi', produk: 'ChatGPT Plus', durasi: '1 bulan', sampai: '23 Des 2026', link: 'https://x.co/invite' }
  const steps = 'Cara bergabung:\n1. Buka {link}\n2. Masuk pakai email ini: {akun}\n3. Terima undangan'

  it('memasukkan langkah ke template dan mengisi isian di dalamnya', () => {
    const t = buildMessage(DEFAULT_TEMPLATES.tim, steps, vars)
    expect(t).toContain('Cara bergabung:\n1. Buka https://x.co/invite')
    expect(t).toContain('3. Terima undangan')
    expect(t.indexOf('Cara bergabung')).toBeGreaterThan(t.indexOf('Link undangan tim'))
    expect(t.indexOf('Cara bergabung')).toBeLessThan(t.indexOf('Kalau ada kendala'))
  })

  it('baris langkah yang isiannya kosong dibuang, baris lain tetap', () => {
    const t = buildMessage(DEFAULT_TEMPLATES.tim, steps, vars)
    expect(t).not.toContain('2. Masuk pakai email ini')
    expect(t).not.toMatch(/\{\w+\}/)
  })

  it('aplikasi tanpa langkah tidak meninggalkan baris kosong berlebih', () => {
    for (const steps of [null, undefined, '', '   ']) {
      const t = buildMessage(DEFAULT_TEMPLATES.tim, steps, vars)
      expect(t).not.toMatch(/\n{3,}/)
      expect(t).not.toContain('{langkah}')
      expect(t).toContain('Kalau ada kendala')
    }
  })

  it('{langkah} di dalam langkah tidak berputar', () => {
    const t = buildMessage(DEFAULT_TEMPLATES.tim, 'Baca {langkah}\nLanjut', vars)
    expect(t).toContain('Lanjut')
    expect(t).not.toContain('Baca')
  })

  it('template akun juga memakai langkah', () => {
    const t = buildMessage(DEFAULT_TEMPLATES.akun, 'Login di {produk}', { ...vars, akun: 'a@b.c', password: 'rahasia' })
    expect(t).toContain('Login di ChatGPT Plus')
    expect(t).toContain('Password: rahasia')
  })

  it('addStepsPlaceholder menyisipkan sebelum paragraf penutup dan tidak dobel', () => {
    const custom = 'Halo {nama}\n\nProduk: {produk}\n\nTerima kasih ya'
    const added = addStepsPlaceholder(custom)
    expect(added).toBe('Halo {nama}\n\nProduk: {produk}\n\n{langkah}\n\nTerima kasih ya')
    expect(addStepsPlaceholder(added)).toBe(added)
    expect(addStepsPlaceholder('Satu paragraf')).toBe('Satu paragraf\n\n{langkah}')
    expect(addStepsPlaceholder(DEFAULT_TEMPLATES.tim)).toBe(DEFAULT_TEMPLATES.tim)
  })
})

describe('jenis template dan template lama', () => {
  it('kindFor memilih dari tipe aplikasi', () => {
    expect(kindFor({ has_team: 1, has_account: 0 }, null)).toBe('tim')
    expect(kindFor({ has_team: 0, has_account: 1 }, null)).toBe('akun')
    expect(kindFor({ has_team: 1, has_account: 1 }, 'a@b.c')).toBe('akun')
    expect(kindFor({ has_team: 1, has_account: 1 }, null)).toBe('tim')
    expect(kindFor({ has_team: 0, has_account: 0 }, null)).toBe('akun')
  })

  it('effectiveTemplate menyisipkan {langkah} hanya kalau aplikasinya punya langkah', () => {
    const old = 'Halo {nama}\n\nProduk: {produk}\n\nTerima kasih'
    expect(effectiveTemplate(old, null)).toBe(old)
    expect(effectiveTemplate(old, '  ')).toBe(old)
    expect(effectiveTemplate(old, '1. Buka')).toContain('{langkah}')
    const t = buildMessage(effectiveTemplate(old, '1. Buka {link}'), '1. Buka {link}', { nama: 'Ani', produk: 'X', link: 'https://l.co' })
    expect(t).toBe('Halo Ani\n\nProduk: X\n\n1. Buka https://l.co\n\nTerima kasih')
  })
})
