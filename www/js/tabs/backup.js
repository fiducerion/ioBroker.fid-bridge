(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;
  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    $('bkSave')    && $('bkSave').addEventListener('click', saveConfig);
    $('bkRunNow')  && $('bkRunNow').addEventListener('click', runNow);
    $('bkRefresh') && $('bkRefresh').addEventListener('click', refresh);
  }

  async function refresh() {
    init();
    await Promise.all([loadConfigAndStatus(), loadExternalList()]);
  }

  async function loadConfigAndStatus() {
    try {
      const j = await global.MA.api.backupStatus();
      if (!j.ok) throw new Error(j.error || 'status failed');
      const cfg = j.config || {};
      $('bkEnabled')  && ($('bkEnabled').checked = !!cfg.enabled);
      $('bkTimes')    && ($('bkTimes').value = (cfg.times || []).join(', '));
      $('bkCopyTo')   && ($('bkCopyTo').value = cfg.copyTo || '');
      $('bkKeepDays') && ($('bkKeepDays').value = cfg.keepDays || 0);
      renderStatus(j);
    } catch (e) {
      const el = $('bkStatus');
      if (el) el.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderStatus(s) {
    const el = $('bkStatus');
    if (!el) return;
    const next = s.nextRunIso ? new Date(s.nextRunIso).toLocaleString('de-DE') : '— (Plan aus)';
    const running = s.running ? '<span class="ma-pill ma-pill-warn">laeuft gerade</span>' : '';
    let lastHtml = '<div class="ma-muted">noch kein Lauf seit Adapter-Start</div>';
    if (s.lastRun) {
      const r = s.lastRun;
      const ts = new Date(r.ts).toLocaleString('de-DE');
      const okPill   = r.ok ? '<span class="ma-pill ma-pill-ok">OK</span>'
                            : '<span class="ma-pill ma-pill-bad">FEHLER</span>';
      const copyInfo = r.copyOk
        ? '<span class="ma-pill ma-pill-ok">extern kopiert</span>'
        : r.copyError
          ? `<span class="ma-pill ma-pill-bad">copy fail: ${escapeHtml(r.copyError)}</span>`
          : '';
      const dur = (r.durationMs / 1000).toFixed(1) + 's';
      const outLines = (r.output || []).slice(-15).map(escapeHtml).join('<br>');
      lastHtml = `
        <div style="margin-bottom: 8px;">${okPill} Trigger: ${escapeHtml(r.trigger || '?')} · ${ts} · Dauer: ${dur} ${copyInfo}</div>
        <div style="margin-bottom: 8px;">Datei: <code>${escapeHtml(r.file || '—')}</code></div>
        <details><summary class="ma-muted">Output (letzte 15 Zeilen)</summary>
        <pre style="background: var(--ma-bg-2); padding: 8px; border-radius: 4px; max-height: 200px; overflow: auto; font-size: 12px; margin: 6px 0 0 0;">${outLines}</pre>
        </details>
      `;
    }
    el.innerHTML = `
      <div style="margin-bottom: 12px;">Naechster Lauf: <strong>${escapeHtml(next)}</strong> ${running}</div>
      <h4 style="margin-top: 16px; margin-bottom: 8px;">Letzter Lauf</h4>
      ${lastHtml}
    `;
  }

  async function loadExternalList() {
    try {
      const j = await global.MA.api.backupExternalList();
      const el = $('bkExternalList');
      if (!el) return;
      if (!j.ok) {
        el.innerHTML = `<div class="ma-muted">${escapeHtml(j.error || 'Fehler')}</div>`;
        return;
      }
      if (!j.files || !j.files.length) {
        el.innerHTML = `<div class="ma-muted">Keine externen Backups (${escapeHtml(j.note || 'Pfad leer')})</div>`;
        return;
      }
      const rows = j.files.map(f => {
        const sz = (f.size / 1024 / 1024).toFixed(1) + ' MB';
        const ts = new Date(f.mtimeMs).toLocaleString('de-DE');
        return `<tr><td style="padding: 4px 8px;"><code>${escapeHtml(f.name)}</code></td><td style="text-align:right; padding: 4px 8px;">${sz}</td><td style="padding: 4px 8px;">${ts}</td></tr>`;
      }).join('');
      el.innerHTML = `
        <div class="ma-muted" style="margin-bottom: 8px;">Pfad: <code>${escapeHtml(j.copyTo)}</code> · ${j.files.length} Dateien</div>
        <table style="width: 100%; border-collapse: collapse;">
          <thead><tr style="border-bottom: 1px solid var(--ma-border);">
            <th style="text-align:left;  padding: 6px 8px;">Datei</th>
            <th style="text-align:right; padding: 6px 8px;">Groesse</th>
            <th style="text-align:left;  padding: 6px 8px;">Datum</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch (e) {
      const el = $('bkExternalList');
      if (el) el.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function saveConfig() {
    const enabled  = !!($('bkEnabled') && $('bkEnabled').checked);
    const timesRaw = ($('bkTimes') && $('bkTimes').value) || '';
    const times    = timesRaw.split(',').map(s => s.trim()).filter(s => /^\d{2}:\d{2}$/.test(s));
    const copyTo   = ($('bkCopyTo') && $('bkCopyTo').value) || '';
    const keepDays = Number($('bkKeepDays') && $('bkKeepDays').value) || 0;

    if (enabled && !times.length) {
      global.MA.toast('Bitte mindestens eine Zeit angeben (HH:MM)', 'warn');
      return;
    }

    try {
      const j = await global.MA.api.backupSaveConfig({ enabled, times, copyTo, keepDays });
      if (!j.ok) throw new Error(j.error || 'speichern fehlgeschlagen');
      global.MA.toast('Backup-Plan gespeichert', 'ok');
      setTimeout(refresh, 500);
    } catch (e) {
      global.MA.toast('Fehler: ' + e.message, 'bad');
    }
  }

  async function runNow() {
    if (!confirm('Jetzt sofort ein Backup ausfuehren?\n\nDas kann einige Minuten dauern.')) return;
    try {
      global.MA.toast('Backup gestartet ...', 'info');
      const j = await global.MA.api.backupRunNow();
      if (j.ok) global.MA.toast('Backup OK', 'ok');
      else      global.MA.toast('Backup fehlgeschlagen', 'bad');
      setTimeout(refresh, 500);
      setTimeout(loadExternalList, 1500);
    } catch (e) {
      global.MA.toast('Fehler: ' + e.message, 'bad');
    }
  }

  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.backup = { init, refresh };
  global.MA.backup = { refresh };
})(window);
