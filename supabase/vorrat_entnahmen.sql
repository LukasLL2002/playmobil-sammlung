-- Entnahmen-Protokoll (Menge + Datum), RLS wie vorrat_chargen
create table if not exists public.vorrat_entnahmen (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vorrat_id bigint not null,
  menge numeric(10,2) not null check (menge > 0),
  datum date not null default (current_date),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

do $$ begin
  alter table public.vorrat_entnahmen
    add constraint vorrat_entnahmen_vorrat_fkey foreign key (vorrat_id, user_id)
    references public.vorrat(id, user_id) on delete cascade deferrable initially immediate;
exception when duplicate_object then null; end $$;

create index if not exists vorrat_entnahmen_vorrat_idx on public.vorrat_entnahmen(vorrat_id);
create index if not exists vorrat_entnahmen_user_datum_idx on public.vorrat_entnahmen(user_id, datum desc);
alter table public.vorrat_entnahmen enable row level security;

drop policy if exists "Lesen: eigene, geteilte oder Admin" on public.vorrat_entnahmen;
drop policy if exists "Anlegen: eigene, geteilte (bearbeiten) oder Admin" on public.vorrat_entnahmen;
drop policy if exists "Ändern: eigene, geteilte (bearbeiten) oder Admin" on public.vorrat_entnahmen;
drop policy if exists "Löschen: eigene, geteilte (bearbeiten) oder Admin" on public.vorrat_entnahmen;

create policy "Lesen: eigene, geteilte oder Admin" on public.vorrat_entnahmen for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners('vorrat', false)));

create policy "Anlegen: eigene, geteilte (bearbeiten) oder Admin" on public.vorrat_entnahmen for insert to authenticated
  with check (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners('vorrat', true)));

create policy "Ändern: eigene, geteilte (bearbeiten) oder Admin" on public.vorrat_entnahmen for update to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners('vorrat', true)))
  with check (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners('vorrat', true)));

create policy "Löschen: eigene, geteilte (bearbeiten) oder Admin" on public.vorrat_entnahmen for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()) or user_id in (select private.shared_owners('vorrat', true)));
