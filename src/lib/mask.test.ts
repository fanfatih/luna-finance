import { describe, expect, it } from 'vitest'
import { maskIdentity } from './mask'

describe('maskIdentity', () => {
  it('menyensor email dengan pola poster', () => {
    expect(maskIdentity('budisantoso99@gmail.com')).toBe('BUD********99@GMAIL.COM')
    expect(maskIdentity('  andi226@gmail.com ')).toBe('AND***26@GMAIL.COM')
  })
  it('menyensor nama', () => {
    expect(maskIdentity('Budiman Santoso')).toBe('BUD**** *****SO')
    expect(maskIdentity('Budi Agus Santoso')).toBe('BUD* **** *****SO')
  })
  it('satu kata dan yang sangat pendek', () => {
    expect(maskIdentity('luthfan')).toBe('LUT***AN')
    expect(maskIdentity('ab')).toBe('A*')
    expect(maskIdentity('')).toBe('')
  })
})
