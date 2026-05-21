(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;

  let initialized = false;
  let aliases = [];
  let rooms = [];
  let funcs = [];

  function init() {
    if (initialized) return;
    initialized = true;
    $('strReload')   && $('strReload').addEventListener('click', refresh);
    $('strNewAlias') && $('strNewAlias').addEventListener('click', openNewAliasDialog);
    $('strNewRoom')  && $('strNewRoom').addEventListener('click', () => openNewEnumDialog('rooms'));
    $('strNewFunc')  && $('strNewFunc').addEventListener('click', () => openNewEnumDialog('functions'));
  }

  async function refresh() {
    init();
    try {
      const [a, r, f] = await Promise.all([
        global.MA.api.listAliases().catch(() => ({ items: [] })),
        global.MA.api.listEnums('rooms').catch(() => ({ items: [] })),
        global.MA.api.listEnums('functions').catch(() => ({ items: [] }))
      ]);
      aliases = a.items || [];
      rooms = r.items || [];
      funcs = f.items || [];
      renderAliases();
      renderEnums('rooms', rooms, $('strRoomsBody'));
      renderEnums('functions', funcs, $('strFuncsBody'));
    } catch (e) {
      global.MA.toast('Fehler: ' + e.message, 'bad');
    }
  }

  let aliasCollapsed = new Set();
  let aliasCollapseInitialized = false;

  function renderAliases() {
    const body = $('strAliasesBody');
    if (!body) return;
    if (!aliases.length) { body.innerHTML = '<div class="ma-muted">Keine Aliase definiert.</div>'; return; }

    // Tree-Aufbau: Aliase nach Punkten zerlegen.
    const tree = { children: {}, items: [] };
    const allFolderPaths = new Set();
    aliases.forEach(a => {
      const short = a.id.replace(/^alias\.0\./, '');
      const parts = short.split('.');
      const leaf = parts.pop();
      let node = tree;
      let pathSoFar = '';
      parts.forEach(p => {
        pathSoFar = pathSoFar ? pathSoFar + '.' + p : p;
        allFolderPaths.add(pathSoFar);
        if (!node.children[p]) node.children[p] = { name: p, fullPath: pathSoFar, children: {}, items: [] };
        node = node.children[p];
      });
      node.items.push({ ...a, leaf });
    });

    // Default: alle Folder zugeklappt beim ersten Render
    if (!aliasCollapseInitialized) {
      allFolderPaths.forEach(p => aliasCollapsed.add(p));
      aliasCollapseInitialized = true;
    }

    body.innerHTML = renderAliasNode(tree, 0, '');
    body.querySelectorAll('button[data-alias-edit]').forEach(b => b.addEventListener('click', () => openEditAliasDialog(b.dataset.aliasEdit)));
    body.querySelectorAll('button[data-alias-del]').forEach(b => b.addEventListener('click', () => deleteAlias(b.dataset.aliasDel)));
    body.querySelectorAll('[data-alias-folder]').forEach(el => {
      el.addEventListener('click', () => {
        const p = el.dataset.aliasFolder;
        if (aliasCollapsed.has(p)) aliasCollapsed.delete(p);
        else aliasCollapsed.add(p);
        renderAliases();
      });
    });
  }

  function renderAliasNode(node, depth, parentPath) {
    let html = '';
    // Erst Subfolder
    const folders = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
    folders.forEach(f => {
      const collapsed = aliasCollapsed.has(f.fullPath);
      html += `
        <div class="scr-folder-row" data-alias-folder="${escapeHtml(f.fullPath)}" style="padding-left:${depth * 14 + 8}px">
          <span class="scr-folder-icon">${collapsed ? '▸' : '▾'}</span>
          <span class="scr-folder-name">${escapeHtml(f.name)}</span>
          <span class="ma-muted" style="font-size:11px; margin-left:6px">(${countLeaves(f)})</span>
        </div>
      `;
      if (!collapsed) html += renderAliasNode(f, depth + 1, f.fullPath);
    });
    // Dann Leaves
    node.items.forEach(a => {
      html += `
        <div class="scr-script-row" style="padding-left:${depth * 14 + 28}px">
          <span class="scr-script-icon">🔗</span>
          <span class="scr-script-name">${escapeHtml(a.leaf)}</span>
          <span class="ma-muted" style="font-size:11px; flex:1; margin-left:8px">→ ${escapeHtml(a.source || '—')}</span>
          <span class="scr-script-actions">
            <button class="ma-btn ma-btn-ghost ma-btn-xs" data-alias-edit="${escapeHtml(a.id)}">✎</button>
            <button class="ma-btn ma-btn-ghost ma-btn-xs ma-btn-danger expert-only" data-alias-del="${escapeHtml(a.id)}">🗑</button>
          </span>
        </div>
      `;
    });
    return html;
  }

  function countLeaves(node) {
    let c = node.items.length;
    Object.values(node.children).forEach(ch => { c += countLeaves(ch); });
    return c;
  }

  const enumCollapsed = new Set();
  let enumCollapseInitialized = { rooms: false, functions: false };

  function renderEnums(cat, items, body) {
    if (!body) return;
    if (!items.length) { body.innerHTML = `<div class="ma-muted">Keine ${cat === 'rooms' ? 'Räume' : 'Funktionen'} definiert.</div>`; return; }
    // Default: alle zugeklappt beim ersten Render
    if (!enumCollapseInitialized[cat]) {
      items.forEach(e => enumCollapsed.add(e.id));
      enumCollapseInitialized[cat] = true;
    }
    body.innerHTML = items.map(e => {
      const closed = enumCollapsed.has(e.id);
      const memberCount = (e.members || []).length;
      return `
      <div class="enum-card${closed ? ' enum-closed' : ''}">
        <div class="enum-head" data-enum-toggle="${escapeHtml(e.id)}">
          <span class="enum-tog">${closed ? '▸' : '▾'}</span>
          <strong>${escapeHtml(e.name || e.shortId)}</strong>
          <span class="ma-muted ma-mono" style="font-size:11px;">${escapeHtml(e.shortId)}</span>
          <span class="enum-count">${memberCount}</span>
          <span class="enum-actions">
            <button class="ma-btn ma-btn-ghost ma-btn-xs" data-enum-edit="${escapeHtml(e.id)}">✎</button>
            <button class="ma-btn ma-btn-ghost ma-btn-xs" data-enum-add="${escapeHtml(e.id)}">+ Mitglied</button>
            <button class="ma-btn ma-btn-ghost ma-btn-xs ma-btn-danger expert-only" data-enum-del="${escapeHtml(e.id)}">🗑</button>
          </span>
        </div>
        ${closed ? '' : `
        <div class="enum-members">
          ${(e.members || []).map(m => `
            <span class="enum-member">
              <span class="ma-mono">${escapeHtml(m)}</span>
              <button class="enum-remove" data-enum-rm="${escapeHtml(e.id)}" data-mem="${escapeHtml(m)}" title="Entfernen">×</button>
            </span>
          `).join('') || '<span class="ma-muted">— leer —</span>'}
        </div>`}
      </div>
    `;}).join('');

    // Toggle-Clicks auf den Header
    body.querySelectorAll('[data-enum-toggle]').forEach(el => {
      el.addEventListener('click', (ev) => {
        // Klicks auf Buttons im Header NICHT als Toggle werten
        if (ev.target.closest('button')) return;
        const id = el.dataset.enumToggle;
        if (enumCollapsed.has(id)) enumCollapsed.delete(id);
        else enumCollapsed.add(id);
        renderEnums(cat, items, body);
      });
    });
    body.querySelectorAll('button[data-enum-edit]').forEach(b => b.addEventListener('click', () => openEditEnumDialog(b.dataset.enumEdit)));
    body.querySelectorAll('button[data-enum-add]').forEach(b => b.addEventListener('click', () => addEnumMember(b.dataset.enumAdd)));
    body.querySelectorAll('button[data-enum-del]').forEach(b => b.addEventListener('click', () => deleteEnum(b.dataset.enumDel)));
    body.querySelectorAll('button[data-enum-rm]').forEach(b => b.addEventListener('click', () => removeEnumMember(b.dataset.enumRm, b.dataset.mem)));
  }

  // ---- Alias-Dialoge ----
  function openNewAliasDialog() {
    const short = prompt('Neuer Alias\n\nKurz-ID unter alias.0. (z.B. Wohnen.Licht):', '');
    if (!short) return;
    const id = 'alias.0.' + String(short).replace(/^alias\.0\.?/, '').replace(/^\.+/, '');
    const source = prompt(`Quell-Datenpunkt (z.B. hue.0.lamp1.state):`, '');
    if (!source) return;
    (async () => {
      try {
        await global.MA.api.createAlias({ id, source, name: short.split('.').pop(), type: 'mixed', role: 'state', read: true, write: true });
        global.MA.toast('Alias angelegt', 'ok');
        refresh();
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function openEditAliasDialog(id) {
    const a = aliases.find(x => x.id === id); if (!a) return;
    const newSrc = prompt(`Alias ${id}\n\nQuelle ändern (aktuell: ${a.source || '—'}):`, a.source || '');
    if (newSrc === null) return;
    (async () => {
      try {
        await global.MA.api.updateAlias(id, { source: newSrc });
        global.MA.toast('Alias geändert', 'ok');
        refresh();
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function deleteAlias(id) {
    if (!confirm(`Alias wirklich löschen?\n${id}`)) return;
    (async () => {
      try { await global.MA.api.deleteAlias(id); global.MA.toast('Gelöscht', 'ok'); refresh(); }
      catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  // ---- Enum-Dialoge ----
  function openNewEnumDialog(cat) {
    const short = prompt(`Neue ${cat === 'rooms' ? 'Raum' : 'Funktion'}\n\nKurz-Name (z.B. Wohnzimmer / Beleuchtung):`, '');
    if (!short) return;
    const safeId = String(short).replace(/[^a-zA-Z0-9_]/g, '_');
    const id = `enum.${cat}.${safeId}`;
    (async () => {
      try {
        await global.MA.api.createEnum({ id, name: short, members: [] });
        global.MA.toast('Angelegt', 'ok');
        refresh();
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function openEditEnumDialog(id) {
    const list = [...rooms, ...funcs];
    const e = list.find(x => x.id === id); if (!e) return;
    const name = prompt(`${id}\n\nName:`, e.name || '');
    if (name === null) return;
    (async () => {
      try { await global.MA.api.updateEnum(id, { name }); global.MA.toast('Gespeichert', 'ok'); refresh(); }
      catch (err) { global.MA.toast('Fehler: ' + err.message, 'bad'); }
    })();
  }

  function deleteEnum(id) {
    if (!confirm(`Wirklich löschen?\n${id}\n\nMitglieder werden nur entkoppelt, nicht selbst gelöscht.`)) return;
    (async () => {
      try { await global.MA.api.deleteEnum(id); global.MA.toast('Gelöscht', 'ok'); refresh(); }
      catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function addEnumMember(enumId) {
    const dp = prompt(`Datenpunkt-ID hinzufügen zu ${enumId}\n\n(z.B. hue.0.lamp1.state):`, '');
    if (!dp) return;
    (async () => {
      try { await global.MA.api.enumMember(enumId, { add: dp }); global.MA.toast('Hinzugefügt', 'ok'); refresh(); }
      catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function removeEnumMember(enumId, member) {
    if (!confirm(`Mitglied entfernen?\n${member}\n\nAus: ${enumId}`)) return;
    (async () => {
      try { await global.MA.api.enumMember(enumId, { remove: member }); global.MA.toast('Entfernt', 'ok'); refresh(); }
      catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.structure = { init, refresh };
})(window);
