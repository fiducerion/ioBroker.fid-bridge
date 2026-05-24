(function (global) {
  'use strict';
  const { $, escapeHtml, fmtVal } = global.MA.ui;

  let initialized = false;
  let items = [];
  let filtered = [];
  let selectedId = '';

  function init() {
    if (initialized) return;
    initialized = true;
    $('objLoadBtn') && $('objLoadBtn').addEventListener('click', load);
    $('objPrefix') && $('objPrefix').addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
    $('objFilter') && $('objFilter').addEventListener('input', applyFilter);
    $('objType')   && $('objType').addEventListener('change', load);
    $('objSpecial')&& $('objSpecial').addEventListener('change', load);
    $('objExpandAll')   && $('objExpandAll').addEventListener('click', () => {
      treeCollapsed.clear();
      render();
    });
    $('objCollapseAll') && $('objCollapseAll').addEventListener('click', () => {
      if (filtered && filtered.length) {
        const root = buildTree(filtered);
        collapseAllInTree(root);
        render();
      }
    });
    $('objExportBtn') && $('objExportBtn').addEventListener('click', exportTree);
    $('objImportBtn') && $('objImportBtn').addEventListener('click', () => $('objImportInput').click());
    $('objImportInput') && $('objImportInput').addEventListener('change', onImportFile);
    $('objCopyLink') && $('objCopyLink').addEventListener('click', () => {
      if (!selectedId) { global.MA.toast('Erst einen Eintrag wählen', 'warn'); return; }
      const u = new URL(location.href);
      u.searchParams.set('tab', 'objects');
      u.searchParams.set('obj', selectedId);
      navigator.clipboard.writeText(u.toString()).then(() => {
        global.MA.toast('Link kopiert', 'ok');
      }).catch(() => {
        global.MA.toast(u.toString(), 'info');
      });
    });
  }

  async function exportTree() {
    const root = ($('objPrefix') && $('objPrefix').value || '').trim();
    if (!root) { global.MA.toast('Bitte einen Prefix angeben (z.B. 0_userdata.0.Energie)', 'warn'); return; }
    if (!confirm(`Export aller Objekte unter "${root}" inkl. aktueller States?\n\nGroße Bereiche können dauern.`)) return;
    try {
      global.MA.toast('Exportiere...', 'info');
      const r = await global.MA.api.exportObjects(root, true);
      const json = JSON.stringify(r, null, 2);
      const safeName = root.replace(/[^a-zA-Z0-9_.\-]/g, '_');
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fiducerion-export-${safeName}-${new Date().toISOString().slice(0,16).replace(/[T:]/g,'_')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      global.MA.toast(`Export: ${r.count} Objekte`, 'ok');
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
  }

  async function onImportFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const txt = await file.text();
      const data = JSON.parse(txt);
      if (!data.items || !Array.isArray(data.items)) throw new Error('Datei enthält kein items[]');
      // Optional: Pfad umschreiben
      const oldRoot = data.root || '';
      const newRoot = prompt(
        `${data.items.length} Objekte importieren\n\nQuell-Pfad: ${oldRoot}\n\nZiel-Pfad (leer = unverändert):`,
        oldRoot
      );
      if (newRoot === null) return;
      const overwrite = confirm('Bereits existierende Objekte überschreiben?\n\nOK = überschreiben, Abbrechen = überspringen');
      const body = { items: data.items, overwrite };
      if (oldRoot && newRoot && newRoot !== oldRoot) {
        body.rootRewrite = { from: oldRoot, to: newRoot };
      }
      global.MA.toast('Importiere...', 'info');
      const r = await global.MA.api.importObjects(body);
      const msg = `Import: ${r.created} neu / übersprungen ${r.skipped} / Fehler ${r.errors} / States gesetzt ${r.statesSet}`;
      global.MA.toast(msg, r.errors ? 'warn' : 'ok');
      setTimeout(load, 600);
    } catch (e) { global.MA.toast('Import-Fehler: ' + e.message, 'bad'); }
  }

  async function refresh() {
    init();
    if (!items.length) await load();
    // Bei Direktlink ?obj=... selectId
    const params = new URLSearchParams(location.search);
    const wantedId = params.get('obj');
    if (wantedId && wantedId !== selectedId) {
      await selectId(wantedId);
    }
    // Refresh-Timer für Inline-State-Werte wieder anschmeißen wenn der Tab aktiviert wird
    const prefix = ($('objPrefix') && $('objPrefix').value || '').trim();
    startStateRefresh(prefix);
  }

  async function load() {
    init();
    const prefix = ($('objPrefix') && $('objPrefix').value || '').trim();
    const type   = ($('objType') && $('objType').value) || 'all';
    const special = ($('objSpecial') && $('objSpecial').value) || '';
    const prog   = $('objProgress');
    const tree   = $('objTree');
    if (prog) prog.textContent = 'Lade Objekte...';
    try {
      const params = { prefix, type, limit: 20000 };
      // Spezial-Filter parsen
      if (special) {
        if (special.startsWith('custom:')) {
          params.customAdapter = special.slice('custom:'.length);
        } else if (special === 'hasCustom') {
          params.hasCustom = '1';
        } else if (special === 'writable') {
          params.writable = '1';
        } else if (special.startsWith('role:')) {
          params.role = special.slice('role:'.length);
        } else if (special === 'historyjson') {
          params.historyJson = '1';
        }
        // Wenn Spezial-Filter: zwingend type=state, sonst macht's keinen Sinn
        if (type === 'all' || type === '') params.type = 'state';
      }
      const r = await global.MA.api.listObjects(params);
      items = r.items || [];
      const filterDesc = special ? ` (Filter: ${special})` : '';
      if (prog) prog.textContent = `Geladen: ${items.length} Objekte${filterDesc}, lade States ...`;
      treeInitialized = false;
      treeCollapsed.clear();
      // Werte für alle states laden, damit der Baum sie inline zeigen kann
      await loadStateValues(prefix, items);
      if (prog) prog.textContent = `Geladen: ${items.length} Objekte${filterDesc}`;
      applyFilter();
      startStateRefresh(prefix);
    } catch (e) {
      if (tree) tree.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`;
      if (prog) prog.textContent = '';
    }
  }

  // Baum-Status
  const treeCollapsed = new Set();
  let treeInitialized = false;
  const TREE_ROW_LIMIT = 3000;

  // Alle Folder im Baum (rekursiv) als collapsed markieren
  function collapseAllInTree(root) {
    function walk(node) {
      if (node.children && node.children.size > 0) {
        if (node.fullId) treeCollapsed.add(node.fullId);
        for (const child of node.children.values()) walk(child);
      }
    }
    walk(root);
  }

  // States für die geladenen Items - inline im Baum anzeigen
  const stateMap = Object.create(null);
  let stateRefreshTimer = null;

  async function loadStateValues(prefix, list) {
    if (!list || !list.length) return;
    // Sehr viele States? Dann pattern auf prefix begrenzen damit's nicht zu groß wird.
    // Server-Pattern '*' lädt potenziell 100.000+ States bei einer großen ioBroker-Instanz
    // - das ist riskant. Daher: Wenn prefix angegeben ist, dieses Pattern nehmen.
    // Sonst: nur die IDs auflisten, die wir wirklich brauchen, in Chunks von 500.
    try {
      const hasPrefix = prefix && prefix.length > 0;
      if (hasPrefix) {
        const pat = prefix + '*';
        const m = await global.MA.api.getStates(pat);
        // m ist {id: {val, ack, ts, ...}}
        for (const id of Object.keys(m || {})) stateMap[id] = m[id];
      } else {
        // Ohne Prefix: pro Chunk durchgehen
        const stateIds = list.filter(it => it.type === 'state').map(it => it.id);
        const CHUNK = 500;
        for (let i = 0; i < stateIds.length; i += CHUNK) {
          const chunk = stateIds.slice(i, i + CHUNK);
          // Pattern aus erstem + letztem - wir nehmen einfach getStates pro Chunk-Min/Max
          // Aber das geht nicht clean - daher pro ID einen Call ist zu langsam. Wir
          // nehmen den * Fallback. Bei sehr großen Setups akzeptieren wir das.
          if (i === 0) {
            const m = await global.MA.api.getStates('*');
            for (const id of Object.keys(m || {})) stateMap[id] = m[id];
            break;  // Ein Call reicht für alle
          }
        }
      }
    } catch (e) {
      // State-Load darf den Baum nicht blocken
      console.warn('loadStateValues:', e);
    }
  }

  // Refresh-Timer: alle 5 Sekunden den States nachladen, solange der Tab sichtbar ist
  function startStateRefresh(prefix) {
    stopStateRefresh();
    stateRefreshTimer = setInterval(async () => {
      // Nur refreshen wenn der objects-Tab gerade aktiv ist (sonst Verschwendung)
      const active = document.querySelector('.ma-tab.active');
      if (!active || active.dataset.tab !== 'objects') return;
      try {
        const pat = prefix && prefix.length ? (prefix + '*') : '*';
        const m = await global.MA.api.getStates(pat);
        for (const id of Object.keys(m || {})) stateMap[id] = m[id];
        // Nur die State-Wert-Zellen aktualisieren, kein kompletter Re-Render
        updateInlineValues();
      } catch (e) { /* still */ }
    }, 5000);
  }
  function stopStateRefresh() {
    if (stateRefreshTimer) { clearInterval(stateRefreshTimer); stateRefreshTimer = null; }
  }

  function updateInlineValues() {
    const tree = $('objTree'); if (!tree) return;
    tree.querySelectorAll('.tree-val[data-state-id]').forEach(el => {
      const id = el.dataset.stateId;
      const st = stateMap[id];
      if (!st) return;
      const newHtml = fmtInlineVal(st);
      if (el.dataset.lastVal !== newHtml) {
        el.dataset.lastVal = newHtml;
        el.innerHTML = newHtml;
        el.classList.add('tree-val-flash');
        setTimeout(() => el.classList.remove('tree-val-flash'), 600);
      }
    });
  }

  function fmtInlineVal(st) {
    if (!st || st.val === null || st.val === undefined) return '<span class="tree-val-null">—</span>';
    let v = st.val;
    if (typeof v === 'object') v = JSON.stringify(v);
    let s = String(v);
    // Lange Strings kürzen
    if (s.length > 60) s = s.slice(0, 57) + '…';
    // Bool farbig
    if (v === true || s === 'true')  return '<span class="tree-val-true">true</span>';
    if (v === false || s === 'false')return '<span class="tree-val-false">false</span>';
    if (typeof v === 'number')       return '<span class="tree-val-num">' + escapeHtml(s) + '</span>';
    return '<span class="tree-val-str">' + escapeHtml(s) + '</span>';
  }

  function applyFilter() {
    const q = (($('objFilter') && $('objFilter').value) || '').toLowerCase().trim();
    filtered = q
      ? items.filter(it => it.id.toLowerCase().includes(q) || (it.name && it.name.toLowerCase().includes(q)))
      : items.slice();
    // Bei aktiver Suche: alle Folder aufklappen, damit Treffer sichtbar
    if (q) {
      treeCollapsed.clear();
      treeInitialized = true;
    }
    render();
  }

  /**
   * Bestimmt Online/Offline-Status fuer ein device/channel/instance.
   * Wie iobroker.admin: schaut nach mehreren typischen Mustern.
   * @returns {boolean|null} true=online, false=offline, null=unbekannt
   */
  function detectOnlineState(id) {
    if (!id || !stateMap) return null;

    // Quellen in Reihenfolge der Prioritaet:
    // 1. Direkter State unter dem Device/Channel: dev.online / dev.connected / dev.alive
    // 2. Sub-channel info.connection oder UNREACH
    // 3. Bei Adapter-Instances: system.adapter.<X>.alive + connected
    const candidates = [];

    // Pattern 1+2: zeile fuer zeile durch stateMap, suche unter prefix
    const prefix = id + '.';
    const onlineLeaves  = ['online', 'connected', 'alive', 'reachable', 'available', 'connection'];
    const offlineLeaves = ['offline', 'unreach', 'unreachable'];

    for (const sid of Object.keys(stateMap)) {
      if (!sid.startsWith(prefix)) continue;
      const sub  = sid.slice(prefix.length);
      const last = sub.split('.').pop().toLowerCase();
      if (!onlineLeaves.includes(last) && !offlineLeaves.includes(last)) continue;

      const st = stateMap[sid];
      if (!st || st.val === null || st.val === undefined) continue;
      const v = st.val;
      const truthy = (v === true || v === 1 || v === '1' || v === 'true' || v === 'online' || v === 'connected');
      const falsy  = (v === false || v === 0 || v === '0' || v === 'false' || v === 'offline');
      if (!truthy && !falsy) continue;

      if (onlineLeaves.includes(last)) {
        candidates.push({ result: truthy, depth: sub.split('.').length, sid });
      } else {
        candidates.push({ result: !truthy, depth: sub.split('.').length, sid });
      }
    }

    // Pattern 3: bei Adapter-Instances (system.adapter.X.0) auch system.adapter.X.0.alive
    if (id.startsWith('system.adapter.')) {
      const aliveSt = stateMap[id + '.alive'];
      if (aliveSt && typeof aliveSt.val === 'boolean') {
        candidates.push({ result: aliveSt.val, depth: 1, sid: id + '.alive' });
      }
    }

    if (!candidates.length) return null;
    // Naechster Treffer mit kleinster Tiefe gewinnt (direkter Sub-State vor verschachteltem)
    candidates.sort((a, b) => a.depth - b.depth);
    return candidates[0].result;
  }
  // Debug-helper damit Bernd ueber console testen kann
  if (typeof global !== 'undefined') {
    global.MA = global.MA || {};
    global.MA._debugDetectOnline = function(id) {
      const result = detectOnlineState(id);
      const prefix = id + '.';
      const matches = Object.keys(stateMap).filter(k => k.startsWith(prefix)).slice(0, 20);
      return { id, result, sampleStates: matches.map(k => ({ id: k, val: stateMap[k] && stateMap[k].val })) };
    };
  }

  function typeIcon(t) {
    switch (t) {
      case 'state':    return '◇';
      case 'channel':  return '▤';
      case 'device':   return '▣';
      case 'folder':   return '▦';
      case 'enum':     return '⌖';
      case 'instance': return '◈';
      case 'adapter':  return '⬢';
      case 'host':     return '⬣';
      case 'script':   return '§';      case 'meta':     return '※';
      default:         return '·';
    }
  }

  function buildTree(list) {
    // Baut einen Baum aus flachen Items basierend auf Punkten in der ID.
    // Knoten: { name, fullId, item (falls Object existiert), children: Map }
    const root = { name: '', fullId: '', item: null, children: new Map() };
    for (const it of list) {
      const parts = it.id.split('.');
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const segment = parts[i];
        const fullId = parts.slice(0, i + 1).join('.');
        if (!node.children.has(segment)) {
          node.children.set(segment, {
            name: segment, fullId, item: null, children: new Map()
          });
        }
        node = node.children.get(segment);
        // Letztes Segment: das ist der Item selbst
        if (i === parts.length - 1) node.item = it;
      }
    }
    return root;
  }

  function flattenTree(root) {
    // Pre-order, mit collapsed-Logik
    const out = [];
    function walk(node, depth) {
      // Root selbst nicht ausgeben
      if (depth > 0) {
        const hasChildren = node.children.size > 0;
        out.push({
          fullId: node.fullId,
          name: node.name,
          item: node.item,
          depth,
          hasChildren,
          isCollapsed: hasChildren && treeCollapsed.has(node.fullId)
        });
      }
      // Kinder nur wenn nicht zugeklappt
      if (depth === 0 || !treeCollapsed.has(node.fullId)) {
        // Sortiert nach Name
        const sortedKeys = Array.from(node.children.keys()).sort();
        for (const k of sortedKeys) walk(node.children.get(k), depth + 1);
      }
    }
    walk(root, 0);
    return out;
  }

  function render() {
    const tree = $('objTree');
    const count = $('objCount');
    if (count) count.innerHTML = `<span class="ma-pill ma-pill-info">${filtered.length}</span>`;
    if (!tree) return;
    if (!filtered.length) { tree.innerHTML = '<div class="ma-muted">Keine Treffer.</div>'; return; }

    // Baum bauen
    const root = buildTree(filtered);

    // Beim ersten Mal nach dem Laden: ALLE Folder zuklappen (nicht nur Top-Level).
    // Punkt 5: User wuenscht default zugeklappt fuer schnelleren Ueberblick.
    if (!treeInitialized) {
      collapseAllInTree(root);
      treeInitialized = true;
    }

    const flat = flattenTree(root);
    const visible = flat.slice(0, TREE_ROW_LIMIT);
    const more = flat.length - visible.length;

    tree.innerHTML = visible.map(n => {
      const isSel = n.item && n.item.id === selectedId;
      const tIcon = n.item ? typeIcon(n.item.type) : '▸';
      const showToggle = n.hasChildren;
      const togIcon = showToggle ? (n.isCollapsed ? '▸' : '▾') : '';
      const idDisplay = n.item ? n.item.id : n.fullId;
      const nameDisplay = n.item && n.item.name && n.item.name !== n.name ? n.item.name : '';
      const indentPx = (n.depth - 1) * 14;
      const isState = n.item && n.item.type === 'state';
      const stateId = isState ? n.item.id : '';
      const st = isState ? stateMap[stateId] : null;
      const valHtml = isState ? fmtInlineVal(st) : '';
      const unit = (isState && n.item && n.item.unit) ? n.item.unit : '';

      // Punkt 3: Device-online-Status detektieren.
      // Wir schauen ob es einen Sub-State <devId>.online ODER <devId>.connected
      // ODER <devId>.alive oder *.UNREACH gibt und ob er truthy ist.
      // Greift fuer Devices und Channels (z.B. tuya geraete) sowie instances.
      let onlineClass = '';
      if (n.item && (n.item.type === 'device' || n.item.type === 'channel' || n.item.type === 'instance')) {
        const onlineState = detectOnlineState(n.item.id);
        if (onlineState === true)       onlineClass = ' device-online';
        else if (onlineState === false) onlineClass = ' device-offline';
      }

      return `
        <div class="tree-row ${isSel ? 'selected' : ''}${onlineClass}" data-id="${escapeHtml(n.fullId)}" data-has-item="${n.item ? '1' : '0'}" style="padding-left:${indentPx + 6}px">
          <span class="tree-toggle ${showToggle ? '' : 'tree-toggle-blank'}" data-toggle="${escapeHtml(n.fullId)}">${togIcon}</span>
          <span class="tree-icon">${tIcon}</span>
          <span class="tree-name">${escapeHtml(n.name)}</span>
          ${nameDisplay ? `<span class="tree-name-extra">${escapeHtml(nameDisplay)}</span>` : ''}
          ${isState ? `<span class="tree-val" data-state-id="${escapeHtml(stateId)}" data-last-val="${escapeHtml(valHtml)}">${valHtml}${unit ? ' <span class="tree-val-unit">' + escapeHtml(unit) + '</span>' : ''}</span>` : ''}
        </div>
      `;
    }).join('') + (more > 0 ? `<div class="ma-muted" style="padding: 8px 12px">... ${more} weitere ausgeblendet. Filter verfeinern.</div>` : '');

    tree.querySelectorAll('.tree-row').forEach(row => {
      row.addEventListener('click', (ev) => {
        const tog = ev.target.closest('[data-toggle]');
        if (tog && tog.textContent.trim()) {
          // Toggle gedrückt
          const id = tog.dataset.toggle;
          if (treeCollapsed.has(id)) treeCollapsed.delete(id);
          else treeCollapsed.add(id);
          render();
          return;
        }
        const id = row.dataset.id;
        const hasItem = row.dataset.hasItem === '1';
        if (hasItem) {
          selectId(id);
        } else {
          // Folder ohne Object: toggle anstelle
          if (treeCollapsed.has(id)) treeCollapsed.delete(id);
          else treeCollapsed.add(id);
          render();
        }
      });
    });
  }

  async function selectId(id) {
    selectedId = id;
    render();
    const det = $('objDetail');
    if (!det) return;
    det.innerHTML = 'Lade...';

    const [obj, st] = await Promise.all([
      global.MA.api.getObject(id).catch(() => null),
      global.MA.api.getState(id).catch(() => null)
    ]);

    const common = obj && obj.common ? obj.common : {};
    const native = obj && obj.native ? obj.native : {};
    const valueRow = obj && obj.type === 'state' ? renderStateValueRow(id, obj, st) : '';

    det.innerHTML = `
      <div class="obj-actions">
        <button class="ma-btn ma-btn-ghost ma-btn-xs" data-act="obj-rename">✎ Umbenennen</button>
        <button class="ma-btn ma-btn-ghost ma-btn-xs" data-act="obj-role">Role ändern</button>
        <button class="ma-btn ma-btn-ghost ma-btn-xs" data-act="obj-custom">Custom-Adapter</button>
        <button class="ma-btn ma-btn-ghost ma-btn-xs expert-only" data-act="obj-raw">{ } Roh</button>
        <button class="ma-btn ma-btn-ghost ma-btn-xs ma-btn-danger expert-only" data-act="obj-delete">🗑 Löschen</button>
      </div>
      <div class="row"><div class="k">ID</div><div class="v">${escapeHtml(id)}</div></div>
      <div class="row"><div class="k">Type</div><div class="v">${escapeHtml(obj && obj.type || '—')}</div></div>
      <div class="row"><div class="k">Name</div><div class="v">${escapeHtml(typeof common.name === 'object' ? (common.name.de || common.name.en || '') : (common.name || ''))}</div></div>
      <div class="row"><div class="k">Role</div><div class="v">${escapeHtml(common.role || '—')}</div></div>
      <div class="row"><div class="k">DType</div><div class="v">${escapeHtml(common.type || '—')}</div></div>
      <div class="row"><div class="k">RW</div><div class="v">${common.read ? 'R' : '-'}/${common.write ? 'W' : '-'}</div></div>
      ${valueRow}
      ${renderCustomSummary(common)}
      <h4>common</h4>
      <pre class="ma-mono">${escapeHtml(JSON.stringify(common, null, 2))}</pre>
      ${Object.keys(native).length ? `<h4>native</h4><pre class="ma-mono">${escapeHtml(JSON.stringify(native, null, 2))}</pre>` : ''}
    `;

    // Action-Buttons
    det.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'obj-rename') openRenameObject(id);
        else if (act === 'obj-role') openRoleEditor(id, obj);
        else if (act === 'obj-custom') openCustomEditor(id, obj);
        else if (act === 'obj-raw') openRawEditor(id, obj);
        else if (act === 'obj-delete') confirmDeleteObject(id);
      });
    });

    // Set-Wert binden
    const setBtn = det.querySelector('[data-set-btn]');
    if (setBtn) setBtn.addEventListener('click', async () => {
      const input = det.querySelector('[data-set-input]');
      const type = setBtn.dataset.dtype || 'string';
      let val = input ? input.value : '';
      try {
        if (type === 'boolean') val = (val === 'true' || val === '1' || val === 'on');
        else if (type === 'number') {
          const n = Number(val); if (Number.isNaN(n)) throw new Error('Ungueltige Zahl');
          val = n;
        }
        else if (type === 'object' || type === 'array' || type === 'json') val = JSON.parse(val);
        await global.MA.api.setState(id, val, false);
        global.MA.toast('Gesetzt: ' + id, 'ok');
        selectId(id);
      } catch (e) {
        global.MA.toast('Fehler: ' + e.message, 'bad');
      }
    });

    // Boolean-Direkt-Click: setzt direkt auf den NICHT-aktuellen Wert (Toggle)
    const boolToggle = det.querySelector('[data-set-bool]');
    if (boolToggle) {
      boolToggle.addEventListener('click', async () => {
        const curr = boolToggle.classList.contains('on');
        try {
          await global.MA.api.setState(id, !curr, false);
          global.MA.toast(!curr ? 'EIN' : 'AUS', 'ok');
          selectId(id);
        } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
      });
    }
    const boolInv = det.querySelector('[data-set-bool-inv]');
    if (boolInv) {
      boolInv.addEventListener('click', async () => {
        // Aktueller Wert aus dem Display-Toggle ableiten
        const togBtn = det.querySelector('[data-set-bool]');
        const curr = togBtn && togBtn.classList.contains('on');
        try {
          await global.MA.api.setState(id, !curr, false);
          selectId(id);
        } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
      });
    }

    // State-Buttons (common.states)
    det.querySelectorAll('[data-set-state]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raw = btn.dataset.setState;
        const type = btn.dataset.dtype || 'mixed';
        let val = raw;
        try {
          if (type === 'number') val = Number(raw);
          else if (type === 'boolean') val = (raw === 'true' || raw === '1');
          await global.MA.api.setState(id, val, false);
          global.MA.toast('Gesetzt: ' + raw, 'ok');
          selectId(id);
        } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
      });
    });

    // Number Step +/-
    det.querySelectorAll('[data-set-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = det.querySelector('[data-set-input]');
        if (!inp) return;
        const step = Number(btn.dataset.setStep);
        const cur = Number(inp.value) || 0;
        const next = cur + step;
        const min = inp.min !== '' ? Number(inp.min) : null;
        const max = inp.max !== '' ? Number(inp.max) : null;
        let v = next;
        if (min !== null && v < min) v = min;
        if (max !== null && v > max) v = max;
        inp.value = String(v);
      });
    });
  }

  function renderStateValueRow(id, obj, st) {
    const c = obj.common || {};
    const t = c.type || 'mixed';
    const writable = !!c.write;
    const cur = st ? st.val : null;
    const valStr = cur !== undefined && cur !== null
      ? (typeof cur === 'object' ? JSON.stringify(cur) : String(cur))
      : '';
    const valDisp = fmtVal(cur);
    const ts = st && st.ts ? new Date(st.ts).toLocaleString('de-DE') : '—';

    let setCtrl = '';

    if (!writable) {
      setCtrl = '<span class="ma-muted">nicht schreibbar</span>';
    } else if (t === 'boolean') {
      // Großer Toggle-Button für Touch
      const on = cur === true || cur === 'true' || cur === 1;
      setCtrl = `
        <button class="ma-btn ma-btn-toggle ${on ? 'on' : 'off'}" data-set-bool="${id}">
          <span class="tog-dot"></span>
          <span class="tog-lbl">${on ? 'AN' : 'AUS'}</span>
        </button>
        <button class="ma-btn ma-btn-ghost" data-set-bool-inv="${id}">Toggle</button>
      `;
    } else if (c.states && typeof c.states === 'object') {
      // common.states ist Mapping {val: "Label"} oder {val: {de: "Label"}}
      // Buttons für jeden Zustand
      const entries = Array.isArray(c.states)
        ? c.states.map(v => [v, String(v)])
        : Object.entries(c.states);
      setCtrl = entries.map(([val, lbl]) => {
        const label = typeof lbl === 'object' ? (lbl.de || lbl.en || val) : String(lbl);
        const isCur = String(val) === String(cur);
        return `<button class="ma-btn ${isCur ? 'ma-btn-active' : 'ma-btn-ghost'}" data-set-state="${escapeHtml(String(val))}" data-dtype="${escapeHtml(t)}">${escapeHtml(label)}</button>`;
      }).join(' ');
    } else if (t === 'number') {
      // Min/Max + Increment Buttons
      const min = c.min != null ? Number(c.min) : null;
      const max = c.max != null ? Number(c.max) : null;
      const step = c.step != null ? Number(c.step) : 1;
      const unit = c.unit || '';
      setCtrl = `
        <button class="ma-btn ma-btn-ghost" data-set-step="-${step}">−</button>
        <input class="ma-input ma-input-num" data-set-input type="number" value="${escapeHtml(valStr)}" ${min!==null?`min="${min}"`:''} ${max!==null?`max="${max}"`:''} step="${step}" />
        <button class="ma-btn ma-btn-ghost" data-set-step="${step}">+</button>
        ${unit ? `<span class="ma-muted">${escapeHtml(unit)}</span>` : ''}
        <button class="ma-btn" data-set-btn data-dtype="number">Setzen</button>
        ${min!==null || max!==null ? `<div class="ma-muted" style="font-size:11px; margin-top:4px;">Bereich: ${min!==null?min:'—'} bis ${max!==null?max:'—'}</div>` : ''}
      `;
    } else {
      // Default: text input + button
      setCtrl = `
        <input class="ma-input" data-set-input value="${escapeHtml(valStr)}" />
        <button class="ma-btn" data-set-btn data-dtype="${escapeHtml(t)}">Setzen</button>
      `;
    }

    return `
      <div class="row"><div class="k">Wert</div><div class="v">${escapeHtml(valDisp)}</div></div>
      <div class="row"><div class="k">Aktualisiert</div><div class="v">${escapeHtml(ts)}</div></div>
      <div class="row"><div class="k">Schreibbar</div><div class="v">${writable ? 'ja' : 'nein'}</div></div>
      ${writable ? `<div class="row"><div class="k">${t === 'boolean' || (c.states && typeof c.states === 'object') ? 'Schalten' : 'Setzen'}</div><div class="v dp-set-row">${setCtrl}</div></div>` : ''}
    `;
  }

  function renderCustomSummary(common) {
    const custom = common && common.custom;
    if (!custom || !Object.keys(custom).length) return '';
    const rows = Object.entries(custom).map(([inst, cfg]) => {
      const enabled = cfg && cfg.enabled !== false;
      return `<span class="ma-pill ${enabled ? 'ma-pill-ok' : ''}">${escapeHtml(inst)}${enabled ? '' : ' (aus)'}</span>`;
    }).join(' ');
    return `<div class="row"><div class="k">Custom</div><div class="v">${rows}</div></div>`;
  }

  function openRenameObject(oldId) {
    const newId = prompt(`Datenpunkt umbenennen / verschieben:\nAlt: ${oldId}\n\nNeue ID:`, oldId);
    if (!newId || newId === oldId) return;
    if (!/^[a-zA-Z0-9_.\-]+$/.test(newId)) { global.MA.toast('Ungültige Zeichen in neuer ID', 'bad'); return; }
    if (!confirm(`Wirklich umbenennen?\n${oldId}\n→\n${newId}\n\nDas Object und der State (falls vorhanden) werden auf die neue ID kopiert, die Quelle wird gelöscht.`)) return;
    (async () => {
      try {
        await global.MA.api.renameObject(oldId, newId);
        global.MA.toast('Umbenannt', 'ok');
        setTimeout(() => { load(); selectId(newId); }, 400);
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function openRoleEditor(id, obj) {
    const current = (obj && obj.common && obj.common.role) || '';
    const role = prompt(`Role für ${id}:\n\nTypische Werte:\n  switch.power, switch.light, indicator, sensor.temperature,\n  value.temperature, value.humidity, level.dimmer, button, info\n\nLeer = role löschen.`, current);
    if (role === null) return;
    (async () => {
      try {
        const patch = JSON.parse(JSON.stringify(obj || {}));
        patch.common = patch.common || {};
        if (role.trim() === '') delete patch.common.role; else patch.common.role = role.trim();
        await global.MA.api.saveObject(id, patch);
        global.MA.toast('Role gespeichert', 'ok');
        setTimeout(() => selectId(id), 400);
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  async function openCustomEditor(id, obj) {
    // Liste der laufenden history-faehigen Adapter holen
    let candidates = [];
    try {
      const r = await global.MA.api.listInstances();
      candidates = (r.items || [])
        .filter(it => /^(history|influxdb|sql)\.\d+$/.test(it.instance))
        .map(it => it.instance);
    } catch (e) {}
    if (!candidates.length) candidates = ['history.0', 'influxdb.0', 'sql.0'];

    const current = (obj && obj.common && obj.common.custom) || {};
    const list = Object.keys(current).map(k => `  ${k}: ${current[k] && current[k].enabled !== false ? 'an' : 'aus'}`).join('\n') || '  (keine)';
    const inst = prompt(`Custom-Adapter für ${id}\n\nAktuelle Einträge:\n${list}\n\nVerfügbar: ${candidates.join(', ')}\n\nWelchen Adapter konfigurieren? (leer = abbrechen)`, candidates[0]);
    if (!inst) return;
    const action = prompt(`Custom-Adapter "${inst}" für ${id}:\n  an   → Logging einschalten\n  aus  → Logging ausschalten\n  weg  → Custom-Eintrag entfernen`, current[inst] ? 'aus' : 'an');
    if (!action) return;
    (async () => {
      try {
        if (action === 'weg' || action === 'remove') {
          await global.MA.api.setObjectCustom(id, inst, {}, true);
        } else {
          await global.MA.api.setObjectCustom(id, inst, { enabled: action === 'an' });
        }
        global.MA.toast(`Custom ${inst}: ${action}`, 'ok');
        setTimeout(() => selectId(id), 400);
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function openRawEditor(id, obj) {
    const ov = document.createElement('div');
    ov.className = 'ma-modal-overlay open';
    ov.innerHTML = `
      <div class="ma-modal">
        <div class="ma-modal-head">
          <div class="ma-modal-title">Roh-Editor: ${escapeHtml(id)}</div>
          <button class="ma-btn" data-save>Speichern</button>
          <button class="ma-modal-close" data-close>Schließen</button>
        </div>
        <div class="ma-modal-body">
          <textarea class="cfg-raw" rows="24" spellcheck="false">${escapeHtml(JSON.stringify(obj || {}, null, 2))}</textarea>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    ov.querySelector('[data-close]').addEventListener('click', () => ov.remove());
    ov.querySelector('[data-save]').addEventListener('click', async () => {
      try {
        const parsed = JSON.parse(ov.querySelector('textarea').value);
        await global.MA.api.saveObject(id, parsed);
        global.MA.toast('Gespeichert', 'ok');
        ov.remove();
        setTimeout(() => selectId(id), 400);
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    });
  }

  function confirmDeleteObject(id) {
    if (!confirm(`Datenpunkt wirklich löschen?\n\n${id}\n\nKann nicht rückgängig gemacht werden.`)) return;
    (async () => {
      try {
        await global.MA.api.deleteObject(id);
        global.MA.toast('Gelöscht', 'ok');
        selectedId = '';
        $('objDetail').innerHTML = '<div class="ma-muted">Nichts ausgewählt.</div>';
        setTimeout(load, 400);
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.objects = { init, refresh, load, selectId };
})(window);
