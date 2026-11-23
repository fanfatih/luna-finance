import { Fragment, useEffect, useMemo, useState } from 'react'
import { Copy, Link2, MessageSquareText, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, IconButton, Input, Loading,
  NominalInput, PageHeader, Segmented, Select, Table, TD, TH, Textarea, useToast,
} from '@/components/ui'
import {
  daysLeft, deleteSubscription, ensureCustomer, groupByTeam, listCustomers, listProducts, listSubscriptions, listTeamLinks,
  renewSubscription, teamLinkKey, saveSubscription, subStatus, type Product, type SubStatus, type Subscription,
} from '@/db/premium'
import { decryptText, encryptText } from '@/lib/crypto'
import { addDays, formatDate, todayStr } from '@/lib/date'
import { rupiah } from '@/lib/money'
import { TeamLinkDialog, WaDialog } from './WaMessage'

type StatusFilter = 'semua' | SubStatus

const STATUS_TONE = { aktif: 'success', 'hampir-habis': 'warn', habis: 'danger' } as const
const STATUS_LABEL = { aktif: 'Aktif', 'hampir-habis': 'Hampir habis', habis: 'Habis' } as const

function leftText(left: number): string {
  if (left < 0) return `Lewat ${-left} hari`
  if (left === 0) return 'Habis hari ini'
  return `${left} hari lagi`
}

export function Rekap() {
  const { db, bump, settings, cryptoKey } = useApp()
  const toast = useToast()
  const today = todayStr()
  const [productId, setProductId] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('semua')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<{ edit?: Subscription } | null>(null)
  const [renew, setRenew] = useState<Subscription | null>(null)
  const [del, setDel] = useState<Subscription | null>(null)
  const [wa, setWa] = useState<Subscription | null>(null)
  const [linkFor, setLinkFor] = useState<string | null>(null)

  const data = useAsync(async () => {
    const [products, subs, customers, teamLinks] = await Promise.all([listProducts(db), listSubscriptions(db), listCustomers(db), listTeamLinks(db)])
    return { products, subs, customers, teamLinks }
  }, [])

  const products = data.data?.products ?? []
  useEffect(() => {
    if (products.length && (productId === null || !products.some((p) => p.id === productId))) setProductId(products[0].id)
  }, [products, productId])

  const product = products.find((p) => p.id === productId) ?? null
  const subs = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (data.data?.subs ?? []).filter((s) => {
      if (s.product_id !== productId) return false
      if (status !== 'semua' && subStatus(s.end_date, today, settings.warnDays) !== status) return false
      return !term || s.customer_name.toLowerCase().includes(term) || (s.account_login ?? '').toLowerCase().includes(term)
    })
  }, [data.data, productId, status, q, today, settings.warnDays])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />

  if (products.length === 0) {
    return (
      <div>
        <PageHeader title="Rekap Data Apk Premium" />
        <EmptyState title="Belum ada aplikasi di pricelist" body="Tambahkan aplikasi dan varian durasinya di Pricelist, lalu langganan customer bisa dicatat di sini." />
      </div>
    )
  }

  const all = data.data?.subs ?? []
  const teamLinks = data.data?.teamLinks ?? {}
  const countOf = (pid: string) => all.filter((s) => s.product_id === pid && s.end_date >= today).length
  const soonCount = all.filter((s) => s.product_id === productId && subStatus(s.end_date, today, settings.warnDays) === 'hampir-habis').length

  const copyPassword = async (s: Subscription) => {
    if (!cryptoKey || !s.account_password_enc) return
    try {
      await navigator.clipboard.writeText(await decryptText(cryptoKey, s.account_password_enc))
      toast('Kata sandi disalin. Tempel di tempat tujuan.')
    } catch {
      toast('Kata sandi tidak bisa dibuka. PIN mungkin sudah diganti dari perangkat lain.', 'error')
    }
  }

  const renderRow = (s: Subscription) => {
    const st = subStatus(s.end_date, today, settings.warnDays)
    const left = daysLeft(s.end_date, today)
    return (
      <tr key={s.id}>
        <TD>
          <div className="font-medium">{s.customer_name}</div>
          {s.customer_contact && <div className="text-[13px] text-muted">{s.customer_contact}</div>}
        </TD>
        <TD>{s.variant_name ?? `${s.duration_days} hari`}</TD>
        {product?.has_account ? <TD>{s.account_login ?? <span className="text-muted">-</span>}</TD> : null}
        <TD className="whitespace-nowrap">{formatDate(s.start_date)}</TD>
        <TD className="whitespace-nowrap">{formatDate(s.end_date)}</TD>
        <TD className="whitespace-nowrap">{leftText(left)}</TD>
        <TD><Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge></TD>
        <TD right>
          <div className="flex justify-end gap-1">
            <IconButton label={`Pesan WhatsApp ${s.customer_name}`} className="size-8" onClick={() => setWa(s)}><MessageSquareText className="size-4" aria-hidden="true" /></IconButton>
            {product?.has_account && s.account_password_enc ? (
              <IconButton label={`Salin kata sandi ${s.customer_name}`} className="size-8" disabled={!cryptoKey} onClick={() => copyPassword(s)}>
                <Copy className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
            <IconButton label={`Perpanjang ${s.customer_name}`} className="size-8" onClick={() => setRenew(s)}><RefreshCw className="size-4" aria-hidden="true" /></IconButton>
            <IconButton label={`Ubah langganan ${s.customer_name}`} className="size-8" onClick={() => setForm({ edit: s })}><Pencil className="size-4" aria-hidden="true" /></IconButton>
            <IconButton label={`Hapus langganan ${s.customer_name}`} className="size-8" onClick={() => setDel(s)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
          </div>
        </TD>
      </tr>
    )
  }

  const head = (
    <thead>
      <tr>
        <TH>Customer</TH><TH>Varian</TH>{product?.has_account ? <TH>Akun</TH> : null}
        <TH>Mulai</TH><TH>Berakhir</TH><TH>Sisa</TH><TH>Status</TH><TH right>Aksi</TH>
      </tr>
    </thead>
  )

  return (
    <div>
      <PageHeader
        title="Rekap Data Apk Premium"
        subtitle="Siapa memakai aplikasi apa, sampai kapan, dan mana yang perlu diperpanjang."
        actions={<Button variant="primary" onClick={() => setForm({})} disabled={!product}><Plus className="size-4" aria-hidden="true" /> Tambah langganan</Button>}
      />

      <div role="tablist" aria-label="Aplikasi" className="mb-4 flex flex-wrap gap-2">
        {products.map((p) => (
          <button
            key={p.id} type="button" role="tab" aria-selected={p.id === productId}
            onClick={() => setProductId(p.id)}
            className={
              'h-9 rounded-lg border px-3 font-medium transition-colors duration-150 ' +
              (p.id === productId ? 'border-accent-text bg-accent-soft text-accent-soft-fg' : 'border-line-strong text-muted hover:bg-subtle hover:text-fg')
            }
          >
            {p.name} <span className="num ml-1 text-[13px] opacity-80">{countOf(p.id)}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input type="search" aria-label="Cari customer" placeholder="Cari customer atau akun" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-64" />
        <Segmented
          label="Status" value={status} onChange={setStatus} size="sm"
          options={[{ value: 'semua', label: 'Semua' }, { value: 'aktif', label: 'Aktif' }, { value: 'hampir-habis', label: 'Hampir habis' }, { value: 'habis', label: 'Habis' }]}
        />
        {soonCount > 0 && status !== 'hampir-habis' && (
          <Button size="sm" onClick={() => setStatus('hampir-habis')}>{soonCount} hampir habis</Button>
        )}
      </div>

      {subs.length === 0 ? (
        <EmptyState
          title={q || status !== 'semua' ? 'Tidak ada yang cocok dengan filter' : `Belum ada langganan ${product?.name ?? ''}`}
          body={q || status !== 'semua' ? 'Ubah filter atau kata pencarian.' : 'Tambahkan customer pertama untuk aplikasi ini.'}
          action={!q && status === 'semua' ? <Button variant="primary" onClick={() => setForm({})}>Tambah langganan</Button> : undefined}
        />
      ) : product?.has_team ? (
        <div className="flex flex-col gap-6">
          {groupByTeam(subs, today, product.team_capacity).map((g) => (
            <section key={g.team} aria-label={`Tim ${g.team}`}>
              <h2 className="mb-2 flex flex-wrap items-baseline gap-2 font-semibold">
                {g.team}
                <span className="text-[13px] font-normal text-muted">
                  {g.capacity ? `${g.activeCount} dari ${g.capacity} slot terisi, sisa ${Math.max(0, g.capacity - g.activeCount)}` : `${g.activeCount} anggota aktif`}
                </span>
                <Button size="sm" className="ml-auto" onClick={() => setLinkFor(g.team)}>
                  <Link2 className="size-4" aria-hidden="true" /> {teamLinks[teamLinkKey(product.id, g.team)] ? 'Ubah link tim' : 'Isi link tim'}
                </Button>
              </h2>
              <Table label={`Anggota ${g.team}`}>{head}<tbody>{g.members.map(renderRow)}</tbody></Table>
            </section>
          ))}
        </div>
      ) : (
        <Table label={`Langganan ${product?.name ?? ''}`}>
          {head}
          <tbody>
            {subs.map((s) => <Fragment key={s.id}>{renderRow(s)}</Fragment>)}
          </tbody>
        </Table>
      )}

      {form && product && (
        <SubscriptionDialog
          product={product} edit={form.edit} customers={data.data?.customers.map((c) => c.name) ?? []}
          teams={[...new Set(all.filter((s) => s.product_id === product.id && s.team).map((s) => s.team as string))]}
          onClose={() => setForm(null)} onSaved={() => { bump(); toast('Langganan tersimpan.') }}
        />
      )}
      {wa && product && (
        <WaDialog
          key={wa.id} sub={wa} product={products.find((p) => p.id === wa.product_id) ?? product}
          teamLink={wa.team ? teamLinks[teamLinkKey(wa.product_id, wa.team)] ?? '' : ''}
          onClose={() => setWa(null)} onLinkSaved={bump}
        />
      )}
      {linkFor && product && (
        <TeamLinkDialog
          productId={product.id} productName={product.name} team={linkFor} link={teamLinks[teamLinkKey(product.id, linkFor)] ?? ''}
          onClose={() => setLinkFor(null)} onSaved={() => { bump(); toast('Link tim tersimpan.') }}
        />
      )}
      {renew && <RenewDialog sub={renew} product={products.find((p) => p.id === renew.product_id) ?? null} onClose={() => setRenew(null)} onSaved={() => { bump(); toast('Langganan diperpanjang.') }} />}
      <ConfirmDialog
        open={!!del} onClose={() => setDel(null)} danger confirmLabel="Hapus langganan"
        title="Hapus langganan ini?" body={del ? `Langganan ${del.product_name} milik ${del.customer_name} akan dihapus dari rekap.` : ''}
        onConfirm={async () => { if (del) { await deleteSubscription(db, del.id); setDel(null); bump(); toast('Langganan dihapus.') } }}
      />
    </div>
  )
}

function SubscriptionDialog({
  product, edit, customers, teams, onClose, onSaved,
}: { product: Product; edit?: Subscription; customers: string[]; teams: string[]; onClose: () => void; onSaved: () => void }) {
  const { db, cryptoKey } = useApp()
  const [who, setWho] = useState(edit?.customer_name ?? '')
  const [variantId, setVariantId] = useState(edit?.variant_id ?? '')
  const [start, setStart] = useState(edit?.start_date ?? todayStr())
  const [days, setDays] = useState(edit ? String(edit.duration_days) : '')
  const [raw, setRaw] = useState(edit ? String(edit.price) : '')
  const [price, setPrice] = useState<number | null>(edit ? edit.price : null)
  const [login, setLogin] = useState(edit?.account_login ?? '')
  const [pwd, setPwd] = useState('')
  const [pwdShown, setPwdShown] = useState(false)
  const [team, setTeam] = useState(edit?.team ?? '')
  const [note, setNote] = useState(edit?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hadPwd = !!edit?.account_password_enc

  const daysNum = /^[1-9]\d*$/.test(days) ? Number(days) : null
  const end = daysNum ? addDays(start, daysNum) : null
  const valid = who.trim() !== '' && daysNum !== null && (raw.trim() === '' || price !== null) && start !== ''

  const pickVariant = (id: string) => {
    setVariantId(id)
    const v = product.variants.find((x) => x.id === id)
    if (v) {
      setDays(String(v.duration_days))
      setRaw(String(v.price))
      setPrice(v.price)
    }
  }

  const reveal = async () => {
    if (!cryptoKey || !edit?.account_password_enc) return
    try {
      setPwd(await decryptText(cryptoKey, edit.account_password_enc))
      setPwdShown(true)
    } catch {
      setError('Kata sandi tidak bisa dibuka dengan PIN saat ini.')
    }
  }

  const save = async () => {
    if (!valid || daysNum === null) return
    setBusy(true)
    try {
      const customerId = await ensureCustomer(db, who)
      let enc = edit?.account_password_enc ?? null
      if (product.has_account && (pwdShown || !hadPwd) && pwd !== '') {
        if (!cryptoKey) throw new Error('Atur PIN di Pengaturan dulu untuk menyimpan kata sandi.')
        enc = await encryptText(cryptoKey, pwd)
      }
      if (product.has_account && pwdShown && pwd === '') enc = null
      await saveSubscription(
        db,
        {
          customerId, productId: product.id, variantId: variantId || null, startDate: start, durationDays: daysNum,
          price: price ?? 0, accountLogin: product.has_account ? login.trim() || null : null,
          accountPasswordEnc: product.has_account ? enc : null, team: product.has_team ? team.trim() || null : null,
          note: note.trim() || null,
        },
        edit?.id,
      )
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
      open onClose={onClose} title={`${edit ? 'Ubah' : 'Tambah'} langganan ${product.name}`}
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!valid}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Customer" htmlFor="s-who" hint="Pilih yang sudah ada atau ketik nama baru, otomatis ditambahkan ke Data Customer.">
          <Input id="s-who" list="s-customers" value={who} onChange={(e) => setWho(e.target.value)} autoComplete="off" />
          <datalist id="s-customers">{customers.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>

        <Field label="Varian" htmlFor="s-variant" hint={product.variants.length === 0 ? 'Belum ada varian di Pricelist. Isi durasi dan harga manual.' : undefined}>
          <Select id="s-variant" value={variantId} onChange={(e) => pickVariant(e.target.value)}>
            <option value="">Atur manual</option>
            {product.variants.map((v) => <option key={v.id} value={v.id}>{v.name}, {v.duration_days} hari, {rupiah(v.price)}</option>)}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal mulai" htmlFor="s-start"><Input id="s-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Durasi (hari)" htmlFor="s-days">
            <Input id="s-days" inputMode="numeric" value={days} onChange={(e) => { setDays(e.target.value.replace(/\D/g, '')); setVariantId('') }} />
          </Field>
        </div>
        <p className="-mt-2 text-muted">{end ? `Berakhir ${formatDate(end)}.` : 'Isi durasi untuk melihat tanggal berakhir.'}</p>

        <NominalInput id="s-price" label="Harga (opsional)" value={raw} allowEmpty onChange={(r, v) => { setRaw(r); setPrice(r.trim() === '' ? 0 : v) }} />

        {product.has_account && (
          <>
            <Field label="Akun (email atau username)" htmlFor="s-login"><Input id="s-login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" /></Field>
            <Field
              label="Kata sandi akun" htmlFor="s-pwd"
              hint={!cryptoKey ? 'Atur PIN di Pengaturan untuk bisa menyimpan kata sandi. Kata sandi disimpan terenkripsi.' : hadPwd && !pwdShown ? 'Tersimpan terenkripsi. Tekan tombol untuk melihat atau mengganti.' : 'Disimpan terenkripsi dengan kunci dari PIN.'}
            >
              {hadPwd && !pwdShown ? (
                <div><Button size="sm" onClick={reveal} disabled={!cryptoKey}>Lihat atau ganti kata sandi</Button></div>
              ) : (
                <Input id="s-pwd" value={pwd} onChange={(e) => setPwd(e.target.value)} disabled={!cryptoKey} autoComplete="off" />
              )}
            </Field>
          </>
        )}

        {product.has_team && (
          <Field label="Tim" htmlFor="s-team" hint={product.team_capacity ? `Kapasitas satu tim ${product.team_capacity}.` : 'Contoh: Tim A.'}>
            <Input id="s-team" list="s-teams" value={team} onChange={(e) => setTeam(e.target.value)} autoComplete="off" />
            <datalist id="s-teams">{teams.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
        )}

        <Field label="Catatan (opsional)" htmlFor="s-note"><Textarea id="s-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

function RenewDialog({
  sub, product, onClose, onSaved,
}: { sub: Subscription; product: Product | null; onClose: () => void; onSaved: () => void }) {
  const { db } = useApp()
  const today = todayStr()
  const [days, setDays] = useState(String(sub.duration_days))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const n = /^[1-9]\d*$/.test(days) ? Number(days) : null
  const expired = sub.end_date < today
  const newEnd = n ? (expired ? addDays(today, n) : addDays(sub.end_date, n)) : null

  const save = async () => {
    if (!n) return
    setBusy(true)
    try {
      await renewSubscription(db, sub.id, n, today)
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
      open onClose={onClose} title={`Perpanjang ${sub.customer_name}`} width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!n}>Perpanjang</Button></>}
    >
      <div className="flex flex-col gap-4">
        <p>
          {sub.product_name} berakhir {formatDate(sub.end_date)}.{' '}
          {expired ? 'Sudah habis, jadi hitungan baru mulai dari hari ini.' : 'Durasi baru disambung dari tanggal berakhir.'}
        </p>
        <Field label="Tambah durasi (hari)" htmlFor="r-days">
          <Input id="r-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} className="max-w-40" />
          {product && product.variants.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {[...new Set(product.variants.map((v) => v.duration_days))].map((d) => <Button key={d} size="sm" onClick={() => setDays(String(d))}>{d} hari</Button>)}
            </div>
          )}
        </Field>
        <p className="font-medium">{newEnd ? `Berakhir menjadi ${formatDate(newEnd)}.` : 'Isi durasi.'}</p>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}
