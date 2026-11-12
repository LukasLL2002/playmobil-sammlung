/* Sortiva service worker – App-Shell (kein Nutzerdaten-Cache)
   Cache-Version an Asset-Query ?v=… anpassen. */
'use strict';

const CACHE = 'sortiva-v20261112-1';
const BASE = new URL('./', self.location).href;

/** Kern-Shell: kleine Start-Assets, kein OCR-Vendor (~21 MB). */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './style.css?v=20261112-1',
  './app.js?v=20261112-1',
  './import.js?v=20261112-1',
  './lego.js?v=20261112-1',
  './custom.js?v=20261112-1',
  './offers.js?v=20261112-1',
  './install.js?v=20261112-1',
  './vendor/supabase/supabase.min.js?v=2.86.0',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

function toAbs(path) {
  return new URL(path, BASE).href;
}

function isSameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; } catch { return false; }
}

/** Keine privaten / API-Antworten cachen. */
function isNetworkOnly(url) {
  const u = String(url);
  if (!isSameOrigin(u)) return true; // CDN & Fremdanbieter: SW nicht übernehmen
  if (/supabase\.co|auth\/v1|rest\/v1|storage\/v1|realtime/i.test(u)) return true;
  if (/access_token|refresh_token|oauth|authorize/i.test(u)) return true;
  return false;
}

function isNavigation(req) {
  return req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept') || '').includes('text/html');
}

function isStaticAsset(url) {
  if (!isSameOrigin(url)) return false;
  const p = new URL(url).pathname;
  return /\.(?:js|css|png|jpg|jpeg|webp|svg|ico|woff2?|wasm|gz|webmanifest)$/i.test(p)
    || /\/vendor\//.test(p)
    || /\/icons\//.test(p);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // einzeln: ein 404 darf die Installation nicht killen
    await Promise.all(PRECACHE.map(async path => {
      const req = new Request(toAbs(path), { cache: 'reload' });
      try {
        const res = await fetch(req);
        if (res && res.ok) await cache.put(req, res.clone());
      } catch (e) {
        console.warn('[sw] precache skip', path, e);
      }
    }));
    // Sofort wartend – aktive Seite bleibt bis zum nächsten Start
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('sortiva-') && k !== CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  if (isNetworkOnly(url)) return; // Browser-Default / Netzwerk

  // Navigation: Netzwerk zuerst, sonst gecachte index.html
  if (isNavigation(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(toAbs('./index.html')))
          || (await cache.match(toAbs('./')))
          || Response.error();
      }
    })());
    return;
  }

  // Gleiche Herkunft, statische Assets: Cache zuerst
  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        // OCR/Vendor erst beim tatsächlichen Abruf cachen (nicht beim Start)
        if (res && res.ok && res.type === 'basic') {
          try { await cache.put(req, res.clone()); } catch { /* quota */ }
        }
        return res;
      } catch {
        const fallback = await cache.match(req, { ignoreSearch: false });
        return fallback || Response.error();
      }
    })());
  }
});
