-- Reserve/Sets: dieselben Angaben wie bei Teilen (alle freiwillig)
alter table public.sets add column if not exists farbe text, add column if not exists beschreibung text,
  add column if not exists anzahl integer check (anzahl is null or anzahl >= 0), add column if not exists euro numeric(10,2), add column if not exists kiste_id bigint;
alter table public.lego_sets add column if not exists farbe text, add column if not exists beschreibung text,
  add column if not exists anzahl integer check (anzahl is null or anzahl >= 0), add column if not exists euro numeric(10,2), add column if not exists kiste_id bigint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sets_kiste_fkey') then
    alter table public.sets add constraint sets_kiste_fkey foreign key (kiste_id, user_id) references public.kisten(id, user_id) on delete set null (kiste_id) deferrable;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lego_sets_kiste_fkey') then
    alter table public.lego_sets add constraint lego_sets_kiste_fkey foreign key (kiste_id, user_id) references public.lego_kisten(id, user_id) on delete set null (kiste_id) deferrable;
  end if;
end $$;
create index if not exists sets_kiste_idx on public.sets (kiste_id) where kiste_id is not null;
create index if not exists lego_sets_kiste_idx on public.lego_sets (kiste_id) where kiste_id is not null;
