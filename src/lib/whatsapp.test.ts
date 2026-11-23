import { describe, expect, it } from 'vitest'
import { waLink, waNumber } from './whatsapp'

describe('waNumber', () => {
  it('mengubah nomor lokal dan internasional jadi format wa.me', () => {
    expect(waNumber('081234567890')).toBe('6281234567890')
    expect(waNumber('+62 812-3456-7890')).toBe('6281234567890')
    expect(waNumber('6281234567890')).toBe('6281234567890')
    expect(waNumber('81234567890')).toBe('6281234567890')
    expect(waNumber('60123456789')).toBe('60123456789')
  })

  it('bukan nomor berarti null', () => {
    expect(waNumber(null)).toBeNull()
    expect(waNumber('')).toBeNull()
    expect(waNumber('@budi_tg')).toBeNull()
    expect(waNumber('budi')).toBeNull()
    expect(waNumber('0812')).toBeNull()
  })
})

describe('waLink', () => {
  it('menyandikan teks, termasuk baris baru dan karakter khusus', () => {
    const { url, withText } = waLink('6281234567890', 'Halo Budi\nLink: https://x.co/?a=1&b=2')
    expect(withText).toBe(true)
    expect(url).toBe('https://wa.me/6281234567890?text=Halo%20Budi%0ALink%3A%20https%3A%2F%2Fx.co%2F%3Fa%3D1%26b%3D2')
  })

  it('teks terlalu panjang dibuang dan hanya membuka chat', () => {
    const r = waLink('6281234567890', 'x'.repeat(3000))
    expect(r).toEqual({ url: 'https://wa.me/6281234567890', withText: false })
  })

  it('tanpa teks hanya membuka chat', () => {
    expect(waLink('6281234567890')).toEqual({ url: 'https://wa.me/6281234567890', withText: false })
  })
})
