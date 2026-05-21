(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;
  let initialized = false;
  let items = [];

  function init() {
    if (initialized) return;
    initialized = true;
    $('modReload') && $('modReload').addEventListener('click', load);
    $('modSearch') && $('modSearch').addEventListener('input', render);
  }
  async function refresh() { init(); await load(); }

  async function load() {
    try {
      const r = await global.MA.api.listAdapters();
      items = r.items || [];
      render();
    } catch (e) {
      const tb = document.querySelector('#modTable tbody');
      if (tb) tb.innerHTML = `<tr><td colspan="5" class="ma-muted">Fehler: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function render() {
    const tbody = document.querySelector('#modTable tbody'); if (!tbody) return;
    const q = (($('modSearch') && $('modSearch').value) || '').toLowerCase().trim();
    const filtered = q
      ? items.filter(it => it.name.toLowerCase().includes(q) || (it.title||'').toLowerCase().includes(q))
      : items;

    tbody.innerHTML = filtered.length ? filtered.map(it => `
      <tr>
        <td><strong>${escapeHtml(it.name)}</strong></td>
        <td>${escapeHtml(it.version || '—')}</td>
        <td>${escapeHtml(it.mode || '—')}</td>
        <td>${escapeHtml(it.title || '')}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="ma-btn ma-btn-ghost" data-act="upgrade" data-name="${escapeHtml(it.name)}">Aktualisieren</button>
          <button class="ma-btn ma-btn-ghost" data-act="addInstance" data-name="${escapeHtml(it.name)}">+ Service</button>
          <button class="ma-btn ma-btn-ghost ma-btn-danger expert-only" data-act="uninstall" data-name="${escapeHtml(it.name)}">Entfernen</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="5" class="ma-muted">Keine Treffer</td></tr>`;

    tbody.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => onAction(btn.dataset.act, btn.dataset.name));
    });
  }

  async function onAction(act, name) {
    if (act === 'uninstall') {
      if (!confirm(`Modul "${name}" entfernen? Das löscht auch alle Services und deren Daten.`)) return;
    } else {
      if (!confirm(`${act === 'upgrade' ? 'Aktualisieren' : 'Service hinzufügen'}: ${name}?`)) return;
    }
    try {
      let r;
      if (act === 'upgrade')         r = await global.MA.api.upgradeAdapter(name);
      else if (act === 'uninstall')  r = await global.MA.api.uninstallAdapter(name);
      else if (act === 'addInstance')r = await global.MA.api.addInstance(name);
      global.MA.terminal.show(r.runId, `${act}: ${name}`, () => setTimeout(load, 500));
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.modules = { init, refresh };
})(window);
