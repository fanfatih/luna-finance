import { Minus, Square, X } from 'lucide-react'
import { isTauri, windowAction } from '@/lib/platform'

/**
 * Bar jendela kustom (sesuai rancangan: bar abu-abu dengan tombol tutup merah).
 * Tombol hanya muncul di aplikasi desktop, karena di peramban tidak ada jendela yang bisa dikendalikan.
 */
export function TitleBar() {
  const desktop = isTauri()
  return (
    <div
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-subtle pl-3"
    >
      <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight">
        Luna Finance
      </span>
      {desktop && (
        <div className="flex h-full">
          <button
            type="button" aria-label="Kecilkan jendela" onClick={() => windowAction('minimize')}
            className="flex w-11 items-center justify-center text-muted hover:bg-line hover:text-fg"
          >
            <Minus className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button" aria-label="Besarkan atau kecilkan jendela" onClick={() => windowAction('toggleMaximize')}
            className="flex w-11 items-center justify-center text-muted hover:bg-line hover:text-fg"
          >
            <Square className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button" aria-label="Tutup jendela" title="Tutup ke tray. Keluar penuh lewat ikon tray." onClick={() => windowAction('close')}
            className="flex w-11 items-center justify-center bg-danger text-white hover:opacity-90"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
