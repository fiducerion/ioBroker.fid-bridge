/* Config-Editor fuer Adapter-Konfigurationen.
 *
 * - Unterstuetzte jsonConfig-Typen: tabs, panel, header, staticText, divider,
 *   text, password, number, checkbox, select, color
 * - Nicht unterstuetzte Typen werden als Hinweis angezeigt + JSON-Editor-Tab
 *   als Notausgang
 * - Bei kompletten Adaptern ohne jsonConfig: voller JSON-Editor
 */
(function (global) {
  'use strict';
  const { escapeHtml } = global.MA.ui;

  const SUPPORTED = new Set([
    'tabs','panel','header','staticText','divider',
    'text','password','number','checkbox','select','color',
    'table'
  ]);

  let modalEl = null;
  let state = null; // {instance, native, schema, dirty}

  function ensureDom() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.className = 'ma-modal-overlay ma-modal-cfg';
    modalEl.innerHTML = `
      <div class="ma-modal ma-modal-config">
        <div class="ma-modal-head">
          <div class="ma-modal-title" id="cfgTitle">Konfiguration</div>
          <div class="ma-modal-status" id="cfgStatus"></div>
          <button class="ma-btn ma-btn-ghost" id="cfgSaveBtn">Speichern</button>
          <button class="ma-modal-close" id="cfgCloseBtn">Schließen</button>
        </div>
        <div class="ma-modal-body cfg-body" id="cfgBody"></div>
      </div>
    `;
    document.body.appendChild(modalEl);
    document.getElementById('cfgSaveBtn').addEventListener('click', save);
    document.getElementById('cfgCloseBtn').addEventListener('click', close);
  }

  async function open(instance) {
    ensureDom();
    document.getElementById('cfgTitle').textContent = `Konfiguration: ${instance}`;
    document.getElementById('cfgStatus').textContent = '';
    document.getElementById('cfgBody').innerHTML = '<div class="ma-muted">Lade...</div>';
    modalEl.classList.add('open');
    try {
      const data = await global.MA.api.getConfig(instance);
      state = {
        instance,
        native: JSON.parse(JSON.stringify(data.native || {})),
        original: JSON.parse(JSON.stringify(data.native || {})),
        schema: data.jsonConfig,
        protectedFields: data.protectedFields || [],
        common: data.common || {},
        reason: data.reason || null,
        adminConfigUrl: data.adminConfigUrl || null,
        schemaSource: data.schemaSource || null,
        dirty: false
      };
      render();
    } catch (e) {
      document.getElementById('cfgBody').innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`;
    }
  }

  function close() {
    if (state && state.dirty) {
      if (!confirm('Ungespeicherte Änderungen verwerfen?')) return;
    }
    modalEl.classList.remove('open');
    state = null;
  }

  function markDirty() {
    if (!state) return;
    state.dirty = true;
    document.getElementById('cfgStatus').textContent = 'geändert';
    document.getElementById('cfgStatus').className = 'ma-modal-status st-run';
  }

  async function save() {
    if (!state) return;
    const btn = document.getElementById('cfgSaveBtn');
    btn.disabled = true;
    try {
      // Wenn Raw-JSON-Tab aktiv: aus textarea uebernehmen
      const raw = document.getElementById('cfgRawJson');
      if (raw) {
        try { state.native = JSON.parse(raw.value); }
        catch (e) { global.MA.toast('JSON-Fehler: ' + e.message, 'bad'); btn.disabled = false; return; }
      }
      await global.MA.api.saveConfig(state.instance, state.native);
      state.dirty = false;
      state.original = JSON.parse(JSON.stringify(state.native));
      document.getElementById('cfgStatus').textContent = 'gespeichert';
      document.getElementById('cfgStatus').className = 'ma-modal-status st-ok';
      global.MA.toast('Konfiguration gespeichert. Service neu starten, um Änderungen zu übernehmen.', 'ok');
    } catch (e) {
      global.MA.toast('Fehler beim Speichern: ' + e.message, 'bad');
    } finally { btn.disabled = false; }
  }

  function render() {
    const body = document.getElementById('cfgBody');
    body.innerHTML = '';

    if (!state.schema) {
      renderRawOnly(body);
      return;
    }

    // Tabs am Top-Level + zusaetzlich ein „Roh-JSON"-Tab als Notausgang
    const navWrap = document.createElement('div');
    navWrap.className = 'cfg-tabs-nav';
    const pagesWrap = document.createElement('div');
    pagesWrap.className = 'cfg-tabs-pages';

    let tabIdx = 0;

    if (state.schema.type === 'tabs') {
      Object.entries(state.schema.items || {}).forEach(([key, def]) => {
        addTab(navWrap, pagesWrap, key, def.label || key, (page) => renderNode(def, page), tabIdx === 0);
        tabIdx++;
      });
    } else if (state.schema.type === 'panel') {
      addTab(navWrap, pagesWrap, 'main', state.schema.label || 'Allgemein', (page) => renderNode(state.schema, page), true);
      tabIdx++;
    } else {
      addTab(navWrap, pagesWrap, 'main', 'Felder', (page) => renderNode(state.schema, page), true);
      tabIdx++;
    }

    addTab(navWrap, pagesWrap, '_raw', 'Roh-JSON', (page) => renderRawTab(page), false);

    body.appendChild(navWrap);
    body.appendChild(pagesWrap);
  }

  function addTab(nav, pages, key, label, builder, active) {
    const b = document.createElement('button');
    b.className = 'cfg-tab' + (active ? ' active' : '');
    b.textContent = label;
    b.dataset.key = key;
    const p = document.createElement('div');
    p.className = 'cfg-tab-page' + (active ? ' active' : '');
    p.dataset.key = key;
    builder(p);
    b.addEventListener('click', () => {
      nav.querySelectorAll('.cfg-tab').forEach(x => x.classList.remove('active'));
      pages.querySelectorAll('.cfg-tab-page').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      p.classList.add('active');
      // Wenn Raw-Tab geoeffnet wird, mit aktuellem State vorbefuellen
      if (key === '_raw') {
        const ta = p.querySelector('#cfgRawJson');
        if (ta) ta.value = JSON.stringify(state.native, null, 2);
      }
    });
    nav.appendChild(b);
    pages.appendChild(p);
  }

  function renderRawTab(container) {
    container.innerHTML = `
      <p class="cfg-help">Bearbeite die native-Konfiguration als JSON. Beim Speichern wird der Inhalt dieses Editors uebernommen, sofern der Tab gerade aktiv ist.</p>
      <textarea class="cfg-raw" id="cfgRawJson" rows="24" spellcheck="false">${escapeHtml(JSON.stringify(state.native, null, 2))}</textarea>
    `;
  }

  function renderRawOnly(body) {
    const reasonHtml = state.reason
      ? `<div class="cfg-fallback-info"><strong>Kein jsonConfig-Schema verfügbar.</strong><br><span class="ma-muted">${escapeHtml(state.reason)}</span></div>`
      : '';

    // Wenn admin.0 da: zwei Tabs (Adapter-UI im iframe, Roh-JSON), sonst nur Roh-JSON
    if (state.adminConfigUrl) {
      body.innerHTML = `
        ${reasonHtml}
        <div class="cfg-tabs-nav">
          <button class="cfg-tab active" data-fbtab="iframe">Adapter-UI</button>
          <button class="cfg-tab"        data-fbtab="raw">Roh-JSON</button>
          <a class="ma-btn ma-btn-ghost" style="margin-left:auto" href="${escapeHtml(state.adminConfigUrl)}" target="_blank" rel="noopener">↗ In neuem Tab öffnen</a>
        </div>
        <div class="cfg-tabs-pages">
          <div class="cfg-tab-page active" data-fbtab="iframe">
            <p class="cfg-help">Eingebundene Original-UI aus dem Admin-Adapter. Falls die Seite leer bleibt, blockiert der Admin iframes (X-Frame-Options) — dann den Button rechts oben nutzen.</p>
            <iframe class="cfg-iframe" src="${escapeHtml(state.adminConfigUrl)}" loading="lazy"></iframe>
          </div>
          <div class="cfg-tab-page" data-fbtab="raw">
            <p class="cfg-help">Native-Konfiguration roh als JSON bearbeiten:</p>
            <textarea class="cfg-raw" id="cfgRawJson" rows="24" spellcheck="false">${escapeHtml(JSON.stringify(state.native, null, 2))}</textarea>
          </div>
        </div>
      `;
      body.querySelectorAll('button.cfg-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          const t = btn.dataset.fbtab;
          body.querySelectorAll('.cfg-tab').forEach(b => b.classList.toggle('active', b.dataset.fbtab === t));
          body.querySelectorAll('.cfg-tab-page').forEach(p => p.classList.toggle('active', p.dataset.fbtab === t));
        });
      });
    } else {
      body.innerHTML = `
        ${reasonHtml}
        <p class="cfg-help">Native-Konfiguration roh als JSON bearbeiten:</p>
        <textarea class="cfg-raw" id="cfgRawJson" rows="28" spellcheck="false">${escapeHtml(JSON.stringify(state.native, null, 2))}</textarea>
      `;
    }
  }

  function renderNode(node, container) {
    if (!node || !node.type) return;
    const items = node.items || {};
    for (const [key, def] of Object.entries(items)) {
      const el = buildField(key, def);
      if (el) container.appendChild(el);
    }
  }

  function buildField(key, def) {
    const type = def && def.type;
    if (type === 'panel') {
      const w = document.createElement('div'); w.className = 'cfg-nested-panel';
      if (def.label) {
        const h = document.createElement('h4'); h.className = 'cfg-nested-title'; h.textContent = def.label; w.appendChild(h);
      }
      renderNode(def, w);
      return w;
    }
    if (type === 'header')   return mkHeader(def);
    if (type === 'staticText') return mkStatic(def);
    if (type === 'divider')  { const d = document.createElement('hr'); d.className = 'cfg-divider'; return d; }
    if (type === 'text')     return mkText(key, def, false);
    if (type === 'password') return mkText(key, def, true);
    if (type === 'number')   return mkNumber(key, def);
    if (type === 'checkbox') return mkCheckbox(key, def);
    if (type === 'select')   return mkSelect(key, def);
    if (type === 'color')    return mkColor(key, def);
    if (type === 'table')    return mkTable(key, def);
    if (!SUPPORTED.has(type)) return mkUnsupported(key, def);
    return null;
  }

  function fieldWrap(label, help) {
    const w = document.createElement('div'); w.className = 'cfg-field';
    if (label) { const l = document.createElement('label'); l.className = 'cfg-label'; l.textContent = label; w.appendChild(l); }
    return { wrap: w, help };
  }
  function appendHelp(w, help) {
    if (help) { const h = document.createElement('div'); h.className = 'cfg-help'; h.textContent = help; w.appendChild(h); }
  }

  function mkHeader(def) {
    const h = document.createElement('h3'); h.className = 'cfg-header'; h.textContent = def.text || ''; return h;
  }
  function mkStatic(def) {
    const p = document.createElement('p'); p.className = 'cfg-static'; p.textContent = def.text || ''; return p;
  }
  function mkText(key, def, password) {
    const { wrap } = fieldWrap(def.label || key);
    const isProtected = state.protectedFields.includes(key);
    const placeholder = isProtected && !state.native[key] ? '(gesetzt – aus Datenschutz nicht angezeigt)' : '';
    const input = document.createElement('input');
    input.type = password || isProtected ? 'password' : 'text';
    input.className = 'ma-input';
    input.value = state.native[key] != null ? String(state.native[key]) : '';
    if (placeholder) input.placeholder = placeholder;
    input.addEventListener('input', () => { state.native[key] = input.value; markDirty(); });
    wrap.appendChild(input);
    appendHelp(wrap, def.help);
    return wrap;
  }
  function mkNumber(key, def) {
    const { wrap } = fieldWrap(def.label || key);
    const input = document.createElement('input');
    input.type = 'number'; input.className = 'ma-input';
    if (def.min != null) input.min = def.min;
    if (def.max != null) input.max = def.max;
    if (def.step != null) input.step = def.step;
    input.value = state.native[key] != null ? state.native[key] : '';
    input.addEventListener('input', () => {
      const v = input.value === '' ? null : Number(input.value);
      state.native[key] = v; markDirty();
    });
    wrap.appendChild(input);
    appendHelp(wrap, def.help);
    return wrap;
  }
  function mkCheckbox(key, def) {
    const wrap = document.createElement('div'); wrap.className = 'cfg-field cfg-field-checkbox';
    const lbl = document.createElement('label'); lbl.className = 'cfg-checkbox-wrap';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!state.native[key];
    input.addEventListener('change', () => { state.native[key] = input.checked; markDirty(); });
    const text = document.createElement('span'); text.textContent = def.label || key;
    lbl.appendChild(input); lbl.appendChild(text);
    wrap.appendChild(lbl);
    appendHelp(wrap, def.help);
    return wrap;
  }
  function mkSelect(key, def) {
    const { wrap } = fieldWrap(def.label || key);
    const sel = document.createElement('select'); sel.className = 'ma-select';
    (def.options || []).forEach(o => {
      const opt = document.createElement('option');
      const val = (typeof o === 'object') ? (o.value != null ? o.value : '') : o;
      const lbl = (typeof o === 'object') ? (o.label != null ? o.label : String(val)) : String(val);
      opt.value = val;
      opt.textContent = (lbl && typeof lbl === 'object') ? (lbl.de || lbl.en || String(val)) : String(lbl);
      if (state.native[key] == val) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => { state.native[key] = sel.value; markDirty(); });
    wrap.appendChild(sel);
    appendHelp(wrap, def.help);
    return wrap;
  }
  function mkColor(key, def) {
    const { wrap } = fieldWrap(def.label || key);
    const input = document.createElement('input');
    input.type = 'color'; input.className = 'ma-input cfg-color';
    input.value = state.native[key] || '#000000';
    input.addEventListener('input', () => { state.native[key] = input.value; markDirty(); });
    wrap.appendChild(input);
    appendHelp(wrap, def.help);
    return wrap;
  }
  function mkTable(key, def) {
    const { wrap } = fieldWrap(def.label || key);
    const items = Array.isArray(def.items) ? def.items : [];

    // Wert: Array sicherstellen
    if (!Array.isArray(state.native[key])) state.native[key] = [];
    const rows = state.native[key];

    const tableWrap = document.createElement('div');
    tableWrap.className = 'cfg-table-wrap';

    const table = document.createElement('table');
    table.className = 'cfg-table';

    // Header
    const thead = document.createElement('thead');
    const hrow  = document.createElement('tr');
    items.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.title || col.attr || '';
      if (col.width) th.style.width = col.width;
      hrow.appendChild(th);
    });
    const thAction = document.createElement('th');
    thAction.style.width = '60px';
    thAction.textContent = '';
    hrow.appendChild(thAction);
    thead.appendChild(hrow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    function renderRows() {
      tbody.innerHTML = '';
      rows.forEach((row, idx) => {
        const tr = document.createElement('tr');
        items.forEach(col => {
          const td = document.createElement('td');
          td.appendChild(buildTableCell(row, col));
          tr.appendChild(td);
        });
        // Loeschen-Button
        const tdDel = document.createElement('td');
        tdDel.className = 'cfg-table-action';
        const del = document.createElement('button');
        del.className = 'ma-btn ma-btn-ghost cfg-table-del';
        del.title = 'Zeile loeschen';
        del.textContent = '🗑';
        del.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (def.noDelete) return;
          rows.splice(idx, 1);
          renderRows();
          markDirty();
        });
        tdDel.appendChild(del);
        tr.appendChild(tdDel);
        tbody.appendChild(tr);
      });
    }

    function buildTableCell(row, col) {
      const type = col.type || 'text';
      const attr = col.attr;
      if (type === 'checkbox') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!row[attr];
        input.addEventListener('change', () => { row[attr] = input.checked; markDirty(); });
        return input;
      }
      if (type === 'select') {
        const sel = document.createElement('select');
        sel.className = 'ma-select cfg-table-select';
        (col.options || []).forEach(o => {
          const opt = document.createElement('option');
          const val = (typeof o === 'object') ? (o.value != null ? o.value : '') : o;
          const lbl = (typeof o === 'object') ? (o.label != null ? o.label : String(val)) : String(val);
          opt.value = val;
          opt.textContent = (lbl && typeof lbl === 'object') ? (lbl.de || lbl.en || String(val)) : String(lbl);
          if (row[attr] == val) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', () => { row[attr] = sel.value; markDirty(); });
        return sel;
      }
      if (type === 'number') {
        const input = document.createElement('input');
        input.type = 'number'; input.className = 'ma-input cfg-table-input';
        if (col.min != null) input.min = col.min;
        if (col.max != null) input.max = col.max;
        input.value = row[attr] != null ? row[attr] : '';
        input.addEventListener('input', () => {
          row[attr] = input.value === '' ? null : Number(input.value);
          markDirty();
        });
        return input;
      }
      // default = text
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'ma-input cfg-table-input';
      input.value = row[attr] != null ? String(row[attr]) : '';
      if (col.tooltip) input.title = col.tooltip;
      input.addEventListener('input', () => { row[attr] = input.value; markDirty(); });
      return input;
    }

    renderRows();
    tableWrap.appendChild(table);

    // Add-Button(s)
    const addBar = document.createElement('div');
    addBar.className = 'cfg-table-addbar';
    const addBtn = document.createElement('button');
    addBtn.className = 'ma-btn ma-btn-primary';
    addBtn.textContent = '+ Zeile hinzufuegen';
    addBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const empty = {};
      items.forEach(col => {
        if (col.default !== undefined) empty[col.attr] = col.default;
        else if (col.type === 'checkbox') empty[col.attr] = false;
        else if (col.type === 'number')   empty[col.attr] = 0;
        else                              empty[col.attr] = '';
      });
      rows.push(empty);
      renderRows();
      markDirty();
    });
    addBar.appendChild(addBtn);
    tableWrap.appendChild(addBar);

    wrap.appendChild(tableWrap);
    appendHelp(wrap, def.help);
    return wrap;
  }

  function mkUnsupported(key, def) {
    const w = document.createElement('div'); w.className = 'cfg-field cfg-field-unsupported';
    w.innerHTML = `<div class="cfg-label">${escapeHtml(def.label || key)}</div>
      <div class="cfg-help">Feldtyp „${escapeHtml(def.type)}" wird im Bridge-Editor noch nicht unterstützt. Aktueller Wert (read-only):</div>
      <code class="cfg-raw-inline">${escapeHtml(JSON.stringify(state.native[key]))}</code>`;
    return w;
  }

  global.MA = global.MA || {};
  global.MA.configEditor = { open, close };
})(window);
