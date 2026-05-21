/* Globale Suche - Modal mit Live-Suche ueber DPs, Scripts, Services, Aliase, Enums.
 * Geoeffnet per Klick auf das Lupe-Icon oder mit "/" auf der Tastatur.
 * Enter im Suchfeld: zum ersten Treffer springen.
 */
(function (global) {
  'use strict';
  const { escapeHtml } = global.MA.ui;

  let modalEl = null;
  let inputEl = null;
  let listEl  = null;
  let countEl = null;
  let currentResults = [];
  let activeIdx = 0;
  let searchTimer = null;
  let lastQuery = '';

  function ensure() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.className = 'ma-modal-overlay gs-overlay';
    modalEl.innerHTML = `
      <div class="ma-modal gs-modal">
        <div class="gs-search-row">
          <span class="gs-icon">🔍</span>
          <input id="gsInput" class="gs-input" placeholder="Suche Datenpunkte, Automationen, Services, Räume..." autocomplete="off" spellcheck="false" />
          <span class="gs-count" id="gsCount"></span>
          <button class="ma-modal-close" id="gsClose">Schließen</button>
        </div>
        <div class="gs-help">Tipp: ↑/↓ navigieren, Enter zum Öffnen, Esc zum Schließen</div>
        <div class="gs-results" id="gsResults"></div>
      </div>
    `;
    document.body.appendChild(modalEl);
    inputEl = modalEl.querySelector('#gsInput');
    listEl  = modalEl.querySelector('#gsResults');
    countEl = modalEl.querySelector('#gsCount');

    modalEl.querySelector('#gsClose').addEventListener('click', hide);
    modalEl.addEventListener('click', (ev) => { if (ev.target === modalEl) hide(); });
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keydown', onKey);
  }

  function show() {
    ensure();
    modalEl.classList.add('open');
    inputEl.value = lastQuery;
    inputEl.focus();
    inputEl.select();
    if (lastQuery && !currentResults.length) onInput();
  }

  function hide() { if (modalEl) modalEl.classList.remove('open'); }

  function onInput() {
    const q = inputEl.value.trim();
    lastQuery = q;
    if (searchTimer) clearTimeout(searchTimer);
    if (q.length < 2) { renderEmpty('Mindestens 2 Zeichen eingeben.'); return; }
    countEl.textContent = '...';
    searchTimer = setTimeout(() => runSearch(q), 220);
  }

  async function runSearch(q) {
    try {
      const r = await global.MA.api.globalSearch(q, 100);
      currentResults = r.results || [];
      activeIdx = 0;
      render();
    } catch (e) {
      renderEmpty('Fehler: ' + e.message);
    }
  }

  function renderEmpty(msg) {
    if (!listEl) return;
    listEl.innerHTML = `<div class="gs-empty">${escapeHtml(msg)}</div>`;
    countEl.textContent = '';
  }

  function categoryBadgeClass(cat) {
    switch (cat) {
      case 'Datenpunkt':  return 'gs-cat-dp';
      case 'Automation':  return 'gs-cat-script';
      case 'Service':     return 'gs-cat-service';
      case 'Raum':        return 'gs-cat-room';
      case 'Funktion':    return 'gs-cat-func';
      default:            return 'gs-cat-other';
    }
  }

  function render() {
    if (!listEl) return;
    if (!currentResults.length) {
      renderEmpty('Keine Treffer.');
      return;
    }
    countEl.textContent = currentResults.length + ' Treffer';
    listEl.innerHTML = currentResults.map((r, i) => `
      <div class="gs-row ${i === activeIdx ? 'gs-active' : ''}" data-idx="${i}">
        <span class="gs-badge ${categoryBadgeClass(r.category)}">${escapeHtml(r.category)}</span>
        <div class="gs-main">
          <div class="gs-id">${escapeHtml(r.id)}</div>
          ${r.label && r.label !== r.id ? `<div class="gs-label">${escapeHtml(r.label)}</div>` : ''}
        </div>
        ${r.sub ? `<div class="gs-sub">${escapeHtml(r.sub)}</div>` : ''}
      </div>
    `).join('');
    listEl.querySelectorAll('.gs-row').forEach(row => {
      row.addEventListener('click', () => {
        activeIdx = Number(row.dataset.idx);
        openActive();
      });
    });
    // Aktive Zeile in den sichtbaren Bereich scrollen
    const active = listEl.querySelector('.gs-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function onKey(ev) {
    if (ev.key === 'Escape') { hide(); return; }
    if (ev.key === 'Enter')  { ev.preventDefault(); openActive(); return; }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (currentResults.length) {
        activeIdx = (activeIdx + 1) % currentResults.length;
        render();
      }
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (currentResults.length) {
        activeIdx = (activeIdx - 1 + currentResults.length) % currentResults.length;
        render();
      }
      return;
    }
  }

  function openActive() {
    const r = currentResults[activeIdx];
    if (!r) return;
    hide();
    // Sprungziel pro Kategorie
    switch (r.category) {
      case 'Datenpunkt': {
        // Tab wechseln und im Object-Browser das richtige Prefix setzen + selectId
        // Wir nehmen die obersten 2 Pfad-Segmente als Prefix damit der Tab nicht
        // alle 41k Objekte laden muss.
        const parts = r.id.split('.');
        const prefix = parts.slice(0, Math.min(3, parts.length - 1)).join('.');
        switchTab('objects');
        setTimeout(() => {
          const pi = document.getElementById('objPrefix');
          if (pi) pi.value = prefix;
          const lb = document.getElementById('objLoadBtn');
          if (lb) lb.click();
          // Nach kurzem Laden den DP selektieren
          setTimeout(() => {
            const tabApi = (global.MA.tabs && global.MA.tabs.objects);
            if (tabApi && tabApi.selectId) tabApi.selectId(r.id);
            else if (global.MA.tabs && global.MA.tabs.objects && global.MA.tabs.objects.refresh) {
              // Fallback: URL-Param setzen und refresh
              const u = new URL(location.href);
              u.searchParams.set('obj', r.id);
              history.replaceState(null, '', u.toString());
              global.MA.tabs.objects.refresh();
            }
          }, 1500);
        }, 50);
        break;
      }
      case 'Automation': {
        switchTab('scripts');
        setTimeout(() => { if (global.MA.scriptEditor) global.MA.scriptEditor.open(r.id); }, 100);
        break;
      }
      case 'Service': {
        switchTab('services');
        setTimeout(() => {
          // Filter im Service-Tab auf den Treffer setzen
          const search = document.getElementById('svcSearch');
          if (search) {
            const inst = r.id.replace(/^system\.adapter\./, '');
            search.value = inst;
            search.dispatchEvent(new Event('input'));
          }
        }, 100);
        break;
      }
      case 'Raum':
      case 'Funktion': {
        switchTab('structure');
        break;
      }
      default:
        switchTab('objects');
    }
  }

  function switchTab(id) {
    // Tab-Wechsel via vorhandenen Mechanismus
    const tab = document.querySelector('.ma-tab[data-tab="' + id + '"]');
    if (tab) tab.click();
  }

  // Globaler Keyboard-Listener fuer "/"
  document.addEventListener('keydown', (ev) => {
    if (ev.key === '/' && !isInputFocused()) {
      ev.preventDefault();
      show();
    }
  });

  function isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  global.MA = global.MA || {};
  global.MA.globalSearch = { show, hide };
})(window);
