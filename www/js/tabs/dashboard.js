(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;

  let initialized = false;
  let logTailEl, logStatusEl;
  const LIVE_MAX = 30;
  const live = [];

  function init() {
    if (initialized) return;
    initialized = true;
    logTailEl   = $('dashLog');
    logStatusEl = $('logStatusBadge');

    global.MA.on('ws:open',        () => setLogStatus('live', 'ok'));
    global.MA.on('ws:close',       () => setLogStatus('offline', 'bad'));
    global.MA.on('ws:log_backlog', (m) => {
      live.length = 0;
      (m.lines || []).slice(-LIVE_MAX).forEach(l => live.push(l));
      renderLog();
    });
    global.MA.on('ws:log', (m) => {
      live.push(m.line);
      while (live.length > LIVE_MAX) live.shift();
      renderLog();
    });
  }

  function setLogStatus(text, kind) {
    if (!logStatusEl) return;
    logStatusEl.textContent = text;
    logStatusEl.className = 'ma-pill ma-pill-' + (kind || 'info');
  }

  function renderLog() {
    if (!logTailEl) return;
    if (!live.length) { logTailEl.textContent = 'Warte auf Logs...'; return; }
    logTailEl.innerHTML = live.map(l => {
      const ts = l.ts ? new Date(l.ts).toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '';
      const sev = String(l.severity || 'info').toLowerCase();
      return `<span class="ma-log-line lvl-${escapeHtml(sev)}">${escapeHtml(ts)} [${escapeHtml(sev.toUpperCase())}] ${escapeHtml(l.from || '')}: ${escapeHtml(l.message || '')}</span>`;
    }).join('\n');
    logTailEl.scrollTop = logTailEl.scrollHeight;
  }

  async function refresh() {
    init();
    await Promise.all([refreshSystem(), refreshInstances(), refreshCounts(), refreshLinks(), refreshNotifications()]);
  }

  async function refreshNotifications() {
    const el = $('dashNotifications'); if (!el) return;
    try {
      const r = await global.MA.api.listNotifications();
      if (r.disabled) {
        // Card komplett ausblenden wenn deaktiviert
        const card = el.closest('.ma-card');
        if (card) card.style.display = 'none';
        return;
      }
      const items = r.items || [];
      if (!items.length) { el.innerHTML = '<div class="ma-muted">Keine offenen Benachrichtigungen.</div>'; return; }
      el.innerHTML = items.map(n => `
        <div class="notif-card notif-${escapeHtml((n.severity || 'info').toLowerCase())}">
          <div class="notif-head">
            <span class="ma-pill ma-pill-${n.severity === 'alert' || n.severity === 'error' ? 'warn' : 'info'}">${escapeHtml(n.scope)} · ${escapeHtml(n.category)}</span>
            <button class="ma-btn ma-btn-ghost ma-btn-xs" data-notif-clear data-host="${escapeHtml(n.host)}" data-scope="${escapeHtml(n.scope)}" data-cat="${escapeHtml(n.category)}">Erledigt</button>
          </div>
          <div class="notif-desc">${escapeHtml(n.description || '')}</div>
          ${n.messages.length ? `<ul class="notif-msgs">${n.messages.slice(0, 5).map(m => `<li><span class="ma-mono">${escapeHtml(m.instance)}</span>: ${escapeHtml(m.message)}</li>`).join('')}${n.messages.length > 5 ? `<li class="ma-muted">... ${n.messages.length - 5} weitere</li>` : ''}</ul>` : ''}
        </div>
      `).join('');
      el.querySelectorAll('[data-notif-clear]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await global.MA.api.clearNotification({ host: btn.dataset.host, scope: btn.dataset.scope, category: btn.dataset.cat });
            global.MA.toast('Erledigt', 'ok');
            setTimeout(refreshNotifications, 800);
          } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
        });
      });
    } catch (e) { el.innerHTML = `<div class="ma-muted">Benachrichtigungen nicht abrufbar: ${escapeHtml(e.message)}</div>`; }
  }

  async function refreshLinks() {
    const el = $('dashLinks'); if (!el) return;
    try {
      const r = await global.MA.api.listLinks();
      const links = r.links || [];
      if (!links.length) { el.innerHTML = '<div class="ma-muted">Keine Adapter-Web-UIs gefunden.</div>'; return; }
      el.innerHTML = links.map(l => `
        <a class="link-tile ${l.alive ? 'link-on' : 'link-off'}" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" title="${escapeHtml(l.url)}">
          <div class="link-title">${escapeHtml(l.label)}</div>
          <div class="link-sub"><span>${escapeHtml(l.instance)}</span><span class="link-arrow">↗</span></div>
        </a>
      `).join('');
    } catch (e) { el.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`; }
  }

  async function refreshSystem() {
    const el = $('dashSystem'); if (!el) return;
    try {
      const info = await global.MA.api.systemInfo();
      el.innerHTML = `
        <div class="ma-obj-detail">
          <div class="row"><div class="k">System</div><div class="v">${escapeHtml(info.host || '—')}</div></div>
          <div class="row"><div class="k">js-controller</div><div class="v">${escapeHtml(info.controllerVersion || '—')}</div></div>
          <div class="row"><div class="k">Node.js</div><div class="v">${escapeHtml(info.nodeVersion || '—')}</div></div>
          <div class="row"><div class="k">Platform</div><div class="v">${escapeHtml(info.platform + ' / ' + info.arch)}</div></div>
          <div class="row"><div class="k">Fiducerion Bridge</div><div class="v">v${escapeHtml(info.adapterVersion || '0.0.0')}</div></div>
          <div class="row"><div class="k">Bridge-Uptime</div><div class="v">${formatUptime(info.uptime)}</div></div>
        </div>
      `;
      renderStatsBar(info.stats);
    } catch (e) {
      el.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderStatsBar(s) {
    if (!s) return;
    // CPU
    const cpuVal = s.cpu != null ? Number(s.cpu) : (s.load != null ? Math.min(100, Math.round(Number(s.load) * 25)) : null);
    setStat('Cpu',  cpuVal != null ? cpuVal.toFixed(0) + ' %' : '—', cpuVal);
    // RAM
    if (s.totalmem && s.freemem != null) {
      const used = s.totalmem - Number(s.freemem);
      const pct = Math.round(used / s.totalmem * 100);
      setStat('Ram',  fmtBytes(used) + ' / ' + fmtBytes(s.totalmem), pct);
    } else if (s.memUsedPct != null) {
      setStat('Ram', s.memUsedPct + ' %', s.memUsedPct);
    } else setStat('Ram', '—', null);
    // Disk
    if (s.diskSize && s.diskFree != null) {
      const used = (s.diskSize - Number(s.diskFree));
      const pct = s.diskUsedPct;
      setStat('Disk', fmtMB(used) + ' / ' + fmtMB(s.diskSize), pct);
    } else setStat('Disk', '—', null);
    // Uptime
    setStat('Uptime', formatUptime(s.uptime), null);
    // IP
    setStat('Ip', s.ip || '—', null);
  }

  function setStat(key, valStr, pct) {
    const el = document.getElementById('stat' + key);
    if (el) el.textContent = valStr;
    const fill = document.getElementById('stat' + key + 'Fill');
    if (fill) {
      if (pct == null) { fill.style.width = '0%'; }
      else {
        fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
        fill.classList.toggle('warn', pct >= 75 && pct < 90);
        fill.classList.toggle('bad',  pct >= 90);
      }
    }
  }

  function fmtBytes(n) {
    if (n == null) return '—';
    const mb = Number(n) / (1024 * 1024);
    if (mb > 1024) return (mb / 1024).toFixed(1) + ' G';
    return mb.toFixed(0) + ' M';
  }
  function fmtMB(mb) {
    if (mb == null) return '—';
    if (Number(mb) > 1024) return (Number(mb) / 1024).toFixed(1) + ' G';
    return Math.round(Number(mb)) + ' M';
  }

  function formatUptime(s) {
    const n = Number(s); if (!Number.isFinite(n)) return '—';
    if (n < 60) return n + ' s';
    if (n < 3600) return Math.floor(n/60) + ' min';
    if (n < 86400) return Math.floor(n/3600) + ' h ' + Math.floor((n%3600)/60) + ' min';
    return Math.floor(n/86400) + ' d ' + Math.floor((n%86400)/3600) + ' h';
  }

  async function refreshInstances() {
    const tbody = document.querySelector('#dashInstanceTable tbody');
    const badges = $('dashInstanceBadges');
    if (!tbody) return;
    try {
      const r = await global.MA.api.listInstances();
      const items = r.items || [];
      const aliveCount = items.filter(x => x.alive).length;

      if (badges) badges.innerHTML = `
        <span class="ma-pill ma-pill-info">${items.length} TOTAL</span>
        <span class="ma-pill ma-pill-ok">${aliveCount} AKTIV</span>
        <span class="ma-pill ${items.length - aliveCount > 0 ? 'ma-pill-warn' : ''}">${items.length - aliveCount} INAKTIV</span>
      `;
      // Sortierung: zuerst nicht-alive (zur Aufmerksamkeit), dann alive
      const sorted = items.slice().sort((a,b) => {
        if (a.alive !== b.alive) return a.alive ? 1 : -1;
        return a.instance.localeCompare(b.instance);
      }).slice(0, 12);

      tbody.innerHTML = sorted.length ? sorted.map(it => {
        const cls = it.alive ? 'ma-pill-ok' : (it.enabled ? 'ma-pill-warn' : '');
        const status = it.alive ? 'aktiv' : (it.enabled ? 'inaktiv' : 'deaktiviert');
        return `<tr>
          <td>${escapeHtml(it.instance)}</td>
          <td><span class="ma-pill ${cls}">${escapeHtml(status)}</span></td>
          <td>${escapeHtml(it.version || '—')}</td>
          <td>${escapeHtml(it.mode || '—')}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="4" class="ma-muted">Keine Daten</td></tr>';
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" class="ma-muted">Fehler: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function refreshCounts() {
    try {
      const c = await global.MA.api.counts();
      const dpEl  = $('statDatapoints');
      const svcEl = $('statServices');
      const alEl  = $('statAlive');
      if (dpEl)  dpEl.textContent  = (c.datapoints || 0).toLocaleString('de-DE');
      if (svcEl) svcEl.textContent = c.instances || 0;
      if (alEl)  alEl.textContent  = c.alive || 0;
    } catch (e) { /* still */ }
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.dashboard = { init, refresh };
})(window);
