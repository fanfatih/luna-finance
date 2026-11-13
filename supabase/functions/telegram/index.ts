// Bot Telegram Luna Finance: catat dan cek utang-piutang dari HP.
// Hanya melayani satu pemilik (TELEGRAM_OWNER_ID). Data masuk ke Supabase, lalu ditarik aplikasi desktop saat sinkron.
import { createClient } from 'npm:@supabase/supabase-js@2'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const OWNER = (Deno.env.get('TELEGRAM_OWNER_ID') ?? '').trim()
const SYNC_KEY = Deno.env.get('SYNC_KEY') ?? ''
const SELF_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram`

type Kind = 'utang' | 'piutang'

/* ---------- util ---------- */

async function webhookSecret(): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('luna-webhook:' + SYNC_KEY))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 48)
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
const rp = (n: number) => 'Rp' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

async function tg(method: string, payload: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return r.json()
}
const send = (chat: number | string, text: string) => tg('sendMessage', { chat_id: chat, text })

/** Sama dengan parseNominal di aplikasi: 100rb, 100k, 100.000, 1,5jt, 2juta, Rp 100.000. */
function parseNominal(raw: string): number | null {
  const SUFFIX: Record<string, number> = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6 }
  let s = raw.toLowerCase().replace(/rp\.?/g, '').replace(/\s+/g, '')
  if (!s) return null
  const m = s.match(/^([\d.,]+)(ribu|rb|k|juta|jt)$/)
  if (m) {
    if (!/^\d+([.,]\d+)?$/.test(m[1])) return null
    const exact = Number(m[1].replace(',', '.')) * SUFFIX[m[2]]
    const n = Math.round(exact)
    return Math.abs(n - exact) < 1e-6 && n > 0 ? n : null
  }
  if (/^\d+$/.test(s)) return Number(s) > 0 ? Number(s) : null
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''))
  return null
}

const looksNumeric = (t: string) => /^(rp\.?)?\d/i.test(t)

/** "Pak Budi 200rb buat bensin" -> nama "Pak Budi", nominal 200000, catatan "buat bensin". */
function parseArgs(text: string): { name: string; amount: number; note: string | null } | string {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  const i = tokens.findIndex(looksNumeric)
  if (i <= 0) return 'Format: nama lalu nominal. Contoh: Budi 200rb'
  const name = tokens.slice(0, i).join(' ')
  const amount = parseNominal(tokens[i])
  if (amount === null) return `Nominal "${tokens[i]}" tidak terbaca. Contoh: 100rb, 100.000, 1,5jt.`
  const note = tokens.slice(i + 1).join(' ') || null
  return { name, amount, note }
}

/* ---------- data ---------- */

const esc = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

async function fetchAll<T>(table: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q: any = db.from(table).select('*').is('deleted_at', null)
    if (filter) q = filter(q)
    const { data, error } = await q.order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

interface Open { id: string; kind: Kind; contact_id: string; date: string; remaining: number }

async function openDebts(contactId?: string, kind?: Kind): Promise<Open[]> {
  const debts = await fetchAll<any>('debts', (q) => {
    if (contactId) q = q.eq('contact_id', contactId)
    if (kind) q = q.eq('kind', kind)
    return q
  })
  if (!debts.length) return []
  const pays = await fetchAll<any>('debt_payments')
  const paid = new Map<string, number>()
  for (const p of pays) paid.set(p.debt_id, (paid.get(p.debt_id) ?? 0) + p.amount)
  return debts
    .map((d) => ({ id: d.id, kind: d.kind as Kind, contact_id: d.contact_id, date: d.date, remaining: d.amount - (paid.get(d.id) ?? 0) }))
    .filter((d) => d.remaining > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

async function findContact(name: string) {
  const { data } = await db.from('contacts').select('id,name').is('deleted_at', null).ilike('name', esc(name)).limit(1)
  return data?.[0] ?? null
}

async function ensureContact(name: string): Promise<{ id: string; name: string }> {
  const found = await findContact(name)
  if (found) return found
  const id = crypto.randomUUID()
  const now = Date.now()
  const { error } = await db.from('contacts').insert({ id, name, updated_at: now, synced_at: now })
  if (error) throw new Error(error.message)
  return { id, name }
}

const sum = (xs: Open[]) => xs.reduce((a, b) => a + b.remaining, 0)

/* ---------- perintah ---------- */

const HELP = [
  'Perintah Luna Finance:',
  '/piutang Budi 200rb [catatan]  (Budi utang ke kamu)',
  '/utang Budi 200rb [catatan]  (kamu utang ke Budi)',
  '/terima Budi 50rb  (Budi bayar piutangnya)',
  '/bayar Budi 50rb  (kamu bayar utangmu)',
  '/saldo [nama]  (sisa utang dan piutang)',
  '/daftar  (semua yang masih berjalan)',
  '',
  'Nominal bebas: 100rb, 100k, 100.000, 1,5jt.',
  'Salah catat? Koreksi lewat aplikasi desktop setelah sinkron.',
].join('\n')

async function addDebt(kind: Kind, args: string): Promise<string> {
  const p = parseArgs(args)
  if (typeof p === 'string') return p
  const c = await ensureContact(p.name)
  const now = Date.now()
  const { error } = await db.from('debts').insert({
    id: crypto.randomUUID(), kind, contact_id: c.id, amount: p.amount, date: today(),
    due_date: null, note: p.note, updated_at: now, synced_at: now,
  })
  if (error) throw new Error(error.message)
  const total = sum(await openDebts(c.id, kind))
  return `Tercatat ${kind} ${c.name} ${rp(p.amount)}.\nTotal ${kind} ${c.name} sekarang ${rp(total)}.`
}

async function addPayment(kind: Kind, args: string): Promise<string> {
  const p = parseArgs(args)
  if (typeof p === 'string') return p
  const c = await findContact(p.name)
  if (!c) return `Nama "${p.name}" belum ada. Cek /daftar.`
  const open = await openDebts(c.id, kind)
  const total = sum(open)
  if (!open.length) return `Nggak ada ${kind} ${c.name} yang masih berjalan.`
  if (p.amount > total) return `Kelebihan. Sisa ${kind} ${c.name} cuma ${rp(total)}.`
  let left = p.amount
  const now = Date.now()
  const rows = []
  for (const d of open) {
    if (left <= 0) break
    const use = Math.min(left, d.remaining)
    rows.push({ id: crypto.randomUUID(), debt_id: d.id, amount: use, date: today(), note: p.note, updated_at: now, synced_at: now })
    left -= use
  }
  const { error } = await db.from('debt_payments').insert(rows)
  if (error) throw new Error(error.message)
  const rest = total - p.amount
  return rest === 0
    ? `Tercatat. ${kind} ${c.name} lunas.`
    : `Tercatat ${rp(p.amount)}. Sisa ${kind} ${c.name} ${rp(rest)}.`
}

async function saldo(args: string): Promise<string> {
  const name = args.trim()
  if (name) {
    const c = await findContact(name)
    if (!c) return `Nama "${name}" belum ada. Cek /daftar.`
    const open = await openDebts(c.id)
    const pi = sum(open.filter((d) => d.kind === 'piutang'))
    const ut = sum(open.filter((d) => d.kind === 'utang'))
    if (!pi && !ut) return `${c.name}: tidak ada yang berjalan.`
    return [`${c.name}`, pi ? `Utang ke kamu: ${rp(pi)}` : '', ut ? `Utangmu ke dia: ${rp(ut)}` : ''].filter(Boolean).join('\n')
  }
  const open = await openDebts()
  const pi = open.filter((d) => d.kind === 'piutang')
  const ut = open.filter((d) => d.kind === 'utang')
  return `Piutang berjalan: ${rp(sum(pi))} (${pi.length} catatan)\nUtang berjalan: ${rp(sum(ut))} (${ut.length} catatan)`
}

async function daftar(): Promise<string> {
  const open = await openDebts()
  if (!open.length) return 'Tidak ada utang atau piutang yang berjalan.'
  const contacts = await fetchAll<any>('contacts')
  const nameOf = new Map(contacts.map((c) => [c.id, c.name]))
  const by = new Map<string, { pi: number; ut: number }>()
  for (const d of open) {
    const e = by.get(d.contact_id) ?? { pi: 0, ut: 0 }
    if (d.kind === 'piutang') e.pi += d.remaining
    else e.ut += d.remaining
    by.set(d.contact_id, e)
  }
  const lines = [...by.entries()]
    .sort((a, b) => b[1].pi + b[1].ut - (a[1].pi + a[1].ut))
    .slice(0, 25)
    .map(([id, e]) => `${nameOf.get(id) ?? '?'}: ` + [e.pi ? `piutang ${rp(e.pi)}` : '', e.ut ? `utang ${rp(e.ut)}` : ''].filter(Boolean).join(', '))
  return lines.join('\n') + (by.size > 25 ? `\n...dan ${by.size - 25} pihak lain` : '')
}

async function handle(chat: number, text: string): Promise<string> {
  const m = text.trim().match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/)
  if (!m) return 'Ketik /bantuan untuk lihat perintah.'
  const [, cmd, args] = m
  switch (cmd.toLowerCase()) {
    case 'start':
    case 'bantuan':
    case 'help': return HELP
    case 'piutang': return addDebt('piutang', args)
    case 'utang': return addDebt('utang', args)
    case 'terima': return addPayment('piutang', args)
    case 'bayar': return addPayment('utang', args)
    case 'saldo': return saldo(args)
    case 'daftar': return daftar()
    default: return 'Perintah tidak dikenal. Ketik /bantuan.'
  }
}

/* ---------- server ---------- */

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Pasang webhook dan daftar perintah: buka sekali dengan ?setup=<SYNC_KEY>.
  if (url.searchParams.has('setup')) {
    if (!SYNC_KEY || url.searchParams.get('setup') !== SYNC_KEY) return new Response('Kunci salah.', { status: 401 })
    if (!TOKEN) return new Response('TELEGRAM_BOT_TOKEN belum diisi.', { status: 400 })
    const hook = await tg('setWebhook', { url: SELF_URL, secret_token: await webhookSecret(), allowed_updates: ['message'] })
    await tg('setMyCommands', {
      commands: [
        { command: 'piutang', description: 'Catat orang utang ke kamu' },
        { command: 'utang', description: 'Catat utangmu ke orang' },
        { command: 'terima', description: 'Catat pembayaran piutang' },
        { command: 'bayar', description: 'Catat bayar utangmu' },
        { command: 'saldo', description: 'Cek sisa utang dan piutang' },
        { command: 'daftar', description: 'Daftar yang masih berjalan' },
        { command: 'bantuan', description: 'Cara pakai' },
      ],
    })
    return new Response(JSON.stringify({ webhook: hook, owner_set: Boolean(OWNER) }, null, 2), { headers: { 'content-type': 'application/json' } })
  }

  if (req.method !== 'POST') return new Response('ok')
  if (req.headers.get('x-telegram-bot-api-secret-token') !== (await webhookSecret())) return new Response('forbidden', { status: 403 })

  const update = await req.json().catch(() => null)
  const msg = update?.message
  if (!msg?.text) return new Response('ok')
  const chat: number = msg.chat.id
  const from = String(msg.from?.id ?? '')

  // Mode pairing: belum ada pemilik, balas ID Telegram saja tanpa membuka data.
  if (!OWNER) {
    await send(chat, `ID Telegram kamu: ${from}\nKasih angka ini ke Claude untuk dipasang sebagai pemilik bot.`)
    return new Response('ok')
  }
  if (from !== OWNER) return new Response('ok')

  try {
    await send(chat, await handle(chat, msg.text))
  } catch (e) {
    console.error(e)
    await send(chat, 'Ada error di server. Coba lagi sebentar lagi.')
  }
  return new Response('ok')
})
