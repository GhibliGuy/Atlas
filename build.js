// Rebuilds the public Atlas site from the live source in binxonia-research-collector/. Run this every time
// Atlas itself changes and you want the shared site to catch up - it always copies fresh, never hand-edited.
// It does NOT touch data/snapshot.json - that's build-snapshot.js's job, run separately.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'binxonia-research-collector');
const OUT = __dirname;

const CODE_FILES = ['page-edits.js', 'official-pois.js', 'game-data.js', 'game-recipes.js', 'atlas-core.js', 'atlas-live.js', 'atlas-layout.js', 'atlas-combo.js', 'atlas-menu.js', 'xp-curve.js', 'family-rules.js', 'atlas-community.js', 'atlas-splash.js', 'atlas-mobile.js', 'atlas-guides.js', 'atlas-tools.js', 'atlas-style.css'];
const VENDOR_FILES = ['vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/fonts/fonts.css', 'vendor/fonts/gloock-400.woff2', 'vendor/fonts/atkinson-400.woff2', 'vendor/fonts/atkinson-400-italic.woff2', 'vendor/fonts/atkinson-700.woff2'];

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
for (const f of VENDOR_FILES) { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.copyFileSync(path.join(SRC, f), path.join(OUT, f)); }

// The world map tile pyramid: self-hosted (see ../tools/download-map-tiles.js) instead of hotlinked from
// binxonia.com, at the game dev's own request. Static once downloaded, so this is a plain recursive copy, not
// something build-snapshot.js needs to touch.
fs.cpSync(path.join(SRC, 'tiles'), path.join(OUT, 'tiles'), { recursive: true });
// Pictures the guides use (img/events: the game's rifts, fallen giants and blooms, drawn by its own code).
fs.cpSync(path.join(SRC, 'img'), path.join(OUT, 'img'), { recursive: true });

// index.html is atlas.html itself, plus one injected line (window.BXC_PUBLIC=true, read once at the top of
// atlas-live.js) and one changed data-loading detail: fetch('data/snapshot.json') instead of a live bridge -
// atlas-live.js already knows to do this itself once PUBLIC_MODE is on, so nothing else here needs to differ.
//
// Every page's head starts with a <base> (page files sit at different depths, so their scripts and data load from the
// site's top folder), its title and link-preview tags (build-pages.js fills these in per page), then the flag that
// this is the website and the clean-address setup: the site's top folder (BXC_PATHS.root, from the <base>), an old
// #/... link turned into its clean address in place, and whether the address is a page of its own (BXC_DEEP: then
// the start page is skipped). Inside the app none of this runs (it loads atlas.html from a file, with #/... links).
const HEAD_SCRIPT = String.raw`<script>window.BXC_PUBLIC=true;(function(){try{if(!/^https?:$/.test(location.protocol))return;` +
  String.raw`var root=new URL(document.baseURI).pathname;window.BXC_PATHS={root:root};var h=location.hash;` +
  String.raw`if(/^#\//.test(h)){history.replaceState(null,"",root+h.slice(2)+(h.indexOf("?")<0?location.search:""))}` +
  String.raw`var p=location.pathname;p=p.indexOf(root)===0?p.slice(root.length):"";p=p.replace(/(^|\/)index\.html$/,"").replace(/\.html$/,"").replace(/\/$/,"");` +
  String.raw`window.BXC_DEEP=!!p}catch(e){}})();</script>`;
let html = fs.readFileSync(path.join(SRC, 'atlas.html'), 'utf8');
if (!html.includes('<title>Binxonia Atlas</title>')) throw new Error('atlas.html has no <title>Binxonia Atlas</title> to replace');
html = html.replace('<title>Binxonia Atlas</title>', '<!--bxc-head-->\n<base href="./">\n<title>Binxonia Atlas</title>\n<!--/bxc-head-->\n' + HEAD_SCRIPT);
if (FORBIDDEN_RE.test(html)) throw new Error('Refusing to build: atlas.html contains private text');
// Every script and stylesheet link carries a fingerprint of its file (atlas-live.js?v=<hash>): browsers keep GitHub
// Pages files for 10 minutes, so without it a visitor right after an update could run a new page with old code. A
// changed file gets a new address and is fetched fresh; an unchanged one keeps its fingerprint (no new page files).
const crypto = require('crypto');
for (const f of CODE_FILES.concat(VENDOR_FILES)) {
  const v = crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, f))).digest('hex').slice(0, 10);
  const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  html = html.replace(new RegExp(`((?:src|href)=")${esc}(?:\\?v=[0-9a-f]+)?(")`, 'g'), `$1${f}?v=${v}$2`);
}
fs.writeFileSync(path.join(OUT, 'index.html'), html);
// a page file for every guide, item, monster, person and cave, and the 404.html fallback (see build-pages.js)
const pagesDone = require('./build-pages.js').writePages(OUT);

console.log('Built atlas-public/ from', SRC);
console.log('Pages:', pagesDone.pages, 'listed,', pagesDone.changed, 'written,', pagesDone.removed, 'removed');
console.log('Copied:', CODE_FILES.concat(VENDOR_FILES).join(', '), 'and tiles/');
console.log('Wrote index.html (with window.BXC_PUBLIC=true)');
console.log('Note: data/snapshot.json was NOT touched - run build-snapshot.js separately to refresh data.');
