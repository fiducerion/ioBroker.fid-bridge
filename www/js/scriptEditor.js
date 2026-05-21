/* Script-Editor: CodeMirror 5 wird lazy von CDN nachgeladen.
 * Bei keinem Internet: Fallback auf <textarea> mit Monospace.
 */
(function (global) {
  'use strict';
  const { escapeHtml } = global.MA.ui;

  const CM_BASE = 'https://cdn.jsdelivr.net/npm/codemirror@5.65.16';

  let modalEl = null;
  let cmInstance = null;
  let state = null; // { id, common, source, originalSource, enabled, dirty }
  let cmLoadPromise = null;

  function loadCM() {
    if (cmLoadPromise) return cmLoadPromise;
    cmLoadPromise = new Promise((resolve) => {
      if (window.CodeMirror) return resolve(true);
      const css1 = mkLink(CM_BASE + '/lib/codemirror.css');
      const css2 = mkLink(CM_BASE + '/theme/monokai.css');
      document.head.append(css1, css2);
      const s1 = mkScript(CM_BASE + '/lib/codemirror.js', () => {
        const s2 = mkScript(CM_BASE + '/mode/javascript/javascript.js', () => resolve(true), () => resolve(false));
        document.head.appendChild(s2);
      }, () => resolve(false));
      document.head.appendChild(s1);
    });
    return cmLoadPromise;
  }
  function mkLink(href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; return l; }
  function mkScript(src, onload, onerror) { const s = document.createElement('script'); s.src = src; s.onload = onload; s.onerror = onerror; return s; }

  function ensureDom() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.className = 'ma-modal-overlay ma-modal-cfg';
    modalEl.innerHTML = `
      <div class="ma-modal ma-modal-editor">
        <div class="ma-modal-head">
          <div class="ma-modal-title" id="edTitle">Editor</div>
          <div class="ma-modal-status" id="edStatus"></div>
          <button class="ma-btn ma-btn-ghost" id="edCopyBtn" title="Quellcode in die Zwischenablage kopieren">📋 Kopieren</button>
          <button class="ma-btn ma-btn-ghost" id="edPasteBtn" title="Aus der Zwischenablage einfügen (überschreibt den Quellcode!)">📥 Einfügen</button>
          <button class="ma-btn ma-btn-ghost" id="edToggleBtn">Aktivieren</button>
          <button class="ma-btn ma-btn-ghost" id="edSaveBtn">Speichern</button>
          <button class="ma-modal-close" id="edCloseBtn">Schließen</button>
        </div>
        <div class="ma-editor-body" id="edBody"></div>
      </div>
    `;
    document.body.appendChild(modalEl);
    document.getElementById('edSaveBtn').addEventListener('click', save);
    document.getElementById('edToggleBtn').addEventListener('click', toggle);
    document.getElementById('edCopyBtn').addEventListener('click', copyToClipboard);
    document.getElementById('edPasteBtn').addEventListener('click', pasteFromClipboard);
    document.getElementById('edCloseBtn').addEventListener('click', close);
  }

  function getEditorValue() {
    if (cmInstance) return cmInstance.getValue();
    const ta = document.getElementById('edSourceArea');
    return ta ? ta.value : '';
  }
  function setEditorValue(v) {
    if (cmInstance) cmInstance.setValue(v);
    else { const ta = document.getElementById('edSourceArea'); if (ta) ta.value = v; }
    // Auch im State updaten, damit Save den neuen Wert sieht
    if (state) {
      state.source = v;
      state.dirty  = state.source !== state.originalSource;
      const updateDirty = window.__edUpdateDirty;
      if (typeof updateDirty === 'function') updateDirty();
    }
  }

  async function copyToClipboard() {
    const code = getEditorValue();
    try {
      // Bevorzugt async clipboard-API, fallback execCommand
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement('textarea');
        ta.value = code; ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '0'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('execCommand copy fehlgeschlagen');
      }
      global.MA.toast('Quellcode in Zwischenablage kopiert (' + code.length + ' Zeichen)', 'ok');
    } catch (e) {
      global.MA.toast('Kopieren fehlgeschlagen: ' + e.message + '. Tipp: Im Editor mit Cmd+A, Cmd+C versuchen.', 'bad');
    }
  }

  async function pasteFromClipboard() {
    if (!confirm('Quellcode aus Zwischenablage einfügen?\n\nDer aktuelle Inhalt wird komplett ÜBERSCHRIEBEN.\nVorher speichern, falls noch ungesichert!')) return;
    try {
      let text = '';
      if (navigator.clipboard && navigator.clipboard.readText) {
        text = await navigator.clipboard.readText();
      } else {
        // Fallback: User in einen Prompt ablegen lassen
        text = prompt('Bitte Quellcode hier einfügen (Cmd+V / Strg+V):', '');
        if (text === null) return;
      }
      if (!text || !text.trim()) {
        global.MA.toast('Zwischenablage ist leer', 'warn');
        return;
      }
      // iOS Smart Quotes neutralisieren (sehr haeufiger Stolperstein)
      const cleaned = text
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/\u2013/g, '-')
        .replace(/\u2014/g, '--')
        .replace(/\u00A0/g, ' ');
      setEditorValue(cleaned);
      global.MA.toast('Eingefügt (' + cleaned.length + ' Zeichen, Smart-Quotes bereinigt)', 'ok');
    } catch (e) {
      global.MA.toast('Einfügen fehlgeschlagen: ' + e.message + '. Tipp: Editor klicken und Cmd+V verwenden.', 'bad');
    }
  }

  async function open(id) {
    ensureDom();
    document.getElementById('edTitle').textContent = id.replace(/^script\.js\./, '');
    document.getElementById('edStatus').textContent = 'lade...';
    document.getElementById('edStatus').className = 'ma-modal-status';
    const body = document.getElementById('edBody');
    body.innerHTML = '<div class="ma-muted" style="padding:14px">Lade...</div>';
    modalEl.classList.add('open');
    try {
      const data = await global.MA.api.getScript(id);
      state = {
        id,
        common: data.common || {},
        source: data.common.source || '',
        originalSource: data.common.source || '',
        enabled: !!data.common.enabled,
        dirty: false
      };
      updateToggleBtn();
      await renderEditor();
    } catch (e) {
      body.innerHTML = `<div class="ma-muted" style="padding:14px">Fehler: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function renderEditor() {
    const body = document.getElementById('edBody');
    body.innerHTML = '<textarea id="edSourceArea" class="ma-editor-area" spellcheck="false"></textarea>';
    const ta = document.getElementById('edSourceArea');
    ta.value = state.source;

    const ok = await loadCM();
    if (ok && window.CodeMirror) {
      const mode = (state.common.engineType === 'Blockly')   ? 'xml'
                 : (state.common.engineType === 'TypeScript') ? 'javascript'
                 : 'javascript';
      cmInstance = window.CodeMirror.fromTextArea(ta, {
        mode,
        lineNumbers: true,
        theme: 'monokai',
        indentUnit: 2,
        tabSize: 2,
        lineWrapping: false,
        viewportMargin: Infinity,
        styleActiveLine: true
      });
      cmInstance.setSize('100%', '100%');
      cmInstance.on('change', () => {
        state.source = cmInstance.getValue();
        state.dirty = state.source !== state.originalSource;
        updateDirty();
      });
      // Strg+S zum Speichern abfangen
      cmInstance.setOption('extraKeys', {
        'Ctrl-S': () => save(),
        'Cmd-S':  () => save()
      });
    } else {
      const warn = document.createElement('div');
      warn.style.cssText = 'padding:6px 12px;font-size:11px;background:rgba(255,204,102,0.12);border-bottom:1px solid var(--ma-warn);color:var(--ma-warn);';
      warn.textContent = 'CodeMirror konnte nicht geladen werden (offline?). Nutze Plain-Editor.';
      body.insertBefore(warn, body.firstChild);
      ta.addEventListener('input', () => {
        state.source = ta.value;
        state.dirty = state.source !== state.originalSource;
        updateDirty();
      });
    }
  }

  function updateDirty() {
    const st = document.getElementById('edStatus');
    if (!st || !state) return;
    if (state.dirty) {
      st.textContent = 'geändert · ungespeichert';
      st.className = 'ma-modal-status st-run';
    } else {
      st.textContent = state.enabled ? 'aktiv' : 'inaktiv';
      st.className = 'ma-modal-status ' + (state.enabled ? 'st-ok' : '');
    }
  }
  function updateToggleBtn() {
    const btn = document.getElementById('edToggleBtn');
    if (!btn || !state) return;
    btn.textContent = state.enabled ? 'Deaktivieren' : 'Aktivieren';
    updateDirty();
  }

  async function save() {
    if (!state) return;
    const btn = document.getElementById('edSaveBtn'); if (btn) btn.disabled = true;
    try {
      if (cmInstance) state.source = cmInstance.getValue();
      await global.MA.api.updateScript(state.id, { source: state.source });
      state.originalSource = state.source;
      state.dirty = false;
      updateDirty();
      global.MA.toast('Automation gespeichert. JavaScript-Service lädt automatisch neu.', 'ok');
    } catch (e) {
      global.MA.toast('Fehler: ' + e.message, 'bad');
    } finally { if (btn) btn.disabled = false; }
  }

  async function toggle() {
    if (!state) return;
    const btn = document.getElementById('edToggleBtn'); if (btn) btn.disabled = true;
    try {
      const newEnabled = !state.enabled;
      await global.MA.api.updateScript(state.id, { enabled: newEnabled });
      state.enabled = newEnabled;
      updateToggleBtn();
      global.MA.toast('Automation ' + (newEnabled ? 'aktiviert' : 'deaktiviert'), 'ok');
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    finally { if (btn) btn.disabled = false; }
  }

  function close() {
    if (state && state.dirty) {
      if (!confirm('Ungespeicherte Änderungen verwerfen?')) return;
    }
    if (cmInstance) { try { cmInstance.toTextArea(); } catch (e) {} cmInstance = null; }
    modalEl.classList.remove('open');
    state = null;
  }

  global.MA = global.MA || {};
  global.MA.scriptEditor = { open, close };
})(window);
