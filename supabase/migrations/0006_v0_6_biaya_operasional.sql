-- Aplikasi 0.6.0: biaya operasional (expenses) dan tagihan rutin (recurring_expenses).
-- Sudah dijalankan di project Supabase. Disimpan di sini sebagai catatan.
-- Urutan yang dipakai: jalankan file ini dulu, lalu deploy edge function sync versi baru.
-- (Sebelum edge function baru aktif, klien lama tidak menyentuh tabel baru ini.)

create table if not exists public.expenses (
  id text primary key,
  date text not null,
  name text not null,
  category text not null default 'lain',
  amount bigint not null,
  channel_id text,
  spread_months integer not null default 1,
  recurring_id text,
  note text,
  updated_at bigint not null,
  deleted_at bigint,
  synced_at bigint not null default 0
);
create index if not exists idx_expenses_synced on public.expenses (synced_at);
alter table public.expenses enable row level security;

create table if not exists public.recurring_expenses (
  id text primary key,
  name text not null,
  category text not null default 'lain',
  amount bigint not null,
  period text not null,
  next_due text not null,
  anchor_day integer not null,
  channel_id text,
  updated_at bigint not null,
  deleted_at bigint,
  synced_at bigint not null default 0
);
create index if not exists idx_recurring_expenses_synced on public.recurring_expenses (synced_at);
alter table public.recurring_expenses enable row level security;

-- sync_push: daftar tabel yang diizinkan ditambah dua tabel baru (tanda tangan fungsi tidak berubah)
create or replace function public.sync_push(tbl text, rows jsonb, keep text[] default '{}')
returns void language plpgsql set search_path to 'public' as $function$
declare cols text; sets text; now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if tbl not in ('channels','daily_records','daily_balances','capital_moves','contacts','debts','debt_payments','products','product_variants','customers','subscriptions','events','top_spenders','monthly_vouchers','team_links','expenses','recurring_expenses') then
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
