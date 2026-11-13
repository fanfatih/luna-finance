import type { Theme } from '@/app/context'

const KEY = 'luna-theme'

export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'terang' || v === 'gelap' || v === 'sistem') return v
  } catch {
    // penyimpanan diblokir: pakai bawaan
  }
  return 'sistem'
}

export function applyTheme(theme: Theme): void {
  const dark = theme === 'gelap' || (theme === 'sistem' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // tidak masalah, tema tetap berlaku selama aplikasi terbuka
  }
}

/** Ikuti perubahan tema Windows bila pilihannya "Ikuti Windows". Mengembalikan fungsi pembersih. */
export function watchSystemTheme(theme: Theme): () => void {
  if (theme !== 'sistem') return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const on = () => applyTheme('sistem')
  mq.addEventListener('change', on)
  return () => mq.removeEventListener('change', on)
}
