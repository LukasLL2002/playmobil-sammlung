// In-memory Supabase mock for headless tests (persists in localStorage across reloads)
(function () {
  const U = '11111111-1111-1111-1111-111111111111';
  const KEY = '__mockdb';
  const seed = () => ({
    seq: 1000,
    sets: [
      { id: 1, set_nummer: '3666', name: 'Ritterburg', notiz: 'Alte Notiz', art: 'reserve', bilder: [], user_id: U, created_at: '2026-01-01' },
      { id: 2, set_nummer: '4000', name: 'Piratenschiff mit sehr langem Namen das früher abgeschnitten wurde', art: 'reserve', bilder: [], user_id: U, created_at: '2026-01-01' },
      { id: 3, set_nummer: '5300', name: 'Zoo', art: 'reserve', bilder: [], user_id: U, created_at: '2026-01-01' },
    ],
    teile: [
      { id: 11, teile_nr: '30 01 2340', farbe: 'dunkelgrau-metallic', beschreibung: 'Ritterhelm mit Visier und Federbusch, extra langer Name zum Testen der Darstellung', euro: 0.76, anzahl: 3, kiste_id: 21, bild_url: null, bilder: [], notiz: null, user_id: U, created_at: '2026-02-01' },
      { id: 12, teile_nr: '30 22 1110', farbe: 'rot', beschreibung: 'Schwert', euro: 1234.5, anzahl: 12, kiste_id: 21, bild_url: 'u/teile/old.jpg', bilder: ['u/teile/old.jpg'], notiz: null, user_id: U, created_at: '2026-02-02' },
    ],
    teil_sets: [{ teil_id: 11, set_id: 1, user_id: U }, { teil_id: 11, set_id: 2, user_id: U }, { teil_id: 12, set_id: 2, user_id: U }],
    kisten: [{ id: 21, art: 'Kiste', nummer: '1', name: 'Ritter und Burgzubehör aus den Achtzigern', farbe: 'blau', ort: 'Keller, Regal 2 ganz hinten links', user_id: U }],
    lego_sets: [{ id: 31, set_nummer: '75192', name: 'Millennium Falcon Ultimate Collector Series', art: 'reserve', bilder: [], jahr: 2017, teile_anzahl: 7541, user_id: U }],
    lego_teile: [{ id: 41, teile_nr: '3001', farbe: 'Bright Red', beschreibung: 'Brick 2 x 4 mit einem sehr langen Namen der umbrechen soll', euro: 0.12, anzahl: 250, kiste_id: 51, bild_url: null, bilder: [], user_id: U, created_at: '2026-03-01' }],
    lego_teil_sets: [{ teil_id: 41, set_id: 31, user_id: U }],
    lego_kisten: [{ id: 51, art: 'Kiste', nummer: '7', name: 'Steine rot', user_id: U }],
    tab_namen: [],
    storage: ['u/teile/old.jpg'],
    removed: [],
    log: [],
  });
  let db; try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) db = seed();
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  save();
  window.__mock = { db: () => db, reset: () => { db = seed(); save(); }, U };
  const svg = c => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${c}"/></svg>`);
  const colorFor = p => ['#c62828', '#2e7d32', '#1565c0', '#f9a825', '#6a1b9a'][[...p].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 5];
  const rel = { teil_sets: 'teil_id', lego_teil_sets: 'teil_id' };
  const uniq = { sets: ['user_id', 'art', 'set_nummer'], lego_sets: ['user_id', 'art', 'set_nummer'] };
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.cols = '*'; this.one = false; this.maybe = false; this.payload = null; }
    select(c) { if (this.op === 'select') this.cols = c || '*'; else this.ret = c || '*'; return this; }
    eq(k, v) { this.f.push(r => String(r[k]) === String(v)); return this; }
    neq(k, v) { this.f.push(r => String(r[k]) !== String(v)); return this; }
    in(k, vs) { this.f.push(r => vs.map(String).includes(String(r[k]))); return this; }
    is(k, v) { this.f.push(r => (r[k] ?? null) === v); return this; }
    order() { return this; } limit() { return this; } range() { return this; } gt() { return this; } lt() { return this; } gte() { return this; } lte() { return this; } ilike() { return this; } not() { return this; } or() { return this; } filter() { return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; this.maybe = true; return this; }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    upsert(p, o) { this.op = 'upsert'; this.payload = p; this.conf = (o && o.onConflict) || 'id'; return this; }
    delete() { this.op = 'delete'; return this; }
    expand(r) {
      const out = { ...r };
      const m = [...String(this.ret || this.cols).matchAll(/(\w+)\(([^)]*)\)/g)];
      for (const [, tbl] of m) out[tbl] = (db[tbl] || []).filter(x => x[rel[tbl] || 'teil_id'] === r.id).map(x => ({ set_id: x.set_id }));
      return out;
    }
    run() {
      const T = db[this.t] = db[this.t] || [];
      db.log.push({ t: this.t, op: this.op, payload: this.payload });
      const match = r => this.f.every(fn => fn(r));
      const chkUniq = (row, self) => { const u = uniq[this.t]; if (!u) return null;
        const d = T.find(x => x !== self && u.every(k => String(x[k] ?? (k === 'art' ? 'reserve' : '')) === String(row[k] ?? (k === 'art' ? 'reserve' : ''))));
        return d ? { code: '23505', message: 'duplicate key value violates unique constraint' } : null; };
      let rows;
      if (this.op === 'select') rows = T.filter(match);
      else if (this.op === 'insert' || this.op === 'upsert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        rows = [];
        for (const p of list) {
          if (this.op === 'upsert') { const ex = T.find(x => String(x[this.conf]) === String(p[this.conf])); if (ex) { Object.assign(ex, p); rows.push(ex); continue; } }
          const r = { id: ++db.seq, created_at: new Date().toISOString(), ...p };
          if ((this.t === 'sets' || this.t === 'lego_sets') && !r.art) r.art = 'reserve';
          if ('bilder' in r || ['teile', 'lego_teile', 'sets', 'lego_sets'].includes(this.t)) r.bilder = r.bilder || (r.bild_url ? [r.bild_url] : []);
          const e = chkUniq(r); if (e) return { data: null, error: e };
          T.push(r); rows.push(r);
        }
      } else if (this.op === 'update') {
        rows = T.filter(match);
        for (const r of rows) { const nr = { ...r, ...this.payload }; const e = chkUniq(nr, r); if (e) return { data: null, error: e }; Object.assign(r, this.payload); }
      } else if (this.op === 'delete') { rows = T.filter(match); db[this.t] = T.filter(r => !match(r)); }
      save();
      rows = rows.map(r => this.expand(r));
      if (this.one) { if (!rows.length) return this.maybe ? { data: null, error: null } : { data: null, error: { message: 'no rows' } }; return { data: JSON.parse(JSON.stringify(rows[0])), error: null }; }
      return { data: JSON.parse(JSON.stringify(rows)), error: null };
    }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  }
  const user = { id: U, email: 'test@example.com' };
  window.supabase = {
    createClient: () => ({
      from: t => new Q(t),
      rpc: async name => (name === 'is_admin' ? { data: false, error: null } : { data: [], error: null }),
      auth: {
        getSession: async () => ({ data: { session: { user } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({}),
      },
      storage: {
        from: () => ({
          upload: async (path) => { db.storage.push(path); save(); return { data: { path }, error: null }; },
          remove: async (paths) => { db.removed.push(...paths); db.storage = db.storage.filter(p => !paths.includes(p)); save(); return { data: [], error: null }; },
          createSignedUrls: async (paths) => ({ data: paths.map(p => ({ path: p, signedUrl: svg(colorFor(p)) })), error: null }),
          createSignedUrl: async (p) => ({ data: { signedUrl: svg(colorFor(p)) }, error: null }),
        }),
      },
    }),
  };
})();
