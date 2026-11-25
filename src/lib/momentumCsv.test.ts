import { describe, expect, it } from 'vitest'
import { csvCell, csvRow, marginPct, projectsCsv, yearCsv } from './momentumCsv'

describe('sel CSV', () => {
  it('angka apa adanya, teks biasa tanpa petik, kosong jadi kosong', () => {
    expect(csvCell(1500000)).toBe('1500000')
    expect(csvCell('Pernikahan')).toBe('Pernikahan')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('koma, petik, dan baris baru dibungkus dengan petik', () => {
    expect(csvCell('Andi, Sari')).toBe('"Andi, Sari"')
    expect(csvCell('Dia bilang "ya"')).toBe('"Dia bilang ""ya"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })

  it('teks yang diawali rumus diberi petik tunggal', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+62812')).toBe(`'+62812`)
    expect(csvCell('@kirim')).toBe(`'@kirim`)
    expect(csvCell('-5')).toBe(`'-5`)
    // angka negatif sungguhan tetap angka
    expect(csvCell(-5)).toBe('-5')
  })

  it('csvRow menyambung sel dengan koma', () => {
    expect(csvRow(['a', 'b,c', 3, null])).toBe('a,"b,c",3,')
  })
})

describe('laporan CSV', () => {
  it('margin dibulatkan, kosong bila nilai nol', () => {
    expect(marginPct(8_000_000, 2_000_000)).toBe(75)
    expect(marginPct(3, 1)).toBe(67)
    expect(marginPct(0, 500)).toBeNull()
    expect(marginPct(1_000_000, 1_500_000)).toBe(-50)
  })

  it('laporan project: judul, baris, laba, dan margin', () => {
    const csv = projectsCsv([
      { name: 'Pernikahan, Andi', client_name: 'Sari', event_date: '2026-12-20', stage: 'booking', total: 8_000_000, paid: 2_400_000, cost: 2_000_000 },
      { name: 'Prewed', client_name: 'Budi', event_date: null, stage: 'inquiry', total: 0, paid: 0, cost: 0 },
    ])
    const lines = csv.replace('﻿', '').split('\n')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(lines[0]).toBe('Project,Klien,Tanggal acara,Tahap,Nilai project,Sudah dibayar,Biaya project,Laba project,Margin (%)')
    expect(lines[1]).toBe('"Pernikahan, Andi",Sari,2026-12-20,Booking,8000000,2400000,2000000,6000000,75')
    expect(lines[2]).toBe('Prewed,Budi,,Inquiry,0,0,0,0,')
  })

  it('laporan tahunan: selisih tiap bulan', () => {
    const csv = yearCsv([{ ym: '2026-11', income: 3_000_000, costs: 1_200_000 }, { ym: '2026-12', income: 0, costs: 500_000 }])
    const lines = csv.replace('﻿', '').split('\n')
    expect(lines).toEqual(['Bulan,Uang masuk,Biaya,Laba bersih', '2026-11,3000000,1200000,1800000', '2026-12,0,500000,-500000'])
  })
})
