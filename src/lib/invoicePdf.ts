import { formatDate } from './date'
import {
  invoiceKindLabel, lineTotal, remainingAfter, type InvoiceIdentity, type InvoiceKind, type InvoiceSnapshot, type InvoiceStatus,
} from './momentum'
import { rupiah } from './money'

export interface InvoicePdfInput {
  identity: InvoiceIdentity
  number: string
  kind: InvoiceKind
  status: InvoiceStatus
  issueDate: string
  dueDate: string
  amount: number
  note: string | null
  snapshot: InvoiceSnapshot
}

type Rgb = [number, number, number]
const INK: Rgb = [17, 24, 39]
const GRAY: Rgb = [107, 114, 128]
const LINE: Rgb = [209, 213, 219]
const BAND: Rgb = [243, 244, 246]

const PAGE_H = 297
const LEFT = 18
const RIGHT = 192
const WIDTH = RIGHT - LEFT
const BOTTOM = 270

/** Font bawaan PDF hanya mengenal huruf Latin dasar. Karakter lain (emoji, aksara) diganti tanda tanya. */
export function pdfSafe(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/\t+/g, ' ').replace(/[^\n\x20-\x7E -ÿ]/gu, '?')
}

/** Ukuran gambar logo yang muat di kotak maksimal, tanpa mengubah perbandingan. */
export function fitLogo(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 }
  const k = Math.min(maxW / w, maxH / h)
  return { w: w * k, h: h * k }
}

/** Buat PDF invoice A4 sepenuhnya di perangkat ini. Dimuat saat dibutuhkan saja karena pustakanya besar. */
export async function buildInvoicePdf(i: InvoicePdfInput): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const s = i.snapshot
  const id = i.identity

  const color = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2])
  const font = (size: number, bold = false, c: Rgb = INK) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    color(c)
  }
  const wrap = (t: string, w: number): string[] => doc.splitTextToSize(pdfSafe(t), w) as string[]
  const text = (t: string, x: number, y: number, align: 'left' | 'right' = 'left') => doc.text(pdfSafe(t), x, y, { align })
  const rule = (y: number, c: Rgb = LINE, w = 0.2) => {
    doc.setDrawColor(c[0], c[1], c[2])
    doc.setLineWidth(w)
    doc.line(LEFT, y, RIGHT, y)
  }

  /* ----- Kepala: logo atau nama usaha di kiri, judul di kanan ----- */
  let y = 18
  let leftEnd = y
  if (id.logo) {
    const box = fitLogo(id.logoW, id.logoH, 46, 18)
    try {
      doc.addImage(id.logo, id.logo.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', LEFT, y, box.w, box.h)
      leftEnd = y + box.h + 5
    } catch {
      leftEnd = y
    }
  }
  font(id.logo && leftEnd > y ? 10 : 15, true)
  text(id.name, LEFT, leftEnd > y ? leftEnd + 1 : y + 6)
  leftEnd = Math.max(leftEnd, y) + (id.logo && leftEnd > y ? 5 : 11)
  font(9, false, GRAY)
  for (const line of [...wrap(id.address, 78), ...wrap(id.contact, 78)].filter(Boolean)) {
    text(line, LEFT, leftEnd)
    leftEnd += 4.2
  }

  font(24, true)
  text('INVOICE', RIGHT, 25, 'right')
  font(10, false, GRAY)
  text(i.number, RIGHT, 32, 'right')
  if (i.status === 'lunas' || i.status === 'batal') {
    const label = i.status === 'lunas' ? 'LUNAS' : 'DIBATALKAN'
    font(11, true)
    const w = doc.getTextWidth(label) + 8
    doc.setDrawColor(INK[0], INK[1], INK[2])
    doc.setLineWidth(0.5)
    doc.rect(RIGHT - w, 36, w, 8.5)
    text(label, RIGHT - w / 2, 41.9)
    doc.text('', 0, 0)
  }

  y = Math.max(leftEnd, 48) + 4
  rule(y)
  y += 9

  /* ----- Penerima dan tanggal ----- */
  const infoTop = y
  font(8.5, false, GRAY)
  text('Ditagihkan kepada', LEFT, y)
  font(12, true)
  let ly = y + 6
  for (const l of wrap(s.clientName, 86)) { text(l, LEFT, ly); ly += 5.4 }
  font(9.5, false, INK)
  for (const l of [...wrap(s.clientContact ?? '', 86), ...wrap(s.clientAddress ?? '', 86)].filter(Boolean)) {
    text(l, LEFT, ly)
    ly += 4.6
  }

  const meta: [string, string][] = [
    ['Tanggal terbit', formatDate(i.issueDate)],
    ['Jatuh tempo', formatDate(i.dueDate)],
    ['Jenis', invoiceKindLabel(i.kind)],
  ]
  let ry = infoTop
  for (const [k, v] of meta) {
    font(9.5, false, GRAY)
    text(k, 122, ry)
    font(9.5, true)
    text(v, RIGHT, ry, 'right')
    ry += 5.6
  }

  y = Math.max(ly, ry) + 3
  font(8.5, false, GRAY)
  text('Acara', LEFT, y)
  y += 5.6
  font(11, true)
  for (const l of wrap(s.projectName, WIDTH)) { text(l, LEFT, y); y += 5.2 }
  const where = [s.eventDate ? formatDate(s.eventDate) : '', s.venue ?? ''].filter(Boolean).join(', ')
  if (where) {
    font(9.5, false, GRAY)
    for (const l of wrap(where, WIDTH)) { text(l, LEFT, y); y += 4.6 }
  }
  y += 5

  /* ----- Tabel item ----- */
  const header = () => {
    doc.setFillColor(BAND[0], BAND[1], BAND[2])
    doc.rect(LEFT, y, WIDTH, 8, 'F')
    font(9, true, GRAY)
    text('Deskripsi', LEFT + 3, y + 5.4)
    text('Jml', 128, y + 5.4, 'right')
    text('Harga satuan', 160, y + 5.4, 'right')
    text('Jumlah', RIGHT - 3, y + 5.4, 'right')
    y += 8
  }
  header()
  const rows = s.items.length ? s.items : []
  for (const it of rows) {
    const desc = wrap(it.name, 92)
    const h = desc.length * 4.8 + 4.4
    if (y + h > BOTTOM) {
      doc.addPage()
      y = 20
      header()
    }
    font(10)
    desc.forEach((l, n) => text(l, LEFT + 3, y + 5.2 + n * 4.8))
    text(String(it.qty), 128, y + 5.2, 'right')
    text(rupiah(it.unitPrice), 160, y + 5.2, 'right')
    text(rupiah(lineTotal({ qty: it.qty, unit_price: it.unitPrice })), RIGHT - 3, y + 5.2, 'right')
    y += h
    rule(y)
  }
  if (!rows.length) {
    font(10, false, GRAY)
    text('Belum ada item.', LEFT + 3, y + 5.2)
    y += 9
    rule(y)
  }
  y += 7

  /* ----- Ringkasan dan jumlah ditagih ----- */
  const subtotal = s.items.reduce((a, it) => a + lineTotal({ qty: it.qty, unit_price: it.unitPrice }), 0)
  const sums: [string, string, boolean][] = [['Subtotal', rupiah(subtotal), false]]
  if (s.discount > 0) sums.push(['Diskon', `-${rupiah(s.discount)}`, false])
  sums.push(['Total project', rupiah(s.total), true])
  if (s.paidBefore > 0) sums.push(['Sudah dibayar', rupiah(s.paidBefore), false])
  const blockH = sums.length * 6 + 3 + 17 + 8
  if (y + blockH > BOTTOM) {
    doc.addPage()
    y = 20
  }
  const top = y

  // Rekening di kiri, sejajar dengan ringkasan
  let py = top
  const payLines = [id.bank && id.accountNo ? `${id.bank} ${id.accountNo}` : id.accountNo, id.accountName ? `a.n. ${id.accountName}` : ''].filter(Boolean)
  if (payLines.length) {
    font(8.5, false, GRAY)
    text('Pembayaran ke', LEFT, py)
    py += 6
    font(11, true)
    text(payLines[0], LEFT, py)
    py += 5.4
    if (payLines[1]) {
      font(10, false)
      text(payLines[1], LEFT, py)
      py += 5
    }
  }

  let sy = top
  for (const [k, v, bold] of sums) {
    font(10, bold, bold ? INK : GRAY)
    text(k, 124, sy)
    font(10, bold)
    text(v, RIGHT, sy, 'right')
    sy += 6
  }
  sy += 1
  doc.setFillColor(INK[0], INK[1], INK[2])
  doc.rect(118, sy, RIGHT - 118, 17, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  text('Jumlah ditagih', 122, sy + 6.2)
  doc.setFontSize(8.5)
  text(invoiceKindLabel(i.kind), 122, sy + 11.6)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  text(rupiah(i.amount), RIGHT - 4, sy + 10.6, 'right')
  sy += 17
  if (i.kind !== 'penuh' && s.total > 0) {
    font(9, false, GRAY)
    text(`Sisa setelah invoice ini: ${rupiah(remainingAfter(s, i.amount))}`, RIGHT, sy + 5.6, 'right')
    sy += 6
  }

  y = Math.max(py, sy) + 10

  /* ----- Catatan dan penutup ----- */
  const note = i.note?.trim()
  if (note) {
    const lines = wrap(note, WIDTH)
    if (y + 6 + lines.length * 4.6 > BOTTOM) { doc.addPage(); y = 20 }
    font(8.5, false, GRAY)
    text('Catatan', LEFT, y)
    y += 5.4
    font(9.5)
    for (const l of lines) { text(l, LEFT, y); y += 4.6 }
    y += 4
  }
  const footer = id.footer.trim()
  if (footer) {
    const lines = wrap(footer, WIDTH)
    if (y + lines.length * 4.4 > BOTTOM) { doc.addPage(); y = 20 }
    font(9, false, GRAY)
    for (const l of lines) { text(l, LEFT, y); y += 4.4 }
  }

  const pages = doc.getNumberOfPages()
  if (pages > 1) {
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p)
      font(8, false, GRAY)
      text(`Halaman ${p} dari ${pages}`, 105, PAGE_H - 10)
    }
  }

  return new Uint8Array(doc.output('arraybuffer'))
}
