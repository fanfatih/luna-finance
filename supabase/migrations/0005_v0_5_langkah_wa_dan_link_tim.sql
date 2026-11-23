-- Aplikasi 0.5.0: langkah pesan WhatsApp per aplikasi (products.wa_steps) dan link undangan per tim (team_links).
-- Sudah dijalankan di project Supabase. Disimpan di sini sebagai catatan.
-- Urutan yang dipakai: bagian 1 dan 2, deploy edge function sync versi baru, lalu bagian 3.
-- (Sebelum bagian 3, edge function lama masih memanggil sync_push dengan parameter `legacy`.)

-- 1. Kolom dan tabel baru
alter table public.products add column if not exists wa_steps text;

create table if not exists public.team_links (
  id text primary key,
  product_id text not null,
  team text not null,
  link text,
  updated_at bigint not null,
  deleted_at bigint,
  synced_at bigint not null default 0
);
create index if not exists idx_team_links_synced on public.team_links (synced_at);
alter table public.team_links enable row level security;

-- 2. sync_push versi baru: `keep` berisi kolom yang tidak dikenal klien lama, jadi isinya jangan ditimpa
create or replace function public.sync_push(tbl text, rows jsonb, keep text[] default '{}')
returns void language plpgsql set search_path to 'public' as $function$
declare cols text; sets text; now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if tbl not in ('channels','daily_records','daily_balances','capital_moves','contacts','debts','debt_payments','products','product_variants','customers','subscriptions','events','top_spenders','monthly_vouchers','team_links') then
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

-- 3. Setelah edge function baru aktif: buang versi lama yang memakai parameter `legacy`
drop function if exists public.sync_push(text, jsonb, boolean);
