-- Kisten/Tüten: Nummer ist freier Text und darf leer bleiben
alter table public.kisten alter column nummer drop not null;
alter table public.lego_kisten alter column nummer drop not null;
-- Eindeutig nur, wenn eine Nummer eingetragen ist (Groß/klein und Leerzeichen egal)
create unique index if not exists kisten_user_art_nummer_norm_key on public.kisten (user_id, art, lower(regexp_replace(btrim(nummer), '\s+', ' ', 'g'))) where nummer is not null and btrim(nummer) <> '';
create unique index if not exists lego_kisten_user_art_nummer_norm_key on public.lego_kisten (user_id, art, lower(regexp_replace(btrim(nummer), '\s+', ' ', 'g'))) where nummer is not null and btrim(nummer) <> '';
alter table public.kisten drop constraint if exists kisten_user_art_nummer_key;
alter table public.lego_kisten drop constraint if exists lego_kisten_user_id_nummer_key;
-- LEGO: beim Löschen einer Kiste nur die Kisten-Zuordnung der Teile leeren
alter table public.lego_teile drop constraint if exists lego_teile_kiste_fkey;
alter table public.lego_teile add constraint lego_teile_kiste_fkey foreign key (kiste_id, user_id) references public.lego_kisten(id, user_id) on delete set null (kiste_id) deferrable;
