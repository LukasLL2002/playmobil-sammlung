# Playmobil-Sammlung

Einfache Web-App mit zwei Bereichen: Playmobil-Sammlung (Teile, Sets, Kisten/Tüten mit NFC/QR) und Vorratskammer (Bestand, MHD, Mindestbestand, Einkaufsliste, Orte mit NFC/QR).
Statische Seite (HTML/CSS/JS) mit Supabase als Backend. Im Code steht nur der öffentliche Publishable Key; der Zugriff ist per Row Level Security auf angemeldete Nutzer beschränkt.

## Konten & Admin

- Jede Person registriert sich selbst und sieht nur **ihre eigenen** Daten (RLS über `user_id`, Fotos unter `<user-id>/teile/…` bzw. `<user-id>/vorrat/…`).
- Kisten- und Set-Nummern sind pro Konto eindeutig.
- **Admin** werden (im Supabase SQL-Editor):
  ```sql
  insert into public.admins (user_id) select id from auth.users where email = 'name@example.com';
  ```
  Admins sehen den Tab „🛡️ Admin“: Benutzerliste, Daten jedes Kontos ansehen/bearbeiten, Daten eines Kontos zurücksetzen (Bestätigung durch Eintippen der E-Mail).
