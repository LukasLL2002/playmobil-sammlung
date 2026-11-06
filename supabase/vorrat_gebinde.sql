-- Inhalt je Gebinde (Packung/Dose/…) ohne destruktive Änderung; Altbestand bleibt NULL.
alter table public.vorrat
  add column if not exists gebinde_inhalt numeric(10,3),
  add column if not exists basis_einheit text;
comment on column public.vorrat.gebinde_inhalt is 'Inhalt je Packung/Dose/… (z.B. 1 bei 1 Liter je Packung)';
comment on column public.vorrat.basis_einheit is 'Basis-Einheit für gebinde_inhalt (l, ml, kg, g, Stück); NULL = nicht gesetzt';
