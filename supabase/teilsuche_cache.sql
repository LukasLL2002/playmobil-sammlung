-- Cache für die Playmobil-Teilesuche (Edge Function „teilsuche“). Nur der Server (service_role) liest/schreibt.
create table if not exists public.teilsuche_cache (
  key text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.teilsuche_cache enable row level security;
revoke all on public.teilsuche_cache from anon, authenticated;
comment on table public.teilsuche_cache is 'Server-Cache der Teilesuche (Klickypedia). Kein Zugriff für Clients.';
