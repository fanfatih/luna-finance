import { useEffect, useMemo, useState } from 'react'
import { Copy, RotateCcw, SquarePen } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import { Button, Card, Dialog, ErrorState, Field, Input, Loading, PageHeader, Segmented, Textarea, useToast } from '@/components/ui'
import { listProducts, saveProductSteps, type Product } from '@/db/premium'
import { loadTemplates, saveTemplates, type Templates } from '@/db/wa'
import { addDays, formatDate, todayStr } from '@/lib/date'
import { copyText } from '@/lib/clipboard'
import {
  buildMessage, DEFAULT_TEMPLATES, effectiveTemplate, PLACEHOLDERS, renderTemplate, STEP_PLACEHOLDERS, STEPS_EXAMPLE, type TemplateKind,
} from '@/lib/template'

export function Template() {
  const { db, bump } = useApp()
  const toast = useToast()
  const data = useAsync(async () => {
    const [products, tpl] = await Promise.all([listProducts(db), loadTemplates(db)])
    return { products, tpl }
  }, [])

  const [kind, setKind] = useState<TemplateKind>('tim')
  const [nama, setNama] = useState('')
  const [produk, setProduk] = useState('')
  const [durasi, setDurasi] = useState('')
  const [link, setLink] = useState('')
  const [akun, setAkun] = useState('')
  const [password, setPassword] = useState('')
  const [editing, setEditing] = useState(false)
  const [editSteps, setEditSteps] = useState<Product | null>(null)
  const [tpl, setTpl] = useState<Templates | null>(null)

  useEffect(() => { if (data.data && !tpl) setTpl(data.data.tpl) }, [data.data, tpl])

  const product = data.data?.products.find((p) => p.name.toLowerCase() === produk.trim().toLowerCase())
  const variant = product?.variants.find((v) => v.name.toLowerCase() === durasi.trim().toLowerCase())
  const sampai = variant ? formatDate(addDays(todayStr(), variant.duration_days)) : ''

  const pickProduct = (name: string) => {
    setProduk(name)
    setDurasi('')
    const p = data.data?.products.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())
    if (p) setKind(p.has_team && !p.has_account ? 'tim' : !p.has_team && p.has_account ? 'akun' : kind)
  }

  const text = useMemo(
    () => buildMessage(effectiveTemplate(tpl?.[kind] ?? '', product?.wa_steps), product?.wa_steps, { nama: nama.trim() || 'kak', produk, durasi, sampai, link, akun, password }),
    [tpl, kind, product, nama, produk, durasi, sampai, link, akun, password],
  )

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  const products = data.data?.products ?? []

  const copy = async () => {
    toast((await copyText(text)) ? 'Teks disalin. Tinggal tempel di WhatsApp.' : 'Gagal menyalin. Blok teksnya lalu salin manual.', 'ok')
  }

  return (
    <div>
      <PageHeader
        title="Template WhatsApp"
        subtitle="Isi produk dan durasinya, teks pesan untuk customer langsung jadi, lengkap dengan langkah pemakaian aplikasinya. Tinggal salin."
        actions={<Button onClick={() => setEditing(true)}><SquarePen className="size-4" aria-hidden="true" /> Ubah template</Button>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-4">
          <Segmented
            label="Jenis akses" value={kind} onChange={setKind}
            options={[{ value: 'tim', label: 'Link tim' }, { value: 'akun', label: 'Akun' }]}
          />
          <Field label="Nama customer (opsional)" htmlFor="t-nama" hint="Kosong berarti disapa &quot;kak&quot;.">
            <Input id="t-nama" value={nama} onChange={(e) => setNama(e.target.value)} />
          </Field>
          <Field label="Produk" htmlFor="t-produk" hint={products.length ? 'Pilih dari pricelist atau ketik sendiri.' : undefined}>
            <Input id="t-produk" list="t-produk-list" value={produk} onChange={(e) => pickProduct(e.target.value)} autoComplete="off" />
            <datalist id="t-produk-list">{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
          </Field>
          <Field
            label="Durasi" htmlFor="t-durasi"
            hint={sampai ? `Aktif sampai ${sampai}, dihitung dari hari ini.` : 'Contoh: 1 bulan. Kalau cocok dengan pricelist, tanggal berakhirnya ikut terisi.'}
          >
            <Input id="t-durasi" list="t-durasi-list" value={durasi} onChange={(e) => setDurasi(e.target.value)} autoComplete="off" />
            <datalist id="t-durasi-list">{(product?.variants ?? []).map((v) => <option key={v.id} value={v.name} />)}</datalist>
          </Field>
          {kind === 'tim' ? (
            <Field label="Link tim" htmlFor="t-link">
              <Input id="t-link" type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} autoComplete="off" />
            </Field>
          ) : (
            <>
              <Field label="Akun (email atau username)" htmlFor="t-akun">
                <Input id="t-akun" value={akun} onChange={(e) => setAkun(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Password" htmlFor="t-pass" hint="Hanya dipakai untuk menyusun teks ini. Tidak disimpan.">
                <Input id="t-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              </Field>
            </>
          )}
          {product && (
            <div className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[14px] font-semibold">Langkah {product.name}</h3>
                <Button size="sm" onClick={() => setEditSteps(product)}>{product.wa_steps ? 'Ubah langkah' : 'Tambah langkah'}</Button>
              </div>
              <p className="mt-1 text-[13px] text-muted">
                {product.wa_steps ? 'Ikut masuk ke pesan di sebelah kanan.' : 'Belum ada. Isi cara pakai aplikasi ini supaya otomatis masuk ke pesan.'}
              </p>
            </div>
          )}
        </div>

        <Card className="flex flex-col p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold">Hasil</h3>
            <Button variant="primary" onClick={copy} disabled={!text}><Copy className="size-4" aria-hidden="true" /> Salin teks</Button>
          </div>
          {text ? (
            <pre aria-label="Teks pesan" className="max-h-[28rem] overflow-y-auto rounded-lg bg-subtle p-4 font-sans text-[14px] leading-relaxed whitespace-pre-wrap">{text}</pre>
          ) : (
            <p className="rounded-lg bg-subtle p-4 text-muted">Isi dulu kolom di sebelah kiri.</p>
          )}
        </Card>
      </div>

      {editing && tpl && (
        <TemplateDialog
          tpl={tpl} initialKind={kind}
          onClose={() => setEditing(false)}
          onSave={async (next) => {
            await saveTemplates(db, next)
            setTpl(next)
            setEditing(false)
            toast('Template tersimpan.')
          }}
        />
      )}

      {editSteps && (
        <StepsDialog
          product={editSteps} onClose={() => setEditSteps(null)}
          onSaved={(had) => { bump(); toast(had ? 'Langkah tersimpan.' : 'Langkah dihapus.') }}
        />
      )}
    </div>
  )
}

function StepsDialog({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: (hasSteps: boolean) => void }) {
  const { db } = useApp()
  const [draft, setDraft] = useState(product.wa_steps ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const preview = useMemo(
    () => renderTemplate(draft, {
      nama: 'Budi', produk: product.name, durasi: '1 bulan', sampai: formatDate(addDays(todayStr(), 30)),
      link: 'https://contoh.link/undangan', akun: 'akun@contoh.com', password: 'rahasia123',
    }),
    [draft, product.name],
  )

  const save = async (text: string) => {
    setBusy(true)
    setError(null)
    try {
      await saveProductSteps(db, product.id, text)
      onSaved(text.trim() !== '')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open onClose={onClose} title={`Langkah ${product.name}`} width="max-w-2xl"
      footer={
        <>
          {product.wa_steps && <Button onClick={() => save('')} disabled={busy}>Hapus langkah</Button>}
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" loading={busy} onClick={() => save(draft)}>Simpan</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="steps-text" className="mb-1.5 block text-[13px] font-medium">Langkah untuk customer</label>
          <Textarea id="steps-text" rows={9} className="font-sans text-[14px] leading-relaxed" placeholder={STEPS_EXAMPLE} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {STEP_PLACEHOLDERS.map((k) => (
              <button
                key={k} type="button" onClick={() => setDraft((d) => `${d}{${k}}`)}
                className="rounded-md bg-subtle px-2 py-1 font-mono text-[12px] transition-colors hover:bg-line"
              >
                {`{${k}}`}
              </button>
            ))}
            {draft.trim() === '' && <Button size="sm" onClick={() => setDraft(STEPS_EXAMPLE)}>Pakai contoh</Button>}
          </div>
          <p className="mt-2 text-[13px] text-muted">Teks ini masuk ke bagian {'{langkah}'} di template. Baris yang isiannya kosong otomatis dibuang. Judul seperti "Cara bergabung:" tulis di sini juga.</p>
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Contoh hasil</p>
          {preview ? (
            <pre aria-label="Contoh hasil langkah" className="max-h-48 overflow-y-auto rounded-lg bg-subtle p-3 font-sans text-[14px] leading-relaxed whitespace-pre-wrap">{preview}</pre>
          ) : (
            <p className="rounded-lg bg-subtle p-3 text-muted">Belum ada isi.</p>
          )}
        </div>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

function TemplateDialog({ tpl, initialKind, onClose, onSave }: { tpl: Templates; initialKind: TemplateKind; onClose: () => void; onSave: (t: Templates) => Promise<void> }) {
  const [kind, setKind] = useState<TemplateKind>(initialKind)
  const [draft, setDraft] = useState(tpl)
  const [busy, setBusy] = useState(false)
  const insert = (key: string) => setDraft((d) => ({ ...d, [kind]: `${d[kind]}{${key}}` }))

  return (
    <Dialog
      open onClose={onClose} title="Ubah template" width="max-w-2xl"
      footer={
        <>
          <Button onClick={() => setDraft((d) => ({ ...d, [kind]: DEFAULT_TEMPLATES[kind] }))}><RotateCcw className="size-4" aria-hidden="true" /> Kembalikan bawaan</Button>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await onSave(draft) } finally { setBusy(false) } }}>Simpan</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          label="Template yang diubah" value={kind} onChange={setKind}
          options={[{ value: 'tim', label: 'Link tim' }, { value: 'akun', label: 'Akun' }]}
        />
        <Textarea
          aria-label="Isi template" rows={12} className="font-sans text-[14px] leading-relaxed"
          value={draft[kind]} onChange={(e) => setDraft((d) => ({ ...d, [kind]: e.target.value }))}
        />
        <div>
          <p className="mb-2 text-[13px] text-muted">
            Klik untuk menambah isian di akhir teks. Baris yang isiannya kosong otomatis dibuang dari hasil. {'{langkah}'} diisi langkah milik aplikasi yang dipilih.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PLACEHOLDERS.map((k) => (
              <button
                key={k} type="button" onClick={() => insert(k)}
                className="rounded-md bg-subtle px-2 py-1 font-mono text-[12px] transition-colors hover:bg-line"
              >
                {`{${k}}`}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
