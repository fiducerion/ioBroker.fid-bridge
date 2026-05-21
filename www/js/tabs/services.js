(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;
  let initialized = false;
  let items = [];

  function init() {
    if (initialized) return;
    initialized = true;
    $('svcReload') && $('svcReload').addEventListener('click', load);
    $('svcFilter') && $('svcFilter').addEventListener('change', render);
    $('svcSearch') && $('svcSearch').addEventListener('input', render);
  }
  async function refresh() { init(); await load(); }

  async function load() {
    try {
      const expert = global.MA.expertMode && global.MA.expertMode.get();
      const r = await global.MA.api.listInstances(expert);
      items = r.items || [];
      updateExpertHeader();
      render();
    } catch (e) {
      const tb = document.querySelector('#svcTable tbody');
      if (tb) tb.innerHTML = `<tr><td colspan="9" class="ma-muted">Fehler: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function updateExpertHeader() {
    // Spalten dynamisch ein-/ausblenden je nach Expert-Mode
    const head = document.querySelector('#svcTable thead tr');
    if (!head) return;
    // Header (RAM, CPU, Events/min) zwischen Mode und Version einfügen, falls noch nicht da
    const hasExt = !!document.getElementById('svcThRam');
    const expert = global.MA.expertMode && global.MA.expertMode.get();
    if (expert && !hasExt) {
      const modeTh = head.querySelector('th:nth-child(3)');
      if (modeTh) {
        modeTh.insertAdjacentHTML('afterend',
          '<th id="svcThRam">RAM</th><th id="svcThCpu">CPU</th><th id="svcThEv" title="Events: empfangen / gesendet pro Minute">Events</th>'
        );
      }
    } else if (!expert && hasExt) {
      ['svcThRam','svcThCpu','svcThEv'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
    }
  }

  function fmtMem(mb) {
    if (mb == null || !Number.isFinite(Number(mb))) return '—';
    const n = Number(mb);
    if (n >= 1024) return (n / 1024).toFixed(1) + ' G';
    return Math.round(n) + ' M';
  }

  function render() {
    const tbody = document.querySelector('#svcTable tbody'); if (!tbody) return;
    const filter = ($('svcFilter') && $('svcFilter').value) || 'all';
    const q = (($('svcSearch') && $('svcSearch').value) || '').toLowerCase().trim();
    const expert = global.MA.expertMode && global.MA.expertMode.get();

    const filtered = items.filter(it => {
      if (filter === 'alive'    && !it.alive) return false;
      if (filter === 'inactive' && (it.alive || !it.enabled)) return false;
      if (filter === 'disabled' && it.enabled) return false;
      if (q && !it.instance.toLowerCase().includes(q) && !(it.name||'').toLowerCase().includes(q)) return false;
      return true;
    });

    tbody.innerHTML = filtered.length ? filtered.map(it => {
      const status = it.alive ? 'läuft' : (it.enabled ? 'wartet' : 'aus');
      const cls    = it.alive ? 'ma-pill-ok' : (it.enabled ? 'ma-pill-warn' : '');
      const title  = it.alive
        ? 'Service ist online und erreichbar.'
        : (it.enabled
            ? 'Eingeschaltet, aber nicht online — startet noch, oder Fehler beim Start.'
            : 'Service ist ausgeschaltet.');
      const logSel = ['silly','debug','info','warn','error'].map(l =>
        `<option value="${l}" ${l===it.logLevel?'selected':''}>${l}</option>`).join('');
      const startBtn = !it.enabled ? `<button class="ma-btn" data-act="start" data-id="${escapeHtml(it.id)}">Start</button>` : '';
      const stopBtn  = it.enabled  ? `<button class="ma-btn ma-btn-ghost" data-act="stop" data-id="${escapeHtml(it.id)}">Stop</button>` : '';
      const restart  = it.alive    ? `<button class="ma-btn ma-btn-ghost" data-act="restart" data-id="${escapeHtml(it.id)}">Restart</button>` : '';
      const editBtn  = `<button class="ma-btn ma-btn-ghost" data-act="edit" data-id="${escapeHtml(it.instance)}">Konfig</button>`;
      const logBtn   = `<button class="ma-btn ma-btn-ghost" data-act="log" data-instance="${escapeHtml(it.instance)}" title="Live-Log dieses Service">📜</button>`;
      const delBtn   = `<button class="ma-btn ma-btn-ghost ma-btn-danger expert-only" data-act="delete" data-id="${escapeHtml(it.id)}">Löschen</button>`;

      const extCells = expert ? `
        <td class="ma-mono">${fmtMem(it.memRss)}</td>
        <td class="ma-mono">${it.cpu != null ? Number(it.cpu).toFixed(1) + ' %' : '—'}</td>
        <td class="ma-mono" title="empfangen / gesendet pro Minute">${it.inputs != null ? it.inputs : '—'} / ${it.outputs != null ? it.outputs : '—'}</td>
      ` : '';

      return `<tr>
        <td>${escapeHtml(it.instance)}</td>
        <td><span class="ma-pill ${cls}" title="${escapeHtml(title)}">${escapeHtml(status)}</span></td>
        <td>${escapeHtml(it.mode || '—')}</td>
        ${extCells}
        <td>${escapeHtml(it.version || '—')}</td>
        <td><select class="ma-select" data-loglevel data-id="${escapeHtml(it.id)}">${logSel}</select></td>
        <td style="text-align:right; white-space:nowrap;">${logBtn} ${editBtn} ${startBtn} ${restart} ${stopBtn} ${delBtn}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="${expert ? 9 : 6}" class="ma-muted">Keine Treffer</td></tr>`;

    tbody.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id; const act = btn.dataset.act;
        if (act === 'log') {
          global.MA.serviceLog.show(btn.dataset.instance);
          return;
        }
        if (act === 'edit') {
          global.MA.configEditor.open(id);
          return;
        }
        if (act === 'stop'    && !confirm('Service "' + id + '" stoppen?')) return;
        if (act === 'restart' && !confirm('Service "' + id + '" neu starten?')) return;
        if (act === 'delete'  && !confirm('Service "' + id + '" LÖSCHEN? Daten gehen verloren.')) return;
        btn.disabled = true;
        try {
          if (act === 'delete') {
            const r = await global.MA.api.deleteInstance(id);
            global.MA.terminal.show(r.runId, `delete: ${id}`, () => setTimeout(load, 500));
          } else {
            await global.MA.api.instanceAction(id, act);
            global.MA.toast('Aktion: ' + act + ' ' + id, 'ok');
            setTimeout(load, 1500);
          }
        } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
        finally { btn.disabled = false; }
      });
    });
    tbody.querySelectorAll('select[data-loglevel]').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await global.MA.api.setInstanceLogLevel(sel.dataset.id, sel.value);
          global.MA.toast('Log-Level: ' + sel.dataset.id + ' → ' + sel.value, 'ok');
        } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
      });
    });
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.services = { init, refresh };
})(window);
