/* Layout only. Does not access or modify collected research data. */
(() => {
  const main = document.getElementById('main');
  const splitter = document.getElementById('splitter');
  const contentEl = document.getElementById('content');
  const storageKey = 'binxoniaAtlasSidebarWidth';
  let desiredWidth = 460, dragging = false;
  try { const n = Number(localStorage.getItem(storageKey)); if (n >= 300) desiredWidth = n; } catch {}
  const narrow = () => matchMedia('(max-width:760px)').matches;
  function resizeMap() { if (typeof map !== 'undefined') map.invalidateSize({pan:false}); }
  function applyWidth(value, save = false) {
    const max = Math.max(300, main.clientWidth - 332);
    const width = Math.round(Math.min(max, Math.max(300, value)));
    main.style.setProperty('--sidebar-width', width + 'px');
    splitter.setAttribute('aria-valuemin', '300');
    splitter.setAttribute('aria-valuemax', String(max));
    splitter.setAttribute('aria-valuenow', String(width));
    if (save) { desiredWidth = width; try { localStorage.setItem(storageKey, String(width)); } catch {} }
    resizeMap();
  }
  splitter.addEventListener('pointerdown', e => {
    if (e.button !== 0 || narrow()) return;
    dragging = true; splitter.setPointerCapture(e.pointerId); document.body.classList.add('resizing'); e.preventDefault();
  });
  splitter.addEventListener('pointermove', e => { if (dragging) applyWidth(e.clientX - main.getBoundingClientRect().left, true); });
  function stop() { dragging = false; document.body.classList.remove('resizing'); }
  splitter.addEventListener('pointerup', stop); splitter.addEventListener('pointercancel', stop); splitter.addEventListener('lostpointercapture', stop);
  splitter.addEventListener('keydown', e => {
    const current = Number(splitter.getAttribute('aria-valuenow'));
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); applyWidth(current + (e.key === 'ArrowRight' ? 24 : -24), true); }
    if (e.key === 'Home' || e.key === 'Enter') { e.preventDefault(); applyWidth(460, true); }
    if (e.key === 'End') { e.preventDefault(); applyWidth(main.clientWidth - 332, true); }
  });
  splitter.addEventListener('dblclick', () => applyWidth(460, true));
  const sections = {
    guides:['Guides','Guides','Written for players and filled from the game’s own data: skills, combat, gear and the world.'],
    map:['Explore','World map','Click anything on the map to see what it is.'],
    monsters:['Explore','Bestiary','Every creature, its weaknesses and drops. "Show on map" finds it.'],
    items:['Explore','Items','Every item seen so far, and where it comes from. "Show on map" circles its sources.'],
    resources:['Gathering','Resources','Select a resource to reveal every location your collector has observed it.'],
    gems:['Gathering','Gems','Where each gem comes from, what each carat does, and building bigger ones at the witch.'],
    zones:['Explore','Zones & caves','Named zones, cave layouts, and what has been observed inside each one.'],
    xp:['Calculators','Experience tables','Plan your next milestone with skill XP curves.'],
    'calc-crafting':['Calculators','Crafting XP','Plan your way to a goal level: what to make or gather, how many, and the materials.'],
    'calc-quality':['Calculators','Quality & enchanting','What quality you’ll get, whether you can enchant it yet, and which gems to use.'],
    'calc-gear':['Calculators','Gear & DPS','Your whole loadout and the damage a second it does against weak, neutral and resistant monsters.'],
    'calc-combat':['Calculators','Combat calculator','Kills to your goal: character level, weapon and magic skills.'],
    gemcombine:['Gathering','Gem combiner','What it costs to build a bigger gem at the witch, and what it ends up worth.'],
    feature:['Community','Request a feature','Tell us what the Atlas should do next.'],
    guide:['Community','Write a guide','Share what you know - good guides get added to the Atlas.'],
    research:['Research','Field observations','Explore the discoveries recorded by your collector.'],
    drops:['Research','Observed drops','Your growing record of loot and gathering rewards.'],
    assets:['Research','Artwork library','Monster and item artwork collected from the game.'],
    news:['Research','Binxonia News','The latest posts from binxonia.com/news.'],
    notes:['Research','Guide & coverage','Understand what is known and what remains unobserved.']
  };
  // The Bestiary, Items and Gems read like pages of a book now: no map beside them ("Show on map" goes to the map).
  const WIDE = new Set(['guides', 'monsters', 'items', 'gems', 'xp', 'calc-crafting', 'calc-quality', 'calc-combat', 'calc-gear', 'gemcombine', 'news', 'notes', 'assets', 'feature', 'guide']);
  function sectionHeading(button) {
    const item = button.dataset.ggroup ? ['Guides', button.textContent.trim(), 'Every guide in ' + button.textContent.trim() + ' - or see all guides.'] : sections[button.dataset.calc ? 'calc-' + button.dataset.calc : button.dataset.tab]; if (!item) return;
    document.getElementById('sectionTrail').textContent = 'Atlas / ' + item[0];
    document.getElementById('sectionTitle').textContent = item[1];
    document.getElementById('sectionDescription').textContent = item[2];
    document.querySelectorAll('.tab').forEach(b => { if (b === button) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
    // Planners and reading pages have nothing to show on the world map (and it was filling half the screen with
    // monsters and their levels) - they get the whole width instead; the map comes back on the field-guide pages.
    const key = button.dataset.calc ? 'calc-' + button.dataset.calc : button.dataset.tab;
    const view = key === 'map' ? 'mapfull' : WIDE.has(key) ? 'wide' : 'map';
    if (main.dataset.view !== view) { main.dataset.view = view; resizeMap(); }
    contentEl.scrollTop = 0;
  }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => sectionHeading(b)));
  sectionHeading(document.querySelector('.tab.on'));
  const statusLine = document.createElement('div'); statusLine.className = 'atlas-statusline';
  document.getElementById('bar').append(statusLine);
  for (const id of ['status','collectorStatus']) { const el = document.getElementById(id); if (el) statusLine.append(el); }
  function wrapTables() {
    contentEl.querySelectorAll('table').forEach(table => {
      if (table.parentElement.classList.contains('table-scroll')) return;
      const wrap = document.createElement('div'); wrap.className = 'table-scroll'; wrap.tabIndex = 0; wrap.setAttribute('role','region'); wrap.setAttribute('aria-label','Scrollable data table');
      table.before(wrap); wrap.append(table);
    });
  }
  new MutationObserver(wrapTables).observe(contentEl, {childList:true,subtree:true}); wrapTables();
  new ResizeObserver(() => { if (!dragging && !narrow()) applyWidth(desiredWidth); resizeMap(); }).observe(main);
  new ResizeObserver(resizeMap).observe(document.getElementById('map'));
  applyWidth(desiredWidth);
})();

/* Table columns, the same way everywhere: numbers and short values (levels, counts, percentages, dates) are centred
   under their heading - header and cells alike; names, links and longer text stay left. Decided per column from what
   it holds, so every table in the Atlas - guides, calculators, layouts - lines up the same. Label/value boxes (no
   headings) are left alone. Runs when a table appears or changes, once per change. */
(() => {
  const TABLES = 'table.g-table, table.research-table, table.qualitytable, table.xptable';
  const isText = td => !!td.querySelector('a, img, select, input, button') || (td.innerText || '').trim().length > 28;
  const numeric = s => /^[\s\d.,%×→·+\-−–()\/xc]*$/i.test(s);
  // a value may carry a short word ("24% back", "Short", "0.5c") and still be a value; real text is longer
  const letters = td => ((td.innerText || '').match(/[a-z]/gi) || []).length;
  const headOf = t => { const h = t.tHead && t.tHead.rows[0]; return h && [...h.cells].filter(th => th.textContent.trim()).length >= 2 ? h : null; };
  const colCells = (t, head, i) => [...t.tBodies].flatMap(b => [...b.rows]).map(r => r.cells.length === head.cells.length ? r.cells[i] : null).filter(Boolean);
  // Tables with the same headings on one page (the quests list, one per category) decide together, so a column is
  // centred in all of them or in none.
  function alignGroup(tables) {
    const head0 = headOf(tables[0]);
    [...head0.cells].forEach((th0, i) => {
      if (!th0.textContent.trim()) return;
      const all = tables.flatMap(t => colCells(t, headOf(t), i)), filled = all.filter(td => (td.innerText || '').trim());
      if (!filled.length) return;
      const texty = filled.filter(isText).length >= filled.length / 2;
      // the first column is a row's label unless it is plainly a number or a range ("67 → 74")
      const centre = !texty && filled.every(td => letters(td) <= 12) && (i > 0 || filled.every(td => numeric(td.innerText.trim())));
      for (const t of tables) { headOf(t).cells[i].classList.toggle('t-c', centre); for (const td of colCells(t, headOf(t), i)) td.classList.toggle('t-c', centre); }
    });
  }
  let queued = false;
  const run = () => {
    queued = false;
    const groups = new Map();
    for (const t of document.querySelectorAll(TABLES)) {
      const head = headOf(t); if (!head) continue;
      const key = [...head.cells].map(th => th.textContent.trim()).join('|');
      (groups.get(key) || groups.set(key, []).get(key)).push(t);
    }
    for (const tables of groups.values()) {
      // only when something changed: a new or re-drawn table, or more rows
      const sig = tables.map(t => [...t.tBodies].reduce((a, b) => a + b.rows.length, 0)).join(',');
      if (tables.every(t => t.dataset.alignSig === sig)) continue;
      alignGroup(tables); for (const t of tables) t.dataset.alignSig = sig;
    }
  };
  const queue = () => { if (!queued) { queued = true; setTimeout(run, 30); } };   // a timer, not a repaint: a hidden window never repaints
  // changes inside the map's own layers (markers moving on every pan and zoom) never hold a table
  new MutationObserver(muts => { if (muts.some(m => !(m.target.closest && m.target.closest('.leaflet-pane')))) queue(); }).observe(document.body, { childList: true, subtree: true });
  queue();
})();
