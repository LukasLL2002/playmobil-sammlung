# Sortiva

Sortiva – sortieren & bewahren. Web-App für Playmobil-Sammlung, Vorratskammer, LEGO und eigene Bereiche.
Statische Seite (HTML/CSS/JS) mit Supabase als Backend. Im Code steht nur der öffentliche Publishable Key; der Zugriff ist per Row Level Security auf angemeldete Nutzer beschränkt.

**Live:** https://sortivaapp.github.io/

## Bereiche

- **Playmobil** – Teile, Sets, Kisten/Tüten mit NFC/QR
- **Vorratskammer** – Bestand, MHD, Mindestbestand, Einkaufsliste, Orte mit NFC/QR, Angebote
- **LEGO** – analog Playmobil
- **Eigene Bereiche** – frei konfigurierbar

## Teilen

Tab „👥 Teilen“: per E-Mail einladen (*nur lesen* / *bearbeiten*). Geteilte Sammlungen erscheinen oben unter „Sammlung“.

## Technik

GitHub Pages + Supabase (Auth, DB, Storage). Kein Scraping von Flyer-Preisen – nur Deep-Links zu Prospekt-Anbietern.
