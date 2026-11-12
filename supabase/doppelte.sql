-- „Doppelte prüfen“: verworfene Gruppen merken + Einträge sicher zusammenführen (eine Transaktion, RLS gilt).
create table if not exists public.dup_ignoriert (
  user_id uuid not null references auth.users(id) on delete cascade,
  bereich text not null check (bereich in ('playmobil', 'lego')),
  gruppe text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, bereich, gruppe)
);
alter table public.dup_ignoriert enable row level security;
create policy "Doppelte-Ausnahmen lesen: eigene oder Admin" on public.dup_ignoriert for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "Doppelte-Ausnahmen anlegen: eigene oder Admin" on public.dup_ignoriert for insert to authenticated
  with check (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "Doppelte-Ausnahmen löschen: eigene oder Admin" on public.dup_ignoriert for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
grant select, insert, delete on public.dup_ignoriert to authenticated;

-- Zusammenführen: Verknüpfungen umhängen, Fotos/Notizen übernehmen, leere Felder füllen, dann erst die anderen löschen.
-- SECURITY INVOKER: es gelten die normalen Zugriffsregeln (eigene, geteilt-bearbeiten oder Admin).
create or replace function public.sets_zusammenfuehren(p_lego boolean, p_keep bigint, p_merge bigint[], p_nummer text, p_name text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid; v_cnt int; v_links_vorher int; v_links_nachher int; v_moved int; v_deleted int;
begin
  p_merge := array(select distinct x from unnest(p_merge) x where x is not null and x <> p_keep);
  if p_keep is null or coalesce(array_length(p_merge, 1), 0) = 0 then raise exception 'Bitte mindestens zwei Einträge wählen.'; end if;
  if nullif(btrim(coalesce(p_nummer, '')), '') is null then raise exception 'Bitte eine Nummer angeben.'; end if;

  if not p_lego then
    select user_id into v_owner from public.sets where id = p_keep for update;
    if v_owner is null then raise exception 'Eintrag nicht gefunden oder keine Berechtigung.'; end if;
    select count(*) into v_cnt from (select id from public.sets where id = any(p_merge) and user_id = v_owner for update) x;
    if v_cnt <> array_length(p_merge, 1) then raise exception 'Einträge gehören nicht zur selben Sammlung oder fehlen.'; end if;
    -- alle betroffenen Teile vorher
    select count(distinct teil_id) into v_links_vorher from public.teil_sets where set_id = p_keep or set_id = any(p_merge);
    insert into public.teil_sets (teil_id, set_id, user_id)
      select distinct teil_id, p_keep, v_owner from public.teil_sets where set_id = any(p_merge)
      on conflict (teil_id, set_id) do nothing;
    get diagnostics v_moved = row_count;
    select count(distinct teil_id) into v_links_nachher from public.teil_sets where set_id = p_keep;
    if v_links_nachher <> v_links_vorher then raise exception 'Verknüpfungen konnten nicht vollständig übernommen werden – nichts geändert.'; end if;
    -- Felder übernehmen (Fotos vereinigt, Titelbild bleibt; Notizen anhängen; Leeres füllen)
    update public.sets k set
      bilder = (select coalesce(array_agg(b order by r), '{}') from (
                  select b, min(o1 * 100000 + o2) r from (
                    select unnest(coalesce(k.bilder, '{}')) b, 0 o1, generate_subscripts(coalesce(k.bilder, '{}'), 1) o2
                    union all
                    select unnest(coalesce(m.bilder, '{}')), 1 + array_position(p_merge, m.id), generate_subscripts(coalesce(m.bilder, '{}'), 1) from public.sets m where m.id = any(p_merge)
                  ) u where b is not null and b <> '' group by b) z),
      notiz = (select nullif(string_agg(n, E'\n' order by o), '') from (
                  select distinct on (btrim(n)) n, o from (
                    select k.notiz n, 0 o union all select m.notiz, 1 + array_position(p_merge, m.id) from public.sets m where m.id = any(p_merge)
                  ) a where nullif(btrim(coalesce(n, '')), '') is not null order by btrim(n), o) d),
      beschreibung = coalesce(nullif(k.beschreibung, ''), (select m.beschreibung from public.sets m where m.id = any(p_merge) and nullif(m.beschreibung, '') is not null order by array_position(p_merge, m.id) limit 1)),
      farbe = coalesce(nullif(k.farbe, ''), (select m.farbe from public.sets m where m.id = any(p_merge) and nullif(m.farbe, '') is not null order by array_position(p_merge, m.id) limit 1)),
      anzahl = coalesce(k.anzahl, (select m.anzahl from public.sets m where m.id = any(p_merge) and m.anzahl is not null order by array_position(p_merge, m.id) limit 1)),
      euro = coalesce(k.euro, (select m.euro from public.sets m where m.id = any(p_merge) and m.euro is not null order by array_position(p_merge, m.id) limit 1)),
      kiste_id = coalesce(k.kiste_id, (select m.kiste_id from public.sets m where m.id = any(p_merge) and m.kiste_id is not null order by array_position(p_merge, m.id) limit 1))
    where k.id = p_keep;
    delete from public.teil_sets where set_id = any(p_merge);
    delete from public.sets where id = any(p_merge);
    get diagnostics v_deleted = row_count;
    update public.sets set set_nummer = btrim(p_nummer), name = nullif(btrim(coalesce(p_name, '')), '') where id = p_keep;
  else
    select user_id into v_owner from public.lego_sets where id = p_keep for update;
    if v_owner is null then raise exception 'Eintrag nicht gefunden oder keine Berechtigung.'; end if;
    select count(*) into v_cnt from (select id from public.lego_sets where id = any(p_merge) and user_id = v_owner for update) x;
    if v_cnt <> array_length(p_merge, 1) then raise exception 'Einträge gehören nicht zur selben Sammlung oder fehlen.'; end if;
    select count(distinct teil_id) into v_links_vorher from public.lego_teil_sets where set_id = p_keep or set_id = any(p_merge);
    insert into public.lego_teil_sets (teil_id, set_id, user_id)
      select distinct teil_id, p_keep, v_owner from public.lego_teil_sets where set_id = any(p_merge)
      on conflict (teil_id, set_id) do nothing;
    get diagnostics v_moved = row_count;
    select count(distinct teil_id) into v_links_nachher from public.lego_teil_sets where set_id = p_keep;
    if v_links_nachher <> v_links_vorher then raise exception 'Verknüpfungen konnten nicht vollständig übernommen werden – nichts geändert.'; end if;
    update public.lego_sets k set
      bilder = (select coalesce(array_agg(b order by r), '{}') from (
                  select b, min(o1 * 100000 + o2) r from (
                    select unnest(coalesce(k.bilder, '{}')) b, 0 o1, generate_subscripts(coalesce(k.bilder, '{}'), 1) o2
                    union all
                    select unnest(coalesce(m.bilder, '{}')), 1 + array_position(p_merge, m.id), generate_subscripts(coalesce(m.bilder, '{}'), 1) from public.lego_sets m where m.id = any(p_merge)
                  ) u where b is not null and b <> '' group by b) z),
      notiz = (select nullif(string_agg(n, E'\n' order by o), '') from (
                  select distinct on (btrim(n)) n, o from (
                    select k.notiz n, 0 o union all select m.notiz, 1 + array_position(p_merge, m.id) from public.lego_sets m where m.id = any(p_merge)
                  ) a where nullif(btrim(coalesce(n, '')), '') is not null order by btrim(n), o) d),
      beschreibung = coalesce(nullif(k.beschreibung, ''), (select m.beschreibung from public.lego_sets m where m.id = any(p_merge) and nullif(m.beschreibung, '') is not null order by array_position(p_merge, m.id) limit 1)),
      farbe = coalesce(nullif(k.farbe, ''), (select m.farbe from public.lego_sets m where m.id = any(p_merge) and nullif(m.farbe, '') is not null order by array_position(p_merge, m.id) limit 1)),
      anzahl = coalesce(k.anzahl, (select m.anzahl from public.lego_sets m where m.id = any(p_merge) and m.anzahl is not null order by array_position(p_merge, m.id) limit 1)),
      euro = coalesce(k.euro, (select m.euro from public.lego_sets m where m.id = any(p_merge) and m.euro is not null order by array_position(p_merge, m.id) limit 1)),
      kiste_id = coalesce(k.kiste_id, (select m.kiste_id from public.lego_sets m where m.id = any(p_merge) and m.kiste_id is not null order by array_position(p_merge, m.id) limit 1)),
      jahr = coalesce(k.jahr, (select m.jahr from public.lego_sets m where m.id = any(p_merge) and m.jahr is not null order by array_position(p_merge, m.id) limit 1)),
      teile_anzahl = coalesce(k.teile_anzahl, (select m.teile_anzahl from public.lego_sets m where m.id = any(p_merge) and m.teile_anzahl is not null order by array_position(p_merge, m.id) limit 1))
    where k.id = p_keep;
    delete from public.lego_teil_sets where set_id = any(p_merge);
    delete from public.lego_sets where id = any(p_merge);
    get diagnostics v_deleted = row_count;
    update public.lego_sets set set_nummer = btrim(p_nummer), name = nullif(btrim(coalesce(p_name, '')), '') where id = p_keep;
  end if;
  return jsonb_build_object('keep', p_keep, 'geloescht', v_deleted, 'verknuepfungen_neu', v_moved, 'teile', v_links_nachher);
end;
$$;
revoke all on function public.sets_zusammenfuehren(boolean, bigint, bigint[], text, text) from public, anon;
grant execute on function public.sets_zusammenfuehren(boolean, bigint, bigint[], text, text) to authenticated;
