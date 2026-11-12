// Erzeugt die Testdateien (Excel/ODS, Bilder) in test-harness/fixtures – wird von den Tests automatisch aufgerufen.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), { execFileSync } = require('child_process');
const DIR = path.join(__dirname, 'fixtures');
module.exports = function makeFixtures() {
  fs.mkdirSync(DIR, { recursive: true });
  const lib = path.join(DIR, 'xlsx.full.min.js');
  if (!fs.existsSync(lib)) execFileSync('curl', ['-sSfL', '-o', lib, 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js']);
  const XLSX = require(lib);
  const H = ['Teile-Nr.', 'Farbe', 'Beschreibung', 'Anzahl', 'Preis', 'Set'];
  const rows = changed => ({
    '0-9': [H, ['30 01 0001', 'silber', '1. Ritterhelm', changed ? 5 : 2, 0.5, '3666'], ['---', '---', 'Bart', 1, '', '']],
    'A-G': [H, ['30 02 0002', 'braun', 'Gürtel', 1, 0.2, '3347; 3348'], ['30 03 0003', 'grau', 'Ritter', 1, 1, '3666'], ['20 30 3000', 'grün', 'Zaun', changed ? 6 : 4, 0.3, ''], ['30 04 0004', 'gold', 'Helm', 1, 0.4, '']],
    'H-M': [['30 05 0005', 'rot', 'Schild', 1, 0.6, '']],
    'N-S': [['30 03 0003', 'grau', 'Ritter', 1, 1, '4000'], ['30 06 0006', 'blau', 'Lanze', 1, 0.3, '']],
    'T-Z': [['30 07 0007', 'weiß', 'Umhang', 1, 0.8, '']],
  });
  const book = changed => { const wb = XLSX.utils.book_new(); for (const [n, r] of Object.entries(rows(changed))) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(r), n); return wb; };
  const w = (f, wb, t) => { const p = path.join(DIR, f); if (!fs.existsSync(p)) fs.writeFileSync(p, XLSX.write(wb, { type: 'buffer', bookType: t })); };
  w('teile-5blaetter.xlsx', book(false), 'xlsx');
  w('teile-5blaetter.ods', book(false), 'ods');
  w('teile-5blaetter-geaendert.xlsx', book(true), 'xlsx');
  // kleine einfarbige PNGs
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const png = ([r, g, b]) => { const W = 32, ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(W, 4); ih[8] = 8; ih[9] = 2;
    const raw = Buffer.alloc((W * 3 + 1) * W); for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) raw.set([r, g, b], y * (W * 3 + 1) + 1 + x * 3);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };
  for (const [n, c] of [['img-red.png', [220, 30, 30]], ['img-green.png', [30, 160, 60]], ['img-blue.png', [30, 80, 200]]]) { const p = path.join(DIR, n); if (!fs.existsSync(p)) fs.writeFileSync(p, png(c)); }
  return DIR;
};
if (require.main === module) console.log(module.exports());
