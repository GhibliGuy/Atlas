// Atlas: Community - "Request a feature" and "Write a guide". The Atlas is a static page with no server, so a form
// submits by opening GitHub's own "new issue" page on the Atlas repo, filled in with what was written here; the
// person confirms it there (it needs a free GitHub account, and issues are public). Nothing here is stored or read by
// the rest of the Atlas - it's only a way for players to reach the maintainer. Unsent drafts are kept in this
// browser only, so a long guide isn't lost if the page is closed.
(() => {
  'use strict';
  const REPO_NEW_ISSUE = 'https://github.com/GhibliGuy/Atlas/issues/new';
  const MAX_URL = 7000;   // GitHub refuses very long new-issue links; longer text goes via the clipboard instead
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };

  const FORMS = {
    feature: {
      draftKey: 'bxcDraftFeature', prefix: '[Feature request] ',
      intro: 'Something you wish the Atlas did, or did better? Describe it here and it goes straight to the person who builds it.',
      fields: [
        { id: 'title', label: 'What would you like?', type: 'text', required: true, placeholder: 'e.g. Show respawn timers for bosses', max: 120 },
        { id: 'area', label: 'Which part of the Atlas?', type: 'select', options: ['Bestiary', 'Items', 'Resources', 'Gems', 'Zones & caves', 'World map', 'Calculators', 'Gem combiner', 'Something new', 'Not sure'] },
        { id: 'details', label: 'Tell us more', type: 'textarea', rows: 7, required: true, placeholder: 'What should it do, and how would it help you? Examples help a lot.' },
        { id: 'name', label: 'Your in-game name (optional)', type: 'text', placeholder: 'So we can thank you', max: 40 }
      ],
      body: v => `**Part of the Atlas:** ${v.area}\n${v.name ? `**In-game name:** ${v.name}\n` : ''}\n### Request\n${v.details}\n`,
      button: 'Send feature request'
    },
    guide: {
      draftKey: 'bxcDraftGuide', prefix: '[Guide] ',
      intro: 'Know something other players would love to learn? Write it up here - a leveling route, a money maker, how a dungeon works. Good guides will be added to the Atlas.',
      fields: [
        { id: 'title', label: 'Guide title', type: 'text', required: true, placeholder: 'e.g. Fast mining from 1 to 30', max: 120 },
        { id: 'topic', label: 'Topic', type: 'select', options: ['Getting started', 'Combat & leveling', 'Crafting & enchanting', 'Gathering', 'Zones & dungeons', 'Bosses', 'Making gold', 'Other'] },
        { id: 'guide', label: 'Your guide', type: 'textarea', rows: 16, required: true, placeholder: 'Write it the way you would explain it to a friend. Steps, levels, locations and tips all help.\n\nTip: start a line with "- " for a bullet list, or "## " for a heading.' },
        { id: 'name', label: 'Your in-game name (optional)', type: 'text', placeholder: 'To credit you on the guide', max: 40 }
      ],
      body: v => `**Topic:** ${v.topic}\n${v.name ? `**Written by:** ${v.name}\n` : ''}\n---\n\n${v.guide}\n`,
      button: 'Submit guide'
    }
  };

  function fieldHtml(f, v) {
    const common = `id="cf-${f.id}" name="${f.id}"${f.required ? ' required' : ''}${f.max ? ` maxlength="${f.max}"` : ''}`;
    let input;
    if (f.type === 'textarea') input = `<textarea ${common} rows="${f.rows}" placeholder="${esc(f.placeholder || '')}">${esc(v ?? '')}</textarea>`;
    else if (f.type === 'select') input = `<select ${common} data-nocombo>${f.options.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else input = `<input type="text" ${common} placeholder="${esc(f.placeholder || '')}" value="${esc(v ?? '')}">`;
    return `<label class="cf-field" for="cf-${f.id}"><span>${esc(f.label)}${f.required ? ' <b class="cf-req">*</b>' : ''}</span>${input}</label>`;
  }

  function renderCommunity(kind) {
    const form = FORMS[kind]; if (!form) return;
    const content = document.getElementById('content');
    const draft = store.get(form.draftKey) || {};
    content.innerHTML = `<div class="cf">
      <p class="cf-lede">${esc(form.intro)}</p>
      <form id="cfForm" novalidate>${form.fields.map(f => fieldHtml(f, draft[f.id])).join('')}
        <div class="cf-actions"><button type="submit" class="cf-send">${esc(form.button)}</button><span id="cfNote" class="cf-note" role="status"></span></div>
      </form>
      <div class="cf-how"><b>How sending works:</b> pressing the button opens GitHub in a new tab with everything you wrote already filled in - check it and press <b>Create</b> there. You'll need a free GitHub account, and what you send can be read by anyone. Don't include passwords or anything private. Your draft is saved in this browser until you send it.</div>
    </div>`;
    const el = content.querySelector('#cfForm'), note = content.querySelector('#cfNote');
    const values = () => Object.fromEntries(form.fields.map(f => [f.id, (el.elements[f.id].value || '').trim()]));
    el.addEventListener('input', () => store.set(form.draftKey, values()));
    el.addEventListener('submit', async e => {
      e.preventDefault();
      const v = values();
      const missing = form.fields.filter(f => f.required && !v[f.id]);
      if (missing.length) { note.className = 'cf-note bad'; note.textContent = 'Please fill in: ' + missing.map(f => f.label).join(', '); el.elements[missing[0].id].focus(); return; }
      const title = form.prefix + v.title, body = form.body(v);
      let url = `${REPO_NEW_ISSUE}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
      let copied = false;
      if (url.length > MAX_URL) {
        // Too long for a link: put the full text on the clipboard and open the issue with a short note to paste it.
        try { await navigator.clipboard.writeText(body); copied = true; } catch {}
        url = `${REPO_NEW_ISSUE}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(copied ? '(Paste your text here with Ctrl+V - it was copied for you because it is too long to fill in automatically.)' : '(Your text was too long to fill in automatically - please paste it here.)')}`;
      }
      window.open(url, '_blank', 'noopener');
      note.className = 'cf-note good';
      note.textContent = copied ? 'GitHub opened in a new tab. Your text is on the clipboard - paste it into the box there, then press Create.' : 'GitHub opened in a new tab - check it and press Create to send.';
      note.dataset.sent = '1';
    });
    // Once they've sent it, the next visit starts fresh.
    window.addEventListener('focus', function clear() { if (note.dataset.sent) { store.del(form.draftKey); window.removeEventListener('focus', clear); } });
  }
  window.renderCommunity = renderCommunity;
})();
