(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;
  let initialized = false;
  let items = [];
  const collapsed = new Set(); // folder-pfade, die kollabiert sind

  function init() {
    if (initialized) return;
    initialized = true;
    $('scrReload') && $('scrReload').addEventListener('click', load);
    $('scrSearch') && $('scrSearch').addEventListener('input', render);
    $('scrFilter') && $('scrFilter').addEventListener('change', render);
    $('scrExpandAll')   && $('scrExpandAll').addEventListener('click',   () => { collapsed.clear(); saveCollapsedToStorage(); render(); });
    $('scrCollapseAll') && $('scrCollapseAll').addEventListener('click', () => { collapseAll(); saveCollapsedToStorage(); render(); });
    $('scrExportAll')   && $('scrExportAll').addEventListener('click', exportAll);
    $('scrImportAll')   && $('scrImportAll').addEventListener('click', () => $('scrImportInput').click());
    $('scrImportInput') && $('scrImportInput').addEventListener('change', onImportFile);
    $('scrNew') && $('scrNew').addEventListener('click', openNewDialog);
  }

  async function refresh() { init(); await load(); }

  // Punkt 6: Folder-Status pro Tree-Pfad in localStorage merken
  const COLLAPSED_LS_KEY  = 'fid-bridge.scripts.collapsed';
  const LAST_SCRIPT_LS_KEY = 'fid-bridge.scripts.lastOpened';
  let initialLoadDone = false;

  function loadCollapsedFromStorage() {
    try {
      const raw = localStorage.getItem(COLLAPSED_LS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          collapsed.clear();
          arr.forEach(p => collapsed.add(p));
          return true;
        }
      }
    } catch (e) {}
    return false;
  }
  function saveCollapsedToStorage() {
    try { localStorage.setItem(COLLAPSED_LS_KEY, JSON.stringify(Array.from(collapsed))); } catch (e) {}
  }

  async function load() {
    const tree = document.querySelector('#scrTree');
    if (tree) tree.innerHTML = '<div class="ma-muted">Lade...</div>';
    try {
      const r = await global.MA.api.listScripts();
      items = r.items || [];

      if (!initialLoadDone) {
        initialLoadDone = true;
        // Punkt 6: beim ersten Render entweder gespeicherten Collapsed-State
        // wiederherstellen ODER default ALLES zugeklappt anzeigen
        const hadStored = loadCollapsedFromStorage();
        if (!hadStored) {
          collapseAll();
        }
        // Plus: zuletzt geoeffnetes Skript wiederherstellen (deep-link aehnlich)
        try {
          const lastId = localStorage.getItem(LAST_SCRIPT_LS_KEY);
          if (lastId) {
            // Pfad aufklappen damit das Skript sichtbar ist
            const parts = lastId.split('.');
            for (let i = 1; i < parts.length; i++) {
              collapsed.delete(parts.slice(0, i).join('.'));
            }
          }
        } catch (e) {}
      }

      render();
    } catch (e) {
      if (tree) tree.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`;
    }
  }

  function buildTree(its) {
    const root = { folders: {}, scripts: [], path: '' };
    its.forEach(it => {
      const parts = it.shortId.split('.');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!node.folders[p]) node.folders[p] = { folders: {}, scripts: [], path: (node.path ? node.path + '.' : '') + p };
        node = node.folders[p];
      }
      node.scripts.push({ ...it, leafName: parts[parts.length - 1] });
    });
    return root;
  }

  function countTotal(node) {
    let n = node.scripts.length;
    for (const sub of Object.values(node.folders)) n += countTotal(sub);
    return n;
  }
  function countOn(node) {
    let n = node.scripts.filter(s => s.enabled).length;
    for (const sub of Object.values(node.folders)) n += countOn(sub);
    return n;
  }
  function collapseAll() {
    function walk(node) {
      for (const [name, sub] of Object.entries(node.folders)) {
        collapsed.add(sub.path);
        walk(sub);
      }
    }
    walk(buildTree(items));
  }

  function render() {
    const container = document.querySelector('#scrTree');
    if (!container) return;
    const q = (($('scrSearch') && $('scrSearch').value) || '').toLowerCase().trim();
    const filter = ($('scrFilter') && $('scrFilter').value) || 'all';

    const filtered = items.filter(it => {
      if (filter === 'enabled'  && !it.enabled) return false;
      if (filter === 'disabled' &&  it.enabled) return false;
      if (q && !it.shortId.toLowerCase().includes(q) && !String(it.name).toLowerCase().includes(q)) return false;
      return true;
    });

    container.innerHTML = '';
    if (!filtered.length) {
      container.innerHTML = '<div class="ma-muted">Keine Treffer</div>';
      return;
    }

    const tree = buildTree(filtered);
    // Wenn aktiv gesucht/gefiltert: alle Folders aufgeklappt (sonst sieht man Treffer nicht)
    const forceExpand = !!(q || filter !== 'all');
    renderNode(tree, container, 0, forceExpand);
  }

  function renderNode(node, container, depth, forceExpand) {
    Object.keys(node.folders).sort().forEach(name => {
      const folder = node.folders[name];
      const total  = countTotal(folder);
      const onCnt  = countOn(folder);
      const isCollapsed = !forceExpand && collapsed.has(folder.path);

      const header = document.createElement('div');
      header.className = 'scr-folder';
      header.style.paddingLeft = (depth * 18 + 8) + 'px';
      header.innerHTML = `
        <span class="scr-folder-arrow">${isCollapsed ? '▶' : '▼'}</span>
        <span class="scr-folder-icon">📁</span>
        <span class="scr-folder-name">${escapeHtml(name)}</span>
        <span class="scr-folder-count">${onCnt}/${total} an</span>
      `;
      header.addEventListener('click', () => {
        if (collapsed.has(folder.path)) collapsed.delete(folder.path);
        else collapsed.add(folder.path);
        saveCollapsedToStorage();
        render();
      });
      container.appendChild(header);

      if (!isCollapsed) {
        const body = document.createElement('div');
        body.className = 'scr-folder-body';
        container.appendChild(body);
        renderNode(folder, body, depth + 1, forceExpand);
      }
    });

    node.scripts.sort((a, b) => a.leafName.localeCompare(b.leafName)).forEach(s => {
      const row = document.createElement('div');
      row.className = 'scr-script ' + (s.enabled ? 'scr-on' : 'scr-off');
      row.style.paddingLeft = (depth * 18 + 8) + 'px';
      const icon = s.engineType === 'Blockly' ? '🧩' : s.engineType === 'TypeScript' ? '🟦' : '📜';
      row.innerHTML = `
        <span class="scr-script-icon">${icon}</span>
        <span class="scr-script-name">${escapeHtml(s.leafName)}</span>
        <span class="scr-pill ${s.enabled ? 'scr-pill-on' : 'scr-pill-off'}">${s.enabled ? 'an' : 'aus'}</span>
        <span class="scr-script-size">${s.sourceLength.toLocaleString('de')}</span>
        <span class="scr-script-actions">
          <button class="ma-btn ma-btn-ghost ma-btn-xs" data-act="edit"   data-id="${escapeHtml(s.id)}">Editor</button>
          <button class="ma-btn ma-btn-ghost ma-btn-xs" data-act="toggle" data-id="${escapeHtml(s.id)}" data-enabled="${s.enabled}">${s.enabled ? 'Aus' : 'An'}</button>
          <button class="ma-btn ma-btn-ghost ma-btn-xs" data-act="export" data-id="${escapeHtml(s.id)}" title="Diese Automation als JSON-Datei exportieren">⤓</button>
          <button class="ma-btn ma-btn-ghost ma-btn-xs" data-act="rename" data-id="${escapeHtml(s.id)}" title="Umbenennen / Verschieben">✎</button>
          <button class="ma-btn ma-btn-ghost ma-btn-xs ma-btn-danger expert-only" data-act="delete" data-id="${escapeHtml(s.id)}" title="Löschen">🗑</button>
        </span>
      `;
      row.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const id = btn.dataset.id, act = btn.dataset.act;
          if (act === 'edit')   {
            try { localStorage.setItem(LAST_SCRIPT_LS_KEY, id); } catch (e) {}
            global.MA.scriptEditor.open(id);
            return;
          }
          if (act === 'rename') { openRenameDialog(id); return; }
          if (act === 'export') { exportOne(id); return; }
          if (act === 'delete') {
            if (!confirm(`Automation wirklich löschen?\n\n${id}\n\nQuellcode geht verloren.`)) return;
            try {
              await global.MA.api.deleteScript(id);
              global.MA.toast('Automation gelöscht', 'ok');
              setTimeout(load, 400);
            } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
            return;
          }
          if (act === 'toggle') {
            const newState = btn.dataset.enabled !== 'true';
            btn.disabled = true;
            try {
              await global.MA.api.updateScript(id, { enabled: newState });
              global.MA.toast('Automation ' + (newState ? 'eingeschaltet' : 'ausgeschaltet'), 'ok');
              setTimeout(load, 500);
            } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); btn.disabled = false; }
          }
        });
      });
      container.appendChild(row);
    });
  }

  // ---- Neu / Umbenennen Dialoge ----
  function openNewDialog() {
    const path = prompt('Pfad der neuen Automation:\n(z.B. common.mein-script oder alarm.NeuerAlarm)\n\nWird unter script.js. angelegt.', 'common.NeueAutomation');
    if (!path) return;
    const clean = String(path).trim().replace(/^\/+|\/+$/g, '').replace(/\//g, '.').replace(/^script\.js\.?/, '');
    if (!/^[A-Za-z0-9_.\-]+$/.test(clean)) { global.MA.toast('Ungültige Zeichen im Pfad', 'bad'); return; }
    const fullId = 'script.js.' + clean;
    const engineType = prompt('Engine-Type: Javascript, TypeScript oder Blockly', 'Javascript') || 'Javascript';
    const initialSrc = engineType === 'Javascript'
      ? `// ${clean.split('.').pop()}\n// erzeugt am ${new Date().toLocaleString('de-DE')}\n\nlog('hello');\n`
      : '';
    (async () => {
      try {
        await global.MA.api.createScript({ id: fullId, name: clean.split('.').pop(), engineType, source: initialSrc });
        global.MA.toast('Automation angelegt: ' + fullId, 'ok');
        setTimeout(() => { load(); global.MA.scriptEditor.open(fullId); }, 400);
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function openRenameDialog(oldId) {
    const oldShort = oldId.replace(/^script\.js\./, '');
    const proposed = prompt(`Neuer Pfad für die Automation:\nAlt: ${oldShort}\n\n(Punkte = Ordner; Beispiel: common.MeinScript_renamed)`, oldShort);
    if (!proposed) return;
    const clean = String(proposed).trim().replace(/^script\.js\.?/, '');
    if (!/^[A-Za-z0-9_.\-]+$/.test(clean)) { global.MA.toast('Ungültige Zeichen im Pfad', 'bad'); return; }
    const newId = 'script.js.' + clean;
    if (newId === oldId) return;
    (async () => {
      try {
        await global.MA.api.renameScript(oldId, newId);
        global.MA.toast(`Verschoben: ${oldShort} → ${clean}`, 'ok');
        setTimeout(load, 400);
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  async function exportAll() {
    if (!confirm('Alle Automationen als JSON-Datei exportieren?')) return;
    try {
      global.MA.toast('Exportiere...', 'info');
      const r = await global.MA.api.exportScripts();
      downloadJson(r, `fiducerion-scripts-${tsTag()}.json`);
      global.MA.toast(`Export: ${r.count} Automationen`, 'ok');
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
  }

  async function exportOne(id) {
    try {
      const r = await global.MA.api.exportScripts(id);
      const safe = id.replace(/[^a-zA-Z0-9_.\-]/g, '_');
      downloadJson(r, `fiducerion-script-${safe}-${tsTag()}.json`);
      global.MA.toast('Exportiert: ' + id.split('.').pop(), 'ok');
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
  }

  function downloadJson(obj, filename) {
    const json = JSON.stringify(obj, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  function tsTag() {
    return new Date().toISOString().slice(0,16).replace(/[T:]/g, '_');
  }

  async function onImportFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const txt = await file.text();
      const data = JSON.parse(txt);
      if (!data.scripts || !Array.isArray(data.scripts)) throw new Error('Datei enthält kein scripts[]');
      const overwrite = confirm(`${data.scripts.length} Automationen importieren\n\nBestehende mit gleicher ID überschreiben?\n\nOK = überschreiben, Abbrechen = überspringen`);
      const keepDisabled = confirm('Aktivierte Automationen aus der Datei aktiv übernehmen?\n\nOK = aktiv lassen (riskant — Scripts können sofort laufen)\nAbbrechen = alle erst deaktiviert anlegen (empfohlen)');
      global.MA.toast('Importiere...', 'info');
      const r = await global.MA.api.importScripts({
        scripts: data.scripts,
        overwrite,
        disableAll: !keepDisabled
      });
      const msg = `Import: ${r.created} neu / ${r.updated} aktualisiert / ${r.skipped} übersprungen / ${r.errors} Fehler`;
      global.MA.toast(msg, r.errors ? 'warn' : 'ok');
      setTimeout(load, 600);
    } catch (e) { global.MA.toast('Import-Fehler: ' + e.message, 'bad'); }
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.scripts = { init, refresh };
})(window);
