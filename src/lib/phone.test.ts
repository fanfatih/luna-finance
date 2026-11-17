import { describe, expect, it } from 'vitest'
import { cleanPhone } from './phone'

describe('cleanPhone', () => {
  it('membuang plus, strip, spasi, dan kurung dari nomor WhatsApp', () => {
    expect(cleanPhone('+62 812-3456-7890')).toBe('6281234567890')
    expect(cleanPhone('(0812) 3456 7890')).toBe('081234567890')
    expect(cleanPhone('0812.3456.7890')).toBe('081234567890')
  })

  it('membuang karakter tak terlihat yang ikut tertempel dari WhatsApp', () => {
    expect(cleanPhone('‪+62 812-3456-7890‬')).toBe('6281234567890')
    expect(cleanPhone('+62 812')).toBe('62812')
  })

  it('membiarkan isian yang bukan nomor', () => {
    expect(cleanPhone('@budi_s')).toBe('@budi_s')
    expect(cleanPhone('budi@mail.com')).toBe('budi@mail.com')
    expect(cleanPhone('0812 abc')).toBe('0812 abc')
  })

  it('aman untuk isian kosong dan sedang diketik', () => {
    expect(cleanPhone('')).toBe('')
    expect(cleanPhone('+')).toBe('')
    expect(cleanPhone('08')).toBe('08')
  })
})
