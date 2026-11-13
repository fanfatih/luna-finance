import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { useApp, useAsync, type Theme } from '@/app/context'
import {
  Badge, Button, Card, ConfirmDialog, Dialog, ErrorState, Field, Input, Loading, NominalInput, PageHeader,
  Segmented, Select, useToast,
} from '@/components/ui'
import { dumpAll, restoreAll } from '@/db/backup'
import {
  addChannel, archiveChannel, latestChannelBalance, listChannels, renameChannel, type Channel,
} from '@/db/finance'
import { listSubscriptions, saveSubscription } from '@/db/premium'
import { clearSyncConfig, DEFAULT_SYNC_URL, lastSyncAt, loadSyncConfig, saveSyncConfig, syncNow } from '@/db/sync'
import { createPinRecord, decryptText, deriveKey, encryptText, verifyPin } from '@/lib/crypto'
import { todayStr } from '@/lib/date'
import { isTauri, saveTextFile } from '@/lib/platform'
import { isAutostartEnabled, setAutostart } from '@/lib/reminders'
import { applyTheme } from '@/lib/theme'

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold">{title}</h2>
      {desc && <p className="mt-0.5 mb-4 text-muted">{desc}</p>}
      {!desc && <div className="mb-4" />}
      {children}
    </Card>
  )
}

export function Settings() {
  const { settings, saveSettings } = useApp()
  const [name, setName] = useState(settings.name)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
        <PageHeader title="Pengaturan" />

        <Section title="Profil dan tampilan">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama panggilan" htmlFor="set-name">
              <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== settings.name && saveSettings({ name: name.trim() })} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Tema</span>
              <Segmented<Theme>
                label="Tema" value={settings.theme}
                onChange={(t) => { applyTheme(t); saveSettings({ theme: t }) }}
                options={[{ value: 'terang', label: 'Terang' }, { value: 'gelap', label: 'Gelap' }, { value: 'sistem', label: 'Ikuti Windows' }]}
              />
            </div>
          </div>
        </Section>

        <PinSection />
        <ChannelSection />

        <Section title="Lunapremium" desc="Kapan langganan ditandai hampir habis dan diingatkan.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hampir habis (hari sebelum berakhir)" htmlFor="set-warn">
              <Select id="set-warn" value={settings.warnDays} onChange={(e) => saveSettings({ warnDays: Number(e.target.value) })}>
                {[1, 2, 3, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d} hari</option>)}
              </Select>
            </Field>
            <label className="flex items-start gap-3 sm:pt-7">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={settings.notif} onChange={(e) => saveSettings({ notif: e.target.checked })} />
              <span>
                <span className="block font-medium">Notifikasi Windows</span>
                <span className="text-[13px] text-muted">Sekali sehari saat aplikasi dibuka, bila ada yang hampir habis.</span>
              </span>
            </label>
          </div>
        </Section>

        <DesktopSection />
        <BackupSection />

        <SyncSection />
      </div>
    </div>
  )
}

/* ---------- Sinkron cloud ---------- */

function SyncSection() {
  const { db, bump } = useApp()
  const toast = useToast()
  const [loaded, setLoaded] = useState(false)
  const [on, setOn] = useState(false)
  const [url, setUrl] = useState(DEFAULT_SYNC_URL)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<number | null>(null)

  const refresh = async () => {
    const c = await loadSyncConfig(db)
    setOn(!!c)
    if (c) setUrl(c.url)
    setLast(await lastSyncAt(db))
    setLoaded(true)
  }
  useEffect(() => { refresh().catch(() => setLoaded(true)) }, [])

  const connect = async () => {
    setBusy(true)
    try {
      const cfg = { url: url.trim() || DEFAULT_SYNC_URL, key: key.trim() }
      if (!cfg.key) throw new Error('Isi kunci sinkron dulu.')
      const r = await syncNow(db, { url: cfg.url.replace(/\/+$/, ''), key: cfg.key })
      await saveSyncConfig(db, cfg)
      setKey('')
      await refresh()
      bump()
      toast(`Tersambung. Terkirim ${r.pushed}, diterima ${r.pulled}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal tersambung.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const when = last ? new Date(last).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'belum pernah'

  return (
    <Section title="Sinkron cloud dan bot Telegram" desc="Data dicadangkan ke Supabase kamu sendiri. Bot Telegram mencatat utang piutang dari HP, lalu masuk ke sini saat sinkron.">
      {!loaded ? <Loading /> : on ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="success">Tersambung</Badge>
          <span className="text-muted">Terakhir sinkron: {when}</span>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const cfg = await loadSyncConfig(db)
                if (!cfg) return
                const r = await syncNow(db, cfg)
                await refresh()
                if (r.pulled) bump()
                toast(`Selesai. Terkirim ${r.pushed}, diterima ${r.pulled}.`)
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Sinkron gagal.', 'error')
              } finally { setBusy(false) }
            }}
          >
            {busy ? 'Menyinkronkan' : 'Sinkronkan sekarang'}
          </Button>
          <Button variant="ghost" onClick={async () => { await clearSyncConfig(db); await refresh() }}>Putuskan</Button>
        </div>
      ) : (
        <div className="grid max-w-xl gap-4">
          <Field label="Alamat Supabase" htmlFor="sync-url">
            <Input id="sync-url" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Kunci sinkron" htmlFor="sync-key" hint="Sama dengan SYNC_KEY di Supabase. Disimpan di komputer ini saja.">
            <Input id="sync-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          </Field>
          <div><Button variant="primary" disabled={busy || !key.trim()} onClick={connect}>{busy ? 'Menyambungkan' : 'Sambungkan'}</Button></div>
        </div>
      )}
    </Section>
  )
}

/* ---------- PIN ---------- */

function PinSection() {
  const { db, settings, saveSettings, setCryptoKey, bump, lock } = useApp()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  return (
    <Section title="Keamanan" desc="PIN mengunci tampilan aplikasi dan melindungi kata sandi akun Lunapremium.">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={settings.pin ? 'success' : 'neutral'}>{settings.pin ? 'PIN aktif' : 'PIN belum diatur'}</Badge>
        <Button onClick={() => setOpen(true)}>{settings.pin ? 'Ganti PIN' : 'Atur PIN'}</Button>
        {settings.pin && <Button variant="ghost" onClick={lock}>Kunci sekarang</Button>}
      </div>
      {settings.pin && (
        <div className="mt-4 max-w-xs">
          <Field label="Kunci otomatis setelah tidak dipakai" htmlFor="set-idle">
            <Select id="set-idle" value={settings.idleMin} onChange={(e) => saveSettings({ idleMin: Number(e.target.value) })}>
              {[1, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} menit</option>)}
            </Select>
          </Field>
        </div>
      )}
      <p className="mt-4 text-[13px] text-muted">
        PIN tidak mengenkripsi seluruh file database. Untuk itu, aktifkan BitLocker atau enkripsi disk di Windows.
      </p>
      {open && (
        <PinDialog
          hasPin={!!settings.pin}
          onClose={() => setOpen(false)}
          onSubmit={async (oldPin, newPin) => {
            const rec = await createPinRecord(newPin)
            const key = await deriveKey(newPin, rec)
            // Kata sandi lama dienkripsi ulang dengan kunci dari PIN baru.
            if (settings.pin) {
              if (!(await verifyPin(oldPin, settings.pin))) throw new Error('PIN lama salah.')
              const oldKey = await deriveKey(oldPin, settings.pin)
              const subs = await listSubscriptions(db)
              for (const s of subs) {
                if (!s.account_password_enc) continue
                const plain = await decryptText(oldKey, s.account_password_enc)
                await saveSubscription(db, {
                  customerId: s.customer_id, productId: s.product_id, variantId: s.variant_id, startDate: s.start_date,
                  durationDays: s.duration_days, price: s.price, accountLogin: s.account_login,
                  accountPasswordEnc: await encryptText(key, plain), team: s.team, note: s.note,
                }, s.id)
              }
            }
            await saveSettings({ pin: rec })
            setCryptoKey(key)
            bump()
            toast('PIN tersimpan.')
          }}
        />
      )}
    </Section>
  )
}

function PinDialog({
  hasPin, onClose, onSubmit,
}: { hasPin: boolean; onClose: () => void; onSubmit: (oldPin: string, newPin: string) => Promise<void> }) {
  const [oldPin, setOldPin] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clean = (v: string) => v.replace(/\D/g, '')
  const pinOk = /^\d{4,12}$/.test(pin)
  const match = pin === pin2
  const canSave = pinOk && match && (!hasPin || oldPin.length > 0)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(oldPin, pin)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan PIN.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open onClose={onClose} title={hasPin ? 'Ganti PIN' : 'Atur PIN'} width="max-w-sm"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" loading={busy} disabled={!canSave} onClick={save}>Simpan PIN</Button></>}
    >
      <div className="flex flex-col gap-4">
        {hasPin && (
          <Field label="PIN lama" htmlFor="pin-old"><Input id="pin-old" type="password" inputMode="numeric" autoComplete="off" value={oldPin} onChange={(e) => setOldPin(clean(e.target.value))} maxLength={12} /></Field>
        )}
        <Field label="PIN baru" htmlFor="pin-new" hint="4 sampai 12 angka." error={pin && !pinOk ? 'PIN berupa 4 sampai 12 angka.' : null}>
          <Input id="pin-new" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(clean(e.target.value))} maxLength={12} />
        </Field>
        <Field label="Ulangi PIN baru" htmlFor="pin-new2" error={pin2 && !match ? 'Ulangi PIN harus sama.' : null}>
          <Input id="pin-new2" type="password" inputMode="numeric" autoComplete="off" value={pin2} onChange={(e) => setPin2(clean(e.target.value))} maxLength={12} />
        </Field>
        <p className="text-[13px] text-muted">Kalau PIN lupa, kata sandi akun yang tersimpan tidak bisa dibuka lagi. Data lainnya tetap aman.</p>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

/* ---------- Channel ---------- */

function ChannelSection() {
  const { db, bump } = useApp()
  const toast = useToast()
  const data = useAsync(async () => {
    const channels = await listChannels(db)
    const balances: Record<string, number> = {}
    for (const c of channels) balances[c.id] = await latestChannelBalance(db, c.id)
    return { channels, balances }
  }, [])
  const [renaming, setRenaming] = useState<Channel | null>(null)
  const [adding, setAdding] = useState(false)
  const [archive, setArchive] = useState<Channel | null>(null)

  return (
    <Section title="Channel saldo" desc="Rekening dan dompet yang dihitung dalam saldo harian.">
      {data.loading && !data.data ? <Loading /> : data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {(data.data?.channels ?? []).map((c) => {
            const bal = data.data?.balances[c.id] ?? 0
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="font-medium">{c.name}</span>
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(c)}><Pencil className="size-3.5" aria-hidden="true" /> Ganti nama</Button>
                  <Button size="sm" variant="ghost" disabled={bal !== 0} title={bal !== 0 ? 'Pindahkan saldonya dulu sampai nol' : undefined} onClick={() => setArchive(c)}>Arsipkan</Button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-3"><Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" /> Tambah channel</Button></div>
      <p className="mt-3 text-[13px] text-muted">Channel hanya bisa diarsipkan saat saldo terakhirnya nol, supaya profit tidak ikut berubah.</p>

      {renaming && <RenameDialog channel={renaming} onClose={() => setRenaming(null)} onSaved={() => { bump(); toast('Nama channel diganti.') }} />}
      {adding && <AddChannelDialog onClose={() => setAdding(false)} onSaved={() => { bump(); toast('Channel ditambahkan.') }} />}
      <ConfirmDialog
        open={!!archive} onClose={() => setArchive(null)} confirmLabel="Arsipkan"
        title={`Arsipkan ${archive?.name ?? ''}?`} body="Channel tidak lagi muncul di catatan harian berikutnya. Catatan lama tidak berubah."
        onConfirm={async () => { if (archive) { await archiveChannel(db, archive.id); setArchive(null); bump(); toast('Channel diarsipkan.') } }}
      />
    </Section>
  )
}

function RenameDialog({ channel, onClose, onSaved }: { channel: Channel; onClose: () => void; onSaved: () => void }) {
  const { db } = useApp()
  const [name, setName] = useState(channel.name)
  return (
    <Dialog
      open onClose={onClose} title="Ganti nama channel" width="max-w-sm"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" disabled={!name.trim()} onClick={async () => { await renameChannel(db, channel.id, name); onSaved(); onClose() }}>Simpan</Button></>}
    >
      <Field label="Nama channel" htmlFor="rn"><Input id="rn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </Dialog>
  )
}

function AddChannelDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { db } = useApp()
  const [name, setName] = useState('')
  const [raw, setRaw] = useState('')
  const [val, setVal] = useState<number | null>(0)
  const [error, setError] = useState<string | null>(null)
  const ok = name.trim() !== '' && val !== null
  return (
    <Dialog
      open onClose={onClose} title="Tambah channel" width="max-w-sm"
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" disabled={!ok} onClick={async () => {
            try { await addChannel(db, name, val ?? 0, todayStr()); onSaved(); onClose() }
            catch (e) { setError(e instanceof Error ? e.message : 'Gagal menyimpan.') }
          }}>Simpan</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Nama channel" htmlFor="ac-name"><Input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <NominalInput id="ac-bal" label="Saldo saat ini" value={raw} allowEmpty onChange={(r, v) => { setRaw(r); setVal(r.trim() === '' ? 0 : v) }} />
        <p className="text-[13px] text-muted">Saldo awal channel baru otomatis dicatat sebagai setor modal hari ini, jadi tidak dihitung sebagai profit.</p>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

/* ---------- Aplikasi desktop ---------- */

function DesktopSection() {
  const toast = useToast()
  const desktop = isTauri()
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => { isAutostartEnabled().then(setOn, () => setOn(false)) }, [])
  return (
    <Section title="Aplikasi desktop" desc="Perilaku saat Windows menyala.">
      {desktop ? (
        <label className="flex items-start gap-3">
          <input
            type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={!!on} disabled={on === null}
            onChange={async (e) => {
              try { await setAutostart(e.target.checked); setOn(e.target.checked) }
              catch (err) { toast(err instanceof Error ? err.message : 'Gagal mengubah pengaturan.', 'error') }
            }}
          />
          <span>
            <span className="block font-medium">Buka otomatis saat Windows menyala</span>
            <span className="text-[13px] text-muted">Aplikasi langsung berjalan di baris tugas (tray), jendela dibuka dari ikonnya.</span>
          </span>
        </label>
      ) : (
        <p className="text-muted">Pengaturan ini hanya ada di aplikasi Windows. Kamu sedang membuka versi peramban.</p>
      )}
    </Section>
  )
}

/* ---------- Cadangan ---------- */

function BackupSection() {
  const { db } = useApp()
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const exportAll = async () => {
    setBusy(true)
    try {
      const ok = await saveTextFile(`luna-finance-${todayStr()}.json`, JSON.stringify(await dumpAll(db), null, 2), 'application/json')
      if (ok) toast('Cadangan disimpan.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal membuat cadangan.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const choose = async (f: File | undefined) => {
    if (!f) return
    try {
      setPending(JSON.parse(await f.text()))
    } catch {
      toast('Berkas tidak bisa dibaca. Pastikan ini cadangan Luna Finance (.json).', 'error')
    }
    if (file.current) file.current.value = ''
  }

  return (
    <Section title="Cadangan data" desc="Salinan semua data dalam satu berkas. Cadangan harian otomatis tersimpan di aplikasi desktop (30 terakhir).">
      <div className="flex flex-wrap gap-2">
        <Button onClick={exportAll} loading={busy}>Simpan cadangan</Button>
        <Button onClick={() => file.current?.click()}>Pulihkan dari berkas</Button>
        <input ref={file} type="file" accept="application/json,.json" className="sr-only" aria-label="Pilih berkas cadangan" tabIndex={-1} onChange={(e) => choose(e.target.files?.[0])} />
      </div>
      <ConfirmDialog
        open={pending !== null} onClose={() => setPending(null)} danger confirmLabel="Timpa dan pulihkan"
        title="Pulihkan dari cadangan?" body="Semua data di aplikasi saat ini akan diganti dengan isi berkas. Simpan cadangan dulu bila data sekarang masih dibutuhkan."
        onConfirm={async () => {
          try {
            await restoreAll(db, pending)
            toast('Data dipulihkan. Aplikasi dimuat ulang.')
            setTimeout(() => window.location.reload(), 800)
          } catch (e) {
            setPending(null)
            toast(e instanceof Error ? e.message : 'Gagal memulihkan.', 'error')
          }
        }}
      />
    </Section>
  )
}
