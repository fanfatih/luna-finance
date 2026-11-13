import { useEffect, useRef, useState } from 'react'
import { Button, Field, Input } from '@/components/ui'
import { deriveKey, verifyPin, type PinRecord } from '@/lib/crypto'

/** Layar PIN. Setelah 5 salah berturut-turut, ada jeda 10 detik sebelum bisa mencoba lagi. */
export function Lock({
  pin, name, onUnlock,
}: { pin: PinRecord; name: string; onUnlock: (key: CryptoKey) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fails, setFails] = useState(0)
  const [wait, setWait] = useState(0)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => ref.current?.focus(), [])
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || wait > 0 || !value) return
    setBusy(true)
    try {
      if (await verifyPin(value, pin)) {
        onUnlock(await deriveKey(value, pin))
        return
      }
      const n = fails + 1
      setFails(n)
      setValue('')
      if (n % 5 === 0) {
        setWait(10)
        setError('PIN salah 5 kali. Tunggu sebentar sebelum mencoba lagi.')
      } else {
        setError('PIN salah. Coba lagi.')
      }
      ref.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{name ? `Halo, ${name}` : 'Luna Finance'}</h1>
          <p className="mt-1 text-muted">Masukkan PIN untuk membuka aplikasi.</p>
        </div>
        <Field label="PIN" htmlFor="pin" error={error}>
          <Input
            ref={ref} id="pin" type="password" inputMode="numeric" autoComplete="off"
            value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
            disabled={wait > 0} maxLength={12} aria-invalid={!!error}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={wait > 0 || !value}>
          {wait > 0 ? `Tunggu ${wait} detik` : 'Buka'}
        </Button>
      </form>
    </div>
  )
}
