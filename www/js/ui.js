(function (global) {
  'use strict';
  const $ = id => document.getElementById(id);

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setConn(mode, text) {
    const el = $('connState'); if (!el) return;
    el.className = 'ma-badge ma-badge-' + mode;
    el.textContent = text;
  }

  const TABS = [
    { id: 'dashboard', num: '02', label: 'ÜBERSICHT' },
    { id: 'services',  num: '03', label: 'SERVICES' },
    { id: 'modules',   num: '04', label: 'MODULE' },
    { id: 'repo',      num: '05', label: 'REPOSITORY' },
    { id: 'objects',   num: '06', label: 'DATENPUNKTE' },
    { id: 'structure', num: '07', label: 'STRUKTUR' },
    { id: 'scripts',   num: '08', label: 'AUTOMATIONEN' },
    { id: 'files',     num: '09', label: 'DATEIEN' },
    { id: 'users',     num: '10', label: 'BENUTZER' },
    { id: 'logs',      num: '11', label: 'PROTOKOLL' },
    { id: 'analyzer',  num: '12', label: 'ANALYZER' },
    { id: 'backup',    num: '13', label: 'BACKUP' },
    { id: 'system',    num: '14', label: 'SYSTEM' },
    { id: 'settings',  num: '15', label: 'EINSTELLUNGEN' }
  ];

  function buildTabs(activeId, onChange) {
    const nav = $('navTabs'); if (!nav) return;
    nav.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.className = 'ma-tab' + (t.id === activeId ? ' active' : '');
      b.dataset.tab = t.id;
      b.innerHTML = `<span class="ma-tab-num">${t.num}</span><span class="ma-tab-label">${t.label}</span><span class="ma-tab-badge" id="tabBadge-${t.id}" hidden></span>`;
      b.addEventListener('click', () => activate(t.id, onChange));
      nav.appendChild(b);
    }
  }

  // v0.13.7: Badge an einem Tab setzen (Zahl oder Warnung).
  //   setTabBadge('repo', 2)            -> blaue 2
  //   setTabBadge('repo', 2, 'warn')    -> orange 2
  //   setTabBadge('backup', '!', 'err') -> rotes !
  //   setTabBadge('repo', 0)            -> Badge weg
  function setTabBadge(tabId, value, kind) {
    const el = document.getElementById('tabBadge-' + tabId);
    if (!el) return;
    const num = (typeof value === 'number') ? value : (value ? String(value) : '');
    if (!num || num === '0') {
      el.hidden = true;
      el.textContent = '';
      el.className = 'ma-tab-badge';
      return;
    }
    el.hidden = false;
    el.textContent = num;
    el.className = 'ma-tab-badge ma-tab-badge-' + (kind || 'info');
  }

  function activate(tabId, onChange) {
    document.querySelectorAll('#navTabs .ma-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('#tabPages .ma-tabpage').forEach(s => s.classList.toggle('active', s.dataset.tab === tabId));
    if (typeof onChange === 'function') onChange(tabId);
  }

  function startClock() {
    const el = $('stardate'); if (!el) return;
    function tick() {
      const now = new Date();
      const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      // Punkt 3: Stardate nur in den LCARS-Themes, sonst normales Datum
      const active = (global.MA.theme && global.MA.theme.getActive && global.MA.theme.getActive()) || '';
      const isLcars = /^lcars/i.test(String(active));
      if (isLcars) {
        const start = new Date(now.getFullYear(), 0, 0);
        const day = Math.floor((now - start) / 86400000);
        const frac = (now.getHours() * 60 + now.getMinutes()) / 1440;
        const sd = (now.getFullYear() - 2000) * 1000 + day + frac;
        el.innerHTML = `★ ${sd.toFixed(2)} · ${time}`;
      } else {
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yy = now.getFullYear();
        el.innerHTML = `${dd}.${mm}.${yy} · ${time}`;
      }
    }
    tick();
    setInterval(tick, 1000);
  }

  function fmtVal(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }

  global.MA = global.MA || {};
  global.MA.ui = { $, escapeHtml, setConn, buildTabs, activate, startClock, fmtVal, setTabBadge };
})(window);
