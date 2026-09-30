// Turns a full collector export (the same JSON the app's own "Export data" button produces) into the trimmed
// data/snapshot.json the public Atlas actually fetches. Run manually for now:
//   node build-snapshot.js path/to/binxonia-collector-2026-xx-xx.json
//
// What gets left out and why: gathers, exp, crafts, skillObservations, enchantments are your own personal
// play-activity history, not general game knowledge, and sessions/http/events/messageTypes/selfState are
// internal/diagnostic or directly identify your current character - none of that belongs on a public site.
// Everything else is "what does the world look like" data: monster locations, resources, zones, drops, gems,
// item/skill catalogs, and captured art - the things Atlas's read-only tabs actually need.
'use strict';
const fs = require('fs');
const path = require('path');

const INCLUDE_STORES = [
  'npcs', 'npcObservations', 'worldObjects', 'gems', 'skills', 'inventoryTypes',
  'assets', 'drops', 'zones', 'terrain', 'zoneTransitions', 'manualResources', 'regions',
];

const inPath = process.argv[2];
if (!inPath) {
  console.error('Usage: node build-snapshot.js path/to/export.json');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
if (raw.format !== 'binxonia-research-collector' || !raw.stores) {
  console.error('That does not look like a collector export (expected {format, stores}).');
  process.exit(1);
}

const out = { schemaVersion: raw.schemaVersion || 2, generatedAt: new Date().toISOString(), stats: {} };
let totalIn = 0, totalOut = 0;
for (const store of INCLUDE_STORES) {
  const rows = Array.isArray(raw.stores[store]) ? raw.stores[store] : [];
  out[store] = rows;
  out.stats[store] = rows.length;
  totalOut += rows.length;
}
for (const store of Object.keys(raw.stores)) totalIn += (raw.stores[store] || []).length;

const outPath = path.join(__dirname, 'data', 'snapshot.json');
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${outPath}`);
console.log(`Included ${INCLUDE_STORES.length} stores, ${totalOut.toLocaleString()} records (source export had ${totalIn.toLocaleString()} records across all stores).`);
console.log('Included:', INCLUDE_STORES.join(', '));
const excluded = Object.keys(raw.stores).filter(s => !INCLUDE_STORES.includes(s));
console.log('Excluded:', excluded.join(', '));
