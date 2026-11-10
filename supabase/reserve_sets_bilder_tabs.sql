-- Sortiva 2026-11-10: Reserve/Sets-Art, mehrere Bilder, eigene Reiter-Namen (additiv)

-- 1) Art für Sets: bestehende Einträge = 'reserve', neuer Reiter schreibt 'set'
alter table public.sets add column if not exists art text not null default 'reserve';
alter table public.lego_sets add column if not exists art text not null default 'reserve';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sets_art_check') then
    alter table public.sets add constraint sets_art_check check (art in ('reserve','set'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lego_sets_art_check') then
    alter table public.lego_sets add constraint lego_sets_art_check check (art in ('reserve','set'));
  end if;
end $$;
-- gleiche Nummer darf in Reserve UND Sets vorkommen (je Art eindeutig)
alter table public.sets add constraint sets_user_art_set_nummer_key unique (user_id, art, set_nummer);
alter table public.sets drop constraint if exists sets_user_set_nummer_key;
alter table public.lego_sets add constraint lego_sets_user_art_set_nummer_key unique (user_id, art, set_nummer);
alter table public.lego_sets drop constraint if exists lego_sets_user_id_set_nummer_key;

-- 2) Mehrere Bilder: bilder[1] = Titelbild; bild_url bleibt als Titelbild erhalten
alter table public.teile add column if not exists bilder text[] not null default '{}';
alter table public.lego_teile add column if not exists bilder text[] not null default '{}';
alter table public.vorrat add column if not exists bilder text[] not null default '{}';
alter table public.sets add column if not exists bilder text[] not null default '{}';
alter table public.lego_sets add column if not exists bilder text[] not null default '{}';
update public.teile set bilder = array[bild_url] where bild_url is not null and cardinality(bilder) = 0;
update public.lego_teile set bilder = array[bild_url] where bild_url is not null and cardinality(bilder) = 0;
update public.vorrat set bilder = array[bild_url] where bild_url is not null and cardinality(bilder) = 0;

-- bild_url und bilder synchron halten (auch für ältere App-Versionen, die nur bild_url schreiben)
create or replace function private.sync_bilder() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(cardinality(new.bilder), 0) = 0 then
      new.bilder := case when new.bild_url is null then '{}'::text[] else array[new.bild_url] end;
    else
      new.bild_url := new.bilder[1];
    end if;
    return new;
  end if;
  if new.bilder is distinct from old.bilder then
    new.bilder := coalesce(new.bilder, '{}'::text[]);
    new.bild_url := new.bilder[1];
  elsif new.bild_url is distinct from old.bild_url then
    new.bilder := array_remove(coalesce(old.bilder, '{}'::text[]), old.bild_url);
    if new.bild_url is not null then
      new.bilder := array[new.bild_url] || array_remove(new.bilder, new.bild_url);
    end if;
  end if;
  return new;
end $$;
revoke all on function private.sync_bilder() from public, anon, authenticated;
drop trigger if exists teile_sync_bilder on public.teile;
create trigger teile_sync_bilder before insert or update on public.teile for each row execute function private.sync_bilder();
drop trigger if exists lego_teile_sync_bilder on public.lego_teile;
create trigger lego_teile_sync_bilder before insert or update on public.lego_teile for each row execute function private.sync_bilder();
drop trigger if exists vorrat_sync_bilder on public.vorrat;
create trigger vorrat_sync_bilder before insert or update on public.vorrat for each row execute function private.sync_bilder();

-- 3) Eigene Reiter-Namen je Konto
create table if not exists public.tab_namen (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  namen jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.tab_namen enable row level security;
drop policy if exists "Reiter lesen: eigene, geteilte oder Admin" on public.tab_namen;
create policy "Reiter lesen: eigene, geteilte oder Admin" on public.tab_namen for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin())
    or user_id in (select private.shared_owners('playmobil', false))
    or user_id in (select private.shared_owners('lego', false)));
drop policy if exists "Reiter anlegen: nur eigene" on public.tab_namen;
create policy "Reiter anlegen: nur eigene" on public.tab_namen for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Reiter ändern: nur eigene" on public.tab_namen;
create policy "Reiter ändern: nur eigene" on public.tab_namen for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Reiter löschen: nur eigene" on public.tab_namen;
create policy "Reiter löschen: nur eigene" on public.tab_namen for delete to authenticated
  using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.tab_namen to authenticated;
