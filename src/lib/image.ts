export interface LogoResult {
  dataUrl: string
  w: number
  h: number
}

/** Batas isi logo yang disimpan, sama dengan yang diterima saveIdentity. */
export const LOGO_MAX_CHARS = 700_000
const MAX_W = 600
const MAX_H = 240

/** Ukuran akhir logo: diperkecil bila lebih besar dari kotak, tidak pernah diperbesar. */
export function logoSize(w: number, h: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 }
  const k = Math.min(1, MAX_W / w, MAX_H / h)
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('File itu tidak bisa dibuka sebagai gambar.'))
    }
    img.src = url
  })
}

/**
 * Kecilkan gambar logo dari file yang dipilih dan ubah jadi data URL. PNG dulu supaya latar transparan terjaga,
 * lalu JPEG bila hasilnya masih terlalu besar. Semuanya di perangkat ini, tidak ada yang dikirim ke mana pun.
 */
export async function prepareLogo(file: File): Promise<LogoResult> {
  if (!file.type.startsWith('image/')) throw new Error('Pilih file gambar (PNG atau JPG).')
  const img = await loadImage(file)
  const { w, h } = logoSize(img.naturalWidth, img.naturalHeight)
  if (!w || !h) throw new Error('Ukuran gambar tidak terbaca. Coba file PNG atau JPG.')
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Gambar tidak bisa diproses di perangkat ini.')
  ctx.drawImage(img, 0, 0, w, h)
  let dataUrl = canvas.toDataURL('image/png')
  if (dataUrl.length > LOGO_MAX_CHARS) {
    // JPEG tidak mengenal transparan, jadi latarnya diputihkan.
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  }
  if (dataUrl.length > LOGO_MAX_CHARS) throw new Error('Gambar terlalu rumit untuk logo. Pakai gambar yang lebih sederhana.')
  return { dataUrl, w, h }
}
