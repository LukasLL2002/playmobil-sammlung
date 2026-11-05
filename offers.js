// Angebote in der Nähe – nur Deep-Links + Open-Data-Märkte, kein Flyer-Scraping
'use strict';

const PLZ_KEY = 'vorratPlz';
const CITY_CACHE_KEY = 'vorratCityCache'; // { plz: { city, lat, lon, slug, ts } }

function getPlz() { return (localStorage.getItem(PLZ_KEY) || '').replace(/\D/g, '').slice(0, 5); }
function setPlz(plz) { localStorage.setItem(PLZ_KEY, String(plz || '').replace(/\D/g, '').slice(0, 5)); }

function citySlug(name) {
  return String(name || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function cityTitle(name) {
  return String(name || '').split(/[\s-]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('-');
}

function productSlug(term) {
  return String(term || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/** Kurzer Suchbegriff aus Name/Kategorie (erste 1–3 sinnvolle Wörter). */
function offerSearchTerm(it) {
  const raw = (it.name || it.kategorie || '').trim();
  const stop = new Set(['und', 'oder', 'der', 'die', 'das', 'mit', 'ohne', 'bio', 'von', 'für']);
  const words = raw.split(/[\s,/|]+/).filter(w => w && !stop.has(w.toLowerCase()) && !/^\d/.test(w));
  return (words.slice(0, 3).join(' ') || raw).slice(0, 40);
}

function readCityCache() {
  try { return JSON.parse(localStorage.getItem(CITY_CACHE_KEY) || '{}'); } catch { return {}; }
}
function writeCityCache(cache) { localStorage.setItem(CITY_CACHE_KEY, JSON.stringify(cache)); }

async function resolvePlz(plz) {
  plz = String(plz || '').replace(/\D/g, '').slice(0, 5);
  if (plz.length !== 5) throw new Error('Bitte eine 5-stellige PLZ eingeben.');
  const cache = readCityCache();
  if (cache[plz] && cache[plz].city && Date.now() - (cache[plz].ts || 0) < 30 * 864e5) return cache[plz];
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(plz)}&country=de&format=json&addressdetails=1&limit=1`;
  const r = await fetch(url, { headers: { 'Accept': 'application/json', 'Accept-Language': 'de' } });
  if (!r.ok) throw new Error('Ortsauflösung fehlgeschlagen (Nominatim).');
  const data = await r.json();
  if (!data?.length) throw new Error('PLZ nicht gefunden.');
  const a = data[0].address || {};
  const city = a.city || a.town || a.village || a.municipality || a.county || data[0].display_name.split(',')[0];
  const info = { city, lat: data[0].lat, lon: data[0].lon, slug: citySlug(city), title: cityTitle(city), ts: Date.now() };
  cache[plz] = info; writeCityCache(cache); return info;
}

function offerLinks(it, cityInfo) {
  const term = offerSearchTerm(it);
  const pslug = productSlug(term);
  const q = encodeURIComponent(term);
  const city = cityInfo.slug;
  const cityTc = cityInfo.title || cityTitle(cityInfo.city);
  return [
    { name: 'MeinProspekt', url: `https://www.meinprospekt.de/${city}/angebote/${pslug}`, note: 'Prospekt-Suche (externe Seite)' },
    { name: 'kaufDA', url: `https://www.kaufda.de/${encodeURIComponent(cityTc)}/Angebote/${encodeURIComponent(term.replace(/\s+/g, '-'))}`, note: 'Angebote vor Ort (externe Seite)' },
    { name: 'Marktguru', url: `https://www.marktguru.de/search/${q}`, note: 'Suche (externe Seite)' },
  ];
}

function viewPlzSettings() {
  const plz = getPlz();
  const cache = readCityCache()[plz];
  app.innerHTML = `
    <a class="back" href="#v/liste">‹ Vorrat</a>
    <h1>📍 PLZ & Angebote</h1>
    <div class="card">
      <p class="muted" style="margin-top:0">PLZ bleibt auf dem Gerät. Die App öffnet die Anbietersuche – Preise und Gültigkeit stehen auf der Anbieter-Seite.</p>
      <label>Postleitzahl</label>
      <input id="plz" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" value="${esc(plz)}" placeholder="z.B. 80331">
      <button class="btn block" id="save" style="margin-top:.8rem;background:#2e7d32">Speichern</button>
      <div id="info" style="margin-top:.8rem">${cache ? `<span class="badge green">${esc(cache.city)}</span>` : ''}</div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Märkte in der Nähe</h2>
      <button class="btn secondary block" id="maerkte">🏪 Märkte laden</button>
      <div id="ml" style="margin-top:.8rem"></div>
    </div>`;
  document.getElementById('save').onclick = async () => {
    const v = document.getElementById('plz').value.trim();
    try {
      const info = await resolvePlz(v); setPlz(v);
      document.getElementById('info').innerHTML = `<span class="badge green">Ort: ${esc(info.city)}</span>`;
      toast('PLZ gespeichert: ' + info.city);
    } catch (e) { fail(e); }
  };
  document.getElementById('maerkte').onclick = () => loadMaerkte(document.getElementById('ml'));
}

async function loadMaerkte(el) {
  const plz = getPlz();
  if (plz.length !== 5) { toast('Bitte zuerst eine PLZ speichern.'); return viewPlzSettings(); }
  el.innerHTML = '<p class="muted">Lädt …</p>';
  try {
    let info = null;
    try { info = await resolvePlz(plz); } catch { /* Ort optional */ }
    const url = `https://supermarkt-in-meiner-naehe.de/api/search?plz=${encodeURIComponent(plz)}&limit=20`
      + (info?.city ? `&city=${encodeURIComponent(info.city)}` : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const list = Array.isArray(data) ? data
      : (data.records || data.results || data.stores || data.data || []);
    if (!list.length) { el.innerHTML = '<p class="muted">Keine Märkte gefunden.</p>'; return; }
    el.innerHTML = `<div class="list">${list.slice(0, 20).map(m => {
      const name = m.name || m.title || m.store || m.trade_label || 'Markt';
      const street = [m.street || m.adresse || m.address, m.housenumber || m.house_number || m.hausnummer].filter(Boolean).join(' ');
      const addr = [street, m.postcode || m.plz || m.zip, m.city || m.ort].filter(Boolean).join(', ');
      const hours = m.opening_hours || m.oeffnungszeiten || m.hours || '';
      const link = m.website || m.url || m.link || m.flyer_url || '';
      return `<div class="card" style="margin:0"><b>${esc(name)}</b>
        ${addr ? `<div class="sub muted">${esc(addr)}</div>` : ''}
        ${hours ? `<div class="sub muted">🕒 ${esc(typeof hours === 'string' ? hours : JSON.stringify(hours))}</div>` : ''}
        ${link ? `<a class="btn small secondary" href="${esc(link)}" target="_blank" rel="noopener">Zur Seite</a>` : ''}
      </div>`;
    }).join('')}</div>`;
  } catch (e) {
    el.innerHTML = `<p class="muted">Märkte nicht geladen (${esc(e.message)}).</p>`;
  }
}

/** Dialog: Angebote beim Anbieter ansehen – nur Deep-Links, keine Preise in der App. */
async function openAngebote(it) {
  let plz = getPlz();
  if (plz.length !== 5) {
    const typed = prompt('Deine PLZ (5 Stellen, nur lokal gespeichert):', '');
    if (typed == null) return;
    try { await resolvePlz(typed); setPlz(typed); plz = getPlz(); }
    catch (e) { return fail(e); }
  }
  let info;
  try { info = await resolvePlz(plz); } catch (e) { return fail(e); }
  const term = offerSearchTerm(it);
  const links = offerLinks(it, info);
  const html = `<form><h2 style="margin-top:0">🛒 ${esc(term)} · ${esc(info.city)}</h2>
    <p class="muted">PLZ bleibt auf dem Gerät. App öffnet die Anbietersuche – Preise und Gültigkeit auf der Anbieter-Seite.</p>
    <div class="list">${links.map(l => `<a class="btn block secondary" style="margin:.3rem 0;text-align:left" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)} ↗</a>`).join('')}</div>
    <div class="row" style="margin-top:1rem"><button type="button" class="btn secondary grow" data-cancel>Schließen</button>
      <a class="btn grow" href="#v/plz" style="text-align:center;background:#2e7d32">PLZ</a></div></form>`;
  const p = dialog(html);
  dialog.current._save = async () => true;
  return p;
}
