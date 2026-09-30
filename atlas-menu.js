// Atlas: the rows of section buttons become menus, the way the browser's own bar does it. Each group (Explore, Gathering,
// Calculators, Research, and the calculator subtabs) collapses to one button that opens a list floating over everything.
// The real buttons stay in the page, hidden, so the rest of the Atlas keeps clicking and marking them exactly as before.
(() => {
  'use strict';
  if (window.__bxcMenus) return;
  window.__bxcMenus = true;

  const css = `
nav.tabs{flex-wrap:wrap;align-items:center}
.bxc-menued > .tab:not(.bxc-menu-btn),.bxc-menued > .calcsubtab:not(.bxc-menu-btn),.bxc-menued > .nav-label{display:none !important}
.bxc-menued{display:inline-flex;align-items:center;margin:0}
.bxc-menu-btn{width:auto;margin:0;padding:7px 13px 7px 11px;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;cursor:pointer}
.bxc-menu-btn .bxc-menu-pick{color:#f0c27b;font-weight:700}
.bxc-menu-btn .bxc-menu-caret{font-size:10px;opacity:.75;margin-left:1px}
.bxc-menu-btn.open{background:#6d4c2e;border-color:#c59a5e}
#bxc-menu-pop{position:fixed;z-index:2147483646;display:none;overflow:auto;box-sizing:border-box;min-width:170px;padding:4px;
  background:#15110e;border:1px solid #c59a5e;border-radius:8px;box-shadow:0 10px 26px rgba(0,0,0,.6);
  font:13px 'Segoe UI',Arial,sans-serif;color:#e8e0d2}
#bxc-menu-pop div{padding:7px 11px;border-radius:5px;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:8px}
#bxc-menu-pop div.on{background:rgba(197,154,94,.26)}
#bxc-menu-pop div.cur{color:#f0c27b;font-weight:700}
#bxc-menu-pop div::before{content:'';width:6px;text-align:center}
#bxc-menu-pop div.cur::before{content:'\\2022'}
#bxc-menu-pop div.bxc-menu-head{cursor:default;padding:7px 11px 3px;color:#b39a76;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
#bxc-menu-pop div.bxc-menu-head::before{content:'';width:0}
#bxc-menu-pop div.bxc-menu-head + div{margin-top:0}
#bxc-menu-pop div.bxc-menu-head ~ div.bxc-menu-head{margin-top:5px;border-top:1px solid #3a2e22;padding-top:8px}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const pop = document.createElement('div'); pop.id = 'bxc-menu-pop'; document.body.appendChild(pop);
  const menus = [];
  let open = null;   // the menu whose list is showing

  const text = el => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();

  function closeMenu() {
    if (!open) return;
    open.btn.classList.remove('open'); open.btn.setAttribute('aria-expanded', 'false');
    pop.style.display = 'none'; open = null;
  }

  function build(host, itemSelector, name) {
    if (host.__bxcMenu) return;
    // the menu button wears the same class as the buttons it stands for, so it must not count as one of them
    const items = () => [...host.querySelectorAll(itemSelector + ':not(.bxc-menu-btn)')];
    if (items().length < 2) return;
    host.__bxcMenu = true;

    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = (items()[0].className.split(/\s+/)[0] || 'tab') + ' bxc-menu-btn';
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
    host.insertBefore(btn, host.firstChild);
    host.classList.add('bxc-menued');

    const menu = { host, btn, name, items, hi: 0 };
    menus.push(menu);

    function label() {
      const on = items().find(b => b.classList.contains('on'));
      btn.textContent = name;
      if (on) { const s = document.createElement('span'); s.className = 'bxc-menu-pick'; s.textContent = text(on); btn.append(s); }
      const c = document.createElement('span'); c.className = 'bxc-menu-caret'; c.textContent = '▾'; btn.append(c);
      btn.setAttribute('aria-label', name + (on ? ': ' + text(on) : ''));
    }
    menu.label = label;

    function paint() { (menu.rows || []).forEach((d, i) => d.classList.toggle('on', i === menu.hi)); }
    menu.paint = paint;

    function show() {
      closeMenu();
      open = menu;
      const list = items();
      menu.hi = Math.max(0, list.findIndex(b => b.classList.contains('on')));
      pop.innerHTML = '';
      menu.rows = [];
      let group = null;
      list.forEach((b, i) => {
        // a button may say which part of the menu it belongs under, e.g. Tradeskills against Combat
        const g = b.dataset.menuGroup || null;
        if (g && g !== group) { const h = document.createElement('div'); h.className = 'bxc-menu-head'; h.textContent = g; pop.append(h); }
        group = g;
        const d = document.createElement('div');
        d.textContent = text(b);
        d.className = b.classList.contains('on') ? 'cur' : '';
        d.dataset.i = String(i);
        pop.append(d);
        menu.rows.push(d);
      });
      paint();
      btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
      pop.style.display = 'block';
      // sit under the button, or above it when there is no room below
      pop.style.maxHeight = 'none';
      const r = btn.getBoundingClientRect(), below = window.innerHeight - r.bottom - 10, above = r.top - 10;
      const need = pop.offsetHeight;
      pop.style.maxHeight = Math.max(140, Math.min(need, Math.max(below, above))) + 'px';
      pop.style.minWidth = Math.max(r.width, 170) + 'px';
      pop.style.left = Math.max(6, Math.min(r.left, window.innerWidth - pop.offsetWidth - 6)) + 'px';
      if (below >= need || below >= above) { pop.style.top = r.bottom + 3 + 'px'; pop.style.bottom = 'auto'; }
      else { pop.style.bottom = window.innerHeight - r.top + 3 + 'px'; pop.style.top = 'auto'; }
      const cur = pop.querySelector('div.on'); if (cur) cur.scrollIntoView({ block: 'nearest' });
    }
    menu.show = show;

    function pick(i) { const b = items()[i]; closeMenu(); btn.focus(); if (b) b.click(); }
    menu.pick = pick;

    btn.addEventListener('mousedown', e => { e.preventDefault(); if (open === menu) { closeMenu(); btn.focus(); } else show(); });
    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (open === menu) menuMove(1); else show(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (open === menu) menuMove(-1); else show(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); sideways(menu, e.key === 'ArrowRight' ? 1 : -1); }
      else if (e.key === 'Escape') { if (open === menu) { e.preventDefault(); closeMenu(); } }
    });

    // The Atlas marks the chosen button itself (and the hash router does too): follow whatever it decides. Writing our
    // own label changes this same element, so anything coming from inside the menu button is ignored - otherwise the
    // observer would keep waking itself and the page would never get on with anything else.
    let writing = false;
    new MutationObserver(recs => {
      if (writing || recs.every(r => btn === r.target || btn.contains(r.target))) return;
      writing = true;
      try { label(); } finally { writing = false; }
      if (open === menu) show();
    }).observe(host, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
    label();
  }

  function menuMove(d) {
    if (!open) return;
    const rows = open.rows || []; if (!rows.length) return;
    open.hi = (open.hi + d + rows.length) % rows.length;
    open.paint();
    rows[open.hi].scrollIntoView({ block: 'nearest' });
  }
  function sideways(from, d) {
    const live = menus.filter(m => m.btn.isConnected && m.btn.offsetParent !== null);
    const i = live.indexOf(from); if (i < 0 || live.length < 2) return;
    const next = live[(i + d + live.length) % live.length];
    next.btn.focus(); if (open) next.show();
  }

  pop.addEventListener('mousedown', e => {
    const d = e.target.closest('div[data-i]'); if (!d || !open) return;
    e.preventDefault(); open.pick(Number(d.dataset.i));
  });
  pop.addEventListener('mousemove', e => {
    const d = e.target.closest('div[data-i]'); if (!d || !open) return;
    const i = Number(d.dataset.i); if (i !== open.hi) { open.hi = i; open.paint(); }
  });
  document.addEventListener('mousedown', e => { if (open && !pop.contains(e.target) && !open.btn.contains(e.target)) closeMenu(); }, true);
  document.addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const b = open.btn; closeMenu(); b.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); menuMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); menuMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); open.pick(open.hi); }
    else if (e.key === 'Tab') closeMenu();
  }, true);
  document.addEventListener('scroll', e => { if (open && !pop.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('blur', closeMenu);

  function scan() {
    document.querySelectorAll('nav.tabs .nav-group').forEach(g => build(g, '.tab', text(g.querySelector('.nav-label')) || 'Sections'));
    document.querySelectorAll('.calcsubtabs').forEach(g => build(g, '.calcsubtab', 'Calculator'));
  }
  let pending = false;
  new MutationObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; scan(); }); })
    .observe(document.body, { childList: true, subtree: true });
  scan();
})();
