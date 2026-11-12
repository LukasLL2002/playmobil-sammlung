const { chromium } = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const results = []; const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, info ? JSON.stringify(info) : ''); };
const FX = require('./make-fixtures')();
const XLSXJS = fs.readFileSync(FX + '/xlsx.full.min.js', 'utf8');
const SHOT = path.join(__dirname, 'layout');
fs.mkdirSync(SHOT, { recursive: true });
// Prüft: kein waagrechtes Überlaufen, kein Text-Element schmaler als 80px, Dialog ≤ 90% Höhe, Knöpfe sichtbar
const LAYOUT = (sel) => {
  const W = innerWidth, H = innerHeight, root = document.querySelector(sel); const bad = [];
  if (!root) return { missing: sel };
  if (document.documentElement.scrollWidth > W + 1) bad.push({ kind: 'page-overflow', sw: document.documentElement.scrollWidth });
  const vis = el => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const rr = root.getBoundingClientRect();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (!vis(el) || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    const clipped = (() => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { const ar = a.getBoundingClientRect(); return ar.right <= W + 1 && ar.left >= -1; } } return false; })();
    if (!clipped && (r.right > W + 1 || r.left < -1)) bad.push({ kind: 'overflow', el: el.tagName + '.' + el.className, l: Math.round(r.left), r: Math.round(r.right) });
    if (root.tagName === 'DIALOG' && (r.right > rr.right + 1 || r.left < rr.left - 1)) bad.push({ kind: 'dlg-overflow', el: el.tagName + '.' + el.className });
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
    const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3;
    // „gequetscht“: schmaler als 80px UND der Text passt nicht in eine Zeile (bricht um)
    if (txt.length >= 6 && /[A-Za-zÄÖÜäöü]{3}/.test(txt) && r.width < 80 && r.height > lh * 1.6) bad.push({ kind: 'narrow-text', el: el.tagName + '.' + el.className, w: Math.round(r.width), txt: txt.slice(0, 30) });
  }
  if (root.tagName === 'DIALOG') {
    if (rr.height > H * 0.9 + 2 && H > 480) bad.push({ kind: 'dlg-too-tall', h: Math.round(rr.height), H });
    if (rr.bottom > H + 1) bad.push({ kind: 'dlg-offscreen', b: Math.round(rr.bottom) });
    const bt = root.querySelector('.dlgbtns'); if (bt) { const b = bt.getBoundingClientRect(); if (b.bottom > rr.bottom + 1 || b.top < rr.top) bad.push({ kind: 'buttons-not-visible' }); }
  }
  return { bad: bad.slice(0, 8), n: bad.length };
};
const SIZES = [[320, 640], [360, 740], [390, 844], [412, 915], [740, 360]];
(async () => {
  await new Promise(r => srv.listen(8771, r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, serviceWorkers: 'block', isMobile: true, hasTouch: true });
    await ctx.route('**/vendor/supabase/supabase.min.js*', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
    await ctx.route('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/**', r => r.fulfill({ contentType: 'text/javascript', body: XLSXJS }));
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    page.on('dialog', d => d.accept());
    const go = async hh => { await page.evaluate(hh => { location.hash = hh; }, hh); await page.waitForTimeout(400); };
    const check = async (name, sel, shot) => { const r = await page.evaluate(LAYOUT, sel); if (shot) await page.screenshot({ path: path.join(SHOT, `${shot}-${tag}.png`) }); ok(`${tag} ${name}: no overflow, no squeezed text`, !r.missing && r.n === 0, r); };
    await page.goto('http://localhost:8771/index.html#teile'); await page.evaluate(() => localStorage.removeItem('__mockdb')); await page.reload(); await page.waitForSelector('#list .item');
    await page.evaluate(() => { const U = window.__mock.U, db = window.__mock.db();
      window.__mock.addSets([{ set_nummer: '3112 – Gefängnisfestung', bilder: [U + '/teile/p1.jpg'] }, { set_nummer: '3112-A -' }, { set_nummer: '3112', name: 'Königlicher Sammlerschatz mit sehr langem Namen' },
        { set_nummer: '3022', name: 'Königlicher Saal' }, { set_nummer: '3022 – Burg' }]);
      const by = n => db.sets.find(s => s.set_nummer === n).id;
      db.teil_sets.push({ teil_id: 11, set_id: by('3112'), user_id: U }); localStorage.setItem('__mockdb', JSON.stringify(db)); });
    await page.reload(); await page.waitForSelector('#list .item');
    // 1) Duplikat-Rückfrage
    await go('#reserve'); await page.click('#ns'); await page.fill('dialog[open] [name=set_nummer]', '3112 test'); await page.click('dialog[open] button[type=submit]');
    await page.waitForSelector('.dupdlg[open]');
    await check('duplicate prompt', '.dupdlg[open]', 'prompt');
    const info = await page.$$eval('.dupdlg [data-dup]', a => a.map(x => { const i = x.querySelector('.info').getBoundingClientRect(), t = x.querySelector('.thumb').getBoundingClientRect(), r = x.querySelector('input[type=radio]')?.getBoundingClientRect();
      return { info: Math.round(i.width), thumb: Math.round(t.width), radio: r ? Math.round(r.width) : 0, row: r ? r.right <= t.left + 1 && t.right <= i.left + 1 : false }; }));
    ok(`${tag} candidate tiles: radio | 48px thumb | text`, info.length === 3 && info.every(x => x.row && x.thumb === 48 && x.radio < 30 && x.info >= 120), info);
    const lines = await page.$eval('.dupdlg [data-dup] .title', e => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight || 20)));
    ok(`${tag} tile title is not one char per line`, lines <= 4, lines);
    await page.click('.dupdlg [data-no]'); await page.click('dialog[open] [data-cancel]').catch(() => {}); await page.waitForTimeout(200);
    // 2) Doppelte prüfen
    await go('#doppelte'); await page.waitForSelector('.dupgroup');
    await check('duplicate review', 'main', 'doppelte');
    await page.evaluate(() => document.querySelector('.dupgroup [data-act=merge]').scrollIntoView({ block: 'end' })); await page.screenshot({ path: path.join(SHOT, `doppelte-gruppe-${tag}.png`) });
    const fw = await page.$$eval('.dupgroup:first-of-type [data-f]', a => a.map(x => Math.round(x.getBoundingClientRect().width)));
    ok(`${tag} Nummer/Name danach wide enough`, fw.every(x => x >= (w < 521 ? w - 80 : 200)), fw);
    // 3) Reiter umbenennen
    await go('#uebersicht'); await page.click('#renTabs'); await page.waitForSelector('dialog[open]');
    await check('tab rename dialog', 'dialog[open]', w === 390 ? 'rename' : null);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    // 4) Teil-Suche (Ergebnisse)
    await go('#kisten'); await go('#teil/neu'); await page.click('#nrSearch'); await page.waitForSelector('.psdlg');
    await page.fill('.psdlg #psq', 'Topfhelm'); await page.click('.psdlg #psGo'); await page.waitForSelector('.psdlg [data-pick]');
    await check('part search results', '.psdlg', w === 390 ? 'teilsuche' : null);
    await page.click('.psdlg #psClose'); await page.waitForTimeout(200);
    // 5) Import-Prüfung
    await go('#kisten'); await go('#import'); await page.setInputFiles('#file', FX + '/teile-5blaetter.xlsx'); await page.waitForSelector('[data-sheet]', { timeout: 15000 });
    await check('import sheet choice', 'main', null);
    await page.click('#go'); await page.waitForSelector('#revSum');
    await check('import review', 'main', w === 390 || w === 320 ? 'import' : null);
    ok(`${tag} no page errors`, !errs.length, errs);
    await ctx.close();
  }
  await browser.close(); srv.close();
  fs.writeFileSync(path.join(__dirname, 'layout-result.json'), JSON.stringify(results, null, 1));
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
