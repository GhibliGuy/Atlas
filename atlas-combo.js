// Atlas: every dropdown becomes a type-to-search box. Click it (or start typing) and the list narrows to what
// matches; arrow keys and Enter pick, Esc cancels. The real <select> stays in the page (hidden) as the source of
// truth, so the rest of the Atlas keeps reading and setting it exactly as before.
(() => {
  'use strict';
  if (window.__bxcCombo) return;
  window.__bxcCombo = true;

  const css = `
.bxc-combo{position:relative;display:inline-block;max-width:100%;min-width:0;vertical-align:middle}
.bxc-combo.fill{display:block;width:100%}
.bxc-combo input{width:100%;box-sizing:border-box;padding-right:26px;text-overflow:ellipsis;cursor:text}
.bxc-combo input:disabled{opacity:.55;cursor:not-allowed}
.bxc-combo .bxc-combo-caret{position:absolute;right:1px;top:1px;bottom:1px;width:24px;padding:0;border:0;background:transparent;color:#b9c7b8;cursor:pointer;font-size:11px;line-height:1}
.bxc-combo .bxc-combo-caret:hover{background:transparent;color:#efd39a}
#bxc-combo-list{position:fixed;z-index:2147483647;display:none;overflow:auto;box-sizing:border-box;background:#101f16;border:1px solid #d9b878;border-radius:7px;box-shadow:0 8px 22px rgba(0,0,0,.55);font:13px 'Segoe UI',Arial,sans-serif;color:#e8eade}
#bxc-combo-list div{padding:6px 10px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bxc-combo-list div.on{background:rgba(217,184,120,.28)}
#bxc-combo-list div.cur{font-weight:700;color:#efd39a}
#bxc-combo-list div.none{cursor:default;color:#8fa397;font-style:italic}
#bxc-combo-list mark{background:none;color:#ffd97a;font-weight:700}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const list = document.createElement('div'); list.id = 'bxc-combo-list'; document.body.appendChild(list);
  let active = null;   // the combo whose list is showing

  const label = o => (o.textContent || '').replace(/\s+/g, ' ').trim();
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function enhance(sel) {
    if (sel.__bxcCombo || sel.multiple || sel.size > 1 || sel.hasAttribute('data-nocombo')) return;
    sel.__bxcCombo = true;
    const wrap = document.createElement('span'); wrap.className = 'bxc-combo';
    const input = document.createElement('input'); input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
    if (sel.id) input.setAttribute('aria-label', (document.querySelector(`label[for="${sel.id}"]`)?.textContent || sel.id).trim());
    const caret = document.createElement('button'); caret.type = 'button'; caret.className = 'bxc-combo-caret'; caret.tabIndex = -1; caret.innerHTML = '&#9662;'; caret.setAttribute('aria-label', 'Show all');
    wrap.append(input, caret);
    const pcs = sel.parentElement && getComputedStyle(sel.parentElement);
    if (pcs && (pcs.display === 'grid' || pcs.display === 'flex' || sel.closest('.calcgrid'))) wrap.classList.add('fill');
    else { const w = sel.getBoundingClientRect().width; wrap.style.width = (w > 60 ? w : 190) + 'px'; }
    sel.style.display = 'none';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);   // keep the select inside the wrapper so removing one removes both

    const combo = { sel, wrap, input, hi: -1, shown: [] };
    const cur = () => sel.selectedOptions && sel.selectedOptions[0];
    const sync = () => { if (active !== combo) input.value = cur() ? label(cur()) : ''; input.disabled = sel.disabled; };
    combo.sync = sync;

    function render(filter) {
      const q = (filter || '').trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
      const opts = [...sel.options];
      combo.shown = opts.filter(o => { const t = label(o).toLowerCase(); return !words.length || words.every(w => t.includes(w)); });
      // best matches first: starts-with, then the rest in list order
      if (words.length) combo.shown.sort((a, b) => (label(a).toLowerCase().startsWith(q) ? 0 : 1) - (label(b).toLowerCase().startsWith(q) ? 0 : 1));
      const c = cur();
      combo.hi = Math.max(0, combo.shown.indexOf(c));
      if (words.length) combo.hi = 0;
      list.innerHTML = combo.shown.length ? combo.shown.map((o, i) => {
        let t = esc(label(o));
        for (const w of words) t = t.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
        return `<div data-i="${i}" class="${o === c ? 'cur ' : ''}${i === combo.hi ? 'on' : ''}">${t}</div>`;
      }).join('') : '<div class="none">No matches</div>';
      place(); scrollHi();
    }
    function place() {
      const r = input.getBoundingClientRect(), below = window.innerHeight - r.bottom, up = r.top;
      const h = Math.min(280, Math.max(120, Math.max(below, up) - 12));
      list.style.left = r.left + 'px'; list.style.minWidth = Math.max(r.width, 160) + 'px'; list.style.maxWidth = Math.min(560, window.innerWidth - 16) + 'px';
      list.style.maxHeight = h + 'px';
      if (below >= 160 || below >= up) { list.style.top = r.bottom + 2 + 'px'; list.style.bottom = 'auto'; }
      else { list.style.bottom = window.innerHeight - r.top + 2 + 'px'; list.style.top = 'auto'; }
      list.style.display = 'block';
    }
    function scrollHi() { const el = list.querySelector('div.on'); if (el) el.scrollIntoView({ block: 'nearest' }); }
    function open(filter) { active = combo; render(filter); }
    function close() { if (active === combo) { list.style.display = 'none'; active = null; } }
    function choose(o) {
      if (o && o !== cur()) { sel.value = o.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
      close(); input.value = cur() ? label(cur()) : '';
    }
    function move(d) {
      if (!combo.shown.length) return;
      combo.hi = (combo.hi + d + combo.shown.length) % combo.shown.length;
      list.querySelectorAll('div').forEach((el, i) => el.classList.toggle('on', i === combo.hi)); scrollHi();
    }
    combo.close = close;

    input.addEventListener('focus', () => { input.select(); open(''); });
    input.addEventListener('mousedown', () => { if (document.activeElement === input && active !== combo) open(''); });
    input.addEventListener('input', () => open(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (active !== combo) open(''); else move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (active !== combo) open(''); else move(-1); }
      else if (e.key === 'Enter') { if (active === combo) { e.preventDefault(); choose(combo.shown[combo.hi]); input.blur(); } }
      else if (e.key === 'Escape') { if (active === combo) { e.preventDefault(); e.stopPropagation(); close(); input.value = cur() ? label(cur()) : ''; input.blur(); } }
      else if (e.key === 'Tab') { if (active === combo && input.value.trim() && combo.shown.length) choose(combo.shown[combo.hi]); else close(); }
    });
    input.addEventListener('blur', () => {
      // clicking a list entry is handled on mousedown, so a blur here is a real leave: keep the typed text only if it names an option
      setTimeout(() => {
        if (active === combo) {
          const t = input.value.trim().toLowerCase();
          const exact = [...sel.options].find(o => label(o).toLowerCase() === t);
          if (exact) choose(exact); else { close(); input.value = cur() ? label(cur()) : ''; }
        } else sync();
      }, 0);
    });
    caret.addEventListener('mousedown', e => { e.preventDefault(); if (active === combo) { close(); } else { input.focus(); open(''); } });
    list.addEventListener('mousedown', e => {
      if (active !== combo) return;
      const el = e.target.closest('div[data-i]'); if (!el) return;
      e.preventDefault(); choose(combo.shown[Number(el.dataset.i)]); input.blur();
    });
    list.addEventListener('mousemove', e => {
      if (active !== combo) return;
      const el = e.target.closest('div[data-i]'); if (!el) return;
      const i = Number(el.dataset.i); if (i !== combo.hi) { combo.hi = i; list.querySelectorAll('div').forEach((d, k) => d.classList.toggle('on', k === i)); }
    });

    // the rest of the Atlas rewrites options and sets .value directly: keep the box in step
    new MutationObserver(() => { sync(); if (active === combo) render(input.value === label(cur() || {}) ? '' : input.value); }).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    for (const prop of ['value', 'selectedIndex']) {
      const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
      Object.defineProperty(sel, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); sync(); } });
    }
    sel.addEventListener('change', sync);
    sync();
  }

  function scan(root) { (root || document).querySelectorAll('select').forEach(enhance); }
  document.addEventListener('scroll', e => { if (active && !list.contains(e.target)) { active.close(); active.input.blur(); } }, true);
  window.addEventListener('resize', () => { if (active) active.close(); });
  let pending = false;
  new MutationObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; scan(); }); })
    .observe(document.body, { childList: true, subtree: true });
  scan();
})();
