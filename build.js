// Rebuilds the public Atlas site from the live source in binxonia-research-collector/. Run this every time
// Atlas itself changes and you want the shared site to catch up - it always copies fresh, never hand-edited.
// It does NOT touch data/snapshot.json - that's build-snapshot.js's job, run separately.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'binxonia-research-collector');
const OUT = __dirname;

const CODE_FILES = ['official-pois.js', 'game-data.js', 'game-recipes.js', 'atlas-core.js', 'atlas-live.js', 'atlas-layout.js', 'atlas-combo.js', 'atlas-menu.js', 'xp-curve.js', 'family-rules.js', 'atlas-community.js', 'atlas-splash.js', 'atlas-mobile.js', 'atlas-guides.js', 'atlas-tools.js', 'atlas-style.css'];
const VENDOR_FILES = ['vendor/leaflet.js', 'vendor/leaflet.css'];

// Some app-only features are never published. Their pieces sit between /*<private>*/ and /*</private>*/ in the
// source and are cut out here; then every public file is checked against the patterns in the source folder's
// private-guard.json (kept there, unpublished), and the build stops - writing nothing - if any still match.
const PRIVATE_RE = /\/\*<private>\*\/[\s\S]*?\/\*<\/private>\*\//g;
const guardFile = path.join(SRC, 'private-guard.json');
if (!fs.existsSync(guardFile)) throw new Error('Refusing to build: ' + guardFile + ' is missing');
const FORBIDDEN_RE = new RegExp(JSON.parse(fs.readFileSync(guardFile, 'utf8')).patterns.join('|'), 'i');
const built = {};
for (const f of CODE_FILES) {
  const text = fs.readFileSync(path.join(SRC, f), 'utf8').replace(PRIVATE_RE, '');
  const hit = FORBIDDEN_RE.exec(text);
  if (hit) throw new Error(`Refusing to build: ${f} still contains private code near "${text.slice(Math.max(0, hit.index - 60), hit.index + 60)}" - wrap it in /*<private>*/ ... /*</private>*/`);
  built[f] = text;
}
for (const f of CODE_FILES) fs.writeFileSync(path.join(OUT, f), built[f]);
for (const f of VENDOR_FILES) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));

// The world map tile pyramid: self-hosted (see ../tools/download-map-tiles.js) instead of hotlinked from
// binxonia.com, at the game dev's own request. Static once downloaded, so this is a plain recursive copy, not
// something build-snapshot.js needs to touch.
fs.cpSync(path.join(SRC, 'tiles'), path.join(OUT, 'tiles'), { recursive: true });

// index.html is atlas.html itself, plus one injected line (window.BXC_PUBLIC=true, read once at the top of
// atlas-live.js) and one changed data-loading detail: fetch('data/snapshot.json') instead of a live bridge -
// atlas-live.js already knows to do this itself once PUBLIC_MODE is on, so nothing else here needs to differ.
let html = fs.readFileSync(path.join(SRC, 'atlas.html'), 'utf8');
if (!html.includes('BXC_PUBLIC')) {
  html = html.replace('<title>Binxonia Atlas</title>', '<title>Binxonia Atlas</title>\n<script>window.BXC_PUBLIC=true;</script>');
}
if (FORBIDDEN_RE.test(html)) throw new Error('Refusing to build: atlas.html contains private text');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

console.log('Built atlas-public/ from', SRC);
console.log('Copied:', CODE_FILES.concat(VENDOR_FILES).join(', '), 'and tiles/');
console.log('Wrote index.html (with window.BXC_PUBLIC=true)');
console.log('Note: data/snapshot.json was NOT touched - run build-snapshot.js separately to refresh data.');
