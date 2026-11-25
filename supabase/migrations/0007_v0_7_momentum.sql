-- Aplikasi 0.7.0: Momentum. Project klien, item tagihan, pembayaran klien, invoice, dan biaya.
-- Urutan yang dipakai: jalankan file ini dulu, lalu deploy edge function sync versi baru.
-- (Sebelum edge function baru aktif, klien lama tidak menyentuh tabel baru ini.)

create table if not exists public.mom_projects (
  id text primary key,
  name text not null,
  client_name text not null,
  client_contact text,
  client_address text,
  event_date text,
  venue text,
  deliver_by text,
  stage text not null default 'inquiry',
  discount bigint not null default 0,
  note text,
  event_id text,
  deliver_event_id text,
  updated_at bigint not null,
  deleted_at bigint,
  synced_at bigint not null default 0
);
create index if not exists idx_mom_projects_synced on public.mom_projects (synced_at);
alter table public.mom_projects enable row level security;

create table if not exists public.mom_items (
  id text primary key,
  project_id text not null,
  name text not null,
  qty integer not null default 1,
  unit_price bigint not null default 0,
  sort integer not null default 0,
  updated_at bigint not null,
  deleted_at bigint,
  synced_at bigint not null default 0
);
create index if not exists idx_mom_items_synced on public.mom_items (synced_at);
alter table public.mom_items enable row level security;

create table if not exists public.mom_payments (
  id text primary key,
  project_id text not null,
  date text not null,
  amount bigint not null,
  kind text not null default 'termin',
  invoice_id text,
  note text,
  updated_at bigint not null,
  deleted_at bigint,
  synced_at bigint not null default 0
);
create index if not exists idx_mom_payments_synced on public.mom_payments (synced_at);
alter table public.mom_payments enable row level security;

create table if not exists public.mom_invoices (
  id text primary key,
  project_id text not null,
  number text not null,
  kind text not null,
  issue_date text not null,
  due_date text not null,
  amount bigint not null,
  status text not null default 'draft',
  note text,
  snapshot text,
  updated_at bigint not null,
  deleted_at bigint,
  synced_at bigint not null default 0
);
create index if not exists idx_mom_invoices_synced on public.mom_invoices (synced_at);
alter table public.mom_invoices enable row level security;

create table if not exists public.mom_expenses (
  id text primary key,
  date text not null,
  name text not null,
  category text not null default 'lain',
  amount bigint not null,
  project_id text,
  spread_months integer not null default 1,
  note text,
  updated_at bigint not null,
  deleted_at bigint,
  synced_at bigint not null default 0
);
create index if not exists idx_mom_expenses_synced on public.mom_expenses (synced_at);
alter table public.mom_expenses enable row level security;

-- sync_push: daftar tabel yang diizinkan ditambah lima tabel Momentum (tanda tangan fungsi tidak berubah)
create or replace function public.sync_push(tbl text, rows jsonb, keep text[] default '{}')
returns void language plpgsql set search_path to 'public' as $function$
declare cols text; sets text; now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if tbl not in ('channels','daily_records','daily_balances','capital_moves','contacts','debts','debt_payments','products','product_variants','customers','subscriptions','events','top_spenders','monthly_vouchers','team_links','expenses','recurring_expenses','mom_projects','mom_items','mom_payments','mom_invoices','mom_expenses') then
    raise exception 'tabel tidak dikenal: %', tbl;
  end if;
  select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name <> 'synced_at';
  select string_agg(
           case when column_name = any(keep) then format('%1$I = t.%1$I', column_name)
                else format('%1$I = excluded.%1$I', column_name) end, ',' order by ordinal_position) into sets
    from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name not in ('id','synced_at');
  execute format(
    'insert into public.%1$I as t (%2$s, synced_at) select %2$s, %3$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (id) do update set %4$s, synced_at = %3$s where t.updated_at < excluded.updated_at',
    tbl, cols, now_ms, sets) using rows;
end $function$;
