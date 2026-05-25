(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;
  let initialized = false;
  let items = [];

  function init() {
    if (initialized) return;
    initialized = true;
    $('repoReload') && $('repoReload').addEventListener('click', doHardRefresh);
    $('repoSearch') && $('repoSearch').addEventListener('input', render);
    $('repoFilter') && $('repoFilter').addEventListener('change', render);
    $('repoInstallUrlBtn') && $('repoInstallUrlBtn').addEventListener('click', installUrl);
    const inp = $('repoUrlInput');
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') installUrl(); });
  }

  async function refresh() { init(); if (!items.length) await load(); }

  async function doHardRefresh() {
    // Punkt 6: echtes "iob update" via POST /api/repo/refresh
    const btn = $('repoReload');
    if (btn) { btn.disabled = true; btn.textContent = '↻ aktualisiere...'; }
    try {
      const r = await global.MA.api.refreshRepo();
      if (r && r.ok) {
        global.MA.toast('Repository neu geladen (' + (r.adapterCount || '?') + ' Module)', 'ok');
      } else {
        global.MA.toast('Refresh fehlgeschlagen: ' + (r && r.error || 'unbekannt'), 'bad');
      }
      // dann mit noCache neu rendern
      await load(true);
    } catch (e) {
      global.MA.toast('Fehler: ' + e.message, 'bad');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻ Aktualisieren'; }
    }
  }

  async function installUrl() {
    const inp = $('repoUrlInput'); if (!inp) return;
    const url = inp.value.trim();
    if (!url) { global.MA.toast('Bitte URL oder npm-Name eingeben', 'warn'); return; }
    if (!confirm('Adapter installieren von:\n\n' + url + '\n\nFortfahren?')) return;
    try {
      const r = await global.MA.api.installRepoUrl(url);
      if (r && r.ok) {
        global.MA.toast('Installation gestartet, siehe Terminal', 'info');
        if (r.runId && global.MA.terminal) {
          global.MA.terminal.show(r.runId, 'Adapter-Install: ' + url);
        }
        inp.value = '';
        // Repo-Liste in 10s neu laden (Adapter sollte dann da sein)
        setTimeout(() => load(true), 10000);
      } else {
        global.MA.toast('Fehler: ' + (r && r.error || 'unbekannt'), 'bad');
      }
    } catch (e) {
      global.MA.toast('Fehler: ' + e.message, 'bad');
    }
  }

  async function load(noCache) {
    const tbody = document.querySelector('#repoTable tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="ma-muted">Lade Repository (dauert ein paar Sekunden)...</td></tr>';
    try {
      const r = await global.MA.api.listRepo(noCache);
      items = r.items || [];
      render();
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="ma-muted">Fehler: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function render() {
    const tbody = document.querySelector('#repoTable tbody');
    if (!tbody) return;
    const q = (($('repoSearch') && $('repoSearch').value) || '').toLowerCase().trim();
    const filter = ($('repoFilter') && $('repoFilter').value) || 'all';

    let filtered = items;
    if (q) filtered = filtered.filter(it => it.name.toLowerCase().includes(q) || (it.title||'').toLowerCase().includes(q) || (it.desc||'').toLowerCase().includes(q));
    if (filter === 'installed')  filtered = filtered.filter(it => it.isInstalled);
    if (filter === 'updates')    filtered = filtered.filter(it => it.updateAvailable);
    if (filter === 'available')  filtered = filtered.filter(it => !it.isInstalled);

    tbody.innerHTML = filtered.length ? filtered.slice(0, 1000).map(it => {
      const inst = it.isInstalled
        ? (it.updateAvailable
            ? `<span class="ma-pill ma-pill-warn">Update: ${escapeHtml(it.installedVersion)} → ${escapeHtml(it.version)}</span>`
            : `<span class="ma-pill ma-pill-ok">${escapeHtml(it.installedVersion)}</span>`)
        : `<span class="ma-pill">nicht installiert</span>`;
      let actions = '';
      if (!it.isInstalled) {
        actions = `<button class="ma-btn" data-act="install" data-name="${escapeHtml(it.name)}">Installieren</button>`;
      } else if (it.updateAvailable) {
        actions = `<button class="ma-btn" data-act="upgrade" data-name="${escapeHtml(it.name)}">Aktualisieren</button>
                   <button class="ma-btn ma-btn-ghost" data-act="addInstance" data-name="${escapeHtml(it.name)}">+ Service</button>`;
      } else {
        actions = `<button class="ma-btn ma-btn-ghost" data-act="addInstance" data-name="${escapeHtml(it.name)}">+ Service</button>`;
      }
      return `<tr>
        <td><strong>${escapeHtml(it.name)}</strong></td>
        <td>${escapeHtml(it.title || '')}</td>
        <td>${escapeHtml(it.version || '—')}</td>
        <td>${inst}</td>
        <td style="text-align:right; white-space:nowrap;">${actions}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="5" class="ma-muted">Keine Treffer</td></tr>`;

    tbody.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => onAction(btn.dataset.act, btn.dataset.name));
    });
  }

  async function onAction(act, name) {
    if (!confirm(`${act === 'install' ? 'Installieren' : act === 'upgrade' ? 'Aktualisieren' : 'Service hinzufügen'}: ${name}?`)) return;
    try {
      let r;
      if (act === 'install')      r = await global.MA.api.installAdapter(name);
      else if (act === 'upgrade') r = await global.MA.api.upgradeAdapter(name);
      else if (act === 'addInstance') r = await global.MA.api.addInstance(name);
      global.MA.terminal.show(r.runId, `${act}: ${name}`, () => {
        // Nach Erfolg neu laden
        setTimeout(() => load(true), 500);
      });
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.repo = { init, refresh };
})(window);
