// Gives every Atlas page a real address on the website: /Atlas/item/gold-saw instead of /Atlas/#/item/gold-saw.
// GitHub Pages only serves files, so each page gets a small file of its own (item/gold-saw.html - GitHub serves it at
// the address without ".html"): the Atlas itself with that page's name and description in its head, so a pasted link
// shows them, and a <base> back to the site's top folder so its scripts and data load from any depth. Anything without
// a file of its own (a map spot, a monster recorded since the last publish) is caught by 404.html - the same Atlas,
// which reads the address and opens the page. Run by build.js and by the app's data publish (main.js), so new monsters,
// items and quests get their page as soon as they are published. Files only change when a page's name changes.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = 'https://ghibliguy.github.io/Atlas/';
const PAGE_DIRS = ['guide', 'item', 'monster', 'npc', 'zone'];   // each written in full every time
const okId = id => /^-?[a-z0-9][a-z0-9._-]*$/i.test(String(id));
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pretty = s => String(s || '').replaceAll('-', ' ').replace(/\bammy\b/gi, 'pendant').replace(/\b\w/g, c => c.toUpperCase());
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clip = (s, n = 200) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

function readJs(file, name) {
  const ctx = { globalThis: {} };
  try { vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx, { timeout: 5000 }); } catch { return null; }
  return ctx.globalThis[name] || null;
}
function readData(outDir) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(outDir, 'data', 'snapshot.json'), 'utf8')); } catch {}
  const part = k => {
    const p = s[k] && s[k].part; if (!p) return Array.isArray(s[k]) ? s[k] : [];
    try { const v = JSON.parse(fs.readFileSync(path.join(outDir, 'data', p), 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  return { quests: Array.isArray(s.quests) ? s.quests : [], zones: Array.isArray(s.zones) ? s.zones : [], npcs: part('npcs'), inventoryTypes: part('inventoryTypes') };
}

// every page: [route (the part after /Atlas/), title, description]
function pageList(outDir) {
  const pages = new Map();
  const add = (route, title, desc) => { if (!pages.has(route)) pages.set(route, [title, clip(desc)]); };
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  const menuGuides = [];
  // the sections in the menu
  for (const m of html.matchAll(/<button[^>]*class="tab[^"]*"[^>]*>[^<]*/g)) {
    const t = m[0], label = t.replace(/^.*>/, '').trim().replace(/&amp;/g, '&');
    const tab = (t.match(/data-tab="([^"]+)"/) || [])[1], calc = (t.match(/data-calc="([^"]+)"/) || [])[1];
    const grp = (t.match(/data-ggroup="([^"]+)"/) || [])[1], gpage = (t.match(/data-gpage="([^"]+)"/) || [])[1];
    if (!label) continue;
    if (calc) add('calc-' + calc, label, `${label} calculator for Binxonia.`);
    else if (grp) add('guides-' + grp, label + ' guides', `Binxonia guides: ${label}.`);
    else if (gpage) { menuGuides.push([gpage, label]); continue; }   // a guide; listed below with its blurb (or, if only the menu names it, after them)
    else if (tab) add(tab, label, `${label} - the Binxonia Atlas.`);
  }
  // the written guides (atlas-guides.js registers each with a slug, title and blurb)
  const guides = fs.readFileSync(path.join(outDir, 'atlas-guides.js'), 'utf8');
  for (const m of guides.matchAll(/reg\(\{slug:'([^']+)'[^}]*?title:'((?:[^'\\]|\\.)*)'(?:[^}]*?blurb:'((?:[^'\\]|\\.)*)')?/g))
    add('guide/' + m[1], m[2].replace(/\\'/g, "'"), (m[3] || '').replace(/\\'/g, "'"));
  for (const [g, label] of menuGuides) add('guide/' + g, label, `${label} - a Binxonia Atlas guide.`);
  const data = readData(outDir);
  // quests (their pages are guide/quest-<id>)
  for (const q of data.quests) if (q && q.name && q.questId && !q.questId.startsWith('__'))
    add('guide/quest-' + slug(q.questId), q.name + ' (quest)', q.lore || `How to do the quest ${q.name} in Binxonia.`);
  // monsters, as the game defines them
  const game = readJs(path.join(outDir, 'game-data.js'), 'BXC_GAME_DATA') || {};
  const typeName = new Map();
  for (const m of game.monsters || []) if (m && m.typeId) {
    typeName.set(m.typeId, String(m.name || '').toLowerCase());
    if (okId(m.typeId)) add('monster/' + m.typeId, m.name || pretty(m.typeId), `${m.name || pretty(m.typeId)}${m.baseLevel ? ', level ' + m.baseLevel : ''}: where it lives, what it drops and how to fight it.`);
  }
  // named people (a name that is not just their kind's name), as the Atlas lists them
  for (const n of data.npcs) {
    const name = String((n && n.name) || '').trim(); if (!name || !n.typeId) continue;
    const plain = typeName.get(n.typeId) || String(n.typeId).replace(/-/g, ' ');
    if (name.toLowerCase() === plain || name.toLowerCase() === String(n.typeId).replace(/-/g, ' ')) continue;
    const s = slug(name); if (s) add('npc/' + s, name, `${name}: where to find them in Binxonia.`);
  }
  // items: every recipe, and everything seen in a bag
  const recipes = readJs(path.join(outDir, 'game-recipes.js'), 'BXC_GAME_RECIPES') || {};
  for (const r of recipes.recipes || []) if (r && r.id && okId(r.id)) add('item/' + r.id, r.name || pretty(r.id), `${r.name || pretty(r.id)}: how to make it, what it needs and what it is used for.`);
  for (const t of data.inventoryTypes) if (t && t.typeId && okId(t.typeId)) add('item/' + t.typeId, pretty(t.typeId), `${pretty(t.typeId)}: where it comes from and what it is used for.`);
  // caves, mines and buildings
  for (const z of data.zones) if (z && Number.isFinite(z.z) && z.z !== 0 && z.name) add('zone/' + z.z, z.name, `${z.name}: its layout, monsters and resources.`);
  // (a section named like a page folder - "guide", the Write-a-guide form - is left to 404.html: a file and a folder
  // of one name would fight over the address)
  return [...pages].filter(([r]) => r.split('/').every(okId) && !PAGE_DIRS.includes(r)).map(([route, [title, desc]]) => ({ route, title, desc }));
}

// the Atlas page with a page's own head
function pageHtml(template, base, p) {
  const title = p ? `${p.title} - Binxonia Atlas` : 'Binxonia Atlas';
  const desc = p ? p.desc : 'A field guide to the living world of Binxonia: monsters, items, resources, quests and maps.';
  const url = SITE + (p ? p.route : '');
  const head = `<base href="${esc(base)}">\n<title>${esc(title)}</title>\n<meta name="description" content="${esc(desc)}">\n` +
    `<meta property="og:title" content="${esc(title)}">\n<meta property="og:description" content="${esc(desc)}">\n<meta property="og:url" content="${esc(url)}">\n` +
    `<meta property="og:site_name" content="Binxonia Atlas">\n<link rel="canonical" href="${esc(url)}">`;
  return template.replace(/<!--bxc-head-->[\s\S]*?<!--\/bxc-head-->/, `<!--bxc-head-->\n${head}\n<!--/bxc-head-->`);
}

function writeIfChanged(file, text) {
  let old = null; try { old = fs.readFileSync(file, 'utf8'); } catch {}
  if (old !== text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return 1; }
  return 0;
}

function writePages(outDir, opts = {}) {
  const siteBase = opts.siteBase || '/Atlas/';
  const template = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  if (!template.includes('<!--bxc-head-->')) throw new Error('index.html has no <!--bxc-head--> block; run build.js');
  const pages = pageList(outDir);
  let changed = 0;
  // the fallback: any address without a file of its own
  changed += writeIfChanged(path.join(outDir, '404.html'), pageHtml(template, siteBase, null));
  // sections at the top level (monsters.html), the rest in their folder (item/gold-saw.html); a folder's old pages
  // that are no longer listed are removed
  const keep = new Set();
  for (const p of pages) {
    const file = path.join(outDir, ...p.route.split('/')) + '.html'; keep.add(path.resolve(file));
    changed += writeIfChanged(file, pageHtml(template, '../'.repeat(p.route.split('/').length - 1) || './', p));
  }
  let removed = 0;
  for (const d of PAGE_DIRS) {
    const dir = path.join(outDir, d); if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) { const file = path.resolve(dir, f); if (f.endsWith('.html') && !keep.has(file)) { fs.unlinkSync(file); removed++; } }
  }
  const tops = pages.filter(p => !p.route.includes('/')).map(p => p.route + '.html');
  const listFile = path.join(outDir, 'data', 'pages.json');
  let oldTops = []; try { oldTops = JSON.parse(fs.readFileSync(listFile, 'utf8')).top || []; } catch {}
  for (const f of oldTops) if (!tops.includes(f)) { try { fs.unlinkSync(path.join(outDir, f)); removed++; } catch {} }
  changed += writeIfChanged(listFile, JSON.stringify({ top: tops }) + '\n');
  return { pages: pages.length, changed, removed };
}

module.exports = { writePages, pageList };
if (require.main === module) console.log(writePages(__dirname));
