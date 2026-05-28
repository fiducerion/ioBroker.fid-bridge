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
    await Promise.all([
      refreshSystem(),
      refreshInstances(),
      refreshCounts(),
      refreshLinks(),
      refreshNotifications(),
      refreshConnectivity(),
      refreshHealth(),
      refreshRedis(),
      refreshAnalyzer()
    ]);
  }

  // v0.13.6: Redis-Status (vom Backend abgefragt)
  async function refreshRedis() {
    const el = $('dashRedis');
    const badgesEl = $('dashRedisBadges');
    if (!el) return;
    try {
      const r = await global.MA.api.redisStatus();
      const pingOk = !!r.pingOk;
      const cfgRedis = !!r.configured || (r.objectsType === 'redis' || r.statesType === 'redis');
      let badgeHtml = '';
      if (pingOk) badgeHtml = '<span class="ma-pill" style="background:#17351f;color:#b6f7c1">● PING OK</span>';
      else if (r.serviceActive) badgeHtml = '<span class="ma-pill" style="background:#3a2a12;color:#ffd18b">service active, no ping</span>';
      else badgeHtml = '<span class="ma-pill" style="background:#1b1f27;color:#c6ceda">nicht aktiv</span>';
      if (!cfgRedis && !pingOk) badgeHtml += ' <span class="ma-pill" style="background:#1b1f27;color:#888">ioBroker nutzt ' + escapeHtml(r.objectsType || '?') + '</span>';
      if (badgesEl) badgesEl.innerHTML = badgeHtml;

      if (!pingOk && !r.serviceActive) {
        el.innerHTML = '<div class="ma-muted">Kein Redis erreichbar oder kein redis-cli installiert.<br>ioBroker-Backend nutzt aktuell: <code>' + escapeHtml(r.objectsType || '?') + '</code> (objects) / <code>' + escapeHtml(r.statesType || '?') + '</code> (states).' +
          (r.pingErr ? '<br>Ping-Fehler: <code>' + escapeHtml(String(r.pingErr).slice(0,120)) + '</code>' : '') + '</div>';
        return;
      }
      // Wenn ping ok aber info leer: Diagnose zeigen statt nichts
      const info = r.info || {};
      if (pingOk && !Object.keys(info).length) {
        el.innerHTML = '<div class="ma-obj-detail">' +
          '<div class="row"><div class="k">Verbindung</div><div class="v">' + escapeHtml(r.host || '?') + ':' + (r.port || '?') + (r.authUsed ? ' (auth)' : '') + '</div></div>' +
          '<div class="row"><div class="k">Ping</div><div class="v">✓ PONG</div></div>' +
          '<div class="row"><div class="k">INFO</div><div class="v ma-muted">' + escapeHtml(r.infoErr || 'keine Daten') + '</div></div>' +
          '</div>' +
          '<div class="ma-muted" style="margin-top:6px;font-size:11px">redis-cli antwortet auf PING, aber INFO liefert nichts. Moeglich: Auth-Problem oder redis-cli-Version. Backend-Type: <code>' + escapeHtml(r.statesType || r.objectsType || '?') + '</code></div>';
        return;
      }
      // Info ausgeben
      const upS = Number(info.uptime_in_seconds) || 0;
      const upStr = upS > 86400 ? Math.floor(upS/86400) + 'd ' + Math.floor((upS%86400)/3600) + 'h' : (upS > 3600 ? Math.floor(upS/3600) + 'h ' + Math.floor((upS%3600)/60) + 'm' : Math.floor(upS/60) + ' min');
      el.innerHTML = '' +
        '<div class="ma-obj-detail">' +
          '<div class="row"><div class="k">Verbindung</div><div class="v">' + escapeHtml(r.host || '?') + ':' + (r.port || '?') + (r.authUsed ? ' 🔒' : '') + '</div></div>' +
          '<div class="row"><div class="k">Version</div><div class="v">' + escapeHtml(info.redis_version || '—') + ' (' + escapeHtml(info.role || '—') + ')</div></div>' +
          '<div class="row"><div class="k">Uptime</div><div class="v">' + escapeHtml(upStr) + '</div></div>' +
          '<div class="row"><div class="k">Memory</div><div class="v">' + escapeHtml(info.used_memory_human || '—') + (info.used_memory_peak_human ? (' (peak ' + escapeHtml(info.used_memory_peak_human) + ')') : '') + '</div></div>' +
          '<div class="row"><div class="k">Clients</div><div class="v">' + escapeHtml(info.connected_clients || '—') + '</div></div>' +
          '<div class="row"><div class="k">Ops/sec</div><div class="v">' + escapeHtml(info.instantaneous_ops_per_sec || '—') + '</div></div>' +
          '<div class="row"><div class="k">Commands total</div><div class="v">' + escapeHtml(info.total_commands_processed || '—') + '</div></div>' +
          '<div class="row"><div class="k">CPU user/sys</div><div class="v">' + escapeHtml(info.used_cpu_user || '—') + ' / ' + escapeHtml(info.used_cpu_sys || '—') + '</div></div>' +
          '<div class="row"><div class="k">Cache hit/miss</div><div class="v">' + escapeHtml(info.keyspace_hits || '0') + ' / ' + escapeHtml(info.keyspace_misses || '0') + '</div></div>' +
          (info.db0 ? '<div class="row"><div class="k">Keys (db0)</div><div class="v">' + escapeHtml(info.db0) + '</div></div>' : '') +
        '</div>';
    } catch (e) {
      el.innerHTML = '<div class="ma-muted">Fehler: ' + escapeHtml(e.message || String(e)) + '</div>';
      if (badgesEl) badgesEl.innerHTML = '<span class="ma-pill ma-pill-warn">Fehler</span>';
    }
  }

  // v0.13.6: Analyzer-Live-Uebersicht (Heute, letzte Stunde)
  async function refreshAnalyzer() {
    const el = $('dashAnalyzer');
    const badgesEl = $('dashAnalyzerBadges');
    if (!el) return;
    try {
      const r = await global.MA.api.analyzerOverview();
      const today = r.today || {};
      const lastHour = r.lastHour || {};
      const yesterday = r.yesterday || {};
      if (badgesEl) {
        badgesEl.innerHTML =
          '<span class="ma-pill" style="background:' + ((today.errors||0) > 0 ? '#3a1515' : '#17351f') + ';color:#fff">heute ' + (today.errors||0) + ' err</span>' +
          ' <span class="ma-pill" style="background:#3a2a12;color:#ffd18b">' + (today.warns||0) + ' warn</span>' +
          ' <span class="ma-pill" style="background:#1b1f27;color:#c6ceda">1h: ' + (lastHour.errors||0) + ' err / ' + (lastHour.warns||0) + ' warn</span>';
      }
      const topPatterns = (r.topPatterns || []).slice(0, 5);
      const rowsHtml = topPatterns.length ? topPatterns.map(p => {
        return '<tr>' +
          '<td><span class="ma-pill" style="background:#3a1515;color:#ffb3b3">' + (p.count || 0) + '×</span></td>' +
          '<td><span class="ma-mono" style="font-size:11px">' + escapeHtml((p.pattern || p.text || '').slice(0, 80)) + '</span></td>' +
          '<td class="ma-muted" style="font-size:11px">' + escapeHtml(p.from || p.adapter || '') + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="3" class="ma-muted" style="padding:6px;text-align:center">keine Top-Patterns</td></tr>';
      el.innerHTML = '' +
        '<div class="ma-obj-detail">' +
          '<div class="row"><div class="k">Heute</div><div class="v">' + (today.errors||0) + ' Errors · ' + (today.warns||0) + ' Warns · ' + (today.events||0) + ' Events</div></div>' +
          '<div class="row"><div class="k">Gestern</div><div class="v">' + (yesterday.errors||0) + ' Errors · ' + (yesterday.warns||0) + ' Warns · ' + (yesterday.events||0) + ' Events</div></div>' +
          '<div class="row"><div class="k">Letzte Stunde</div><div class="v">' + (lastHour.errors||0) + ' Errors · ' + (lastHour.warns||0) + ' Warns</div></div>' +
        '</div>' +
        '<table class="ma-table" style="margin-top:8px"><thead><tr><th>Anzahl</th><th>Top-Pattern</th><th>Quelle</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody></table>';
    } catch (e) {
      el.innerHTML = '<div class="ma-muted">Analyzer noch nicht aktiv oder Fehler: ' + escapeHtml(e.message || String(e)) + '</div>';
      if (badgesEl) badgesEl.innerHTML = '<span class="ma-pill ma-pill-warn">offline</span>';
    }
  }

  // v0.13.6: ConnectivityGuard-Status anzeigen
  // Liest States aus 0_userdata.0.Netzwerk.Connectivity.*
  async function refreshConnectivity() {
    const el = $('dashConnectivity');
    const badgesEl = $('dashConnBadges');
    if (!el) return;
    try {
      const base = '0_userdata.0.Netzwerk.Connectivity';
      const keys = ['online','dnsOk','httpOk','currentOutageMin','outagesLast24h','downtimeLast24hMin','lastUpAt','lastDownAt','lastCheckAt','outagesJson','htmlCard'];
      const states = {};
      for (const k of keys) {
        try {
          const s = await global.MA.api.getState(base + '.' + k);
          states[k] = s ? s.val : null;
        } catch (e) { states[k] = null; }
      }
      if (states.online == null && states.htmlCard == null) {
        el.innerHTML = '<div class="ma-muted">ConnectivityGuard-Script nicht aktiv oder noch nie gelaufen. Erwartete States unter <code>' + base + '.*</code>.</div>';
        if (badgesEl) badgesEl.innerHTML = '<span class="ma-pill ma-pill-warn">offline</span>';
        return;
      }
      const online = states.online === true;
      if (badgesEl) {
        badgesEl.innerHTML =
          (online
            ? '<span class="ma-pill" style="background:#17351f;color:#b6f7c1">● ONLINE</span>'
            : '<span class="ma-pill" style="background:#3a1515;color:#ffb3b3">● OFFLINE</span>') +
          ' <span class="ma-pill" style="background:#1b1f27;color:#c6ceda">24h: ' + (states.outagesLast24h || 0) + ' Outage(s) / ' + (states.downtimeLast24hMin || 0) + 'min</span>';
      }
      // Wenn das Script eine fertige htmlCard liefert: die nutzen
      if (states.htmlCard && typeof states.htmlCard === 'string' && states.htmlCard.length > 100) {
        el.innerHTML = states.htmlCard;
        return;
      }
      // Fallback: eigene Darstellung
      const ageSec = states.lastCheckAt ? Math.round((Date.now() - states.lastCheckAt) / 1000) : null;
      let outages = [];
      try { if (states.outagesJson) outages = JSON.parse(states.outagesJson) || []; } catch(e) {}
      let outageRows = outages.slice(-5).reverse().map(o => {
        const t = new Date(o.start).toLocaleTimeString('de-DE');
        const min = Math.round((o.durationMs || 0) / 60000);
        return '<tr><td>' + escapeHtml(t) + '</td><td style="text-align:right">' + min + 'min</td></tr>';
      }).join('');
      if (!outageRows) outageRows = '<tr><td colspan="2" class="ma-muted" style="padding:6px;text-align:center">keine Outages in 24h</td></tr>';
      el.innerHTML = '' +
        '<div class="ma-obj-detail">' +
          '<div class="row"><div class="k">DNS</div><div class="v">' + (states.dnsOk === true ? '✓ ok' : '✗ fail') + '</div></div>' +
          '<div class="row"><div class="k">HTTP-Canary</div><div class="v">' + (states.httpOk === true ? '✓ ok' : '✗ fail') + '</div></div>' +
          '<div class="row"><div class="k">aktueller Outage</div><div class="v">' + (states.currentOutageMin || 0) + ' min</div></div>' +
          '<div class="row"><div class="k">letzter Check</div><div class="v">' + (ageSec != null ? ('vor ' + ageSec + 's') : '—') + '</div></div>' +
        '</div>' +
        '<table class="ma-table" style="margin-top:8px"><thead><tr><th>Outage Start</th><th style="text-align:right">Dauer</th></tr></thead><tbody>' + outageRows + '</tbody></table>';
    } catch (e) {
      el.innerHTML = '<div class="ma-muted">Fehler: ' + escapeHtml(e.message || String(e)) + '</div>';
    }
  }

  // v0.13.6: SysHealthAmpel-Status anzeigen
  // Liest States aus 0_userdata.0.Status.WledAmpel.* und 0_userdata.0.Scripte.Health.*
  async function refreshHealth() {
    const el = $('dashHealth');
    const badgesEl = $('dashHealthBadges');
    if (!el) return;
    try {
      // Ampel-Modus
      let mode = null, reason = null, modeSince = null, htmlCard = null, monitorJson = null;
      try { const s = await global.MA.api.getState('0_userdata.0.Status.WledAmpel.mode'); mode = s ? s.val : null; } catch(e) {}
      try { const s = await global.MA.api.getState('0_userdata.0.Status.WledAmpel.reason'); reason = s ? s.val : null; } catch(e) {}
      try { const s = await global.MA.api.getState('0_userdata.0.Status.WledAmpel.modeSince'); modeSince = s ? s.val : null; } catch(e) {}
      try { const s = await global.MA.api.getState('0_userdata.0.vis.Dashboards.ScriptHealthHTML'); htmlCard = s ? s.val : null; } catch(e) {}
      try { const s = await global.MA.api.getState('0_userdata.0.Scripte.Health.monitorJson'); monitorJson = s ? s.val : null; } catch(e) {}

      if (mode == null && htmlCard == null && monitorJson == null) {
        el.innerHTML = '<div class="ma-muted">SysHealthAmpel-Script nicht aktiv. Erwartete States unter <code>0_userdata.0.Scripte.Health.*</code> und <code>0_userdata.0.Status.WledAmpel.*</code>.</div>';
        if (badgesEl) badgesEl.innerHTML = '<span class="ma-pill ma-pill-warn">offline</span>';
        return;
      }
      // Badges: Modus + OK/WARN/DOWN Zähler aus monitorJson
      let okCnt = 0, warnCnt = 0, downCnt = 0;
      try {
        const items = monitorJson ? (Array.isArray(monitorJson) ? monitorJson : JSON.parse(monitorJson)) : [];
        items.forEach(it => {
          if (it && it.classify === 'down') downCnt++;
          else if (it && it.classify === 'warn') warnCnt++;
          else okCnt++;
        });
      } catch(e) {}
      const modeBg = mode === 'RED' ? '#3a1515' : (mode === 'YELLOW' ? '#3a2a12' : (mode === 'BLUE' ? '#0e2540' : '#17351f'));
      const modeFg = mode === 'RED' ? '#ffb3b3' : (mode === 'YELLOW' ? '#ffd18b' : (mode === 'BLUE' ? '#9ec6f7' : '#b6f7c1'));
      const modeIcon = mode === 'RED' ? '🔴' : (mode === 'YELLOW' ? '🟡' : (mode === 'BLUE' ? '🔵' : (mode === 'GREEN' ? '🟢' : '⚪')));
      if (badgesEl) {
        badgesEl.innerHTML =
          '<span class="ma-pill" style="background:' + modeBg + ';color:' + modeFg + '">' + modeIcon + ' ' + escapeHtml(mode || 'INIT') + '</span>' +
          ' <span class="ma-pill" style="background:#17351f;color:#b6f7c1">OK ' + okCnt + '</span>' +
          (warnCnt ? ' <span class="ma-pill" style="background:#3a2a12;color:#ffd18b">WARN ' + warnCnt + '</span>' : '') +
          (downCnt ? ' <span class="ma-pill" style="background:#3a1515;color:#ffb3b3">DOWN ' + downCnt + '</span>' : '');
      }
      // HTML-Card vom Script direkt nutzen wenn lang genug
      if (htmlCard && typeof htmlCard === 'string' && htmlCard.length > 200) {
        el.innerHTML = htmlCard;
        if (reason) el.insertAdjacentHTML('beforebegin', '');
        return;
      }
      // Fallback: eigene Darstellung mit Reason
      el.innerHTML = '' +
        '<div class="ma-obj-detail">' +
          '<div class="row"><div class="k">Modus</div><div class="v">' + escapeHtml(mode || 'INIT') + '</div></div>' +
          '<div class="row"><div class="k">Grund</div><div class="v">' + escapeHtml(reason || '—') + '</div></div>' +
          '<div class="row"><div class="k">seit</div><div class="v">' + escapeHtml(modeSince || '—') + '</div></div>' +
        '</div>';
    } catch (e) {
      el.innerHTML = '<div class="ma-muted">Fehler: ' + escapeHtml(e.message || String(e)) + '</div>';
    }
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

  // v0.13.6: Sparkline-Ringbuffer fuer CPU/RAM (ca 60 Punkte = 5min bei 5s Tick)
  const SPARK_MAX = 60;
  const sparkBuf = { cpu: [], ram: [] };

  function pushSpark(key, val) {
    if (val == null || !Number.isFinite(val)) return;
    const buf = sparkBuf[key];
    if (!buf) return;
    buf.push(Number(val));
    while (buf.length > SPARK_MAX) buf.shift();
    drawSpark(key);
  }

  function drawSpark(key) {
    const canvas = document.getElementById('spark' + key.charAt(0).toUpperCase() + key.slice(1));
    if (!canvas) return;
    const buf = sparkBuf[key];
    if (!buf || !buf.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const max = 100;
    const min = 0;
    const n = buf.length;
    if (n < 2) return;
    const dx = W / (SPARK_MAX - 1);
    const xOffset = (SPARK_MAX - n) * dx;  // rechtsbuendig

    // Hintergrund gefuelltes Polygon
    ctx.beginPath();
    ctx.moveTo(xOffset, H);
    buf.forEach((v, i) => {
      const x = xOffset + i * dx;
      const y = H - ((v - min) / (max - min)) * H;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(xOffset + (n - 1) * dx, H);
    ctx.closePath();
    // Farbe nach letztem Wert
    const last = buf[buf.length - 1];
    const color = last >= 90 ? 'rgba(220,38,38,0.6)' : (last >= 75 ? 'rgba(245,158,11,0.6)' : 'rgba(22,163,74,0.55)');
    const lineColor = last >= 90 ? '#dc2626' : (last >= 75 ? '#f59e0b' : '#16a34a');
    ctx.fillStyle = color;
    ctx.fill();

    // Linie
    ctx.beginPath();
    buf.forEach((v, i) => {
      const x = xOffset + i * dx;
      const y = H - ((v - min) / (max - min)) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function renderStatsBar(s) {
    if (!s) return;
    // CPU
    const cpuVal = s.cpu != null ? Number(s.cpu) : (s.load != null ? Math.min(100, Math.round(Number(s.load) * 25)) : null);
    setStat('Cpu',  cpuVal != null ? cpuVal.toFixed(0) + ' %' : '—', cpuVal);
    pushSpark('cpu', cpuVal);
    // RAM
    let ramPct = null;
    if (s.totalmem && s.freemem != null) {
      const used = s.totalmem - Number(s.freemem);
      ramPct = Math.round(used / s.totalmem * 100);
      setStat('Ram',  fmtBytes(used) + ' / ' + fmtBytes(s.totalmem), ramPct);
    } else if (s.memUsedPct != null) {
      ramPct = s.memUsedPct;
      setStat('Ram', s.memUsedPct + ' %', s.memUsedPct);
    } else setStat('Ram', '—', null);
    pushSpark('ram', ramPct);
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
