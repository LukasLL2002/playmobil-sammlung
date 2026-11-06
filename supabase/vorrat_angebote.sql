-- Manuell erfasste Vorrats-Angebote (kein Live-Feed)
create table if not exists public.vorrat_angebote (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vorrat_id bigint not null,
  markt text not null,
  preis numeric(10,2) not null check (preis >= 0),
  gueltig_ab date not null default current_date,
  gueltig_bis date not null,
  quelle_url text,
  notiz text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  check (gueltig_bis >= gueltig_ab)
);
-- + FK, RLS, indexes, revoke anon – applied via migration vorrat_angebote
