(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;

  const LEVEL_RANK = { error: 0, warn: 1, info: 2, debug: 3, silly: 4 };
  const MAX_LINES = 2000;
  const buffer = [];
  let initialized = false;
  let paused = false;
  let renderHandle = null;

  function init() {
    if (initialized) return;
    initialized = true;
    $('logClearBtn') && $('logClearBtn').addEventListener('click', () => { buffer.length = 0; scheduleRender(); });
    $('logPauseBtn') && $('logPauseBtn').addEventListener('click', () => {
      paused = !paused;
      $('logPauseBtn').textContent = paused ? 'Weiter' : 'Pause';
      if (!paused) scheduleRender();
    });
    $('logLevelFilter') && $('logLevelFilter').addEventListener('change', scheduleRender);
    $('logTextFilter')  && $('logTextFilter').addEventListener('input', scheduleRender);

    global.MA.on('ws:log_backlog', (m) => {
      const lines = (m.lines || []);
      for (const l of lines) buffer.push(l);
      trim();
      scheduleRender();
    });
    global.MA.on('ws:log', (m) => {
      buffer.push(m.line);
      trim();
      if (!paused) scheduleRender();
    });
  }

  function trim() { while (buffer.length > MAX_LINES) buffer.shift(); }

  function scheduleRender() {
    if (renderHandle) return;
    renderHandle = requestAnimationFrame(() => { renderHandle = null; render(); });
  }

  async function refresh() {
    init();
    if (!buffer.length) {
      try {
        const r = await global.MA.api.logsRecent(500);
        (r.lines || []).forEach(l => buffer.push(l));
        trim();
        scheduleRender();
      } catch (e) { /* WS uebernimmt */ }
    }
  }

  function render() {
    const el = $('logFull'); if (!el) return;
    const levelSel = ($('logLevelFilter') && $('logLevelFilter').value) || 'all';
    const textSel  = (($('logTextFilter') && $('logTextFilter').value) || '').toLowerCase().trim();
    const minRank  = levelSel === 'all' ? Infinity : LEVEL_RANK[levelSel];

    const list = buffer.filter(l => {
      const r = LEVEL_RANK[String(l.severity || 'info').toLowerCase()] ?? 99;
      if (levelSel !== 'all' && r > minRank) return false;
      if (textSel) {
        const hay = (l.message + ' ' + (l.from || '')).toLowerCase();
        if (!hay.includes(textSel)) return false;
      }
      return true;
    });

    const wasBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 24;
    el.innerHTML = list.map(l => {
      const ts = l.ts ? new Date(l.ts).toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '';
      const sev = String(l.severity || 'info').toLowerCase();
      const adapterName = String(l.from || '').replace(/^system\.adapter\./, '');
      const color = adapterColor(adapterName);
      return `<span class="ma-log-line lvl-${escapeHtml(sev)}"><span style="color:#888">${escapeHtml(ts)}</span> <span style="color:#666">[${escapeHtml(sev.toUpperCase().padEnd(5))}]</span> <span class="log-adapter" style="background:${color}; color:#fff;">${escapeHtml(adapterName)}</span>: ${escapeHtml(l.message || '')}</span>`;
    }).join('\n');
    if (wasBottom) el.scrollTop = el.scrollHeight;
  }

  // Deterministische Farbe pro Adapter - HSL aus String-Hash, dezent gesaettigt
  const colorCache = Object.create(null);
  function adapterColor(name) {
    if (colorCache[name]) return colorCache[name];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i) | 0;
    const hue = Math.abs(h) % 360;
    const c = `hsl(${hue}, 45%, 35%)`;
    colorCache[name] = c;
    return c;
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.logs = { init, refresh };
})(window);
