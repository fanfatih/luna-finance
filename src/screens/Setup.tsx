import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Field, IconButton, Input, NominalInput } from '@/components/ui'
import type { Db } from '@/db'
import { addChannel, setSetting } from '@/db/finance'
import { createPinRecord, deriveKey, type PinRecord } from '@/lib/crypto'
import { todayStr } from '@/lib/date'

interface Row { key: number; name: string; raw: string; value: number | null }

const DEFAULT_CHANNELS = ['Seabank', 'Flip', 'Jago', 'Gopay', 'Duitku', 'Digiflazz']

/** Pengaturan awal: nama, PIN (opsional), channel dan saldo awal. Hanya muncul sekali. */
export function Setup({
  db, onDone,
}: { db: Db; onDone: (key: CryptoKey | null, pin: PinRecord | null) => void }) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [startDate, setStartDate] = useState(todayStr())
  const [rows, setRows] = useState<Row[]>(
    DEFAULT_CHANNELS.map((n, i) => ({ key: i, name: n, raw: '', value: 0 })),
  )
  const [nextKey, setNextKey] = useState(DEFAULT_CHANNELS.length)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pinError =
    pin && !/^\d{4,12}$/.test(pin)
      ? 'PIN berupa 4 sampai 12 angka.'
      : pin && pin !== pin2
        ? 'Ulangi PIN harus sama.'
        : null

  const rowsValid =
    rows.length > 0 &&
    rows.every((r) => r.name.trim() !== '' && (r.raw.trim() === '' || r.value !== null)) &&
    new Set(rows.map((r) => r.name.trim().toLowerCase())).size === rows.length

  const finish = async () => {
    setBusy(true)
    setError(null)
    try {
      for (const r of rows) await addChannel(db, r.name, r.value ?? 0, startDate)
      await setSetting(db, 'name', name.trim())
      let rec: PinRecord | null = null
      let key: CryptoKey | null = null
      if (pin) {
        rec = await createPinRecord(pin)
        key = await deriveKey(pin, rec)
        await setSetting(db, 'pin', JSON.stringify(rec))
      }
      await setSetting(db, 'setup_done', '1')
      onDone(key, rec)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan. Coba lagi.')
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl px-6 py-12">
        <p className="text-muted">Langkah {step} dari 3</p>

        {step === 1 && (
          <div className="mt-2 flex flex-col gap-5">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Selamat datang</h1>
              <p className="mt-1 text-muted">Semua data disimpan di komputer ini. Tidak perlu akun untuk mulai.</p>
            </div>
            <Field label="Nama panggilan" htmlFor="name" hint="Dipakai untuk sapaan di Beranda.">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="PIN (opsional)" htmlFor="pin1" hint="4 sampai 12 angka.">
                <Input id="pin1" type="password" inputMode="numeric" autoComplete="off" value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={12} />
              </Field>
              <Field label="Ulangi PIN" htmlFor="pin2" error={pinError}>
                <Input id="pin2" type="password" inputMode="numeric" autoComplete="off" value={pin2}
                  onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} maxLength={12} disabled={!pin} />
              </Field>
            </div>
            <p className="text-[13px] text-muted">
              PIN mengunci tampilan aplikasi dan melindungi kata sandi akun yang kamu simpan. Tanpa PIN, kolom kata sandi
              akun di Lunapremium tidak bisa dipakai. Untuk melindungi file databasenya, aktifkan BitLocker di Windows.
            </p>
            <div className="flex justify-end">
              <Button variant="primary" size="lg" disabled={!!pinError} onClick={() => setStep(2)}>Lanjut</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-2 flex flex-col gap-5">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Channel dan saldo awal</h1>
              <p className="mt-1 text-muted">
                Isi saldo tiap channel sekarang. Ini hanya sekali, setelah itu cukup catat saldo harian. Kosongkan bila saldonya nol.
              </p>
            </div>
            <Field label="Mulai mencatat dari tanggal" htmlFor="start">
              <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="max-w-48" />
            </Field>
            <ul className="flex flex-col gap-3">
              {rows.map((r) => (
                <li key={r.key} className="grid grid-cols-[1fr_1fr_auto] items-start gap-3">
                  <Field label="Nama channel" htmlFor={`cn-${r.key}`}>
                    <Input id={`cn-${r.key}`} value={r.name}
                      onChange={(e) => setRows((x) => x.map((y) => (y.key === r.key ? { ...y, name: e.target.value } : y)))} />
                  </Field>
                  <NominalInput
                    id={`cb-${r.key}`} label="Saldo awal" value={r.raw} allowEmpty placeholder="Contoh: 250.000"
                    onChange={(raw, value) =>
                      setRows((x) => x.map((y) => (y.key === r.key ? { ...y, raw, value: raw.trim() === '' ? 0 : value } : y)))}
                  />
                  <IconButton
                    label={`Hapus channel ${r.name || 'ini'}`} className="mt-6"
                    disabled={rows.length <= 1}
                    onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
            <div>
              <Button size="sm" onClick={() => { setRows((x) => [...x, { key: nextKey, name: '', raw: '', value: 0 }]); setNextKey((k) => k + 1) }}>
                <Plus className="size-4" aria-hidden="true" /> Tambah channel
              </Button>
            </div>
            {!rowsValid && (
              <p role="alert" className="text-[13px] text-danger-text">
                Setiap channel butuh nama yang berbeda, dan saldo awalnya harus terbaca.
              </p>
            )}
            <div className="flex justify-between">
              <Button onClick={() => setStep(1)}>Kembali</Button>
              <Button variant="primary" size="lg" disabled={!rowsValid} onClick={() => setStep(3)}>Lanjut</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-2 flex flex-col gap-5">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Siap dipakai</h1>
              <p className="mt-1 text-muted">Cek ringkasannya. Semua bisa diubah lagi di Pengaturan.</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl border border-line bg-surface p-5">
              <dt className="text-muted">Nama</dt><dd>{name.trim() || 'Belum diisi'}</dd>
              <dt className="text-muted">PIN</dt><dd>{pin ? 'Diatur' : 'Tidak dipakai'}</dd>
              <dt className="text-muted">Mulai mencatat</dt><dd>{startDate}</dd>
              <dt className="text-muted">Channel</dt><dd>{rows.map((r) => r.name.trim()).join(', ')}</dd>
            </dl>
            {error && <p role="alert" className="text-danger-text">{error}</p>}
            <div className="flex justify-between">
              <Button onClick={() => setStep(2)} disabled={busy}>Kembali</Button>
              <Button variant="primary" size="lg" loading={busy} onClick={finish}>Mulai pakai</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
