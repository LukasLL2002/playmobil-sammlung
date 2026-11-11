// Klickypedia-Seiten auslesen (Suche + Teile-Seite). Reines JS, damit es in Deno und Node testbar ist.
const ent = s => String(s || '').replace(/&#0?39;|&#8217;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&euro;/g, '€').replace(/&#8211;/g, '–').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const strip = s => ent(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export function fmtPmNr(nr) { const d = String(nr || '').replace(/\D/g, ''); return d.length === 8 ? `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4)}` : String(nr || '').trim(); }
/** Suchergebnis-Seite: nur Teile (/parts/…) */
export function parseSearch(html) {
  const out = [], seen = new Set();
  const re = /<div class="td_mod3 td_mod_wrap[\s\S]*?<a href="(https:\/\/www\.klickypedia\.com\/parts\/[^"]+)"[^>]*title="([^"]*)"[\s\S]*?<img[^>]*src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1]; if (seen.has(url)) continue; seen.add(url);
    const title = ent(m[2]); const mm = title.match(/^\s*([0-9][0-9A-Za-z\-]*)\s*-\s*(.*)$/);
    const img = /no-thumb/.test(m[3]) ? null : m[3];
    out.push({ nr: mm ? mm[1] : '', name_en: mm ? mm[2].trim() : title, img, link: url });
  }
  return out;
}
/** Teile-Seite: Nummer, Namen (DE/EN), Farbe, Kategorie, Preis, Sets, Bild */
export function parsePart(html, url) {
  const box = (html.match(/caja_set_info">([\s\S]*?)<\/div>/) || [])[1] || '';
  const lang = l => { const m = box.match(new RegExp('alt="' + l + '">\\s*([^<]*)<br')); return m ? ent(m[1]).trim() : ''; };
  const field = f => { const m = box.match(new RegExp('<strong>' + f + ':</strong>([\\s\\S]*?)<br')); return m ? strip(m[1]).replace(/\s*\(\d+ parts\)\s*$/, '') : ''; };
  const setsBlock = (html.split('SETS CONTAINING THIS PART')[1] || '').split('<!--')[0];
  const sets = [...new Set([...setsBlock.matchAll(/<h3 class="entry-title"><a [^>]*>([^<]+)<\/a>/g)].map(x => ent(x[1]).trim()))];
  const img = (html.match(/src="(https:\/\/www\.klickypedia\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/part-[^"]+?)"/) || [])[1] || null;
  const nr = field('Part Number');
  const preis = (field('Approximate Price').match(/[\d.,]+/) || [])[0];
  return { nr, name_de: lang('Deutsch'), name_en: lang('English'), farbe: field('Colour'), kategorie: field('Category'), preis: preis ? Number(preis.replace(',', '.')) : null, sets: sets.slice(0, 30), sets_total: sets.length, img, link: url };
}
const FARBEN = { black: 'schwarz', white: 'weiß', red: 'rot', blue: 'blau', 'dark blue': 'dunkelblau', 'light blue': 'hellblau', green: 'grün', 'dark green': 'dunkelgrün', 'light green': 'hellgrün', yellow: 'gelb', grey: 'grau', gray: 'grau', 'dark grey': 'dunkelgrau', 'light grey': 'hellgrau', brown: 'braun', 'dark brown': 'dunkelbraun', 'light brown': 'hellbraun', orange: 'orange', pink: 'rosa', purple: 'lila', violet: 'lila', silver: 'silber', gold: 'gold', golden: 'gold', beige: 'beige', transparent: 'transparent', metal: 'metallic', 'flesh': 'hautfarben', 'skin': 'hautfarben', multicolor: 'bunt', multicolour: 'bunt', turquoise: 'türkis', copper: 'kupfer', bronze: 'bronze', cream: 'creme', ivory: 'elfenbein' };
export const farbeDe = f => String(f || '').split(/\s*,\s*/).filter(Boolean).map(x => FARBEN[x.trim().toLowerCase()] || x.trim()).join(', ');
const cleanQ = q => String(q || '').trim().replace(/\s+/g, ' ');
/** Kern der Suche: holt Suchseite + Details der ersten Treffer. fetchText/cache werden hereingereicht (Deno oder Test). */
export async function klickySearch(q, { fetchText, cache, max = 8 }) {
  q = cleanQ(q);
  const isNr = /^[\d\s.\-]+$/.test(q) && q.replace(/\D/g, '').length >= 4;
  const query = isNr ? q.replace(/\D/g, '') : q;
  const find = s => cache('kp:s:' + s.toLowerCase(), 24, async () => parseSearch(await fetchText('https://www.klickypedia.com/?s=' + encodeURIComponent(s))));
  let list = await find(query), used = query;
  if (!list.length && !isNr) { // mehrere Wörter ohne Treffer: mit dem längsten Wort nochmal
    const w = query.split(' ').filter(x => x.length > 2).sort((a, b) => b.length - a.length)[0];
    if (w && w !== query) { list = await find(w); used = w; }
  }
  const top = list.slice(0, max), out = [];
  for (let i = 0; i < top.length; i += 3) {
    const part = await Promise.all(top.slice(i, i + 3).map(r => cache('kp:p:' + r.link, 24 * 7, async () => parsePart(await fetchText(r.link), r.link)).catch(() => null)));
    part.forEach((p, j) => { const r = top[i + j]; out.push({
      nr: fmtPmNr(p?.nr || r.nr), name: p?.name_de || p?.name_en || r.name_en, name_en: p?.name_en || r.name_en, farbe: p?.farbe && !/n\/a/i.test(p.farbe) ? farbeDe(p.farbe) : '',
      kategorie: p?.kategorie || '', preis: p?.preis ?? null, sets: p?.sets || [], img: p?.img || r.img, link: r.link, quelle: 'Klickypedia' }); });
  }
  return { items: out, total: list.length, query: used };
}
