const { chromium } = require('/usr/local/lib/pnpm/5/.pnpm/playwright-core@1.59.1/node_modules/playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const results = []; const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, info ? JSON.stringify(info) : ''); };
(async () => {
  await new Promise(r => srv.listen(8769, r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route('**/vendor/supabase/supabase.min.js*', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const confirms = []; page.on('dialog', d => { confirms.push(d.message()); d.accept(); });
  const go = async h => { await page.evaluate(h => { location.hash = h; }, h); await page.waitForTimeout(450); };
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')));
  const B = 'http://localhost:8769/index.html';
  await page.goto(B + '#teile'); await page.evaluate(() => localStorage.removeItem('__mockdb')); await page.reload(); await page.waitForSelector('#list .item');
  const ids = await page.evaluate(() => {
    const U = window.__mock.U, db = window.__mock.db();
    window.__mock.addSets([
      { set_nummer: '3112 – Gefängnisfestung', notiz: 'Alt', bilder: [U + '/teile/p1.jpg'] }, { set_nummer: '3112' }, { set_nummer: '3112-A -', notiz: 'Karton fehlt', bilder: [U + '/teile/p2.jpg'] },
      { set_nummer: '4400' }, { set_nummer: '4400 – Post' }, { set_nummer: '3666', name: 'Burg als Set', art: 'set' },
      { set_nummer: '5581' }, { set_nummer: '5581 -' }, { set_nummer: '5581 Palast', name: 'anderes' }, { set_nummer: '9000', name: 'Einzeln' }]);
    const by = n => db.sets.find(s => s.set_nummer === n).id;
    db.teil_sets.push({ teil_id: 11, set_id: by('3112 – Gefängnisfestung'), user_id: U }, { teil_id: 11, set_id: by('3112'), user_id: U }, { teil_id: 12, set_id: by('3112-A -'), user_id: U });
    db.lego_sets.push({ id: 9031, set_nummer: '75192-1', name: null, art: 'reserve', bilder: [], jahr: 2017, user_id: U });
    db.lego_teil_sets.push({ teil_id: 41, set_id: 9031, user_id: U });
    localStorage.setItem('__mockdb', JSON.stringify(db));
    return { gef: by('3112 – Gefängnisfestung'), a: by('3112'), b: by('3112-A -'), p: by('5581 Palast') };
  });
  await page.reload(); await page.waitForSelector('#list .item');
  await go('#uebersicht'); ok('Übersicht has "Doppelte prüfen"', (await page.getAttribute('#dupBtn', 'href')) === '#doppelte');
  await page.click('#dupBtn'); await page.waitForSelector('#dupSum');
  const sum = async () => (await page.textContent('#dupSum')).replace(/\s+/g, ' ').trim();
  ok('groups found: 3112, 4400, 3666 (Reserve+Set), 5581', (await sum()).startsWith('4 Gruppen'), await sum());
  const grp = n => page.locator('.dupgroup', { hasText: 'Nummer ' + n });
  const g3666 = (await grp('3666').textContent()).replace(/\s+/g, ' ');
  ok('cross-kind group labelled with tab', g3666.includes('Reserve') && g3666.includes('Sets') && g3666.includes('Burg als Set'));
  const g = grp('3112');
  ok('group tiles show parts + photos count', (await g.locator('.item').count()) === 3 && (await g.textContent()).includes('1 Teile · 1 Fotos'));
  ok('default keeps best entry, suggests number+name', (await g.locator('input[type=radio]:checked').getAttribute('value')) === String(ids.gef) && (await g.locator('[data-f=nummer]').inputValue()) === '3112' && (await g.locator('[data-f=name]').inputValue()) === 'Gefängnisfestung');
  let d = await db(); const linksBefore = d.teil_sets.length, otherLinks = d.teil_sets.filter(x => ![ids.gef, ids.a, ids.b].includes(x.set_id)).length;
  await g.locator('[data-act=merge]').click(); await page.waitForTimeout(700);
  ok('confirm explains what happens', confirms[0] && confirms[0].includes('Bleibt erhalten') && confirms[0].includes('3112-A -') && confirms[0].includes('Kein Teil wird gelöscht'), confirms[0]);
  d = await db(); const keep = d.sets.find(s => s.id === ids.gef);
  ok('merged entries deleted, kept one updated', !d.sets.some(s => s.id === ids.a || s.id === ids.b) && keep.set_nummer === '3112' && keep.name === 'Gefängnisfestung', keep);
  ok('photos united (cover stays first), notes appended', JSON.stringify(keep.bilder.map(x => x.split('/').pop())) === '["p1.jpg","p2.jpg"]' && keep.notiz === 'Alt\nKarton fehlt', keep);
  const kl = d.teil_sets.filter(x => x.set_id === ids.gef).map(x => x.teil_id).sort();
  ok('no link loss, no duplicate links', JSON.stringify(kl) === '[11,12]' && d.teil_sets.length === linksBefore - 1 && d.teil_sets.filter(x => ![ids.gef].includes(x.set_id)).length === otherLinks, { kl, before: linksBefore, after: d.teil_sets.length });
  ok('group gone after merge', (await sum()).startsWith('3 Gruppen') && !(await grp('3112').count()));
  // Teil-Detail zeigt neuen Eintrag
  await go('#teil/12'); ok('part detail shows kept entry', (await page.textContent('main')).includes('3112 Gefängnisfestung'));
  // Teilweise: einen Eintrag ausnehmen
  await go('#doppelte'); const g5 = grp('5581'); const k5 = await page.evaluate(() => JSON.parse(localStorage.getItem('__mockdb')).sets.find(s => s.set_nummer === '5581').id);
  await g5.locator(`input[type=radio][value="${k5}"]`).check(); await g5.locator(`[data-inc="${ids.p}"]`).uncheck(); await g5.locator('[data-act=merge]').click(); await page.waitForTimeout(700);
  d = await db(); ok('unchecked entry is kept, others merged', d.sets.some(s => s.id === ids.p) && d.sets.filter(s => /^5581/.test(s.set_nummer)).length === 2 && d.sets.some(s => s.id === k5));
  // Nicht doppelt → bleibt weg (auch nach Neuladen)
  await grp('4400').locator('[data-act=ignore]').click(); await page.waitForTimeout(400);
  d = await db(); ok('dismissal saved', (d.dup_ignoriert || []).length === 1 && d.dup_ignoriert[0].bereich === 'playmobil');
  await grp('3666').locator('[data-act=skip]').click(); await page.waitForTimeout(200);
  ok('skip hides group for now', !(await grp('3666').count()) && (await sum()).includes('übersprungen'));
  await page.reload(); await page.waitForSelector('#dupSum');
  ok('dismissed group stays hidden after reload', !(await grp('4400').count()) && (await grp('5581').count()) === 1, await sum());
  // LEGO
  await go('#l/uebersicht'); ok('LEGO Übersicht has button', (await page.getAttribute('#dupBtn', 'href')) === '#l/doppelte');
  await go('#l/doppelte'); await page.waitForSelector('#dupSum');
  ok('LEGO: "75192" + "75192-1" grouped', (await sum()).startsWith('1 Gruppe'));
  await page.locator('.dupgroup [data-act=merge]').click(); await page.waitForTimeout(700);
  d = await db(); ok('LEGO merge keeps both part links', d.lego_sets.length === 1 && d.lego_teil_sets.filter(x => x.set_id === d.lego_sets[0].id).length === 1 && d.lego_teil_sets.length === 1, { s: d.lego_sets, l: d.lego_teil_sets });
  ok('no page errors', errs.length === 0, errs);
  fs.writeFileSync(path.join(__dirname, 'dupes-result.json'), JSON.stringify({ when: new Date().toISOString(), results }, null, 2));
  await browser.close(); srv.close();
  const failed = results.filter(r => !r.pass).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
