-- Zusammenführen/Admin an Reserve/Sets-Art und mehrere Bilder anpassen
create or replace function private.merge_preview(p_von uuid, p_nach uuid, p_bereich text)
 returns jsonb language sql stable security definer set search_path to '' as $function$
  select (case when p_bereich in ('playmobil','beide') then jsonb_build_object(
    'kisten', (select count(*) from public.kisten where user_id = p_von),
    'kisten_gleich', (select count(*) from public.kisten a where a.user_id = p_von and exists (select 1 from public.kisten b where b.user_id = p_nach and b.art = a.art and b.nummer = a.nummer)),
    'sets', (select count(*) from public.sets where user_id = p_von),
    'sets_gleich', (select count(*) from public.sets a where a.user_id = p_von and exists (select 1 from public.sets b where b.user_id = p_nach and b.art = a.art and b.set_nummer = a.set_nummer)),
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
$function$;

-- Pfade eines Bilder-Arrays vom alten aufs neue Konto umschreiben
create or replace function private.bilder_umziehen(p_arr text[], p_von uuid, p_nach uuid, p_dir text)
 returns text[] language sql immutable set search_path to '' as $f$
  select coalesce(array_agg(case when e like p_von::text || '/%' then p_nach::text || '/' || p_dir || '/' || regexp_replace(e, '^.*/', '') else e end order by o), '{}'::text[])
  from unnest(coalesce(p_arr, '{}'::text[])) with ordinality u(e, o);
$f$;
create or replace function private.bilder_dateien(p_arr text[], p_von uuid, p_nach uuid, p_dir text)
 returns jsonb language sql immutable set search_path to '' as $f$
  select coalesce(jsonb_agg(jsonb_build_object('von', e, 'nach', p_nach::text || '/' || p_dir || '/' || regexp_replace(e, '^.*/', ''))), '[]'::jsonb)
  from (select distinct e from unnest(coalesce(p_arr, '{}'::text[])) e where e like p_von::text || '/%') x;
$f$;
create or replace function private.bilder_vereinen(a text[], b text[])
 returns text[] language sql immutable set search_path to '' as $f$
  select coalesce(a, '{}'::text[]) || coalesce(array(select x from unnest(coalesce(b, '{}'::text[])) with ordinality u(x, o) where not (x = any (coalesce(a, '{}'::text[]))) order by o), '{}'::text[]);
$f$;
revoke all on function private.bilder_umziehen(text[], uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.bilder_dateien(text[], uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.bilder_vereinen(text[], text[]) from public, anon, authenticated;

create or replace function private.merge_run(p_von uuid, p_nach uuid, p_bereich text)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  r record; m record; k record; v_match bigint;
  v_orig bigint[]; v_moved bigint[];
  n_k int := 0; n_km int := 0; n_s int := 0; n_sm int := 0; n_t int := 0; n_tm int := 0;
  n_o int := 0; n_om int := 0; n_v int := 0; n_vm int := 0;
  n_lk int := 0; n_lkm int := 0; n_ls int := 0; n_lsm int := 0; n_lt int := 0; n_ltm int := 0;
  v_files jsonb := '[]'::jsonb; v_del jsonb := '[]'::jsonb;
  v_pat text := p_von::text || '/%';
begin
  if p_von = p_nach then raise exception 'Quelle und Ziel sind gleich' using errcode = '22023'; end if;
  set constraints all deferred;

  if p_bereich in ('playmobil','beide','alle') then
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
      select id into v_match from public.sets where user_id = p_nach and art = r.art and set_nummer = r.set_nummer;
      if found then
        update public.teil_sets set set_id = v_match where user_id = p_von and set_id = r.id;
        update public.sets set bilder = private.bilder_vereinen(bilder, r.bilder) where id = v_match;
        delete from public.sets where id = r.id; n_sm := n_sm + 1;
      else
        update public.sets set user_id = p_nach where id = r.id; n_s := n_s + 1;
      end if;
    end loop;
    update public.teile set user_id = p_nach where user_id = p_von; get diagnostics n_t = row_count;
    update public.teil_sets set user_id = p_nach where user_id = p_von;
    for m in select * from public.teile where id = any (v_moved) and coalesce(teile_nr, '') <> '' order by id loop
      select * into k from public.teile n where n.id = any (v_orig) and n.teile_nr = m.teile_nr
        and lower(coalesce(n.farbe, '')) = lower(coalesce(m.farbe, '')) and n.kiste_id is not distinct from m.kiste_id
        order by n.id limit 1;
      if found then
        update public.teile set anzahl = anzahl + m.anzahl, beschreibung = coalesce(beschreibung, m.beschreibung),
          euro = coalesce(euro, m.euro), notiz = coalesce(notiz, m.notiz),
          bilder = private.bilder_vereinen(bilder, m.bilder) where id = k.id;
        insert into public.teil_sets (teil_id, set_id, user_id)
          select k.id, ts.set_id, p_nach from public.teil_sets ts where ts.teil_id = m.id on conflict do nothing;
        delete from public.teile where id = m.id; n_tm := n_tm + 1;
      end if;
    end loop;
    for r in select id, bilder from public.teile where user_id = p_nach and (bild_url like v_pat or exists (select 1 from unnest(bilder) e where e like v_pat)) loop
      v_files := v_files || private.bilder_dateien(r.bilder, p_von, p_nach, 'teile');
      update public.teile set bilder = private.bilder_umziehen(r.bilder, p_von, p_nach, 'teile') where id = r.id;
    end loop;
    for r in select id, bilder from public.sets where user_id = p_nach and exists (select 1 from unnest(bilder) e where e like v_pat) loop
      v_files := v_files || private.bilder_dateien(r.bilder, p_von, p_nach, 'teile');
      update public.sets set bilder = private.bilder_umziehen(r.bilder, p_von, p_nach, 'teile') where id = r.id;
    end loop;
  end if;

  if p_bereich in ('vorrat','beide','alle') then
    select coalesce(array_agg(id), '{}') into v_orig from public.vorrat where user_id = p_nach;
    select coalesce(array_agg(id), '{}') into v_moved from public.vorrat where user_id = p_von;
    for r in select * from public.vorrat_orte where user_id = p_von loop
      select id into v_match from public.vorrat_orte where user_id = p_nach and lower(trim(name)) = lower(trim(r.name)) order by id limit 1;
      if found then
        update public.vorrat set ort_id = v_match where user_id = p_von and ort_id = r.id;
        update public.vorrat_chargen set ort_id = v_match where user_id = p_von and ort_id = r.id;
        delete from public.vorrat_orte where id = r.id; n_om := n_om + 1;
      else
        update public.vorrat_orte set user_id = p_nach where id = r.id; n_o := n_o + 1;
      end if;
    end loop;
    update public.vorrat_chargen set user_id = p_nach where user_id = p_von;
    update public.vorrat set user_id = p_nach where user_id = p_von; get diagnostics n_v = row_count;
    for m in select * from public.vorrat where id = any (v_moved) order by id loop
      select * into k from public.vorrat n where n.id = any (v_orig) and lower(trim(n.name)) = lower(trim(m.name))
        and n.einheit is not distinct from m.einheit and n.ort_id is not distinct from m.ort_id order by n.id limit 1;
      if found then
        update public.vorrat_chargen set vorrat_id = k.id where vorrat_id = m.id;
        update public.vorrat set kategorie = coalesce(kategorie, m.kategorie),
          mindestbestand = coalesce(mindestbestand, m.mindestbestand), preis = coalesce(preis, m.preis),
          barcode = coalesce(barcode, m.barcode), notiz = coalesce(notiz, m.notiz),
          bilder = private.bilder_vereinen(bilder, m.bilder)
        where id = k.id;
        delete from public.vorrat where id = m.id; n_vm := n_vm + 1;
      end if;
    end loop;
    for r in select id, bilder from public.vorrat where user_id = p_nach and (bild_url like v_pat or exists (select 1 from unnest(bilder) e where e like v_pat)) loop
      v_files := v_files || private.bilder_dateien(r.bilder, p_von, p_nach, 'vorrat');
      update public.vorrat set bilder = private.bilder_umziehen(r.bilder, p_von, p_nach, 'vorrat') where id = r.id;
    end loop;
  end if;

  if p_bereich in ('lego','alle') then
    select coalesce(array_agg(id), '{}') into v_orig from public.lego_teile where user_id = p_nach;
    select coalesce(array_agg(id), '{}') into v_moved from public.lego_teile where user_id = p_von;
    for r in select * from public.lego_kisten where user_id = p_von loop
      select id into v_match from public.lego_kisten where user_id = p_nach and art = r.art and nummer = r.nummer;
      if found then
        update public.lego_teile set kiste_id = v_match where user_id = p_von and kiste_id = r.id;
        delete from public.lego_kisten where id = r.id; n_lkm := n_lkm + 1;
      else update public.lego_kisten set user_id = p_nach where id = r.id; n_lk := n_lk + 1; end if;
    end loop;
    for r in select * from public.lego_sets where user_id = p_von loop
      select id into v_match from public.lego_sets where user_id = p_nach and art = r.art and set_nummer = r.set_nummer;
      if found then
        update public.lego_teil_sets set set_id = v_match where user_id = p_von and set_id = r.id;
        update public.lego_sets set bilder = private.bilder_vereinen(bilder, r.bilder) where id = v_match;
        delete from public.lego_sets where id = r.id; n_lsm := n_lsm + 1;
      else update public.lego_sets set user_id = p_nach where id = r.id; n_ls := n_ls + 1; end if;
    end loop;
    update public.lego_teile set user_id = p_nach where user_id = p_von; get diagnostics n_lt = row_count;
    update public.lego_teil_sets set user_id = p_nach where user_id = p_von;
    for m in select * from public.lego_teile where id = any (v_moved) and coalesce(teile_nr, '') <> '' order by id loop
      select * into k from public.lego_teile n where n.id = any (v_orig) and n.teile_nr = m.teile_nr
        and lower(coalesce(n.farbe, '')) = lower(coalesce(m.farbe, '')) and n.kiste_id is not distinct from m.kiste_id order by n.id limit 1;
      if found then
        update public.lego_teile set anzahl = anzahl + m.anzahl, beschreibung = coalesce(beschreibung, m.beschreibung),
          euro = coalesce(euro, m.euro), notiz = coalesce(notiz, m.notiz),
          bilder = private.bilder_vereinen(bilder, m.bilder) where id = k.id;
        insert into public.lego_teil_sets (teil_id, set_id, user_id) select k.id, ts.set_id, p_nach from public.lego_teil_sets ts where ts.teil_id = m.id on conflict do nothing;
        delete from public.lego_teile where id = m.id; n_ltm := n_ltm + 1;
      end if;
    end loop;
    for r in select id, bilder from public.lego_teile where user_id = p_nach and (bild_url like v_pat or exists (select 1 from unnest(bilder) e where e like v_pat)) loop
      v_files := v_files || private.bilder_dateien(r.bilder, p_von, p_nach, 'lego');
      update public.lego_teile set bilder = private.bilder_umziehen(r.bilder, p_von, p_nach, 'lego') where id = r.id;
    end loop;
    for r in select id, bilder from public.lego_sets where user_id = p_nach and exists (select 1 from unnest(bilder) e where e like v_pat) loop
      v_files := v_files || private.bilder_dateien(r.bilder, p_von, p_nach, 'lego');
      update public.lego_sets set bilder = private.bilder_umziehen(r.bilder, p_von, p_nach, 'lego') where id = r.id;
    end loop;
  end if;

  set constraints all immediate;
  return jsonb_build_object('kisten_neu', n_k, 'kisten_zusammengelegt', n_km, 'sets_neu', n_s, 'sets_zusammengelegt', n_sm,
    'teile_neu', n_t - n_tm, 'teile_zusammengelegt', n_tm, 'orte_neu', n_o, 'orte_zusammengelegt', n_om,
    'vorrat_neu', n_v - n_vm, 'vorrat_zusammengelegt', n_vm,
    'lego_kisten_neu', n_lk, 'lego_kisten_zusammengelegt', n_lkm, 'lego_sets_neu', n_ls, 'lego_sets_zusammengelegt', n_lsm,
    'lego_teile_neu', n_lt - n_ltm, 'lego_teile_zusammengelegt', n_ltm,
    'dateien', v_files, 'loeschen', v_del);
end $function$;

create or replace function private.admin_reset_user(target uuid)
 returns json language plpgsql security definer set search_path to '' as $function$
declare n_ts int; n_t int; n_s int; n_k int; n_v int; n_o int; n_c int; n_a int;
  n_lts int; n_lt int; n_ls int; n_lk int; n_cb int;
begin
  if not private.is_admin() then raise exception 'Nur für Admins' using errcode = '42501'; end if;
  delete from public.teil_sets where user_id = target; get diagnostics n_ts = row_count;
  delete from public.teile where user_id = target; get diagnostics n_t = row_count;
  delete from public.sets where user_id = target; get diagnostics n_s = row_count;
  delete from public.kisten where user_id = target; get diagnostics n_k = row_count;
  delete from public.vorrat_angebote where user_id = target; get diagnostics n_a = row_count;
  delete from public.vorrat_chargen where user_id = target; get diagnostics n_c = row_count;
  delete from public.vorrat where user_id = target; get diagnostics n_v = row_count;
  delete from public.vorrat_orte where user_id = target; get diagnostics n_o = row_count;
  delete from public.lego_teil_sets where user_id = target; get diagnostics n_lts = row_count;
  delete from public.lego_teile where user_id = target; get diagnostics n_lt = row_count;
  delete from public.lego_sets where user_id = target; get diagnostics n_ls = row_count;
  delete from public.lego_kisten where user_id = target; get diagnostics n_lk = row_count;
  delete from public.custom_bereiche where user_id = target; get diagnostics n_cb = row_count;
  delete from public.tab_namen where user_id = target;
  return json_build_object('teil_sets',n_ts,'teile',n_t,'sets',n_s,'kisten',n_k,'vorrat',n_v,'vorrat_orte',n_o,'chargen',n_c,'angebote',n_a,
    'lego_teil_sets',n_lts,'lego_teile',n_lt,'lego_sets',n_ls,'lego_kisten',n_lk,'custom_bereiche',n_cb);
end $function$;
