// Sortiva – Playmobil-Teilesuche (Proxy zu klickypedia.com). Nur angemeldete Nutzer, mit Cache und Begrenzung.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { klickySearch } from './parse.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const UA = 'Sortiva-Teilesuche/1.0 (private Sammlungs-App; +https://lukasll2002.github.io/playmobil-sammlung/)';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const hits = new Map<string, number[]>();
const mem = new Map<string, { t: number; v: unknown }>();
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function fetchText(url: string) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de,en;q=0.8' }, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(tm); }
}
async function cache<T>(key: string, ttlH: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now(), m = mem.get(key);
  if (m && now - m.t < ttlH * 3600e3) return m.v as T;
  const { data } = await admin.from('teilsuche_cache').select('data, created_at').eq('key', key).maybeSingle();
  if (data && now - new Date(data.created_at).getTime() < ttlH * 3600e3) { mem.set(key, { t: new Date(data.created_at).getTime(), v: data.data }); return data.data as T; }
  const v = await fn();
  mem.set(key, { t: now, v });
  await admin.from('teilsuche_cache').upsert({ key, data: v, created_at: new Date().toISOString() });
  return v;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Nicht erlaubt.' }, 405);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json({ error: 'Bitte zuerst anmelden.' }, 401);
  const now = Date.now(), l = (hits.get(u.user.id) || []).filter(t => now - t < 60e3);
  if (l.length >= 20) return json({ error: 'Zu viele Suchen auf einmal – bitte kurz warten.' }, 429);
  l.push(now); hits.set(u.user.id, l);
  let q = '';
  try { q = String((await req.json())?.q || '').trim(); } catch { /* leer */ }
  if (q.length < 2 || q.length > 80) return json({ error: 'Bitte 2 bis 80 Zeichen eingeben.' }, 400);
  try {
    return json(await klickySearch(q, { fetchText, cache }));
  } catch (e) {
    console.error('teilsuche', String(e));
    return json({ error: 'Klickypedia ist gerade nicht erreichbar. Bitte später nochmal versuchen.' }, 502);
  }
});
