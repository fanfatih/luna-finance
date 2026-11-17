-- Aplikasi 0.3.0: email customer, kalender kegiatan (events), dan sync_push yang aman untuk klien 0.2.0.
-- Sudah dijalankan di project Supabase. Disimpan di sini sebagai catatan.
alter table public.customers add column if not exists email text;

create table if not exists public.events (
  id text primary key,
  title text not null,
  date text not null,
  start_time text,
  end_time text,
  category text not null default 'pribadi',
  note text,
  remind_day integer not null default 0,
  remind_hours integer not null default 0,
  updated_at bigint not null,
  deleted_at bigint,
  synced_at bigint not null default 0
);
create index if not exists idx_events_synced on public.events (synced_at);
alter table public.events enable row level security;

drop function if exists public.sync_push(text, jsonb);
create or replace function public.sync_push(tbl text, rows jsonb, legacy boolean default false)
returns void language plpgsql set search_path to 'public' as $function$
declare cols text; sets text; now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if tbl not in ('channels','daily_records','daily_balances','capital_moves','contacts','debts','debt_payments','products','product_variants','customers','subscriptions','events') then
    raise exception 'tabel tidak dikenal: %', tbl;
  end if;
  select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name <> 'synced_at';
  -- Klien lama (0.2.0) tidak mengenal kolom email: jangan timpa email yang sudah terisi.
  select string_agg(
           case when legacy and tbl = 'customers' and column_name = 'email' then 'email = t.email'
                else format('%1$I = excluded.%1$I', column_name) end, ',' order by ordinal_position) into sets
    from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name not in ('id','synced_at');
  execute format(
    'insert into public.%1$I as t (%2$s, synced_at) select %2$s, %3$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (id) do update set %4$s, synced_at = %3$s where t.updated_at < excluded.updated_at',
    tbl, cols, now_ms, sets) using rows;
end $function$;
