-- ============ 1. Deferrable composite FKs (für Zusammenführen) ============
alter table public.teile drop constraint teile_kiste_fkey;
alter table public.teile add constraint teile_kiste_fkey foreign key (kiste_id, user_id) references public.kisten(id, user_id) on delete set null (kiste_id) deferrable initially immediate;
alter table public.teil_sets drop constraint teil_sets_teil_fkey;
alter table public.teil_sets add constraint teil_sets_teil_fkey foreign key (teil_id, user_id) references public.teile(id, user_id) on delete cascade deferrable initially immediate;
alter table public.teil_sets drop constraint teil_sets_set_fkey;
alter table public.teil_sets add constraint teil_sets_set_fkey foreign key (set_id, user_id) references public.sets(id, user_id) on delete cascade deferrable initially immediate;
alter table public.vorrat drop constraint vorrat_ort_fkey;
alter table public.vorrat add constraint vorrat_ort_fkey foreign key (ort_id, user_id) references public.vorrat_orte(id, user_id) on delete set null (ort_id) deferrable initially immediate;

-- ============ 2. Tabellen ============
create table public.freigaben (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  bereich text not null default 'beide' check (bereich in ('playmobil','vorrat','beide')),
  recht text not null default 'lesen' check (recht in ('lesen','bearbeiten')),
  status text not null default 'eingeladen' check (status in ('eingeladen','angenommen')),
  created_at timestamptz not null default now(),
  constraint freigaben_owner_member_key unique (owner_id, member_id),
  constraint freigaben_nicht_selbst check (owner_id <> member_id)
);
create index freigaben_member_idx on public.freigaben (member_id, status);
alter table public.freigaben enable row level security;

create table public.zusammenfuehrungen (
  id bigint generated always as identity primary key,
  von_id uuid not null references auth.users(id) on delete cascade,
  nach_id uuid not null references auth.users(id) on delete cascade,
  antragsteller_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  bereich text not null check (bereich in ('playmobil','vorrat','beide')),
  status text not null default 'offen' check (status in ('offen','abgelehnt','angenommen','erledigt')),
  ergebnis jsonb,
  created_at timestamptz not null default now(),
  erledigt_at timestamptz,
  constraint zusammenfuehrungen_nicht_selbst check (von_id <> nach_id)
);
create index zusammenfuehrungen_von_idx on public.zusammenfuehrungen (von_id);
create index zusammenfuehrungen_nach_idx on public.zusammenfuehrungen (nach_id);
create index zusammenfuehrungen_antrag_idx on public.zusammenfuehrungen (antragsteller_id);
alter table public.zusammenfuehrungen enable row level security;

revoke all on public.freigaben, public.zusammenfuehrungen from anon, authenticated;
grant select, delete on public.freigaben, public.zusammenfuehrungen to authenticated;

-- ============ 3. Hilfsfunktionen für RLS ============
create or replace function private.shared_owners(p_bereich text, p_write boolean)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select f.owner_id from public.freigaben f
  where f.member_id = (select auth.uid()) and f.status = 'angenommen'
    and f.bereich in (p_bereich, 'beide') and (not p_write or f.recht = 'bearbeiten');
$$;

create or replace function private.storage_prefixes(p_write boolean)
returns setof text language sql stable security definer set search_path = '' as $$
  select f.owner_id::text || '/' || s.dir
  from public.freigaben f
  cross join (values ('teile','playmobil'), ('vorrat','vorrat')) s(dir, b)
  where f.member_id = (select auth.uid()) and f.status = 'angenommen'
    and f.bereich in (s.b, 'beide') and (not p_write or f.recht = 'bearbeiten')
  union
  select p.u::text || '/' || s.dir
  from public.zusammenfuehrungen z
  cross join lateral (values (z.von_id), (z.nach_id)) p(u)
  cross join (values ('teile','playmobil'), ('vorrat','vorrat')) s(dir, b)
  where z.status = 'angenommen' and (select auth.uid()) in (z.von_id, z.nach_id, z.antragsteller_id)
    and z.bereich in (s.b, 'beide');
$$;

revoke execute on function private.shared_owners(text, boolean), private.storage_prefixes(boolean) from public, anon;
grant execute on function private.shared_owners(text, boolean), private.storage_prefixes(boolean) to authenticated;

-- ============ 4. RLS: eigene, geteilte oder Admin ============
create policy "Freigaben: Beteiligte oder Admin lesen" on public.freigaben for select to authenticated
  using ((select auth.uid()) in (owner_id, member_id) or (select private.is_admin()));
create policy "Freigaben: entziehen, ablehnen oder verlassen" on public.freigaben for delete to authenticated
  using ((select auth.uid()) in (owner_id, member_id) or (select private.is_admin()));
create policy "Zusammenführungen: Beteiligte oder Admin lesen" on public.zusammenfuehrungen for select to authenticated
  using ((select auth.uid()) in (von_id, nach_id, antragsteller_id) or (select private.is_admin()));
create policy "Zusammenführungen: nicht laufende löschen" on public.zusammenfuehrungen for delete to authenticated
  using (((select auth.uid()) in (von_id, nach_id, antragsteller_id) and status <> 'angenommen') or (select private.is_admin()));

do $$
declare t text; b text; p record;
begin
  for t, b in select * from (values ('kisten','playmobil'),('sets','playmobil'),('teile','playmobil'),('teil_sets','playmobil'),('vorrat','vorrat'),('vorrat_orte','vorrat')) v(t,b) loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
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

drop policy if exists "Eigene Bilder oder Admin lesen" on storage.objects;
drop policy if exists "Eigene Bilder oder Admin hochladen" on storage.objects;
drop policy if exists "Eigene Bilder oder Admin ändern" on storage.objects;
drop policy if exists "Eigene Bilder oder Admin löschen" on storage.objects;
create policy "Bilder lesen: eigene, geteilte oder Admin" on storage.objects for select to authenticated
  using (bucket_id = 'bilder' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin())
    or ((storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]) in (select private.storage_prefixes(false))));
create policy "Bilder hochladen: eigene, geteilte oder Admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'bilder' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin())
    or ((storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]) in (select private.storage_prefixes(true))));
create policy "Bilder ändern: eigene, geteilte oder Admin" on storage.objects for update to authenticated
  using (bucket_id = 'bilder' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin())
    or ((storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]) in (select private.storage_prefixes(true))))
  with check (bucket_id = 'bilder' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin())
    or ((storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]) in (select private.storage_prefixes(true))));
create policy "Bilder löschen: eigene, geteilte oder Admin" on storage.objects for delete to authenticated
  using (bucket_id = 'bilder' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin())
    or ((storage.foldername(name))[1] || '/' || (storage.foldername(name))[2]) in (select private.storage_prefixes(true))));

-- ============ 5. Teilen: RPCs ============
create or replace function private.freigabe_einladen(p_email text, p_bereich text, p_recht text)
returns text language plpgsql security definer set search_path = '' as $$
declare v uuid; me uuid := auth.uid();
begin
  if me is null then raise exception 'Nicht angemeldet' using errcode = '42501'; end if;
  if p_bereich not in ('playmobil','vorrat','beide') or p_recht not in ('lesen','bearbeiten') then
    raise exception 'Ungültige Angaben' using errcode = '22023'; end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email)) and id <> me;
  if found then
    insert into public.freigaben (owner_id, member_id, bereich, recht) values (me, v, p_bereich, p_recht)
    on conflict (owner_id, member_id) do update set bereich = excluded.bereich, recht = excluded.recht;
  end if;
  return 'Falls ein Konto mit dieser E-Mail existiert, wurde es eingeladen.';
end $$;

create or replace function private.freigabe_annehmen(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.freigaben set status = 'angenommen' where id = p_id and member_id = auth.uid() and status = 'eingeladen';
  if not found then raise exception 'Einladung nicht gefunden' using errcode = 'P0002'; end if;
end $$;

create or replace function private.freigabe_aendern(p_id bigint, p_bereich text, p_recht text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_bereich not in ('playmobil','vorrat','beide') or p_recht not in ('lesen','bearbeiten') then
    raise exception 'Ungültige Angaben' using errcode = '22023'; end if;
  update public.freigaben set bereich = p_bereich, recht = p_recht where id = p_id and owner_id = auth.uid();
  if not found then raise exception 'Freigabe nicht gefunden' using errcode = 'P0002'; end if;
end $$;

create or replace function private.meine_freigaben()
returns table (id bigint, owner_id uuid, owner_email text, member_id uuid, member_email text, bereich text, recht text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.id, f.owner_id, o.email::text, f.member_id, m.email::text, f.bereich, f.recht, f.status, f.created_at
  from public.freigaben f join auth.users o on o.id = f.owner_id join auth.users m on m.id = f.member_id
  where (select auth.uid()) in (f.owner_id, f.member_id)
  order by f.created_at;
$$;

-- ============ 6. Zusammenführen ============
create or replace function private.merge_preview(p_von uuid, p_nach uuid, p_bereich text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select (case when p_bereich in ('playmobil','beide') then jsonb_build_object(
    'kisten', (select count(*) from public.kisten where user_id = p_von),
    'kisten_gleich', (select count(*) from public.kisten a where a.user_id = p_von and exists (select 1 from public.kisten b where b.user_id = p_nach and b.art = a.art and b.nummer = a.nummer)),
    'sets', (select count(*) from public.sets where user_id = p_von),
    'sets_gleich', (select count(*) from public.sets a where a.user_id = p_von and exists (select 1 from public.sets b where b.user_id = p_nach and b.set_nummer = a.set_nummer)),
    'teile', (select count(*) from public.teile where user_id = p_von),
    'stueck', (select coalesce(sum(anzahl), 0) from public.teile where user_id = p_von),
    'teile_gleich', (select count(*) from public.teile t left join public.kisten tk on tk.id = t.kiste_id
       where t.user_id = p_von and coalesce(t.teile_nr, '') <> '' and exists (
         select 1 from public.teile n left join public.kisten nk on nk.id = n.kiste_id
         where n.user_id = p_nach and n.teile_nr = t.teile_nr and lower(coalesce(n.farbe, '')) = lower(coalesce(t.farbe, ''))
           and ((t.kiste_id is null and n.kiste_id is null) or (tk.art = nk.art and tk.nummer = nk.nummer)))),
    'bilder_teile', (select count(*) from public.teile where user_id = p_von and bild_url is not null)
  ) else '{}'::jsonb end)
  || (case when p_bereich in ('vorrat','beide') then jsonb_build_object(
    'orte', (select count(*) from public.vorrat_orte where user_id = p_von),
    'orte_gleich', (select count(*) from public.vorrat_orte a where a.user_id = p_von and exists (select 1 from public.vorrat_orte b where b.user_id = p_nach and lower(trim(b.name)) = lower(trim(a.name)))),
    'vorrat', (select count(*) from public.vorrat where user_id = p_von),
    'vorrat_gleich', (select count(*) from public.vorrat v left join public.vorrat_orte vo on vo.id = v.ort_id
       where v.user_id = p_von and exists (
         select 1 from public.vorrat n left join public.vorrat_orte nv on nv.id = n.ort_id
         where n.user_id = p_nach and lower(trim(n.name)) = lower(trim(v.name)) and n.einheit is not distinct from v.einheit
           and ((v.ort_id is null and n.ort_id is null) or lower(trim(vo.name)) = lower(trim(nv.name))))),
    'bilder_vorrat', (select count(*) from public.vorrat where user_id = p_von and bild_url is not null)
  ) else '{}'::jsonb end);
$$;

create or replace function private.merge_run(p_von uuid, p_nach uuid, p_bereich text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record; m record; k record; v_match bigint;
  v_orig bigint[]; v_moved bigint[]; v_new text;
  n_k int := 0; n_km int := 0; n_s int := 0; n_sm int := 0; n_t int := 0; n_tm int := 0;
  n_o int := 0; n_om int := 0; n_v int := 0; n_vm int := 0;
  v_files jsonb := '[]'::jsonb; v_del jsonb := '[]'::jsonb;
begin
  if p_von = p_nach then raise exception 'Quelle und Ziel sind gleich' using errcode = '22023'; end if;
  set constraints all deferred;

  if p_bereich in ('playmobil','beide') then
    select coalesce(array_agg(id), '{}') into v_orig from public.teile where user_id = p_nach;
    select coalesce(array_agg(id), '{}') into v_moved from public.teile where user_id = p_von;
    for r in select * from public.kisten where user_id = p_von loop
      select id into v_match from public.kisten where user_id = p_nach and art = r.art and nummer = r.nummer;
      if found then
        update public.teile set kiste_id = v_match where user_id = p_von and kiste_id = r.id;
        delete from public.kisten where id = r.id; n_km := n_km + 1;
      else
        update public.kisten set user_id = p_nach where id = r.id; n_k := n_k + 1;
      end if;
    end loop;
    for r in select * from public.sets where user_id = p_von loop
      select id into v_match from public.sets where user_id = p_nach and set_nummer = r.set_nummer;
      if found then
        update public.teil_sets set set_id = v_match where user_id = p_von and set_id = r.id;
        delete from public.sets where id = r.id; n_sm := n_sm + 1;
      else
        update public.sets set user_id = p_nach where id = r.id; n_s := n_s + 1;
      end if;
    end loop;
    update public.teile set user_id = p_nach where user_id = p_von;
    get diagnostics n_t = row_count;
    update public.teil_sets set user_id = p_nach where user_id = p_von;
    for m in select * from public.teile where id = any (v_moved) and coalesce(teile_nr, '') <> '' order by id loop
      select * into k from public.teile n where n.id = any (v_orig) and n.teile_nr = m.teile_nr
        and lower(coalesce(n.farbe, '')) = lower(coalesce(m.farbe, '')) and n.kiste_id is not distinct from m.kiste_id
        order by n.id limit 1;
      if found then
        update public.teile set anzahl = anzahl + m.anzahl, beschreibung = coalesce(beschreibung, m.beschreibung),
          euro = coalesce(euro, m.euro), notiz = coalesce(notiz, m.notiz), bild_url = coalesce(bild_url, m.bild_url)
        where id = k.id;
        insert into public.teil_sets (teil_id, set_id, user_id)
          select k.id, ts.set_id, p_nach from public.teil_sets ts where ts.teil_id = m.id on conflict do nothing;
        if m.bild_url is not null and k.bild_url is not null then v_del := v_del || to_jsonb(m.bild_url); end if;
        delete from public.teile where id = m.id; n_tm := n_tm + 1;
      end if;
    end loop;
    for r in select id, bild_url from public.teile where user_id = p_nach and bild_url like p_von::text || '/%' loop
      v_new := p_nach::text || '/teile/' || regexp_replace(r.bild_url, '^.*/', '');
      v_files := v_files || jsonb_build_object('von', r.bild_url, 'nach', v_new);
      update public.teile set bild_url = v_new where id = r.id;
    end loop;
  end if;

  if p_bereich in ('vorrat','beide') then
    select coalesce(array_agg(id), '{}') into v_orig from public.vorrat where user_id = p_nach;
    select coalesce(array_agg(id), '{}') into v_moved from public.vorrat where user_id = p_von;
    for r in select * from public.vorrat_orte where user_id = p_von loop
      select id into v_match from public.vorrat_orte where user_id = p_nach and lower(trim(name)) = lower(trim(r.name)) order by id limit 1;
      if found then
        update public.vorrat set ort_id = v_match where user_id = p_von and ort_id = r.id;
        delete from public.vorrat_orte where id = r.id; n_om := n_om + 1;
      else
        update public.vorrat_orte set user_id = p_nach where id = r.id; n_o := n_o + 1;
      end if;
    end loop;
    update public.vorrat set user_id = p_nach where user_id = p_von;
    get diagnostics n_v = row_count;
    for m in select * from public.vorrat where id = any (v_moved) order by id loop
      select * into k from public.vorrat n where n.id = any (v_orig) and lower(trim(n.name)) = lower(trim(m.name))
        and n.einheit is not distinct from m.einheit and n.ort_id is not distinct from m.ort_id
        order by n.id limit 1;
      if found then
        update public.vorrat set menge = menge + m.menge, mhd = least(mhd, m.mhd), kategorie = coalesce(kategorie, m.kategorie),
          mindestbestand = coalesce(mindestbestand, m.mindestbestand), preis = coalesce(preis, m.preis),
          barcode = coalesce(barcode, m.barcode), notiz = coalesce(notiz, m.notiz), bild_url = coalesce(bild_url, m.bild_url)
        where id = k.id;
        if m.bild_url is not null and k.bild_url is not null then v_del := v_del || to_jsonb(m.bild_url); end if;
        delete from public.vorrat where id = m.id; n_vm := n_vm + 1;
      end if;
    end loop;
    for r in select id, bild_url from public.vorrat where user_id = p_nach and bild_url like p_von::text || '/%' loop
      v_new := p_nach::text || '/vorrat/' || regexp_replace(r.bild_url, '^.*/', '');
      v_files := v_files || jsonb_build_object('von', r.bild_url, 'nach', v_new);
      update public.vorrat set bild_url = v_new where id = r.id;
    end loop;
  end if;

  set constraints all immediate;
  return jsonb_build_object('kisten_neu', n_k, 'kisten_zusammengelegt', n_km, 'sets_neu', n_s, 'sets_zusammengelegt', n_sm,
    'teile_neu', n_t - n_tm, 'teile_zusammengelegt', n_tm, 'orte_neu', n_o, 'orte_zusammengelegt', n_om,
    'vorrat_neu', n_v - n_vm, 'vorrat_zusammengelegt', n_vm, 'dateien', v_files, 'loeschen', v_del);
end $$;

create or replace function private.zusammenfuehrung_anfragen(p_email text, p_richtung text, p_bereich text)
returns text language plpgsql security definer set search_path = '' as $$
declare v uuid; me uuid := auth.uid();
begin
  if me is null then raise exception 'Nicht angemeldet' using errcode = '42501'; end if;
  if p_bereich not in ('playmobil','vorrat','beide') or p_richtung not in ('zu_dir','zu_mir') then
    raise exception 'Ungültige Angaben' using errcode = '22023'; end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email)) and id <> me;
  if found then
    insert into public.zusammenfuehrungen (von_id, nach_id, antragsteller_id, bereich)
    values (case when p_richtung = 'zu_dir' then me else v end, case when p_richtung = 'zu_dir' then v else me end, me, p_bereich);
  end if;
  return 'Falls ein Konto mit dieser E-Mail existiert, wurde die Anfrage gesendet.';
end $$;

create or replace function private.zusammenfuehrung_vorschau(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare z public.zusammenfuehrungen;
begin
  select * into z from public.zusammenfuehrungen where id = p_id and (auth.uid() in (von_id, nach_id, antragsteller_id) or private.is_admin());
  if not found then raise exception 'Anfrage nicht gefunden' using errcode = 'P0002'; end if;
  return private.merge_preview(z.von_id, z.nach_id, z.bereich);
end $$;

create or replace function private.zusammenfuehrung_annehmen(p_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare z public.zusammenfuehrungen; res jsonb;
begin
  select * into z from public.zusammenfuehrungen where id = p_id and status = 'offen'
    and auth.uid() in (von_id, nach_id) and auth.uid() <> antragsteller_id for update;
  if not found then raise exception 'Anfrage nicht gefunden oder schon bearbeitet' using errcode = 'P0002'; end if;
  res := private.merge_run(z.von_id, z.nach_id, z.bereich);
  update public.zusammenfuehrungen set status = 'angenommen', ergebnis = res where id = p_id;
  return res || jsonb_build_object('id', p_id);
end $$;

create or replace function private.zusammenfuehrung_ablehnen(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.zusammenfuehrungen set status = 'abgelehnt', erledigt_at = now()
  where id = p_id and status = 'offen' and auth.uid() in (von_id, nach_id) and auth.uid() <> antragsteller_id;
  if not found then raise exception 'Anfrage nicht gefunden' using errcode = 'P0002'; end if;
end $$;

create or replace function private.zusammenfuehrung_abschliessen(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.zusammenfuehrungen set status = 'erledigt', erledigt_at = now(), ergebnis = ergebnis - 'dateien' - 'loeschen'
  where id = p_id and status = 'angenommen' and (auth.uid() in (von_id, nach_id, antragsteller_id) or private.is_admin());
end $$;

create or replace function private.meine_zusammenfuehrungen()
returns table (id bigint, von_id uuid, von_email text, nach_id uuid, nach_email text, antragsteller_id uuid, bereich text, status text, ergebnis jsonb, created_at timestamptz, erledigt_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select z.id, z.von_id, a.email::text, z.nach_id, b.email::text, z.antragsteller_id, z.bereich, z.status, z.ergebnis, z.created_at, z.erledigt_at
  from public.zusammenfuehrungen z join auth.users a on a.id = z.von_id join auth.users b on b.id = z.nach_id
  where (select auth.uid()) in (z.von_id, z.nach_id, z.antragsteller_id)
  order by z.created_at desc;
$$;

create or replace function private.admin_merge_vorschau(p_von uuid, p_nach uuid, p_bereich text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Nur für Admins' using errcode = '42501'; end if;
  return private.merge_preview(p_von, p_nach, p_bereich);
end $$;

create or replace function private.admin_zusammenfuehren(p_von uuid, p_nach uuid, p_bereich text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint; res jsonb;
begin
  if not private.is_admin() then raise exception 'Nur für Admins' using errcode = '42501'; end if;
  if p_bereich not in ('playmobil','vorrat','beide') then raise exception 'Ungültige Angaben' using errcode = '22023'; end if;
  res := private.merge_run(p_von, p_nach, p_bereich);
  insert into public.zusammenfuehrungen (von_id, nach_id, antragsteller_id, bereich, status, ergebnis)
  values (p_von, p_nach, auth.uid(), p_bereich, 'angenommen', res) returning id into v_id;
  return res || jsonb_build_object('id', v_id);
end $$;

-- ============ 7. Öffentliche Wrapper (security invoker) ============
create or replace function public.freigabe_einladen(p_email text, p_bereich text, p_recht text) returns text language sql set search_path = '' as $$ select private.freigabe_einladen(p_email, p_bereich, p_recht); $$;
create or replace function public.freigabe_annehmen(p_id bigint) returns void language sql set search_path = '' as $$ select private.freigabe_annehmen(p_id); $$;
create or replace function public.freigabe_aendern(p_id bigint, p_bereich text, p_recht text) returns void language sql set search_path = '' as $$ select private.freigabe_aendern(p_id, p_bereich, p_recht); $$;
create or replace function public.meine_freigaben() returns table (id bigint, owner_id uuid, owner_email text, member_id uuid, member_email text, bereich text, recht text, status text, created_at timestamptz) language sql set search_path = '' as $$ select * from private.meine_freigaben(); $$;
create or replace function public.zusammenfuehrung_anfragen(p_email text, p_richtung text, p_bereich text) returns text language sql set search_path = '' as $$ select private.zusammenfuehrung_anfragen(p_email, p_richtung, p_bereich); $$;
create or replace function public.zusammenfuehrung_vorschau(p_id bigint) returns jsonb language sql set search_path = '' as $$ select private.zusammenfuehrung_vorschau(p_id); $$;
create or replace function public.zusammenfuehrung_annehmen(p_id bigint) returns jsonb language sql set search_path = '' as $$ select private.zusammenfuehrung_annehmen(p_id); $$;
create or replace function public.zusammenfuehrung_ablehnen(p_id bigint) returns void language sql set search_path = '' as $$ select private.zusammenfuehrung_ablehnen(p_id); $$;
create or replace function public.zusammenfuehrung_abschliessen(p_id bigint) returns void language sql set search_path = '' as $$ select private.zusammenfuehrung_abschliessen(p_id); $$;
create or replace function public.meine_zusammenfuehrungen() returns table (id bigint, von_id uuid, von_email text, nach_id uuid, nach_email text, antragsteller_id uuid, bereich text, status text, ergebnis jsonb, created_at timestamptz, erledigt_at timestamptz) language sql set search_path = '' as $$ select * from private.meine_zusammenfuehrungen(); $$;
create or replace function public.admin_merge_vorschau(p_von uuid, p_nach uuid, p_bereich text) returns jsonb language sql set search_path = '' as $$ select private.admin_merge_vorschau(p_von, p_nach, p_bereich); $$;
create or replace function public.admin_zusammenfuehren(p_von uuid, p_nach uuid, p_bereich text) returns jsonb language sql set search_path = '' as $$ select private.admin_zusammenfuehren(p_von, p_nach, p_bereich); $$;

-- ============ 8. Rechte ============
revoke execute on function private.merge_preview(uuid, uuid, text), private.merge_run(uuid, uuid, text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'freigabe_einladen(text,text,text)','freigabe_annehmen(bigint)','freigabe_aendern(bigint,text,text)','meine_freigaben()',
    'zusammenfuehrung_anfragen(text,text,text)','zusammenfuehrung_vorschau(bigint)','zusammenfuehrung_annehmen(bigint)',
    'zusammenfuehrung_ablehnen(bigint)','zusammenfuehrung_abschliessen(bigint)','meine_zusammenfuehrungen()',
    'admin_merge_vorschau(uuid,uuid,text)','admin_zusammenfuehren(uuid,uuid,text)'] loop
    execute format('revoke execute on function private.%s from public, anon', f);
    execute format('grant execute on function private.%s to authenticated', f);
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
