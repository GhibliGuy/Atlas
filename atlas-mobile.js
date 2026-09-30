/* The Atlas on a phone. Runs only when atlas.html's head marked the page as mobile (html.bxm: a touch screen phone,
   or ?mobile=1 to try it; ?mobile=0 turns it off, remembered). Everything else in the Atlas is unchanged: this adds a
   compact top bar, a bottom bar for the places people go most, and a full-screen menu with every section - each entry
   simply clicks the Atlas's own section button, so routing, Back and live updates work exactly as on the desktop. */
(() => {
  const root = document.documentElement;
  if (!root.classList.contains('bxm') || window.__bxcMobile) return;
  window.__bxcMobile = true;
  const $ = s => document.querySelector(s);
  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    map: svg('<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>'),
    beast: svg('<circle cx="7" cy="8" r="1.8"/><circle cx="12" cy="6" r="1.8"/><circle cx="17" cy="8" r="1.8"/><path d="M8 14.5c1-2.2 2.4-3.3 4-3.3s3 1.1 4 3.3c.8 1.8-.2 3.8-2 3.8-.8 0-1.3-.4-2-.4s-1.2.4-2 .4c-1.8 0-2.8-2-2-3.8z"/>'),
    items: svg('<path d="M5 9h14l-1.2 10.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z"/><path d="M9 9V7a3 3 0 0 1 6 0v2"/>'),
    guides: svg('<path d="M4 5.5C6.5 4.3 9.3 4.3 12 6c2.7-1.7 5.5-1.7 8-.5v13c-2.5-1.2-5.3-1.2-8 .5-2.7-1.7-5.5-1.7-8-.5z"/><path d="M12 6v13"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>')
  };

  // ---- top bar: the Atlas's own Back, the name (to Home), search and the theme switch ----
  const bar = $('#bar');
  const brand = bar && bar.querySelector(':scope>b');
  if (brand) { brand.setAttribute('role', 'button'); brand.tabIndex = 0; brand.title = 'Home';
    const home = () => { if (window.bxcSplash) window.bxcSplash.open(); };
    brand.addEventListener('click', home); brand.addEventListener('keydown', e => { if (e.key === 'Enter') home(); }); }
  const searchBtn = document.createElement('button');
  searchBtn.type = 'button'; searchBtn.className = 'm-iconbtn'; searchBtn.id = 'mSearchBtn'; searchBtn.setAttribute('aria-label', 'Search'); searchBtn.innerHTML = ICON.search;
  bar && bar.append(searchBtn);
  searchBtn.addEventListener('click', () => {
    const on = !bar.classList.contains('m-searching');
    bar.classList.toggle('m-searching', on);
    searchBtn.innerHTML = on ? ICON.close : ICON.search;
    searchBtn.setAttribute('aria-label', on ? 'Close search' : 'Search');
    const q = $('#q'); if (on && q) setTimeout(() => q.focus(), 30);
    else if (q) { q.blur(); if (q.value) { q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); } }   // closing search clears it, so its results go too
  });

  // ---- bottom bar ----
  const TABS = [
    ['map', 'Map', '.tab[data-tab="map"]'],
    ['beast', 'Bestiary', '.tab[data-tab="monsters"]'],
    ['items', 'Items', '.tab[data-tab="items"]'],
    ['guides', 'Guides', '.tab[data-tab="guides"]:not([data-ggroup]):not([data-gpage])'],
    ['menu', 'Menu', null]
  ];
  const nav = document.createElement('nav');
  nav.className = 'm-tabbar'; nav.setAttribute('aria-label', 'Atlas');
  nav.innerHTML = TABS.map(([ic, label, sel], i) => `<button type="button" data-i="${i}"${sel ? '' : ' aria-haspopup="dialog"'}>${ICON[ic]}<span>${label}</span></button>`).join('');
  document.body.append(nav);
  const go = sel => { const b = document.querySelector(sel); if (!b) return; if (window.bxcSplash) window.bxcSplash.close(); closeMenu(); b.click(); window.scrollTo(0, 0); };
  nav.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; const t = TABS[+b.dataset.i]; if (t[2]) go(t[2]); else openMenu(); });

  // which bottom entry is lit: the section showing (nothing while the Home page is open)
  function paint() {
    const splash = document.getElementById('atlasSplash'), home = splash && !splash.hidden && getComputedStyle(splash).display !== 'none';
    const cur = document.querySelector('nav.tabs .tab.on:not(.bxc-menu-btn)');
    nav.querySelectorAll('button[data-i]').forEach(b => { const t = TABS[+b.dataset.i]; b.classList.toggle('on', !home && !!t[2] && !!cur && cur.matches(t[2])); });
  }
  addEventListener('hashchange', () => setTimeout(paint, 60));
  document.addEventListener('click', () => setTimeout(paint, 60), true);
  new MutationObserver(() => paint()).observe(document.body, { childList: true });

  // ---- menu: every section, grouped as the desktop menus are, plus Home and the theme ----
  const sheet = document.createElement('div');
  sheet.className = 'm-menu'; sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'All sections');
  document.body.append(sheet);
  function buildMenu() {
    const groups = [...document.querySelectorAll('nav.tabs .nav-group')].map(g => {
      const label = (g.querySelector('.nav-label') || {}).textContent || '';
      let html = '', head = null;
      g.querySelectorAll('.tab:not(.bxc-menu-btn)').forEach((b, i) => {
        const h = b.dataset.menuGroup || null;
        if (h && h !== head) html += `<p class="m-sub">${h}</p>`;
        head = h;
        html += `<button type="button" class="m-item${b.classList.contains('on') ? ' on' : ''}" data-g="${[...document.querySelectorAll('nav.tabs .nav-group')].indexOf(g)}" data-b="${i}">${b.textContent.trim()}</button>`;
      });
      return `<section><h2>${label}</h2>${html}</section>`;
    }).join('');
    sheet.innerHTML = `<div class="m-menu-head"><b>Binxonia Atlas</b><button type="button" class="m-iconbtn" data-close aria-label="Close menu">${ICON.close}</button></div>
      <div class="m-menu-body"><section><button type="button" class="m-item" data-home>Home</button><button type="button" class="m-item" data-mtheme>${root.dataset.theme === 'light' ? 'Dark mode' : 'Light mode'}</button></section>${groups}
      <p class="m-foot">On a computer the Atlas shows the map beside every page. <a href="?mobile=0">Use the desktop layout here</a></p></div>`;
  }
  function openMenu() { buildMenu(); sheet.hidden = false; root.classList.add('m-menu-open'); const f = sheet.querySelector('.m-item.on') || sheet.querySelector('[data-close]'); f && f.focus({ preventScroll: true }); }
  function closeMenu() { if (sheet.hidden) return; sheet.hidden = true; root.classList.remove('m-menu-open'); }
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return closeMenu();
    if (e.target.closest('[data-home]')) { closeMenu(); if (window.bxcSplash) window.bxcSplash.open(); return; }
    if (e.target.closest('[data-mtheme]')) { closeMenu(); const t = document.getElementById('themeToggle'); if (t) t.click(); return; }
    const it = e.target.closest('.m-item[data-g]'); if (!it) return;
    const g = document.querySelectorAll('nav.tabs .nav-group')[+it.dataset.g], b = g && g.querySelectorAll('.tab:not(.bxc-menu-btn)')[+it.dataset.b];
    if (!b) return;
    if (window.bxcSplash) window.bxcSplash.close();
    closeMenu(); b.click(); window.scrollTo(0, 0);
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); if (bar.classList.contains('m-searching')) searchBtn.click(); } });
  // a search result or any section change closes the search row
  document.addEventListener('click', e => { if (bar.classList.contains('m-searching') && e.target.closest('#content,.m-tabbar,.combo-list,[role="listbox"]') && !e.target.closest('#q')) setTimeout(() => { if (document.activeElement !== $('#q')) { bar.classList.remove('m-searching'); searchBtn.innerHTML = ICON.search; } }, 120); });

  // Gear & DPS: its results sit below all the boxes on a phone, so a small readout above the bottom bar keeps the
  // neutral damage a second in view while you change things; tapping it jumps to the full results
  const pill = document.createElement('button');
  pill.type = 'button'; pill.className = 'm-dps'; pill.hidden = true;
  document.body.append(pill);
  pill.addEventListener('click', () => { const a = document.getElementById('gpAside'); if (a) a.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  let pillT = 0;
  function pillPaint() {
    const out = document.getElementById('gpOut'), n = out && [...out.querySelectorAll('.gp-c')].find(c => /Neutral/.test(c.textContent));
    const v = n && n.querySelector('b');
    pill.hidden = !v;
    if (v) pill.innerHTML = '<span>Damage a second</span> <b>' + v.textContent + '</b> <span>neutral ↓</span>';
  }
  new MutationObserver(() => { clearTimeout(pillT); pillT = setTimeout(pillPaint, 120); }).observe(document.getElementById('content') || document.body, { childList: true, subtree: true, characterData: true });
  // hidden while the full results are on screen
  addEventListener('scroll', () => { const a = document.getElementById('gpAside'); if (!a || pill.hidden && !document.getElementById('gpOut')) return; const r = a.getBoundingClientRect(); pill.classList.toggle('m-away', r.top < innerHeight - 80 && r.bottom > 100); }, { passive: true });

  // the map needs to know when its box changes size (bars, rotation)
  const fixMap = () => { try { if (typeof map !== 'undefined') map.invalidateSize({ pan: false }); } catch {} };
  addEventListener('orientationchange', () => setTimeout(fixMap, 300));
  addEventListener('resize', () => setTimeout(fixMap, 100));
  paint();
})();
