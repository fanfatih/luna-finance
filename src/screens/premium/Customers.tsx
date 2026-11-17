import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useApp, useAsync } from '@/app/context'
import {
  Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, IconButton, Input, Loading, PageHeader,
  Table, TD, TH, Textarea, useToast,
} from '@/components/ui'
import { deleteCustomer, listCustomers, listSubscriptions, saveCustomer, subStatus, type Customer } from '@/db/premium'
import { formatDate, todayStr } from '@/lib/date'
import { cleanPhone } from '@/lib/phone'

export function Customers() {
  const { db, bump, settings } = useApp()
  const toast = useToast()
  const today = todayStr()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<{ c?: Customer } | null>(null)
  const [del, setDel] = useState<Customer | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const data = useAsync(async () => {
    const [customers, subs] = await Promise.all([listCustomers(db), listSubscriptions(db)])
    return { customers, subs }
  }, [])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (data.data?.customers ?? []).filter(
      (c) => !term || c.name.toLowerCase().includes(term) || (c.contact ?? '').toLowerCase().includes(term) || (c.email ?? '').toLowerCase().includes(term),
    )
  }, [data.data, q])

  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  const subs = data.data?.subs ?? []

  return (
    <div>
      <PageHeader
        title="Data Customer"
        subtitle="Semua customer Lunapremium dan langganan yang sedang mereka pakai."
        actions={<Button variant="primary" onClick={() => setEdit({})}><Plus className="size-4" aria-hidden="true" /> Tambah customer</Button>}
      />

      <div className="mb-4 max-w-sm">
        <Input type="search" aria-label="Cari customer" placeholder="Cari nama, kontak, atau email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {(data.data?.customers.length ?? 0) === 0 ? (
        <EmptyState
          title="Belum ada customer" body="Customer juga otomatis dibuat saat kamu menambah langganan di Rekap."
          action={<Button variant="primary" onClick={() => setEdit({})}>Tambah customer</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="Tidak ada yang cocok" body={`Tidak ada customer dengan kata "${q}".`} />
      ) : (
        <Table label="Daftar customer">
          <thead><tr><TH>Nama</TH><TH>Kontak</TH><TH>Email</TH><TH>Langganan</TH><TH>Catatan</TH><TH right>Aksi</TH></tr></thead>
          <tbody>
            {rows.map((c) => {
              const mine = subs.filter((s) => s.customer_id === c.id)
              const active = mine.filter((s) => s.end_date >= today).length
              return (
                <tr key={c.id}>
                  <TD className="font-medium">
                    <button
                      type="button" aria-expanded={open === c.id}
                      onClick={() => setOpen(open === c.id ? null : c.id)}
                      className="text-left underline-offset-2 hover:underline"
                    >
                      {c.name}
                    </button>
                    {open === c.id && (
                      <ul className="mt-2 flex flex-col gap-1 text-[13px] font-normal">
                        {mine.length === 0 && <li className="text-muted">Belum punya langganan.</li>}
                        {mine.map((s) => {
                          const st = subStatus(s.end_date, today, settings.warnDays)
                          return (
                            <li key={s.id} className="flex flex-wrap items-center gap-2">
                              <span>{s.product_name}{s.team ? ` (${s.team})` : ''}, sampai {formatDate(s.end_date)}</span>
                              <Badge tone={st === 'aktif' ? 'success' : st === 'hampir-habis' ? 'warn' : 'danger'}>
                                {st === 'aktif' ? 'Aktif' : st === 'hampir-habis' ? 'Hampir habis' : 'Habis'}
                              </Badge>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </TD>
                  <TD>{c.contact || <span className="text-muted">-</span>}</TD>
                  <TD>{c.email || <span className="text-muted">-</span>}</TD>
                  <TD>{active} aktif{mine.length > active ? `, ${mine.length - active} habis` : ''}</TD>
                  <TD className="max-w-60 truncate text-muted">{c.note}</TD>
                  <TD right>
                    <div className="flex justify-end gap-1">
                      <IconButton label={`Ubah ${c.name}`} className="size-8" onClick={() => setEdit({ c })}><Pencil className="size-4" aria-hidden="true" /></IconButton>
                      <IconButton label={`Hapus ${c.name}`} className="size-8" onClick={() => setDel(c)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
                    </div>
                  </TD>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {edit && <CustomerDialog edit={edit.c} onClose={() => setEdit(null)} onSaved={() => { bump(); toast('Customer tersimpan.') }} />}
      <ConfirmDialog
        open={!!del} onClose={() => setDel(null)} danger confirmLabel="Hapus customer"
        title={`Hapus ${del?.name ?? ''}?`} body="Customer beserta semua langganannya akan dihapus dari rekap."
        onConfirm={async () => { if (del) { await deleteCustomer(db, del.id); setDel(null); bump(); toast('Customer dihapus.') } }}
      />
    </div>
  )
}

function CustomerDialog({ edit, onClose, onSaved }: { edit?: Customer; onClose: () => void; onSaved: () => void }) {
  const { db } = useApp()
  const [name, setName] = useState(edit?.name ?? '')
  const [contact, setContact] = useState(edit?.contact ?? '')
  const [email, setEmail] = useState(edit?.email ?? '')
  const [note, setNote] = useState(edit?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await saveCustomer(db, { name, contact: contact.trim() || null, email: email.trim() || null, note: note.trim() || null }, edit?.id)
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
      open onClose={onClose} title={edit ? 'Ubah customer' : 'Tambah customer'} width="max-w-md"
      footer={<><Button onClick={onClose}>Batal</Button><Button variant="primary" onClick={save} loading={busy} disabled={!name.trim()}>Simpan</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Nama" htmlFor="c-name"><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Kontak (opsional)" htmlFor="c-contact" hint="Nomor WhatsApp (tanda + - dan spasi otomatis hilang), username Telegram, atau lainnya."><Input id="c-contact" inputMode="tel" value={contact} onChange={(e) => setContact(cleanPhone(e.target.value))} /></Field>
        <Field label="Email (opsional)" htmlFor="c-email"><Input id="c-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Catatan (opsional)" htmlFor="c-note"><Textarea id="c-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="text-danger-text">{error}</p>}
      </div>
    </Dialog>
  )
}
