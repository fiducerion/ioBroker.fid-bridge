/* Service-Log-Modal: zeigt live-log-Lines, gefiltert nach Service-Namespace.
 * Subscribed auf ws:log, ignoriert alle Zeilen ausser denen mit passender Quelle.
 */
(function (global) {
  'use strict';
  const { escapeHtml } = global.MA.ui;

  let modalEl = null;
  let preEl   = null;
  let titleEl = null;
  let activeInstance = null;
  let paused = false;
  let lines = [];
  const MAX_LINES = 500;

  function ensure() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.className = 'ma-modal-overlay ma-modal-cfg';
    modalEl.innerHTML = `
      <div class="ma-modal ma-modal-svc-log">
        <div class="ma-modal-head">
          <div class="ma-modal-title" id="slTitle">Log</div>
          <select class="ma-select" id="slLevelFilter">
            <option value="all">alle Level</option>
            <option value="warn">ab warn</option>
            <option value="error">nur error</option>
          </select>
          <button class="ma-btn ma-btn-ghost" id="slPauseBtn">Pause</button>
          <button class="ma-btn ma-btn-ghost" id="slClearBtn">Leeren</button>
          <button class="ma-modal-close" id="slCloseBtn">Schließen</button>
        </div>
        <pre class="ma-log ma-log-full" id="slLog" style="max-height:70vh; min-height:50vh; margin:0;">Warte auf Log-Zeilen...</pre>
      </div>
    `;
    document.body.appendChild(modalEl);
    preEl   = modalEl.querySelector('#slLog');
    titleEl = modalEl.querySelector('#slTitle');
    modalEl.querySelector('#slCloseBtn').addEventListener('click', hide);
    modalEl.querySelector('#slPauseBtn').addEventListener('click', () => {
      paused = !paused;
      modalEl.querySelector('#slPauseBtn').textContent = paused ? 'Weiter' : 'Pause';
    });
    modalEl.querySelector('#slClearBtn').addEventListener('click', () => { lines.length = 0; render(); });
    modalEl.querySelector('#slLevelFilter').addEventListener('change', render);

    global.MA.on('ws:log', (m) => {
      if (!activeInstance || paused) return;
      const line = m.line;
      if (!line || !matchesInstance(line, activeInstance)) return;
      lines.push(line);
      while (lines.length > MAX_LINES) lines.shift();
      render();
    });
  }

  function matchesInstance(line, instance) {
    const from = String(line.from || '');
    // Exakter Match auf "javascript.0" oder Service-id
    return from === instance || from.endsWith('.' + instance) || from.startsWith(instance + '.');
  }

  function render() {
    if (!preEl) return;
    const lvlFilter = modalEl.querySelector('#slLevelFilter').value;
    const order = { error: 0, warn: 1, info: 2, debug: 3, silly: 4 };
    const filtered = lines.filter(l => {
      const v = order[(l.severity || 'info').toLowerCase()];
      if (lvlFilter === 'warn')  return v <= 1;
      if (lvlFilter === 'error') return v <= 0;
      return true;
    });
    if (!filtered.length) { preEl.textContent = 'Keine passenden Zeilen.'; return; }
    preEl.innerHTML = filtered.map(l => {
      const ts  = l.ts ? new Date(l.ts).toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '';
      const sev = (l.severity || 'info').toLowerCase();
      return `<span class="ma-log-line lvl-${escapeHtml(sev)}">[${escapeHtml(ts)}] ${escapeHtml(sev.toUpperCase().padEnd(5))} ${escapeHtml(l.from || '')} - ${escapeHtml(l.message || '')}</span>`;
    }).join('\n');
    preEl.scrollTop = preEl.scrollHeight;
  }

  function show(instance) {
    ensure();
    activeInstance = instance;
    paused = false;
    lines.length = 0;
    titleEl.textContent = 'Log: ' + instance;
    render();
    modalEl.classList.add('open');
  }
  function hide() { if (modalEl) modalEl.classList.remove('open'); activeInstance = null; }

  global.MA = global.MA || {};
  global.MA.serviceLog = { show, hide };
})(window);
