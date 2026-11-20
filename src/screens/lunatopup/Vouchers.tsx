import { useMemo, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import { Button, Card, Dialog, ErrorState, Field, IconButton, Input, Loading, PageHeader, Select, Table, TD, TH, useToast } from '@/components/ui'
import { MONTH_NAMES } from '@/db/topspender'
import { listMonthlyVouchers, listVoucherYears, saveMonthlyVoucher, type MonthlyVoucher } from '@/db/vouchers'
import { cn } from '@/lib/cn'

export function VouchersPage() {
  const { db, bump } = useApp()
  const toast = useToast()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [edit, setEdit] = useState<MonthlyVoucher | null>(null)

  const data = useAsync(async () => {
    const [rows, years] = await Promise.all([listMonthlyVouchers(db, year), listVoucherYears(db)])
    return { rows, years }
  }, [year])

  const years = useMemo(() => {
    const set = new Set<number>([now.getFullYear(), now.getFullYear() + 1, year, ...(data.data?.years ?? [])])
    return [...set].sort((a, b) => a - b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data, year])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  const rows = data.data?.rows ?? []
  const counted = rows.filter((r) => r.used !== null)
  const total = counted.reduce((s, r) => s + (r.used ?? 0), 0)
  const best = counted.reduce<MonthlyVoucher | null>((b, r) => (!b || (r.used ?? 0) > (b.used ?? 0) ? r : b), null)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <PageHeader
          title="Data Voucher"
          subtitle="Voucher default tiap bulan di lunatopup.com dan berapa kali terpakai."
          actions={
            <Select aria-label="Tahun" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          }
        />

        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Stat label={`Total terpakai ${year}`} value={counted.length ? total.toLocaleString('id-ID') : '-'} />
          <Stat label="Rata-rata per bulan" value={counted.length ? Math.round(total / counted.length).toLocaleString('id-ID') : '-'} />
          <Stat label="Terbanyak" value={best ? `${best.name ?? MONTH_NAMES[best.month - 1]} (${best.used})` : '-'} />
        </div>

        <Table label={`Voucher bulanan ${year}`}>
          <thead>
            <tr><TH>Bulan</TH><TH>Nama voucher</TH><TH className="text-right">Terpakai</TH><TH><span className="sr-only">Aksi</span></TH></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const current = year === now.getFullYear() && r.month === now.getMonth() + 1
              return (
                <tr key={r.month} className={cn(current && 'bg-subtle')}>
                  <TD>{MONTH_NAMES[r.month - 1]}{current ? <span className="ml-2 text-[13px] text-muted">bulan ini</span> : null}</TD>
                  <TD>{r.name ? <span className="font-mono">{r.name}</span> : <span className="text-muted">Belum diisi</span>}</TD>
                  <TD className="num text-right">{r.used !== null ? r.used.toLocaleString('id-ID') : <span className="text-muted">-</span>}</TD>
                  <TD className="w-12">
                    <IconButton label={`${r.name ? 'Ubah' : 'Isi'} voucher ${MONTH_NAMES[r.month - 1]}`} className="size-8" onClick={() => setEdit(r)}>
                      {r.name ? <Pencil className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                    </IconButton>
                  </TD>
                </tr>
              )
            })}
          </tbody>
        </Table>
        <p className="mt-3 text-[13px] text-muted">Jumlah terpakai diisi setelah bulannya berjalan. Voucher dibuat di website, halaman ini hanya mencatat.</p>
      </div>

      {edit && (
        <VoucherDialog
          year={year} row={edit} onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); data.reload(); bump(); toast('Voucher tersimpan.') }}
        />
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="num mt-1 text-2xl font-bold">{value}</p>
    </Card>
  )
}

function VoucherDialog({ year, row, onClose, onSaved }: { year: number; row: MonthlyVoucher; onClose: () => void; onSaved: () => void }) {
  const { db } = useApp()
  const [name, setName] = useState(row.name ?? '')
  const [used, setUsed] = useState(row.used !== null ? String(row.used) : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const u = used.trim() === '' ? null : Number(used.replace(/\./g, ''))
      if (u !== null && !Number.isFinite(u)) throw new Error('Jumlah terpakai harus berupa angka.')
      await saveMonthlyVoucher(db, year, row.month, { name, used: u })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open onClose={onClose} title={`Voucher ${MONTH_NAMES[row.month - 1]} ${year}`} width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Nama voucher" htmlFor="v-name" hint="Contoh: NNNOVEMBER. Dikosongkan berarti bulan ini belum punya voucher.">
          <Input id="v-name" autoFocus autoComplete="off" className="font-mono uppercase" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Terpakai" htmlFor="v-used" hint="Isi setelah bulannya berjalan.">
          <Input id="v-used" inputMode="numeric" autoComplete="off" value={used} onChange={(e) => setUsed(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}
