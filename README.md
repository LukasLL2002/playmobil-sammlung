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

## Teilen & Zusammenführen

- **Teilen** (Tab „👥 Teilen“ in beiden Bereichen): per E-Mail einladen, mit dem Recht *nur lesen* oder *bearbeiten*, für einen Bereich oder beide. Die eingeladene Person nimmt die Einladung an oder lehnt sie ab. Danach wählt sie oben unter „Sammlung“ die geteilte Sammlung aus. Der Besitzer kann den Zugriff jederzeit entziehen, das Mitglied kann die Sammlung verlassen. Einträge, die ein Mitglied anlegt, gehören dem Besitzer.
- **Zusammenführen**: Konto A fragt an, entweder „Meine Daten → zu dir“ oder „Deine Daten → zu mir“. Das andere Konto sieht eine Vorschau und muss zustimmen. Gleiche Kisten/Tüten, Sets und Orte (Nummer bzw. Name) werden zusammengelegt. Bei gleichen Teilen (Nr. + Farbe in derselben Kiste) wird die Anzahl addiert, bei gleichen Vorratsartikeln (Name + Einheit + Ort) die Menge. Fotos verschiebt die App danach. Admins können im Admin-Tab zwei Konten direkt zusammenführen.
- Die SQL-Migration liegt in `supabase/teilen_zusammenfuehren.sql`. Die Tabellen heißen `freigaben` und `zusammenfuehrungen`; alle Funktionen sind SECURITY DEFINER im Schema `private`, mit RLS auf allen Tabellen.
