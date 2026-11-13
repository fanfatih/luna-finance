// Sinkronisasi Luna Finance. Aplikasi desktop mengirim perubahan lokal dan mengambil perubahan baru.
// Aturan konflik: baris dengan updated_at lebih baru menang. Hapus lunak ikut tersinkron.
import { createClient } from 'npm:@supabase/supabase-js@2'

const TABLES = [
  'channels', 'daily_records', 'daily_balances', 'capital_moves', 'contacts',
  'debts', 'debt_payments', 'products', 'product_variants', 'customers', 'subscriptions',
]
const BATCH = 1000

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-sync-key',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Gunakan POST.' }, 405)

  const key = Deno.env.get('SYNC_KEY') ?? ''
  if (!key || !same(req.headers.get('x-sync-key') ?? '', key)) return json({ error: 'Kunci sinkron salah.' }, 401)

  let body: { push?: Record<string, unknown[]>; since?: Record<string, string> }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Isi permintaan tidak valid.' }, 400)
  }

  for (const t of TABLES) {
    const rows = body.push?.[t]
    if (Array.isArray(rows) && rows.length) {
      const { error } = await db.rpc('sync_push', { tbl: t, rows })
      if (error) return json({ error: `${t}: ${error.message}` }, 500)
    }
  }

  const pull: Record<string, { rows: unknown[]; next: string | null }> = {}
  let more = false
  for (const t of TABLES) {
    const [tsRaw, id = '0'] = (body.since?.[t] ?? '0|0').split('|')
    const ts = Number(tsRaw) || 0
    const { data, error } = await db
      .from(t)
      .select('*')
      .or(`synced_at.gt.${ts},and(synced_at.eq.${ts},id.gt.${id})`)
      .order('synced_at')
      .order('id')
      .limit(BATCH)
    if (error) return json({ error: `${t}: ${error.message}` }, 500)
    const last = data.at(-1)
    pull[t] = { rows: data, next: last ? `${last.synced_at}|${last.id}` : null }
    if (data.length === BATCH) more = true
  }
  return json({ pull, more })
})
