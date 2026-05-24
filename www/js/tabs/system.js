(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;
  let initialized = false;
  let sysConfig = null;
  let hosts = [];

  function init() {
    if (initialized) return;
    initialized = true;
    $('sysReload')     && $('sysReload').addEventListener('click', refresh);
    $('sysSaveConfig') && $('sysSaveConfig').addEventListener('click', saveSysConfig);
    $('sysBackupNow')  && $('sysBackupNow').addEventListener('click', triggerBackup);
    $('sysAddCustomLink')   && $('sysAddCustomLink').addEventListener('click', addCustomLinkRow);
    $('sysSaveCustomLinks') && $('sysSaveCustomLinks').addEventListener('click', saveCustomLinks);
  }

  let customLinks = [];
  async function loadCustomLinks() {
    const body = $('sysCustomLinksBody'); if (!body) return;
    try {
      const r = await global.MA.api.getCustomLinks();
      customLinks = r.items || [];
      renderCustomLinks();
    } catch (e) { body.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`; }
  }
  function renderCustomLinks() {
    const body = $('sysCustomLinksBody'); if (!body) return;
    if (!customLinks.length) { body.innerHTML = '<div class="ma-muted">Keine eigenen Links. Mit "+ Link" einen hinzufügen — z.B. zigbee2mqtt-Frontend (http://10.1.1.13:8080), Proxmox-UI, Router-Web.</div>'; return; }
    body.innerHTML = `
      <table class="ma-table">
        <thead><tr><th>Bezeichnung</th><th>URL</th><th></th></tr></thead>
        <tbody>
        ${customLinks.map((l, i) => `
          <tr>
            <td><input class="ma-input" data-cl-i="${i}" data-cl-f="label" value="${escapeHtml(l.label || '')}" placeholder="z.B. z2m Frontend" /></td>
            <td><input class="ma-input" data-cl-i="${i}" data-cl-f="url"   value="${escapeHtml(l.url   || '')}" placeholder="http://10.1.1.13:8080" /></td>
            <td style="text-align:right"><button class="ma-btn ma-btn-ghost ma-btn-xs ma-btn-danger" data-cl-del="${i}">×</button></td>
          </tr>
        `).join('')}
        </tbody>
      </table>
      <p class="ma-muted" style="font-size:11px; padding: 6px 14px;">URL kann den Platzhalter <code>%ip%</code> enthalten — wird durch den Hostname ersetzt, mit dem du die Bridge aufrufst.</p>
    `;
    body.querySelectorAll('input[data-cl-i]').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = +inp.dataset.clI, f = inp.dataset.clF;
        if (customLinks[i]) customLinks[i][f] = inp.value;
      });
    });
    body.querySelectorAll('button[data-cl-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        customLinks.splice(+btn.dataset.clDel, 1);
        renderCustomLinks();
      });
    });
  }
  function addCustomLinkRow() {
    customLinks.push({ label: '', url: '' });
    renderCustomLinks();
  }
  async function saveCustomLinks() {
    try {
      const clean = customLinks.filter(l => l && l.url && l.url.trim());
      await global.MA.api.setCustomLinks(clean);
      global.MA.toast('Eigene Links gespeichert. Übersicht aktualisiert sich beim nächsten Refresh.', 'ok');
      customLinks = clean;
      renderCustomLinks();
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
  }

  async function refresh() { init(); await Promise.all([loadSysConfig(), loadHosts(), loadBackups(), loadCustomLinks()]); }

  async function triggerBackup() {
    if (!confirm('Backup jetzt erstellen?\n\nLäuft ein paar Minuten, Live-Log erscheint im Terminal-Fenster.\nWenn das Terminal hängenbleibt, mit × oben rechts schließen — der Backup läuft im Hintergrund weiter und erscheint in der Liste sobald fertig.')) return;
    try {
      const r = await global.MA.api.triggerBackup();
      global.MA.terminal.show(r.runId, 'Fiducerion Backup');
      global.MA.toast('Backup gestartet', 'ok');
      setTimeout(loadBackups, 30000);
      // Backup laeuft im Backend - die Liste mehrmals nach unten hin nochmal updaten
      setTimeout(loadBackups, 60000);
      setTimeout(loadBackups, 180000);
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
  }

  async function loadBackups() {
    const body = $('sysBackupsBody'); if (!body) return;
    try {
      const r = await global.MA.api.listBackups();
      const files = r.files || [];
      const header = `
        <div style="padding: 10px 14px; border-bottom: 1px solid var(--ma-border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <span class="ma-muted" style="font-size:11px;">${escapeHtml(r.dir || '')} · ${files.length} Datei(en)</span>
          <span style="flex:1"></span>
          <button class="ma-btn" id="sysBackupUpload">📤 Backup hochladen</button>
          <input type="file" id="sysBackupUploadInput" hidden accept=".tar.gz,.tgz,.tar,.zip" />
        </div>
      `;
      if (!files.length) {
        body.innerHTML = header + (r.reason
          ? `<div class="ma-muted" style="padding:14px">${escapeHtml(r.reason)}</div>`
          : '<div class="ma-muted" style="padding:14px">Noch keine Backups vorhanden.</div>');
      } else {
        body.innerHTML = header + `
          <table class="ma-table">
            <thead><tr><th>Datei</th><th>Größe</th><th>Datum</th><th style="text-align:right">Aktion</th></tr></thead>
            <tbody>${files.slice(0, 25).map(f => `
              <tr>
                <td class="ma-mono">${escapeHtml(f.name)}</td>
                <td>${fmtBytes(f.size)}</td>
                <td class="ma-muted">${escapeHtml(new Date(f.modified).toLocaleString('de-DE'))}</td>
                <td style="text-align:right; white-space:nowrap">
                  <button class="ma-btn ma-btn-ghost ma-btn-xs" data-restore="${escapeHtml(f.name)}" title="ioBroker komplett aus diesem Backup wiederherstellen">↻ Restore</button>
                  <button class="ma-btn ma-btn-ghost ma-btn-xs ma-btn-danger expert-only" data-bk-del="${escapeHtml(f.name)}" title="Datei loeschen">🗑</button>
                </td>
              </tr>
            `).join('')}</tbody>
          </table>
          ${files.length > 25 ? `<div class="ma-muted" style="padding: 6px 14px;">... ${files.length - 25} weitere</div>` : ''}
        `;
      }

      const uplBtn = $('sysBackupUpload'), uplInp = $('sysBackupUploadInput');
      if (uplBtn && uplInp) {
        uplBtn.addEventListener('click', () => uplInp.click());
        uplInp.addEventListener('change', onBackupUpload);
      }
      body.querySelectorAll('button[data-restore]').forEach(btn => btn.addEventListener('click', () => doRestore(btn.dataset.restore)));
      body.querySelectorAll('button[data-bk-del]').forEach(btn => btn.addEventListener('click', () => doDelete(btn.dataset.bkDel)));
    } catch (e) { body.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`; }
  }

  async function onBackupUpload(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (file.size > 110 * 1024 * 1024) { global.MA.toast('Datei zu groß (>110 MB). Per SFTP nach /opt/iobroker/backups/ kopieren.', 'bad'); return; }
    if (!confirm(`Backup hochladen?\n${file.name} (${(file.size/1024/1024).toFixed(1)} MB)`)) return;
    try {
      global.MA.toast('Upload läuft...', 'info');
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => { const s = String(r.result); const idx = s.indexOf(','); res(idx >= 0 ? s.slice(idx + 1) : s); };
        r.onerror = () => rej(new Error('FileReader-Fehler'));
        r.readAsDataURL(file);
      });
      await global.MA.api.uploadBackup(file.name, b64);
      global.MA.toast('Backup hochgeladen', 'ok');
      loadBackups();
    } catch (e) { global.MA.toast('Upload-Fehler: ' + e.message, 'bad'); }
  }

  async function doRestore(filename) {
    if (!confirm(`⚠️ RESTORE wirklich starten?\n\nDatei: ${filename}\n\n` +
                 `ACHTUNG: ioBroker wird komplett aus dieser Datei wiederhergestellt. Alle aktuellen Daten werden überschrieben. ioBroker startet neu, die Bridge ist während des Restores nicht erreichbar.\n\n` +
                 `Auf jeden Fall vorher ein aktuelles Backup im Verzeichnis liegen haben!`)) return;
    if (!confirm(`Letzte Sicherheitsfrage: wirklich RESTORE aus ${filename}?`)) return;
    try {
      const r = await global.MA.api.triggerRestore(filename);
      global.MA.terminal.show(r.runId, 'Fiducerion Restore: ' + filename);
      global.MA.toast('Restore gestartet — siehe Terminal', 'info');
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
  }

  async function doDelete(filename) {
    if (!confirm(`Backup-Datei löschen?\n${filename}\n\nKann nicht rückgängig gemacht werden.`)) return;
    try {
      await global.MA.api.deleteBackup(filename);
      global.MA.toast('Datei gelöscht', 'ok');
      loadBackups();
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
  }

  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(2) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  async function loadSysConfig() {
    const body = $('sysConfigBody'); if (!body) return;
    body.innerHTML = 'Lade...';
    try {
      sysConfig = await global.MA.api.getSysConfig();
      renderSysConfig();
    } catch (e) { body.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`; }
  }

  function renderSysConfig() {
    if (!sysConfig) return;
    const c = sysConfig.common || {};
    // i18n-Werte sind oft {de: "..."} oder noch tiefer verschachtelt. Rekursiv extrahieren.
    function s(v, depth) {
      depth = depth || 0;
      if (v == null) return '';
      if (typeof v === 'string') {
        // Hatte schon mal "[object Object]" als String gespeichert? Cleanen.
        if (v === '[object Object]' || v === '[Object object]') return '';
        return v;
      }
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      if (typeof v !== 'object') return '';
      if (depth > 5) return '';
      // Priorisierte Felder
      const order = ['de', 'en', 'ru', 'value', 'name', 'text', 'title'];
      for (const k of order) {
        if (v[k] != null) {
          const r = s(v[k], depth + 1);
          if (r) return r;
        }
      }
      // Sonst: erstes nicht-leeres Property
      for (const k of Object.keys(v)) {
        const r = s(v[k], depth + 1);
        if (r) return r;
      }
      return '';
    }
    const body = $('sysConfigBody');
    body.innerHTML = `
      <div class="sys-form">
        <div class="cfg-field">
          <label class="cfg-label">Installations-Name</label>
          <input class="ma-input" data-key="name" value="${escapeHtml(s(c.name))}" />
        </div>
        <div class="cfg-field">
          <label class="cfg-label">Sprache</label>
          <select class="ma-select" data-key="language">
            ${langOpts(s(c.language))}
          </select>
        </div>
        <div class="cfg-field">
          <label class="cfg-label">Temperatur-Einheit</label>
          <select class="ma-select" data-key="tempUnit">
            <option value="°C" ${s(c.tempUnit)==='°C'?'selected':''}>°C</option>
            <option value="°F" ${s(c.tempUnit)==='°F'?'selected':''}>°F</option>
          </select>
        </div>
        <div class="cfg-field">
          <label class="cfg-label">Währung</label>
          <input class="ma-input" data-key="currency" value="${escapeHtml(s(c.currency))}" placeholder="z.B. €, $, EUR" />
        </div>
        <div class="cfg-field">
          <label class="cfg-label">Datumsformat</label>
          <input class="ma-input" data-key="dateFormat" value="${escapeHtml(s(c.dateFormat))}" placeholder="DD.MM.YYYY" />
        </div>
        <div class="cfg-field">
          <label class="cfg-label">Erster Wochentag</label>
          <select class="ma-select" data-key="firstDayOfWeek">
            <option value="monday" ${s(c.firstDayOfWeek)==='monday'?'selected':''}>Montag</option>
            <option value="sunday" ${s(c.firstDayOfWeek)==='sunday'?'selected':''}>Sonntag</option>
          </select>
        </div>
        <div class="cfg-field">
          <label class="cfg-label">Land</label>
          <input class="ma-input" data-key="country" value="${escapeHtml(s(c.country))}" />
        </div>
        <div class="cfg-field">
          <label class="cfg-label">Ort</label>
          <input class="ma-input" data-key="city" value="${escapeHtml(s(c.city))}" />
        </div>
        <div class="cfg-field">
          <label class="cfg-label">Breitengrad</label>
          <input class="ma-input" data-key="latitude" data-type="number" value="${c.latitude != null ? c.latitude : ''}" />
        </div>
        <div class="cfg-field">
          <label class="cfg-label">Längengrad</label>
          <input class="ma-input" data-key="longitude" data-type="number" value="${c.longitude != null ? c.longitude : ''}" />
        </div>
        <div class="cfg-field">
          <label class="cfg-label">Aktives Repository</label>
          <input class="ma-input" data-key="activeRepo" value="${escapeHtml(s(c.activeRepo))}" placeholder="stable, latest, beta" />
        </div>
        <div class="cfg-field cfg-field-checkbox">
          <label class="cfg-checkbox-wrap">
            <input type="checkbox" data-key="isFloatComma" ${c.isFloatComma?'checked':''} />
            <span>Komma als Dezimaltrennzeichen (z.B. 1,5 statt 1.5)</span>
          </label>
        </div>
        <div class="cfg-field cfg-field-checkbox">
          <label class="cfg-checkbox-wrap">
            <input type="checkbox" data-key="expertMode" ${c.expertMode?'checked':''} />
            <span>Experten-Modus</span>
          </label>
        </div>
        <div class="cfg-field cfg-field-checkbox">
          <label class="cfg-checkbox-wrap">
            <input type="checkbox" data-key="diag" ${c.diag?'checked':''} />
            <span>Diagnose-Daten senden</span>
          </label>
        </div>
      </div>
    `;
  }

  function langOpts(cur) {
    const langs = [
      ['en','English'], ['de','Deutsch'], ['ru','Русский'], ['pt','Português'],
      ['nl','Nederlands'], ['fr','Français'], ['it','Italiano'], ['es','Español'],
      ['pl','Polski'], ['uk','Українська'], ['zh-cn','中文']
    ];
    return langs.map(([v,l]) => `<option value="${v}" ${cur===v?'selected':''}>${escapeHtml(l)}</option>`).join('');
  }

  async function saveSysConfig() {
    if (!sysConfig) return;
    const inputs = $('sysConfigBody').querySelectorAll('[data-key]');
    const newCommon = {};
    inputs.forEach(inp => {
      const key = inp.dataset.key;
      const type = inp.dataset.type || (inp.type === 'checkbox' ? 'bool' : inp.type === 'number' ? 'number' : 'string');
      let val;
      if (inp.type === 'checkbox') val = inp.checked;
      else if (type === 'number') {
        const t = inp.value.trim();
        val = t === '' ? null : Number(t);
      }
      else val = inp.value;
      newCommon[key] = val;
    });
    const btn = $('sysSaveConfig'); btn.disabled = true;
    try {
      await global.MA.api.saveSysConfig({ common: newCommon });
      global.MA.toast('Grundkonfiguration gespeichert', 'ok');
      loadSysConfig();
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    finally { btn.disabled = false; }
  }

  // ---- Hosts ----
  async function loadHosts() {
    const body = $('sysHostsBody'); if (!body) return;
    body.innerHTML = 'Lade...';
    try {
      const r = await global.MA.api.systemHosts();
      hosts = r.hosts || [];
      renderHosts();
    } catch (e) { body.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`; }
  }

  function renderHosts() {
    const body = $('sysHostsBody');
    if (!hosts.length) { body.innerHTML = '<div class="ma-muted">Keine Hosts gefunden</div>'; return; }
    body.innerHTML = '<div class="sys-host-grid">' + hosts.map(h => `
      <div class="sys-host-card">
        <div class="sys-host-head">
          <span class="ma-pill ${h.alive?'ma-pill-ok':''}">${h.alive?'läuft':'offline'}</span>
          <strong class="sys-host-name">${escapeHtml(h.name)}</strong>
        </div>
        <div class="sys-host-rows">
          <div><span class="ma-muted">Hostname:</span> ${escapeHtml(h.hostname || '—')}</div>
          <div><span class="ma-muted">Plattform:</span> ${escapeHtml(h.platform || '—')}</div>
          <div><span class="ma-muted">js-controller:</span> ${escapeHtml(h.installedVersion || '—')}</div>
        </div>
        <button class="ma-btn ma-btn-ghost" data-host="${escapeHtml(h.id)}">Details</button>
      </div>
    `).join('') + '</div>';
    body.querySelectorAll('button[data-host]').forEach(btn => {
      btn.addEventListener('click', () => openHostDetail(btn.dataset.host));
    });
  }

  // ---- Host-Detail-Modal ----
  let hostModalEl = null;
  let currentHost = null;
  let hostEditMode = false;
  let hostRawMode = false;  // Roh-JSON-Editor

  function ensureHostModal() {
    if (hostModalEl) return;
    hostModalEl = document.createElement('div');
    hostModalEl.className = 'ma-modal-overlay';
    hostModalEl.innerHTML = `
      <div class="ma-modal ma-modal-host">
        <div class="ma-modal-head">
          <div class="ma-modal-title" id="hdTitle">Host</div>
          <button class="ma-btn ma-btn-ghost" id="hdEditBtn">✎ Bearbeiten</button>
          <button class="ma-btn ma-btn-ghost expert-only" id="hdRawBtn" hidden>{ } Roh</button>
          <button class="ma-btn" id="hdSaveBtn" hidden>Speichern</button>
          <button class="ma-modal-close" id="hdCloseBtn">Schließen</button>
        </div>
        <div class="ma-modal-body" id="hdBody">Lade...</div>
      </div>
    `;
    document.body.appendChild(hostModalEl);
    document.getElementById('hdCloseBtn').addEventListener('click', () => {
      hostModalEl.classList.remove('open');
      hostEditMode = false;
      hostRawMode = false;
      toggleEditButtons();
    });
    document.getElementById('hdEditBtn').addEventListener('click', () => {
      hostEditMode = true;
      hostRawMode = false;
      toggleEditButtons();
      if (currentHost) renderHostDetail(currentHost);
    });
    document.getElementById('hdRawBtn').addEventListener('click', () => {
      hostEditMode = true;
      hostRawMode = !hostRawMode;
      toggleEditButtons();
      if (currentHost) renderHostDetail(currentHost);
    });
    document.getElementById('hdSaveBtn').addEventListener('click', saveHost);
  }

  function toggleEditButtons() {
    const edit = document.getElementById('hdEditBtn');
    const raw  = document.getElementById('hdRawBtn');
    const save = document.getElementById('hdSaveBtn');
    if (!edit || !save || !raw) return;
    edit.hidden = hostEditMode && !hostRawMode;
    raw.hidden  = !hostEditMode;
    save.hidden = !hostEditMode;
    raw.textContent = hostRawMode ? '← Form' : '{ } Roh';
  }

  async function openHostDetail(hostId) {
    ensureHostModal();
    hostEditMode = false;
    hostRawMode = false;
    toggleEditButtons();
    document.getElementById('hdTitle').textContent = hostId.replace(/^system\.host\./, '');
    document.getElementById('hdBody').innerHTML = 'Lade...';
    hostModalEl.classList.add('open');
    try {
      currentHost = await global.MA.api.getHost(hostId);
      renderHostDetail(currentHost);
    } catch (e) {
      document.getElementById('hdBody').innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function saveHost() {
    if (!currentHost) return;
    const saveBtn = document.getElementById('hdSaveBtn'); if (saveBtn) saveBtn.disabled = true;
    try {
      let patch;
      if (hostRawMode) {
        const ta = document.getElementById('hdRawJson');
        if (!ta) return;
        try {
          const parsed = JSON.parse(ta.value);
          patch = {};
          if (parsed.common) patch.common = parsed.common;
          if (parsed.native) patch.native = parsed.native;
        } catch (e) { global.MA.toast('JSON-Fehler: ' + e.message, 'bad'); return; }
      } else {
        const titleInp    = document.getElementById('hdTitleInp');
        const loglevelInp = document.getElementById('hdLoglevelInp');
        patch = { common: {} };
        if (titleInp)    patch.common.title    = titleInp.value;
        if (loglevelInp) patch.common.loglevel = loglevelInp.value;
      }
      await global.MA.api.saveHost(currentHost.id, patch);
      global.MA.toast('Host-Konfig gespeichert', 'ok');
      hostEditMode = false;
      hostRawMode = false;
      toggleEditButtons();
      currentHost = await global.MA.api.getHost(currentHost.id);
      renderHostDetail(currentHost);
      loadHosts();
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    finally { if (saveBtn) saveBtn.disabled = false; }
  }

  function renderHostDetail(d) {
    const c = d.common || {};
    const n = d.native || {};
    const s = d.states || {};
    const osInfo = n.os || {};
    const hw = n.hardware || {};
    const cpus = Array.isArray(hw.cpus) ? hw.cpus : [];
    const netifs = hw.networkInterfaces || {};

    // Raw-Modus: kompletter native + common als JSON-Editor
    if (hostRawMode) {
      const rawObj = { common: c, native: n };
      document.getElementById('hdBody').innerHTML = `
        <div class="cfg-fallback-info"><strong>Roh-Editor.</strong> Vorsicht: falsche Werte können den Host kaputt machen. Native-Werte (cpus, totalmem, networkInterfaces) sind system-erfasst — Änderungen daran werden beim Restart überschrieben.</div>
        <textarea class="cfg-raw" id="hdRawJson" rows="28" spellcheck="false">${escapeHtml(JSON.stringify(rawObj, null, 2))}</textarea>
      `;
      return;
    }

    function fmtBytes(v) {
      if (v == null) return '—';
      const num = Number(v);
      if (!isFinite(num)) return '—';
      const mb = num / (1024 * 1024);
      if (mb > 1024) return (mb / 1024).toFixed(2) + ' GB';
      return mb.toFixed(1) + ' MB';
    }
    function fmtUptime(secs) {
      if (secs == null) return '—';
      const n = Number(secs);
      if (!isFinite(n)) return '—';
      const days = Math.floor(n / 86400);
      const h = Math.floor((n % 86400) / 3600);
      const m = Math.floor((n % 3600) / 60);
      return `${days}d ${h}h ${m}m`;
    }

    // Editierbar: title, loglevel, address, color (falls vorhanden)
    const titleField    = hostEditMode
      ? `<input class="ma-input" id="hdTitleInp" value="${escapeHtml(c.title || '')}" />`
      : `<strong>${escapeHtml(c.title || c.name || d.id.replace(/^system\.host\./, ''))}</strong>`;
    const loglevelOpts  = ['silly','debug','info','warn','error']
      .map(l => `<option value="${l}" ${c.loglevel===l?'selected':''}>${l}</option>`).join('');
    const loglevelField = hostEditMode
      ? `<select class="ma-select" id="hdLoglevelInp">${loglevelOpts}</select>`
      : `<span>${escapeHtml(c.loglevel || 'info')}</span>`;

    document.getElementById('hdBody').innerHTML = `
      <div class="sys-host-detail">

        <h3 class="sys-h">Allgemein</h3>
        <div class="sys-grid">
          <div><span class="ma-muted">Titel:</span> ${titleField}</div>
          <div><span class="ma-muted">Default-Loglevel:</span> ${loglevelField}</div>
        </div>

        <h3 class="sys-h">Status</h3>
        <div class="sys-grid">
          <div><span class="ma-muted">Status:</span> <span class="ma-pill ${s.alive && s.alive.val ? 'ma-pill-ok' : ''}">${s.alive && s.alive.val ? 'läuft' : 'offline'}</span></div>
          <div><span class="ma-muted">Uptime:</span> ${escapeHtml(fmtUptime(s.uptime && s.uptime.val))}</div>
          <div><span class="ma-muted">Last Load:</span> ${s.load && s.load.val != null ? Number(s.load.val).toFixed(2) : '—'}</div>
          <div><span class="ma-muted">CPU:</span> ${s.cpu && s.cpu.val != null ? Number(s.cpu.val).toFixed(1) + ' %' : '—'}</div>
          <div><span class="ma-muted">RAM frei:</span> ${escapeHtml(fmtBytes(s.freemem && s.freemem.val))} (${s.freememPercent && s.freememPercent.val != null ? Number(s.freememPercent.val).toFixed(0) + ' %' : '—'})</div>
          <div><span class="ma-muted">Disk frei:</span> ${s.diskFree && s.diskFree.val != null ? Number(s.diskFree.val).toFixed(0) + ' MB' : '—'} / ${s.diskSize && s.diskSize.val != null ? Number(s.diskSize.val).toFixed(0) + ' MB' : '—'}</div>
        </div>

        <h3 class="sys-h">System</h3>
        <div class="sys-grid">
          <div><span class="ma-muted">Hostname:</span> ${escapeHtml(osInfo.hostname || '—')}</div>
          <div><span class="ma-muted">Plattform:</span> ${escapeHtml(osInfo.platform || '—')}</div>
          <div><span class="ma-muted">Typ:</span> ${escapeHtml(osInfo.type || '—')}</div>
          <div><span class="ma-muted">Release:</span> ${escapeHtml(osInfo.release || '—')}</div>
          <div><span class="ma-muted">Architektur:</span> ${escapeHtml(osInfo.arch || '—')}</div>
          <div><span class="ma-muted">js-controller:</span> ${escapeHtml(c.installedVersion || '—')}</div>
          <div><span class="ma-muted">Node:</span> ${escapeHtml(osInfo.nodeVersion || '—')}</div>
        </div>

        <h3 class="sys-h">Hardware</h3>
        <div class="sys-grid">
          <div><span class="ma-muted">CPU:</span> ${escapeHtml(cpus[0] ? (cpus[0].model || '—') : '—')}</div>
          <div><span class="ma-muted">Kerne:</span> ${cpus.length || '—'}</div>
          <div><span class="ma-muted">RAM gesamt:</span> ${escapeHtml(fmtBytes(hw.totalmem))}</div>
        </div>

        <h3 class="sys-h">Netzwerk</h3>
        <div class="sys-net">
          ${Object.entries(netifs).map(([name, addrs]) => `
            <div class="sys-net-row">
              <strong>${escapeHtml(name)}</strong>
              <span>${Array.isArray(addrs) ? addrs.filter(a => !a.internal).map(a => escapeHtml(a.address)).join(', ') : '—'}</span>
            </div>
          `).join('') || '<div class="ma-muted">—</div>'}
        </div>

        <p class="ma-muted" style="font-size:11px; margin-top:14px">
          ${hostEditMode
            ? 'Editierbar sind Titel und Default-Loglevel. Übrige Felder werden vom System gemeldet.'
            : '"Bearbeiten" oben rechts, um Titel und Loglevel zu ändern.'}
        </p>
      </div>
    `;
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.system = { init, refresh };
  // Expose backup-funktionen damit der Backup-Tab sie nutzen kann
  global.MA.system = {
    init: init,
    loadBackups:   () => loadBackups(),
    triggerBackup: () => triggerBackup()
  };
})(window);
