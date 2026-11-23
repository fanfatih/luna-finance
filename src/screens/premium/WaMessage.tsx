import { useEffect, useMemo, useState } from 'react'
import { Copy, MessageCircle } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import { Button, Dialog, Field, Input, Textarea, useToast } from '@/components/ui'
import { saveTeamLink, type Product, type Subscription } from '@/db/premium'
import { loadTemplates } from '@/db/wa'
import { copyText } from '@/lib/clipboard'
import { decryptText } from '@/lib/crypto'
import { formatDate } from '@/lib/date'
import { errText } from '@/lib/reminders'
import { buildMessage, effectiveTemplate, kindFor } from '@/lib/template'
import { openWhatsApp, waNumber } from '@/lib/whatsapp'

/** Pesan WhatsApp untuk satu langganan di Rekap: diisi dari datanya, bisa diedit, lalu disalin atau dikirim. */
export function WaDialog({
  sub, product, teamLink, onClose, onLinkSaved,
}: { sub: Subscription; product: Product; teamLink: string; onClose: () => void; onLinkSaved: () => void }) {
  const { db, cryptoKey } = useApp()
  const toast = useToast()
  const tpl = useAsync(() => loadTemplates(db), [])
  const kind = kindFor(product, sub.account_login)
  const [link, setLink] = useState(teamLink)
  const [pwd, setPwd] = useState<string | null>(null)
  const [pwdFailed, setPwdFailed] = useState(false)
  const [override, setOverride] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const number = waNumber(sub.customer_contact)

  useEffect(() => {
    if (kind !== 'akun' || !sub.account_password_enc || !cryptoKey) return
    let alive = true
    decryptText(cryptoKey, sub.account_password_enc).then(
      (p) => alive && setPwd(p),
      () => alive && setPwdFailed(true),
    )
    return () => {
      alive = false
    }
  }, [kind, sub.account_password_enc, cryptoKey])

  const text = useMemo(() => {
    if (!tpl.data) return ''
    return buildMessage(effectiveTemplate(tpl.data[kind], product.wa_steps), product.wa_steps, {
      nama: sub.customer_name,
      produk: sub.product_name,
      durasi: sub.variant_name ?? `${sub.duration_days} hari`,
      sampai: formatDate(sub.end_date),
      link,
      akun: sub.account_login ?? '',
      password: pwd ?? '',
    })
  }, [tpl.data, kind, product.wa_steps, sub, link, pwd])

  const final = override ?? text
  const missing: string[] = []
  if (kind === 'tim' && !link.trim()) missing.push('link tim')
  if (kind === 'akun') {
    if (!sub.account_login) missing.push('akun')
    if (!pwd) missing.push('password')
  }

  /** Link tim yang diisi atau diubah di sini disimpan untuk timnya, jadi anggota lain tidak perlu mengisi lagi. */
  const persistLink = async (): Promise<boolean> => {
    const l = link.trim()
    if (kind !== 'tim' || !sub.team || l === teamLink.trim()) return true
    try {
      await saveTeamLink(db, product.id, sub.team, l)
      onLinkSaved()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Link tidak bisa disimpan.')
      return false
    }
  }

  const copy = async () => {
    setError(null)
    if (!(await persistLink())) return
    toast((await copyText(final)) ? 'Pesan disalin. Tinggal tempel di WhatsApp.' : 'Gagal menyalin. Blok teksnya lalu salin manual.', 'ok')
  }

  const send = async () => {
    if (!number) return
    setError(null)
    setBusy(true)
    try {
      if (!(await persistLink())) return
      await copyText(final)
      const { withText } = await openWhatsApp(number, final)
      toast(withText ? 'WhatsApp dibuka dengan pesan terisi. Pesan juga sudah disalin.' : 'Pesan terlalu panjang untuk dibawa lewat link. Chat dibuka, pesan sudah disalin, tinggal tempel.', 'ok')
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open onClose={onClose} title={`Pesan WhatsApp untuk ${sub.customer_name}`} width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>Tutup</Button>
          <Button onClick={send} loading={busy} disabled={!number || !final} title={number ? undefined : 'Kontak customer belum berupa nomor WhatsApp'}>
            <MessageCircle className="size-4" aria-hidden="true" /> Buka WhatsApp
          </Button>
          <Button variant="primary" onClick={copy} disabled={!final}><Copy className="size-4" aria-hidden="true" /> Salin pesan</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {kind === 'tim' && (
          <Field
            label="Link tim" htmlFor="wa-link"
            hint={sub.team ? `Disimpan untuk ${sub.team}, jadi anggota lain di tim ini tidak perlu mengisi lagi.` : 'Langganan ini belum punya nama tim, jadi link hanya dipakai untuk pesan ini.'}
          >
            <Input id="wa-link" type="url" inputMode="url" autoComplete="off" value={link} onChange={(e) => { setLink(e.target.value); setOverride(null) }} />
          </Field>
        )}

        <div>
          <label htmlFor="wa-text" className="mb-1.5 block text-[13px] font-medium">Pesan</label>
          <Textarea id="wa-text" rows={14} className="font-sans text-[14px] leading-relaxed" value={final} onChange={(e) => setOverride(e.target.value)} />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            {override !== null && <button type="button" onClick={() => setOverride(null)} className="underline underline-offset-2 hover:text-fg">Susun ulang dari data</button>}
            {missing.length > 0 && <span>Baris ini dilewati karena belum terisi: {missing.join(', ')}.</span>}
            {pwdFailed && <span>Password tidak bisa dibuka dengan PIN saat ini.</span>}
            {!number && <span>Tombol WhatsApp aktif kalau kontak customer berupa nomor.</span>}
          </div>
        </div>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

/** Isi atau ubah link undangan satu tim. Kosongkan untuk menghapus. */
export function TeamLinkDialog({
  productId, productName, team, link, onClose, onSaved,
}: { productId: string; productName: string; team: string; link: string; onClose: () => void; onSaved: () => void }) {
  const { db } = useApp()
  const [value, setValue] = useState(link)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await saveTeamLink(db, productId, team, value)
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
      open onClose={onClose} title={`Link ${team}`} width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label={`Link undangan ${productName}`} htmlFor="tl-link" hint="Dipakai di pesan WhatsApp semua anggota tim ini. Kosongkan untuk menghapus.">
          <Input id="tl-link" type="url" inputMode="url" autoFocus autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}
