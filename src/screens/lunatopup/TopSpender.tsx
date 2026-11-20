import { useMemo, useState } from 'react'
import { Copy, Pencil, Plus, Settings2, Wand2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Button, Card, Dialog, EmptyState, ErrorState, Field, IconButton, Input, Loading, PageHeader, Select, useToast,
} from '@/components/ui'
import {
  allVoucherCodes, getRewards, listTopSpenderYears, listTopSpenders, makeVoucherCode, MONTH_NAMES, PLACES, saveTopSpenders,
  setRewards, type Place, type Rewards, type TopSpender,
} from '@/db/topspender'
import { copyText } from '@/lib/clipboard'
import { maskIdentity } from '@/lib/mask'
import { cn } from '@/lib/cn'
import { parseMessage, parseNominal, rupiah } from '@/lib/money'

const rewardOf = (place: Place, r: Rewards): string => (place === 1 || place === 2 ? r[place] : '')

export function TopSpenderPage() {
  const { db, bump } = useApp()
  const toast = useToast()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [edit, setEdit] = useState<number | null>(null)
  const [rewardsOpen, setRewardsOpen] = useState(false)

  const data = useAsync(async () => {
    const [rows, years, rewards] = await Promise.all([listTopSpenders(db, year), listTopSpenderYears(db), getRewards(db)])
    return { rows, years, rewards }
  }, [year])

  const years = useMemo(() => {
    const set = new Set<number>([now.getFullYear(), now.getFullYear() + 1, year, ...(data.data?.years ?? [])])
    return [...set].sort((a, b) => a - b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data, year])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  const rows = data.data?.rows ?? []
  const rewards = data.data!.rewards
  const byMonth = (m: number) => rows.filter((r) => r.month === m)

  const copyVouchers = async (m: number) => {
    const text = byMonth(m)
      .filter((r) => r.voucher_code)
      .map((r) => `${r.voucher_code} | ${rewardOf(r.place, rewards) || `Peringkat ${r.place}`} | ${r.account}`)
      .join('\n')
    toast((await copyText(text)) ? 'Daftar voucher disalin.' : 'Gagal menyalin.', 'ok')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <PageHeader
          title="Data Top Spender"
          subtitle="Top spender tiap bulan di lunatopup.com, beserta kode voucher hadiahnya."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Tahun" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
              <Button onClick={() => setRewardsOpen(true)}><Settings2 className="size-4" aria-hidden="true" /> Hadiah</Button>
            </div>
          }
        />

        <p className="mb-5 text-muted">
          Hadiah: Top 1 {rewards[1] || '-'}. Top 2 {rewards[2] || '-'}. Akun asli hanya tersimpan di komputer dan cloud pribadimu. Poster memakai versi yang disensor.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MONTH_NAMES.map((name, i) => {
            const m = i + 1
            const list = byMonth(m)
            const current = year === now.getFullYear() && m === now.getMonth() + 1
            return (
              <Card key={m} className={cn('flex flex-col p-4', current && 'outline-2 -outline-offset-2 outline-accent-text')}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-[15px] font-semibold">{name}{current ? <span className="ml-2 text-[13px] font-medium text-muted">bulan ini</span> : null}</h2>
                  <div className="flex">
                    {list.some((r) => r.voucher_code) && (
                      <IconButton label={`Salin daftar voucher ${name}`} className="size-8" onClick={() => copyVouchers(m)}><Copy className="size-4" aria-hidden="true" /></IconButton>
                    )}
                    <IconButton label={`${list.length ? 'Ubah' : 'Isi'} top spender ${name}`} className="size-8" onClick={() => setEdit(m)}>
                      {list.length ? <Pencil className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                    </IconButton>
                  </div>
                </div>
                {list.length === 0 ? (
                  <p className="text-muted">Belum diisi.</p>
                ) : (
                  <ol className="flex flex-col gap-2.5">
                    {list.map((r) => <Entry key={r.id} r={r} />)}
                  </ol>
                )}
              </Card>
            )
          })}
        </div>

        {rows.length === 0 && (
          <div className="mt-6">
            <EmptyState title={`Belum ada data ${year}`} body="Pilih bulan di atas dan isi top spender-nya." />
          </div>
        )}
      </div>

      {edit && (
        <MonthDialog
          year={year} month={edit} rows={byMonth(edit)} rewards={rewards} onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); data.reload(); bump(); toast('Top spender tersimpan.') }}
        />
      )}
      {rewardsOpen && (
        <RewardsDialog
          rewards={rewards} onClose={() => setRewardsOpen(false)}
          onSaved={() => { setRewardsOpen(false); data.reload(); toast('Hadiah tersimpan.') }}
        />
      )}
    </div>
  )
}

function Entry({ r }: { r: TopSpender }) {
  const toast = useToast()
  return (
    <li className="flex items-start gap-2.5">
      <span className="num w-6 shrink-0 pt-0.5 text-muted">#{r.place}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={r.account}>{r.account}</p>
        <p className="num text-[13px] text-muted">{r.total_spend !== null ? rupiah(r.total_spend) : 'Total belum diisi'}</p>
      </div>
      {r.voucher_code && (
        <button
          type="button" title="Salin kode"
          onClick={async () => toast((await copyText(r.voucher_code!)) ? `Kode ${r.voucher_code} disalin.` : 'Gagal menyalin.', 'ok')}
          className="shrink-0 rounded-md bg-subtle px-2 py-1 font-mono text-[12px] transition-colors hover:bg-line"
        >
          {r.voucher_code}
        </button>
      )}
    </li>
  )
}

interface Draft { account: string; spend: string; code: string }

function MonthDialog({
  year, month, rows, rewards, onClose, onSaved,
}: { year: number; month: number; rows: TopSpender[]; rewards: Rewards; onClose: () => void; onSaved: () => void }) {
  const { db } = useApp()
  const [draft, setDraft] = useState<Record<Place, Draft>>(() => {
    const d = {} as Record<Place, Draft>
    for (const p of PLACES) {
      const r = rows.find((x) => x.place === p)
      d[p] = { account: r?.account ?? '', spend: r?.total_spend != null ? String(r.total_spend) : '', code: r?.voucher_code ?? '' }
    }
    return d
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (p: Place, patch: Partial<Draft>) => setDraft((d) => ({ ...d, [p]: { ...d[p], ...patch } }))

  const generate = async (p: Place) => {
    const taken = [...(await allVoucherCodes(db)), ...PLACES.map((x) => draft[x].code).filter(Boolean)]
    set(p, { code: makeVoucherCode(month, p, taken) })
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const entries = PLACES.map((p) => {
        const d = draft[p]
        let total: number | null = null
        if (d.spend.trim()) {
          const res = parseNominal(d.spend)
          if (!res.ok) throw new Error(`Total spend peringkat ${p}: ${parseMessage(res.reason)}`)
          total = res.value
        }
        return { place: p, account: d.account, total_spend: total, voucher_code: d.code }
      })
      await saveTopSpenders(db, year, month, entries)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open onClose={onClose} title={`Top spender ${MONTH_NAMES[month - 1]} ${year}`} width="max-w-xl"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-5">
        {PLACES.map((p) => {
          const d = draft[p]
          const reward = rewardOf(p, rewards)
          return (
            <fieldset key={p} className="flex flex-col gap-3 rounded-xl border border-line p-3">
              <legend className="px-1 text-[13px] font-semibold">Peringkat {p}{reward ? `, ${reward}` : ''}</legend>
              <Field label="Email atau akun" htmlFor={`ts-acc-${p}`} hint={d.account.trim() ? `Di poster: ${maskIdentity(d.account)}` : p === 3 ? 'Boleh dikosongkan.' : undefined}>
                <Input id={`ts-acc-${p}`} autoComplete="off" value={d.account} onChange={(e) => set(p, { account: e.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Total spend" htmlFor={`ts-spend-${p}`}>
                  <Input id={`ts-spend-${p}`} autoComplete="off" placeholder="Contoh: 8,7jt atau 8.700.000" value={d.spend} onChange={(e) => set(p, { spend: e.target.value })} />
                </Field>
                {reward && (
                  <Field label="Kode voucher" htmlFor={`ts-code-${p}`}>
                    <div className="flex gap-2">
                      <Input id={`ts-code-${p}`} autoComplete="off" className="font-mono uppercase" value={d.code} onChange={(e) => set(p, { code: e.target.value })} />
                      <Button onClick={() => generate(p)} aria-label={`Buat kode voucher peringkat ${p}`} title="Buat kode acak"><Wand2 className="size-4" aria-hidden="true" /></Button>
                    </div>
                  </Field>
                )}
              </div>
            </fieldset>
          )
        })}
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}

function RewardsDialog({ rewards, onClose, onSaved }: { rewards: Rewards; onClose: () => void; onSaved: () => void }) {
  const { db } = useApp()
  const [r, setR] = useState<Rewards>(rewards)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open onClose={onClose} title="Hadiah top spender" width="max-w-md"
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await setRewards(db, r); onSaved() } finally { setBusy(false) } }}>Simpan</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Hadiah Top 1" htmlFor="rw-1"><Input id="rw-1" value={r[1]} onChange={(e) => setR({ ...r, 1: e.target.value })} /></Field>
        <Field label="Hadiah Top 2" htmlFor="rw-2"><Input id="rw-2" value={r[2]} onChange={(e) => setR({ ...r, 2: e.target.value })} /></Field>
        <p className="text-[13px] text-muted">Tulisan ini tampil di halaman dan ikut tersalin saat menyalin daftar voucher untuk website. Peringkat 3 tidak mendapat voucher.</p>
      </div>
    </Dialog>
  )
}
