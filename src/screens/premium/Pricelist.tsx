import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, IconButton, Input, Loading,
  NominalInput, PageHeader, Table, TD, TH, useToast,
} from '@/components/ui'
import {
  deleteProduct, deleteVariant, listProducts, saveProduct, saveVariant, type Product, type Variant,
} from '@/db/premium'
import { rupiah } from '@/lib/money'

function dur(days: number): string {
  if (days % 365 === 0) return `${days / 365} tahun`
  if (days % 30 === 0) return `${days / 30} bulan`
  return `${days} hari`
}

export function Pricelist() {
  const { db, bump } = useApp()
  const toast = useToast()
  const data = useAsync(() => listProducts(db), [])
  const [prod, setProd] = useState<{ edit?: Product } | null>(null)
  const [variant, setVariant] = useState<{ product: Product; edit?: Variant } | null>(null)
  const [delProd, setDelProd] = useState<Product | null>(null)
  const [delVar, setDelVar] = useState<Variant | null>(null)

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  const products = data.data ?? []

  return (
    <div>
      <PageHeader
        title="Pricelist"
        subtitle="Aplikasi premium yang kamu jual, beserta varian durasi dan harganya."
        actions={<Button variant="primary" onClick={() => setProd({})}><Plus className="size-4" aria-hidden="true" /> Tambah aplikasi</Button>}
      />

      {products.length === 0 ? (
        <EmptyState
          title="Belum ada aplikasi" body="Tambahkan aplikasi pertama, misalnya Canva, lalu isi varian durasi dan harganya."
          action={<Button variant="primary" onClick={() => setProd({})}>Tambah aplikasi</Button>}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {products.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  {p.has_account ? <Badge tone="accent">Akun dari store</Badge> : null}
                  {p.has_team ? <Badge tone="accent">Per tim{p.team_capacity ? `, isi ${p.team_capacity}` : ''}</Badge> : null}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => setVariant({ product: p })}><Plus className="size-4" aria-hidden="true" /> Varian</Button>
                  <IconButton label={`Ubah ${p.name}`} className="size-8" onClick={() => setProd({ edit: p })}><Pencil className="size-4" aria-hidden="true" /></IconButton>
                  <IconButton label={`Hapus ${p.name}`} className="size-8" onClick={() => setDelProd(p)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
                </div>
              </div>
              {p.variants.length === 0 ? (
                <p className="text-muted">Belum ada varian. Tambahkan durasi dan harga.</p>
              ) : (
                <Table label={`Varian ${p.name}`}>
                  <thead><tr><TH>Varian</TH><TH>Durasi</TH><TH right>Harga</TH><TH right>Aksi</TH></tr></thead>
                  <tbody>
                    {p.variants.map((v) => (
                      <tr key={v.id}>
                        <TD className="font-medium">{v.name}</TD>
                        <TD>{dur(v.duration_days)}</TD>
                        <TD right><span className="num">{rupiah(v.price)}</span></TD>
                        <TD right>
                          <div className="flex justify-end gap-1">
                            <IconButton label={`Ubah varian ${v.name}`} className="size-8" onClick={() => setVariant({ product: p, edit: v })}><Pencil className="size-4" aria-hidden="true" /></IconButton>
                            <IconButton label={`Hapus varian ${v.name}`} className="size-8" onClick={() => setDelVar(v)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
                          </div>
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          ))}
        </div>
      )}

      {prod && <ProductDialog edit={prod.edit} onClose={() => setProd(null)} onSaved={() => { bump(); toast('Aplikasi tersimpan.') }} />}
      {variant && <VariantDialog product={variant.product} edit={variant.edit} onClose={() => setVariant(null)} onSaved={() => { bump(); toast('Varian tersimpan.') }} />}
      <ConfirmDialog
        open={!!delProd} onClose={() => setDelProd(null)} danger confirmLabel="Hapus aplikasi"
        title={`Hapus ${delProd?.name ?? ''}?`}
        body="Aplikasi dan variannya hilang dari pricelist. Langganan customer yang sudah tercatat tetap ada di rekap lama bila aplikasinya dipulihkan dari cadangan."
        onConfirm={async () => { if (delProd) { await deleteProduct(db, delProd.id); setDelProd(null); bump(); toast('Aplikasi dihapus.') } }}
      />
      <ConfirmDialog
        open={!!delVar} onClose={() => setDelVar(null)} danger confirmLabel="Hapus varian"
        title={`Hapus varian ${delVar?.name ?? ''}?`} body="Langganan yang sudah memakai varian ini tidak berubah."
        onConfirm={async () => { if (delVar) { await deleteVariant(db, delVar.id); setDelVar(null); bump(); toast('Varian dihapus.') } }}
      />
    </div>
  )
}

function ProductDialog({ edit, onClose, onSaved }: { edit?: Product; onClose: () => void; onSaved: () => void }) {
  const { db } = useApp()
  const [name, setName] = useState(edit?.name ?? '')
  const [hasAccount, setHasAccount] = useState(!!edit?.has_account)
  const [hasTeam, setHasTeam] = useState(!!edit?.has_team)
  const [cap, setCap] = useState(edit?.team_capacity ? String(edit.team_capacity) : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const capOk = !hasTeam || cap.trim() === '' || /^[1-9]\d*$/.test(cap.trim())

  const save = async () => {
    setBusy(true)
    try {
      await saveProduct(db, { name, hasAccount, hasTeam, teamCapacity: cap.trim() ? Number(cap) : null }, edit?.id)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open onClose={onClose} title={edit ? 'Ubah aplikasi' : 'Tambah aplikasi'} width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!name.trim() || !capOk}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Nama aplikasi" htmlFor="p-name"><Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Canva" /></Field>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={hasAccount} onChange={(e) => setHasAccount(e.target.checked)} />
          <span><span className="block font-medium">Customer memakai akun dari store</span><span className="text-[13px] text-muted">Form langganan akan punya kolom email atau username dan kata sandi.</span></span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={hasTeam} onChange={(e) => setHasTeam(e.target.checked)} />
          <span><span className="block font-medium">Dikelompokkan per tim</span><span className="text-[13px] text-muted">Cocok untuk Canva: rekap menampilkan anggota tiap tim A, B, dan seterusnya.</span></span>
        </label>
        {hasTeam && (
          <Field label="Kapasitas satu tim (opsional)" htmlFor="p-cap" error={capOk ? null : 'Isi angka bulat lebih dari 0.'} hint="Dipakai untuk menampilkan sisa slot, misalnya 12 dari 100.">
            <Input id="p-cap" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} className="max-w-40" />
          </Field>
        )}
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

function VariantDialog({ product, edit, onClose, onSaved }: { product: Product; edit?: Variant; onClose: () => void; onSaved: () => void }) {
  const { db } = useApp()
  const [name, setName] = useState(edit?.name ?? '')
  const [days, setDays] = useState(edit ? String(edit.duration_days) : '30')
  const [raw, setRaw] = useState(edit ? String(edit.price) : '')
  const [price, setPrice] = useState<number | null>(edit ? edit.price : null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const daysOk = /^[1-9]\d*$/.test(days)

  useEffect(() => setError(null), [name, days, raw])

  const save = async () => {
    if (price === null || !daysOk) return
    setBusy(true)
    try {
      await saveVariant(db, { productId: product.id, name, durationDays: Number(days), price }, edit?.id)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open onClose={onClose} title={`${edit ? 'Ubah' : 'Tambah'} varian ${product.name}`} width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!name.trim() || !daysOk || price === null}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Nama varian" htmlFor="v-name"><Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: 1 bulan" /></Field>
        <Field label="Durasi (hari)" htmlFor="v-days" error={daysOk ? null : 'Isi angka bulat lebih dari 0.'}>
          <Input id="v-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} className="max-w-40" />
          <div className="flex gap-2">
            {[30, 90, 180, 365].map((d) => <Button key={d} size="sm" onClick={() => setDays(String(d))}>{d} hari</Button>)}
          </div>
        </Field>
        <NominalInput id="v-price" label="Harga" value={raw} onChange={(r, v) => { setRaw(r); setPrice(v) }} />
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}
