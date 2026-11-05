-- Erweiterung: Chargen/MHD, LEGO, eigene Bereiche, freiere Freigaben
-- Idempotent wo sinnvoll. Keine destruktiven Resets.

-- ========== 1) Freigaben: bereich erweitern ==========
alter table public.freigaben drop constraint if exists freigaben_bereich_check;
alter table public.zusammenfuehrungen drop constraint if exists zusammenfuehrungen_bereich_check;
-- bereich: playmobil | vorrat | lego | beide | alle | c:<uuid>
alter table public.freigaben add constraint freigaben_bereich_check
  check (bereich in ('playmobil','vorrat','lego','beide','alle') or bereich ~ '^c:[0-9a-f-]{36}$');
alter table public.zusammenfuehrungen add constraint zusammenfuehrungen_bereich_check
  check (bereich in ('playmobil','vorrat','lego','beide','alle') or bereich ~ '^c:[0-9a-f-]{36}$');

create or replace function private.bereich_deckt(f_bereich text, p_bereich text)
returns boolean language sql immutable as $$
  select f_bereich = p_bereich
      or f_bereich = 'alle'
      or (f_bereich = 'beide' and p_bereich in ('playmobil','vorrat'));
$$;

create or replace function private.shared_owners(p_bereich text, p_write boolean)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select f.owner_id from public.freigaben f
  where f.member_id = (select auth.uid()) and f.status = 'angenommen'
    and private.bereich_deckt(f.bereich, p_bereich)
    and (not p_write or f.recht = 'bearbeiten');
$$;

create or replace function private.storage_prefixes(p_write boolean)
returns setof text language sql stable security definer set search_path = '' as $$
  select (select auth.uid())::text || '/' || d from unnest(array['teile','vorrat','lego','custom']) d
  union
  select f.owner_id::text || '/' || d
  from public.freigaben f, unnest(array['teile','vorrat','lego','custom']) d
  where f.member_id = (select auth.uid()) and f.status = 'angenommen'
    and private.bereich_deckt(f.bereich, case d when 'teile' then 'playmobil' when 'vorrat' then 'vorrat' when 'lego' then 'lego' else 'alle' end)
    and (not p_write or f.recht = 'bearbeiten')
  union
  select z.von_id::text || '/' || d from public.zusammenfuehrungen z, unnest(array['teile','vorrat','lego','custom']) d
  where z.status = 'angenommen' and (select auth.uid()) in (z.von_id, z.nach_id)
  union
  select z.nach_id::text || '/' || d from public.zusammenfuehrungen z, unnest(array['teile','vorrat','lego','custom']) d
  where z.status = 'angenommen' and (select auth.uid()) in (z.von_id, z.nach_id);
$$;

-- ========== 2) Vorrat-Chargen (mehrere MHDs) ==========
do $$ begin
  alter table public.vorrat add constraint vorrat_id_user_key unique (id, user_id);
exception when duplicate_object then null; end $$;

create table if not exists public.vorrat_chargen (
  id bigint generated always as identity primary key,
  vorrat_id bigint not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  menge numeric(10,2) not null default 0 check (menge >= 0),
  mhd date,
  ort_id bigint,
  notiz text,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
-- FKs composite for same-owner
do $$ begin
  alter table public.vorrat_chargen
    add constraint vorrat_chargen_vorrat_fkey foreign key (vorrat_id, user_id)
    references public.vorrat(id, user_id) on delete cascade deferrable initially immediate;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.vorrat_chargen
    add constraint vorrat_chargen_ort_fkey foreign key (ort_id, user_id)
    references public.vorrat_orte(id, user_id) on delete set null deferrable initially immediate;
exception when duplicate_object then null; end $$;
create index if not exists vorrat_chargen_vorrat_idx on public.vorrat_chargen(vorrat_id);
alter table public.vorrat_chargen enable row level security;

create or replace function private.sync_vorrat_mengen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare vid bigint := coalesce(new.vorrat_id, old.vorrat_id);
begin
  update public.vorrat v set
    menge = coalesce((select sum(c.menge) from public.vorrat_chargen c where c.vorrat_id = vid), 0),
    mhd = (select min(c.mhd) from public.vorrat_chargen c where c.vorrat_id = vid and c.menge > 0 and c.mhd is not null),
    updated_at = now()
  where v.id = vid;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_sync_vorrat_chargen on public.vorrat_chargen;
create trigger trg_sync_vorrat_chargen
  after insert or update or delete on public.vorrat_chargen
  for each row execute function private.sync_vorrat_mengen();

-- Bestehende Artikel → eine Charge (nur wenn noch keine)
insert into public.vorrat_chargen (vorrat_id, user_id, menge, mhd, ort_id)
select v.id, v.user_id, coalesce(v.menge, 0), v.mhd, v.ort_id
from public.vorrat v
where not exists (select 1 from public.vorrat_chargen c where c.vorrat_id = v.id);

-- Neuer Artikel ohne Charge → automatisch anlegen
create or replace function private.vorrat_auto_charge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.vorrat_chargen c where c.vorrat_id = new.id) then
    insert into public.vorrat_chargen (vorrat_id, user_id, menge, mhd, ort_id)
    values (new.id, new.user_id, coalesce(new.menge, 0), new.mhd, new.ort_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_vorrat_auto_charge on public.vorrat;
create trigger trg_vorrat_auto_charge
  after insert on public.vorrat
  for each row execute function private.vorrat_auto_charge();

-- ========== 3) LEGO ==========
create table if not exists public.lego_kisten (
  id bigint generated always as identity primary key,
  nummer text not null, art text not null default 'Kiste', farbe text, name text, ort text, notiz text,
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unique (user_id, nummer), unique (id, user_id)
);
create table if not exists public.lego_sets (
  id bigint generated always as identity primary key,
  set_nummer text not null, name text, notiz text, jahr int, teile_anzahl int,
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unique (user_id, set_nummer), unique (id, user_id)
);
create table if not exists public.lego_teile (
  id bigint generated always as identity primary key,
  teile_nr text, farbe text, beschreibung text, euro numeric(10,2), anzahl int not null default 1,
  kiste_id bigint, bild_url text, notiz text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unique (id, user_id)
);
create table if not exists public.lego_teil_sets (
  teil_id bigint not null, set_id bigint not null, user_id uuid not null,
  primary key (teil_id, set_id), unique (teil_id, set_id, user_id)
);
do $$ begin
  alter table public.lego_teile add constraint lego_teile_kiste_fkey
    foreign key (kiste_id, user_id) references public.lego_kisten(id, user_id) on delete set null deferrable initially immediate;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lego_teil_sets add constraint lego_teil_sets_teil_fkey
    foreign key (teil_id, user_id) references public.lego_teile(id, user_id) on delete cascade deferrable initially immediate;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lego_teil_sets add constraint lego_teil_sets_set_fkey
    foreign key (set_id, user_id) references public.lego_sets(id, user_id) on delete cascade deferrable initially immediate;
exception when duplicate_object then null; end $$;
alter table public.lego_kisten enable row level security;
alter table public.lego_sets enable row level security;
alter table public.lego_teile enable row level security;
alter table public.lego_teil_sets enable row level security;

-- ========== 4) Eigene Bereiche ==========
create table if not exists public.custom_bereiche (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, icon text not null default '📁', farbe text not null default '#1565c0',
  vorlage text not null default 'sammlung' check (vorlage in ('sammlung','inventar')),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create table if not exists public.custom_felder (
  id bigint generated always as identity primary key,
  bereich_id uuid not null, user_id uuid not null,
  schluessel text not null, label text not null,
  typ text not null default 'text' check (typ in ('text','number','euro','date','select')),
  optionen jsonb not null default '[]', pflicht boolean not null default false, sort int not null default 0,
  unique (bereich_id, schluessel), unique (id, user_id)
);
create table if not exists public.custom_orte (
  id bigint generated always as identity primary key,
  bereich_id uuid not null, user_id uuid not null,
  name text not null, farbe text, notiz text, created_at timestamptz not null default now(),
  unique (bereich_id, name), unique (id, user_id)
);
create table if not exists public.custom_eintraege (
  id bigint generated always as identity primary key,
  bereich_id uuid not null, user_id uuid not null,
  name text not null, anzahl numeric(12,2) not null default 1,
  ort_id bigint, data jsonb not null default '{}',
  bild_url text, notiz text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, user_id)
);
do $$ begin
  alter table public.custom_felder add constraint custom_felder_bereich_fkey
    foreign key (bereich_id, user_id) references public.custom_bereiche(id, user_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.custom_orte add constraint custom_orte_bereich_fkey
    foreign key (bereich_id, user_id) references public.custom_bereiche(id, user_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.custom_eintraege add constraint custom_eintraege_bereich_fkey
    foreign key (bereich_id, user_id) references public.custom_bereiche(id, user_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.custom_eintraege add constraint custom_eintraege_ort_fkey
    foreign key (ort_id, user_id) references public.custom_orte(id, user_id) on delete set null deferrable initially immediate;
exception when duplicate_object then null; end $$;
alter table public.custom_bereiche enable row level security;
alter table public.custom_felder enable row level security;
alter table public.custom_orte enable row level security;
alter table public.custom_eintraege enable row level security;

-- ========== 5) RLS-Policies (eigene / geteilte / Admin) ==========
do $$
declare
  t text; b text; pair text[];
  pairs text[][] := array[
    array['vorrat_chargen','vorrat'],
    array['lego_kisten','lego'], array['lego_sets','lego'], array['lego_teile','lego'], array['lego_teil_sets','lego'],
    array['custom_bereiche','alle'], array['custom_felder','alle'], array['custom_orte','alle'], array['custom_eintraege','alle']
  ];
begin
  foreach pair slice 1 in array pairs loop
    t := pair[1]; b := pair[2];
    execute format('drop policy if exists %I on public.%I', 'Lesen: eigene, geteilte oder Admin', t);
    execute format('drop policy if exists %I on public.%I', 'Anlegen: eigene, geteilte (bearbeiten) oder Admin', t);
    execute format('drop policy if exists %I on public.%I', 'Ändern: eigene, geteilte (bearbeiten) oder Admin', t);
    execute format('drop policy if exists %I on public.%I', 'Löschen: eigene, geteilte (bearbeiten) oder Admin', t);
    execute format($f$create policy "Lesen: eigene, geteilte oder Admin" on public.%I for select to authenticated
      using (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners(%L, false)))$f$, t, b);
    execute format($f$create policy "Anlegen: eigene, geteilte (bearbeiten) oder Admin" on public.%I for insert to authenticated
      with check (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners(%L, true)))$f$, t, b);
    execute format($f$create policy "Ändern: eigene, geteilte (bearbeiten) oder Admin" on public.%I for update to authenticated
      using (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners(%L, true)))
      with check (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners(%L, true)))$f$, t, b, b);
    execute format($f$create policy "Löschen: eigene, geteilte (bearbeiten) oder Admin" on public.%I for delete to authenticated
      using (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners(%L, true)))$f$, t, b);
  end loop;
end $$;

-- Feinere RLS für custom: bei Freigabe c:<id> nur dieser Bereich
create or replace function private.custom_ok(p_bereich_id uuid, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.custom_bereiche b
    where b.id = p_bereich_id and (
      b.user_id = (select auth.uid())
      or (select private.is_admin())
      or b.user_id in (select private.shared_owners('alle', p_write))
      or b.user_id in (select private.shared_owners('c:' || p_bereich_id::text, p_write))
    )
  );
$$;

drop policy if exists "Lesen: eigene, geteilte oder Admin" on public.custom_bereiche;
drop policy if exists "Anlegen: eigene, geteilte (bearbeiten) oder Admin" on public.custom_bereiche;
drop policy if exists "Ändern: eigene, geteilte (bearbeiten) oder Admin" on public.custom_bereiche;
drop policy if exists "Löschen: eigene, geteilte (bearbeiten) oder Admin" on public.custom_bereiche;
create policy "custom_bereiche select" on public.custom_bereiche for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin())
    or user_id in (select private.shared_owners('alle', false))
    or user_id in (select private.shared_owners('c:' || id::text, false)));
create policy "custom_bereiche insert" on public.custom_bereiche for insert to authenticated
  with check (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "custom_bereiche update" on public.custom_bereiche for update to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin())
    or user_id in (select private.shared_owners('c:' || id::text, true)))
  with check (user_id = (select auth.uid()) or (select private.is_admin())
    or user_id in (select private.shared_owners('c:' || id::text, true)));
create policy "custom_bereiche delete" on public.custom_bereiche for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- child tables: check via custom_ok
do $$
declare t text;
begin
  foreach t in array array['custom_felder','custom_orte','custom_eintraege'] loop
    execute format('drop policy if exists %I on public.%I', 'Lesen: eigene, geteilte oder Admin', t);
    execute format('drop policy if exists %I on public.%I', 'Anlegen: eigene, geteilte (bearbeiten) oder Admin', t);
    execute format('drop policy if exists %I on public.%I', 'Ändern: eigene, geteilte (bearbeiten) oder Admin', t);
    execute format('drop policy if exists %I on public.%I', 'Löschen: eigene, geteilte (bearbeiten) oder Admin', t);
    execute format($f$create policy "custom child select" on public.%I for select to authenticated
      using (private.custom_ok(bereich_id, false))$f$, t);
    execute format($f$create policy "custom child insert" on public.%I for insert to authenticated
      with check (private.custom_ok(bereich_id, true) and (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners('c:'||bereich_id::text, true)) or user_id in (select private.shared_owners('alle', true))))$f$, t);
    execute format($f$create policy "custom child update" on public.%I for update to authenticated
      using (private.custom_ok(bereich_id, true)) with check (private.custom_ok(bereich_id, true))$f$, t);
    execute format($f$create policy "custom child delete" on public.%I for delete to authenticated
      using (private.custom_ok(bereich_id, true))$f$, t);
  end loop;
end $$;

-- ========== 6) Freigabe-RPC validiert neue Bereiche ==========
create or replace function private.freigabe_einladen(p_email text, p_bereich text, p_recht text)
returns text language plpgsql security definer set search_path = '' as $$
declare v uuid; me uuid := auth.uid();
begin
  if me is null then raise exception 'Nicht angemeldet' using errcode = '42501'; end if;
  if p_recht not in ('lesen','bearbeiten') then raise exception 'Ungültige Angaben' using errcode = '22023'; end if;
  if p_bereich not in ('playmobil','vorrat','lego','beide','alle')
     and p_bereich !~ '^c:[0-9a-f-]{36}$' then
    raise exception 'Ungültige Angaben' using errcode = '22023';
  end if;
  if p_bereich ~ '^c:' then
    if not exists (select 1 from public.custom_bereiche b where b.id = substr(p_bereich,3)::uuid and b.user_id = me) then
      raise exception 'Bereich nicht gefunden' using errcode = '22023';
    end if;
  end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email)) and id <> me;
  if found then
    insert into public.freigaben (owner_id, member_id, bereich, recht) values (me, v, p_bereich, p_recht)
    on conflict (owner_id, member_id) do update set bereich = excluded.bereich, recht = excluded.recht;
  end if;
  return 'Falls ein Konto mit dieser E-Mail existiert, wurde es eingeladen.';
end $$;

create or replace function private.freigabe_aendern(p_id bigint, p_bereich text, p_recht text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_recht not in ('lesen','bearbeiten') then raise exception 'Ungültige Angaben' using errcode = '22023'; end if;
  if p_bereich not in ('playmobil','vorrat','lego','beide','alle') and p_bereich !~ '^c:[0-9a-f-]{36}$' then
    raise exception 'Ungültige Angaben' using errcode = '22023';
  end if;
  update public.freigaben set bereich = p_bereich, recht = p_recht
  where id = p_id and owner_id = auth.uid();
  if not found then raise exception 'Nicht gefunden' using errcode = 'P0002'; end if;
end $$;

-- ========== 7) Admin list/reset erweitern ==========
drop function if exists public.admin_list_users();
drop function if exists private.admin_list_users();

create or replace function private.admin_list_users()
returns table(id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, is_admin boolean,
  teile bigint, kisten bigint, sets bigint, vorrat bigint, vorrat_orte bigint,
  lego_teile bigint, lego_kisten bigint, lego_sets bigint, custom_bereiche bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Nur für Admins' using errcode = '42501'; end if;
  return query
  select u.id, u.email::text, u.created_at, u.last_sign_in_at,
    exists (select 1 from public.admins a where a.user_id = u.id),
    (select count(*) from public.teile x where x.user_id = u.id),
    (select count(*) from public.kisten x where x.user_id = u.id),
    (select count(*) from public.sets x where x.user_id = u.id),
    (select count(*) from public.vorrat x where x.user_id = u.id),
    (select count(*) from public.vorrat_orte x where x.user_id = u.id),
    (select count(*) from public.lego_teile x where x.user_id = u.id),
    (select count(*) from public.lego_kisten x where x.user_id = u.id),
    (select count(*) from public.lego_sets x where x.user_id = u.id),
    (select count(*) from public.custom_bereiche x where x.user_id = u.id)
  from auth.users u order by u.created_at;
end $$;

create or replace function public.admin_list_users()
returns table(id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, is_admin boolean,
  teile bigint, kisten bigint, sets bigint, vorrat bigint, vorrat_orte bigint,
  lego_teile bigint, lego_kisten bigint, lego_sets bigint, custom_bereiche bigint)
language sql stable set search_path = '' as $$ select * from private.admin_list_users(); $$;

create or replace function private.admin_reset_user(target uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare n_ts int; n_t int; n_s int; n_k int; n_v int; n_o int; n_c int;
  n_lts int; n_lt int; n_ls int; n_lk int; n_cb int;
begin
  if not private.is_admin() then raise exception 'Nur für Admins' using errcode = '42501'; end if;
  delete from public.teil_sets where user_id = target; get diagnostics n_ts = row_count;
  delete from public.teile where user_id = target; get diagnostics n_t = row_count;
  delete from public.sets where user_id = target; get diagnostics n_s = row_count;
  delete from public.kisten where user_id = target; get diagnostics n_k = row_count;
  delete from public.vorrat_chargen where user_id = target; get diagnostics n_c = row_count;
  delete from public.vorrat where user_id = target; get diagnostics n_v = row_count;
  delete from public.vorrat_orte where user_id = target; get diagnostics n_o = row_count;
  delete from public.lego_teil_sets where user_id = target; get diagnostics n_lts = row_count;
  delete from public.lego_teile where user_id = target; get diagnostics n_lt = row_count;
  delete from public.lego_sets where user_id = target; get diagnostics n_ls = row_count;
  delete from public.lego_kisten where user_id = target; get diagnostics n_lk = row_count;
  delete from public.custom_bereiche where user_id = target; get diagnostics n_cb = row_count;
  return json_build_object('teil_sets',n_ts,'teile',n_t,'sets',n_s,'kisten',n_k,'vorrat',n_v,'vorrat_orte',n_o,'chargen',n_c,
    'lego_teil_sets',n_lts,'lego_teile',n_lt,'lego_sets',n_ls,'lego_kisten',n_lk,'custom_bereiche',n_cb);
end $$;

-- Grants
revoke execute on function private.bereich_deckt(text,text), private.custom_ok(uuid,boolean) from public, anon;
grant execute on function private.bereich_deckt(text,text), private.custom_ok(uuid,boolean) to authenticated;
grant select, insert, update, delete on public.vorrat_chargen, public.lego_kisten, public.lego_sets, public.lego_teile, public.lego_teil_sets,
  public.custom_bereiche, public.custom_felder, public.custom_orte, public.custom_eintraege to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Nachgezogen: search_path + Indizes
-- (bereits auf der DB ausgeführt)
