/* Live-Terminal-Modal fuer cmdExec.
 * Wartet auf WS-Events cmd_stdout/cmd_stderr/cmd_exit mit passender runId.
 */
(function (global) {
  'use strict';
  const { escapeHtml } = global.MA.ui;

  let modalEl = null;
  let outEl = null;
  let titleEl = null;
  let statusEl = null;
  let closeBtn = null;
  let activeRunId = null;
  let onExit = null;

  function ensureDom() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.className = 'ma-modal-overlay';
    modalEl.innerHTML = `
      <div class="ma-modal ma-modal-terminal">
        <div class="ma-modal-head">
          <div class="ma-modal-title" id="termTitle">Terminal</div>
          <div class="ma-modal-status" id="termStatus">läuft...</div>
          <button class="ma-btn ma-btn-ghost ma-btn-xs" id="termForce" title="Erzwungen schließen (Prozess läuft im Hintergrund weiter)">×</button>
          <button class="ma-modal-close" id="termClose" disabled>Schließen</button>
        </div>
        <pre class="ma-terminal" id="termOut"></pre>
      </div>
    `;
    document.body.appendChild(modalEl);
    titleEl  = modalEl.querySelector('#termTitle');
    statusEl = modalEl.querySelector('#termStatus');
    outEl    = modalEl.querySelector('#termOut');
    closeBtn = modalEl.querySelector('#termClose');
    closeBtn.addEventListener('click', () => hide());
    modalEl.querySelector('#termForce').addEventListener('click', () => hide());

    // WS-Listener nur einmal binden
    global.MA.on('ws:cmd_stdout', (m) => { if (m.runId === activeRunId) append(m.data, 'out'); });
    global.MA.on('ws:cmd_stderr', (m) => { if (m.runId === activeRunId) append(m.data, 'err'); });
    global.MA.on('ws:cmd_exit',   (m) => {
      if (m.runId !== activeRunId) return;
      const ok = m.code === 0;
      append(`\n--- Beendet (exit code ${m.code}${m.timeout ? ', TIMEOUT' : ''}) ---\n`, ok ? 'sys-ok' : 'sys-bad');
      statusEl.textContent = ok ? 'fertig' : (m.timeout ? 'timeout' : 'fehlgeschlagen');
      statusEl.className = 'ma-modal-status ' + (ok ? 'st-ok' : 'st-bad');
      closeBtn.disabled = false;
      if (typeof onExit === 'function') { try { onExit(m); } catch(e){} }
    });
  }

  // Erlaubt sowohl show(runId, title, cb) als auch show(title, runId, cb) - akzeptiert beide Reihenfolgen
  function show(a, b, exitCb) {
    ensureDom();
    let runId, title;
    // Heuristik: runId beginnt mit "fid-" oder enthaelt Zahlen+Bindestriche -> ist runId
    if (typeof a === 'string' && /^fid-|^run-/.test(a)) { runId = a; title = b; }
    else if (typeof b === 'string' && /^fid-|^run-/.test(b)) { title = a; runId = b; }
    else { runId = a; title = b; }

    activeRunId = runId;
    onExit = exitCb || null;
    titleEl.textContent = title || 'Terminal';
    statusEl.textContent = 'läuft...';
    statusEl.className = 'ma-modal-status st-run';
    outEl.innerHTML = '';
    closeBtn.disabled = true;
    modalEl.classList.add('open');

    // Sicherheitsnetz: nach 10min Auto-Enable des Close-Buttons.
    // Schuetzt davor, dass das Modal hängenbleibt wenn cmd_exit nie kommt.
    setTimeout(() => {
      if (closeBtn && activeRunId === runId) {
        closeBtn.disabled = false;
        if (statusEl && statusEl.classList.contains('st-run')) {
          statusEl.textContent = 'noch aktiv?';
          statusEl.className = 'ma-modal-status st-warn';
        }
      }
    }, 600000);
  }

  function hide() { if (modalEl) modalEl.classList.remove('open'); activeRunId = null; onExit = null; }

  function append(text, kind) {
    if (!outEl) return;
    const span = document.createElement('span');
    span.className = 'term-' + (kind || 'out');
    span.textContent = String(text || '');
    outEl.appendChild(span);
    outEl.scrollTop = outEl.scrollHeight;
  }

  global.MA = global.MA || {};
  global.MA.terminal = { show, hide, append };
})(window);
