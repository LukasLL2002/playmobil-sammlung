-- „Keine Nummer gefunden“: zusätzliche Markierung, nichts wird gelöscht
alter table public.teile add column if not exists nummer_unbekannt boolean not null default false;
alter table public.lego_teile add column if not exists nummer_unbekannt boolean not null default false;
-- Bisher als „---“ erfasste Nummern zusätzlich markieren (Text bleibt unverändert)
update public.teile set nummer_unbekannt = true where btrim(coalesce(teile_nr,'')) in ('---','--','-','–','—') and not nummer_unbekannt;
update public.lego_teile set nummer_unbekannt = true where btrim(coalesce(teile_nr,'')) in ('---','--','-','–','—') and not nummer_unbekannt;
