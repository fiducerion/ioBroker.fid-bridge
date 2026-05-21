/* tabs/analyzer.js — Analyzer
 *
 * Zeigt Errors+Warnings aus dem in-Adapter Log-Sammler:
 *  - Stats-Strip oben
 *  - "Heute Live" (default geoeffnet): Top Errors / Top Warnings / Recent
 *  - "Gestern" (default zu)
 *  - "7-Tage-Verlauf" (default zu): Balken + Tagesliste
 *
 * Pro Eintrag und pro Sektion: Copy-Buttons (Markdown).
 */
(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;

  let initialized = false;
  let autoRefresh = null;
  let lastOverview = null;
  let lastRecent = [];
  let lastTopErr = [];
  let lastTopWarn = [];
  let lastHistory = [];
  let openedCards = { today: true, yesterday: false, history: false };

  function init() {
    if (initialized) return;
    initialized = true;
    $('anReload') && $('anReload').addEventListener('click', refresh);
  }

  async function refresh() {
    init();
    await Promise.all([
      loadOverview(),
      loadTodayTop(),
      loadRecent(),
      loadHistory()
    ]);
    renderAll();
    startAutoRefresh();
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefresh = setInterval(async () => {
      // Nur refreshen wenn Analyzer-Tab aktiv ist
      const active = document.querySelector('.ma-tab.active');
      if (!active || active.dataset.tab !== 'analyzer') return;
      try {
        await Promise.all([loadOverview(), loadTodayTop(), loadRecent()]);
        renderAll();
      } catch (e) {}
    }, 10000);
  }
  function stopAutoRefresh() { if (autoRefresh) { clearInterval(autoRefresh); autoRefresh = null; } }

  async function loadOverview() {
    try { lastOverview = await global.MA.api.analyzerOverview(); }
    catch (e) { lastOverview = null; }
  }
  async function loadTodayTop() {
    try {
      const [te, tw] = await Promise.all([
        global.MA.api.analyzerTop('today', 'patterns', 'error', 10),
        global.MA.api.analyzerTop('today', 'patterns', 'warn',  10)
      ]);
      lastTopErr  = (te && te.items) || [];
      lastTopWarn = (tw && tw.items) || [];
    } catch (e) { lastTopErr = []; lastTopWarn = []; }
  }
  async function loadRecent() {
    try {
      const r = await global.MA.api.analyzerEvents({ limit: 100 });
      lastRecent = (r && r.items) || [];
    } catch (e) { lastRecent = []; }
  }
  async function loadHistory() {
    try {
      const r = await global.MA.api.analyzerHistory();
      lastHistory = (r && r.days) || [];
    } catch (e) { lastHistory = []; }
  }

  function renderAll() {
    renderStats();
    renderToday();
    renderYesterday();
    renderHistory();
  }

  function renderStats() {
    const el = $('anStatsBar'); if (!el) return;
    const o = lastOverview;
    if (!o) { el.innerHTML = '<div class="ma-muted">Lade...</div>'; return; }
    const today = o.today || { errors: 0, warnings: 0, groups: 0 };
    const yest  = o.yesterday || { errors: 0, warnings: 0 };
    const hr    = o.lastHour || { errors: 0, warnings: 0 };
    el.innerHTML = `
      <div class="an-stat an-stat-err">
        <div class="an-stat-lbl">Errors heute</div>
        <div class="an-stat-val">${today.errors}</div>
      </div>
      <div class="an-stat an-stat-warn">
        <div class="an-stat-lbl">Warnings heute</div>
        <div class="an-stat-val">${today.warnings}</div>
      </div>
      <div class="an-stat">
        <div class="an-stat-lbl">Typen heute</div>
        <div class="an-stat-val">${today.groups}</div>
      </div>
      <div class="an-stat">
        <div class="an-stat-lbl">letzte Stunde</div>
        <div class="an-stat-val"><span style="color:var(--ma-err,#e57373)">${hr.errors}</span> / <span style="color:#ffb74d">${hr.warnings}</span></div>
      </div>
      <div class="an-stat">
        <div class="an-stat-lbl">Gestern</div>
        <div class="an-stat-val"><span style="color:var(--ma-err,#e57373)">${yest.errors||0}</span> / <span style="color:#ffb74d">${yest.warnings||0}</span></div>
      </div>
    `;
  }

  function renderToday() {
    const card  = $('anTodayCard');
    const body  = $('anTodayBody'); if (!body) return;
    body.innerHTML = `
      <div class="an-grid">
        <div class="an-col">
          <div class="an-col-head">
            <h4>❌ Top Errors heute</h4>
            <button class="ma-btn ma-btn-ghost ma-btn-xs" data-copy-section="topErr" title="Als Markdown kopieren">📋</button>
          </div>
          ${renderTopList(lastTopErr, 'err')}
        </div>
        <div class="an-col">
          <div class="an-col-head">
            <h4>⚠️ Top Warnings heute</h4>
            <button class="ma-btn ma-btn-ghost ma-btn-xs" data-copy-section="topWarn" title="Als Markdown kopieren">📋</button>
          </div>
          ${renderTopList(lastTopWarn, 'warn')}
        </div>
      </div>
      <div class="an-col" style="margin-top: 16px;">
        <div class="an-col-head">
          <h4>📜 Aktuell (letzte ${lastRecent.length} Events)</h4>
          <button class="ma-btn ma-btn-ghost ma-btn-xs" data-copy-section="recent" title="Als Markdown kopieren">📋</button>
        </div>
        ${renderEventList(lastRecent)}
      </div>
    `;
    bindCopy(body);
  }

  function renderTopList(items, type) {
    if (!items.length) return '<div class="ma-muted" style="padding: 8px;">— keine —</div>';
    return `
      <table class="ma-table an-top-table">
        <thead><tr><th style="width:36px">#</th><th style="width:60px;text-align:right">Anzahl</th><th>Pattern</th><th style="width:36px"></th></tr></thead>
        <tbody>${items.map((it, i) => `
          <tr>
            <td class="ma-muted">${i + 1}</td>
            <td style="text-align:right; font-weight: 700; color: ${type === 'err' ? 'var(--ma-err, #e57373)' : '#ffb74d'};">${it.count}</td>
            <td class="ma-mono" style="font-size: 11px; word-break: break-word;" title="${escapeHtml(it.sample || it.key)}">${escapeHtml(it.key)}</td>
            <td><button class="ma-btn ma-btn-ghost ma-btn-xs" data-copy-text="${escapeHtml(JSON.stringify({ key: it.key, count: it.count, sample: it.sample || '', lastTs: it.lastTs }))}" title="Kopieren">📋</button></td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
  }

  function renderEventList(items) {
    if (!items.length) return '<div class="ma-muted" style="padding: 8px;">— noch nichts —</div>';
    return `
      <div class="an-events">
        ${items.map(e => `
          <div class="an-event an-event-${e.level}">
            <span class="an-event-time">${new Date(e.ts).toLocaleTimeString('de-DE')}</span>
            <span class="an-event-lvl">${e.level === 'error' ? '❌' : '⚠️'}</span>
            <span class="an-event-src">${escapeHtml(e.script || e.adapter)}</span>
            <span class="an-event-msg" title="${escapeHtml(e.msg)}">${escapeHtml(e.msg.slice(0, 200))}</span>
            <button class="ma-btn ma-btn-ghost ma-btn-xs" data-copy-event-id="${e.id}" title="Komplettes Event kopieren">📋</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderYesterday() {
    const body = $('anYestBody'); if (!body) return;
    const yest = lastOverview && lastOverview.yesterday;
    if (!yest) {
      body.innerHTML = '<div class="ma-muted" style="padding:10px">Keine Daten für gestern verfügbar (Bridge läuft erst seit heute).</div>';
      return;
    }
    body.innerHTML = `
      <div class="an-grid">
        <div class="an-col">
          <h4 style="margin:0 0 8px">${escapeHtml(yest.date)}</h4>
          <div class="ma-obj-detail">
            <div class="row"><div class="k">Errors</div><div class="v" style="color:var(--ma-err, #e57373); font-weight: 700;">${yest.errors}</div></div>
            <div class="row"><div class="k">Warnings</div><div class="v" style="color:#ffb74d; font-weight: 700;">${yest.warnings}</div></div>
            <div class="row"><div class="k">Typen</div><div class="v">${yest.groups || '—'}</div></div>
          </div>
          <p class="ma-muted" style="font-size:11px; margin: 12px 0 0;">
            Hinweis: Pattern-Details werden nur für „heute" gehalten. Für ältere Tage zeigt die History nur die Aggregate.
          </p>
        </div>
      </div>
    `;
  }

  function renderHistory() {
    const body = $('anHistBody'); if (!body) return;
    if (!lastHistory.length) {
      body.innerHTML = '<div class="ma-muted" style="padding:10px">Noch keine Historie. Daten werden ab dem ersten Tageswechsel gesammelt.</div>';
      return;
    }
    const maxV = Math.max(1, ...lastHistory.map(d => (d.errors || 0) + (d.warnings || 0)));
    body.innerHTML = `
      <table class="ma-table an-hist-table">
        <thead><tr><th>Datum</th><th style="text-align:right">Errors</th><th style="text-align:right">Warnings</th><th>Balken</th></tr></thead>
        <tbody>${lastHistory.map(d => {
          const total = (d.errors || 0) + (d.warnings || 0);
          const ePct = Math.round((d.errors / maxV) * 100);
          const wPct = Math.round((d.warnings / maxV) * 100);
          return `
            <tr>
              <td class="ma-mono">${escapeHtml(d.date)}</td>
              <td style="text-align:right; color: var(--ma-err, #e57373); font-weight: 600;">${d.errors}</td>
              <td style="text-align:right; color: #ffb74d; font-weight: 600;">${d.warnings}</td>
              <td>
                <div class="an-bar">
                  <div class="an-bar-err"  style="width: ${ePct}%"></div>
                  <div class="an-bar-warn" style="width: ${wPct}%"></div>
                  <span class="an-bar-lbl">${total}</span>
                </div>
              </td>
            </tr>
          `;
        }).join('')}</tbody>
      </table>
    `;
  }

  // ---- Copy-Helpers ----
  function bindCopy(root) {
    root.querySelectorAll('[data-copy-event-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.copyEventId);
        const ev = lastRecent.find(x => x.id === id);
        if (!ev) return;
        const txt = formatEventMarkdown(ev);
        copyText(txt);
      });
    });
    root.querySelectorAll('[data-copy-text]').forEach(btn => {
      btn.addEventListener('click', () => {
        try {
          const o = JSON.parse(btn.dataset.copyText);
          const lines = [
            '**Pattern:** `' + (o.key || '') + '`',
            '**Anzahl:** ' + (o.count || 0),
            o.sample ? '**Sample:** ' + o.sample : '',
            o.lastTs ? '**Zuletzt:** ' + new Date(o.lastTs).toLocaleString('de-DE') : ''
          ].filter(Boolean);
          copyText(lines.join('\n'));
        } catch (e) {}
      });
    });
    root.querySelectorAll('[data-copy-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = btn.dataset.copySection;
        let txt = '';
        if (sec === 'topErr')  txt = formatTopListMd('Top Errors heute', lastTopErr);
        if (sec === 'topWarn') txt = formatTopListMd('Top Warnings heute', lastTopWarn);
        if (sec === 'recent')  txt = formatEventListMd('Letzte Events', lastRecent);
        copyText(txt);
      });
    });
  }

  function formatEventMarkdown(e) {
    const t = new Date(e.ts).toLocaleString('de-DE');
    return [
      '```',
      `[${t}] ${e.level.toUpperCase()}  ${e.adapter}${e.script ? ' (' + e.script + ')' : ''}`,
      e.msg,
      '```'
    ].join('\n');
  }

  function formatTopListMd(title, items) {
    const lines = [`### ${title}`, ''];
    if (!items.length) lines.push('_— keine —_');
    else items.forEach((it, i) => {
      lines.push(`${i + 1}. **${it.count}×** \`${it.key}\``);
      if (it.sample && it.sample !== it.key) lines.push(`    ${it.sample}`);
    });
    return lines.join('\n');
  }
  function formatEventListMd(title, items) {
    const lines = [`### ${title}`, ''];
    if (!items.length) lines.push('_— noch nichts —_');
    else {
      lines.push('```');
      items.forEach(e => {
        const t = new Date(e.ts).toLocaleString('de-DE');
        lines.push(`[${t}] ${e.level.toUpperCase().padEnd(5)} ${e.adapter}${e.script ? ' (' + e.script + ')' : ''}: ${e.msg.slice(0, 250)}`);
      });
      lines.push('```');
    }
    return lines.join('\n');
  }

  async function copyText(txt) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(txt);
      } else {
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      global.MA.toast('Kopiert (' + txt.length + ' Zeichen)', 'ok');
    } catch (e) {
      global.MA.toast('Kopieren fehlgeschlagen: ' + e.message, 'bad');
    }
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.analyzer = { init, refresh };
})(window);
