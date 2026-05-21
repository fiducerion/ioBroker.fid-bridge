/* lib/logCollector.js
 *
 * Live-Log-Sammler für den Analyzer-Tab.
 *
 * Funktioniert ähnlich wie das User-Skript "LogMonitor v1.0.1":
 *   - Hookt via adapter.requireLog(true) + adapter.on('log', ...) alle errors+warnings ab
 *   - Hält einen 48h-Ringbuffer der Roh-Events im RAM
 *   - Normalisiert Patterns (Timestamps, IPs, Hexzahlen, große Numbers -> Platzhalter)
 *     damit gleichartige Events zusammen gezählt werden können
 *   - Aggregiert pro Tag: { date, errors, warnings, groups, adapters{}, scripts{} }
 *   - Tagesrotation um Mitternacht
 *   - Persistiert die 7-Tages-Historie in 0_userdata.0.fid-bridge.analyzer.history
 *     damit sie einen Bridge-Restart überlebt
 *
 * Performance:
 *   - Ringbuffer hartes Cap: 50.000 Events (mehr als genug für 48h auf gesunden Systemen)
 *   - Bei sehr hoher Lograte (Crash-Loop) wird ab dem Cap der älteste Event weggeworfen
 *
 * Skript-Namen-Extraktion: aus javascript.0-Logs wird der eigentliche Skript-Pfad
 * (script.js.<...>) aus der Message extrahiert. 3-stufiges Matching:
 *   1) "^script.js.<name>:" am Zeilenanfang
 *   2) "(script.js.<name>:N:N)" in Stack-Frames
 *   3) irgendwo "script.js.<name>" als Last-Resort
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ANSI_RE = /\x1b\[[0-9;]*m/g;

const HARD_CAP_EVENTS  = 50000;     // max. Anzahl Events im Ringbuffer
const RETENTION_MS     = 48 * 3600 * 1000;
const HISTORY_DAYS     = 7;         // Tages-Aggregate
const RECENT_LIMIT     = 200;       // last-N für die Übersicht
const TOP_N_DEFAULT    = 10;
const FLUSH_DEBOUNCE_MS = 2500;     // History-Persist debounce
const HISTORY_STATE_ID = '0_userdata.0.fid-bridge.analyzer.history';

function stripAnsi(s) { return String(s || '').replace(ANSI_RE, ''); }

function todayKey(d) {
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Pattern-Normalisierung: macht aus zwei "verschiedenen" Errors die nur in
// Timestamps/Zahlen unterscheiden den gleichen Pattern-Key.
function normalizePattern(msg) {
  let m = stripAnsi(msg);
  m = m.replace(/^script\.js\.\S+:\s*/, '');                                            // Skript-Präfix raus
  m = m.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\b/g, '<TS>');               // ISO timestamps
  m = m.replace(/\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?\b/g, '<TS>');             // ioBroker timestamps
  m = m.replace(/\b(\d{1,3}\.){3}\d{1,3}\b/g, '<IP>');                                   // IPs
  m = m.replace(/\b0x[0-9a-fA-F]+\b/g, '<HEX>');                                         // 0x...
  m = m.replace(/\b[0-9a-fA-F]{12,}\b/g, '<HEX>');                                       // lange Hex-Strings
  m = m.replace(/:\d+(:\d+)?\)/g, ':N$1)');                                              // (file:line:col)
  m = m.replace(/\b\d+ms\b/g, '<N>ms');
  m = m.replace(/\bsize=\d+/g, 'size=<N>');
  m = m.replace(/\b\d{4,}\b/g, '<N>');                                                   // große Zahlen
  m = m.replace(/\s+/g, ' ').trim();
  return m.slice(0, 240);
}

// Skript-Pfad aus einer Log-Message extrahieren (für javascript.0)
function scriptOf(msg) {
  const s = String(msg || '');
  let m = s.match(/^(script\.js\.[^\s:]+):/);
  if (m) return m[1];
  m = s.match(/\((script\.js\.[^:)]+):/);
  if (m) return m[1];
  m = s.match(/(script\.js\.[A-Za-z0-9_.\-]+)/);
  if (m) return m[1];
  return null;
}

function adapterOf(from) {
  return String(from || '').replace(/^system\.adapter\./, '') || 'unknown';
}

function makeAggregate() {
  return {
    date: todayKey(),
    errors: 0,
    warnings: 0,
    adapters: Object.create(null), // adapterId -> count
    scripts:  Object.create(null), // scriptId -> count
    patternsErr:  new Map(),       // pattern -> { count, lastTs, sample }
    patternsWarn: new Map(),
    hourly: Array.from({ length: 24 }, () => ({ err: 0, warn: 0 }))
  };
}

function patternsMapToObj(m) {
  const o = {};
  m.forEach((v, k) => { o[k] = v; });
  return o;
}
function patternsObjToMap(o) {
  const m = new Map();
  if (o && typeof o === 'object') {
    Object.keys(o).forEach(k => m.set(k, o[k]));
  }
  return m;
}

function topN(map, n) {
  const arr = [];
  map.forEach((v, k) => arr.push({ key: k, count: v.count, lastTs: v.lastTs, sample: v.sample || '' }));
  arr.sort((a, b) => b.count - a.count);
  return arr.slice(0, n);
}

function topNFromCounts(obj, n) {
  return Object.entries(obj || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

module.exports = function createCollector(adapter) {
  const state = {
    events: [],                            // 48h Ringbuffer der Roh-Events
    nextEventId: 1,
    today: makeAggregate(),
    history: [],                           // [{ date, errors, warnings, adapters, scripts }]
    flushTimer: null,
    rotateTimer: null,
    started: false,
    listener: null
  };

  function ingest(level, ts, adapter_, script, msg) {
    if (level !== 'error' && level !== 'warn') return;

    // Eigene Bridge-Logs nicht aufnehmen (sonst Endlos-Echo bei Bridge-Fehlern)
    if (adapter_ && adapter_.startsWith('fid-bridge')) return;

    // Tagesrotation
    const today = todayKey(new Date(ts));
    if (today !== state.today.date) {
      rotateDay();
    }

    const pattern = normalizePattern(msg);
    const ev = {
      id: state.nextEventId++,
      ts: ts,
      level: level,
      adapter: adapter_,
      script: script,
      msg: String(msg || '').slice(0, 1500),
      pattern: pattern
    };
    state.events.push(ev);

    // Ringbuffer-Cap
    if (state.events.length > HARD_CAP_EVENTS) {
      state.events.splice(0, state.events.length - HARD_CAP_EVENTS);
    }

    // Aggregate aktualisieren
    const agg = state.today;
    if (level === 'error') {
      agg.errors++;
      bumpPattern(agg.patternsErr, pattern, ts, msg);
    } else {
      agg.warnings++;
      bumpPattern(agg.patternsWarn, pattern, ts, msg);
    }
    agg.adapters[adapter_] = (agg.adapters[adapter_] || 0) + 1;
    if (script) agg.scripts[script] = (agg.scripts[script] || 0) + 1;
    agg.hourly[new Date(ts).getHours()][level === 'error' ? 'err' : 'warn']++;

    schedulePersist();
    pruneOldEvents();
  }

  function bumpPattern(map, key, ts, sample) {
    if (!key) return;
    const e = map.get(key) || { count: 0, lastTs: 0, sample: '' };
    e.count++;
    e.lastTs = ts;
    if (!e.sample && sample) e.sample = String(sample).slice(0, 240);
    map.set(key, e);
  }

  function pruneOldEvents() {
    const cutoff = Date.now() - RETENTION_MS;
    if (state.events.length && state.events[0].ts < cutoff) {
      let firstKeep = 0;
      while (firstKeep < state.events.length && state.events[firstKeep].ts < cutoff) firstKeep++;
      if (firstKeep > 0) state.events.splice(0, firstKeep);
    }
  }

  function rotateDay() {
    // Aktuellen Tag in Historie wegspeichern, neuen Tag eröffnen
    const old = state.today;
    state.history.push({
      date: old.date,
      errors: old.errors,
      warnings: old.warnings,
      groups: old.patternsErr.size + old.patternsWarn.size,
      adapters: Object.assign({}, old.adapters),
      scripts:  Object.assign({}, old.scripts)
    });
    // Cap auf HISTORY_DAYS
    while (state.history.length > HISTORY_DAYS) state.history.shift();
    state.today = makeAggregate();
    schedulePersist(true);
  }

  function schedulePersist(immediate) {
    if (state.flushTimer) clearTimeout(state.flushTimer);
    state.flushTimer = setTimeout(persistHistory, immediate ? 0 : FLUSH_DEBOUNCE_MS);
    if (state.flushTimer.unref) state.flushTimer.unref();
  }

  async function persistHistory() {
    try {
      // Heute + History persistieren
      const payload = {
        history: state.history,
        today: serializeAggregate(state.today),
        savedAt: Date.now()
      };
      // Stellen sicher dass der Ordner-Pfad existiert
      await ensureFolder('0_userdata.0.fid-bridge');
      await ensureFolder('0_userdata.0.fid-bridge.analyzer');
      await ensureState(HISTORY_STATE_ID, {
        type: 'string', role: 'json', read: true, write: false,
        name: 'Fiducerion Analyzer - History'
      });
      await adapter.setForeignStateAsync(HISTORY_STATE_ID, { val: JSON.stringify(payload), ack: true });
    } catch (e) {
      adapter.log.debug('analyzer persist error: ' + e.message);
    }
  }

  function serializeAggregate(agg) {
    return {
      date: agg.date,
      errors: agg.errors,
      warnings: agg.warnings,
      adapters: Object.assign({}, agg.adapters),
      scripts:  Object.assign({}, agg.scripts),
      patternsErr:  patternsMapToObj(agg.patternsErr),
      patternsWarn: patternsMapToObj(agg.patternsWarn),
      hourly: agg.hourly.slice()
    };
  }
  function deserializeAggregate(o) {
    if (!o) return makeAggregate();
    const a = makeAggregate();
    a.date = o.date || todayKey();
    a.errors = Number(o.errors) || 0;
    a.warnings = Number(o.warnings) || 0;
    a.adapters = Object.assign({}, o.adapters || {});
    a.scripts  = Object.assign({}, o.scripts  || {});
    a.patternsErr  = patternsObjToMap(o.patternsErr);
    a.patternsWarn = patternsObjToMap(o.patternsWarn);
    if (Array.isArray(o.hourly) && o.hourly.length === 24) a.hourly = o.hourly;
    return a;
  }

  async function ensureFolder(id) {
    try {
      const ex = await adapter.getForeignObjectAsync(id);
      if (ex) return;
      await adapter.setForeignObjectAsync(id, {
        type: 'folder',
        common: { name: id.split('.').pop() },
        native: {}
      });
    } catch (e) {}
  }
  async function ensureState(id, common) {
    try {
      const ex = await adapter.getForeignObjectAsync(id);
      if (ex) return;
      await adapter.setForeignObjectAsync(id, { type: 'state', common, native: {} });
    } catch (e) {}
  }

  async function restorePersisted() {
    try {
      const st = await adapter.getForeignStateAsync(HISTORY_STATE_ID).catch(() => null);
      if (!st || !st.val) return;
      let payload; try { payload = JSON.parse(st.val); } catch (e) { return; }
      if (!payload) return;
      if (Array.isArray(payload.history)) state.history = payload.history.slice(-HISTORY_DAYS);
      if (payload.today) {
        const restored = deserializeAggregate(payload.today);
        // Falls Datum wechselt zwischen Save und Restore -> ältere Aggregate in History
        if (restored.date !== todayKey()) {
          state.history.push({
            date: restored.date,
            errors: restored.errors,
            warnings: restored.warnings,
            groups: restored.patternsErr.size + restored.patternsWarn.size,
            adapters: restored.adapters,
            scripts:  restored.scripts
          });
          while (state.history.length > HISTORY_DAYS) state.history.shift();
        } else {
          state.today = restored;
        }
      }
      adapter.log.info('Analyzer: ' + state.history.length + ' Tage Historie geladen, heute: ' + state.today.errors + ' Errors / ' + state.today.warnings + ' Warnings');
    } catch (e) {
      adapter.log.debug('analyzer restore: ' + e.message);
    }
  }

  // ---- Optionaler Backfill aus heutiger Logdatei ----
  // Wir parsen iobroker.<today>.log und speisen alles seit Mitternacht in den Sammler ein.
  // Nur Events die NEUER als der aktuelle Stand sind werden aufgenommen, sonst doppelt.
  const LINE_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.\d+\s+-\s+(\w+):\s+(\S+)\s+\(\d+\)\s+(.*)$/;
  function backfillToday() {
    try {
      const date = todayKey();
      const file = '/opt/iobroker/log/iobroker.' + date + '.log';
      if (!fs.existsSync(file)) return 0;
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const cutTs = midnight.getTime();
      // Wenn wir schon heute Events haben: nur was neuer als unser ältester ist
      const haveTs = state.events.length ? state.events[0].ts : Infinity;
      const skipBefore = state.today.errors + state.today.warnings > 0 ? haveTs : cutTs;

      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      let added = 0;
      for (const raw of lines) {
        if (!raw) continue;
        const clean = stripAnsi(raw);
        const m = clean.match(LINE_RE);
        if (!m) continue;
        const lvl = m[2].toLowerCase();
        if (lvl !== 'error' && lvl !== 'warn') continue;
        const ts = new Date(m[1].replace(' ', 'T')).getTime();
        if (!Number.isFinite(ts) || ts < cutTs) continue;
        if (ts < skipBefore && state.today.errors + state.today.warnings > 0) continue;
        // Doppel-Schutz: gleicher Adapter+Pattern in letzten 2 Sekunden? -> skip
        ingest(lvl, ts, m[3], scriptOf(m[4]), m[4]);
        added++;
        if (added > 50000) break;  // Hard-Limit Backfill
      }
      if (added) adapter.log.info('Analyzer: ' + added + ' Events aus heutiger Logdatei nachgeladen');
      return added;
    } catch (e) {
      adapter.log.debug('analyzer backfill: ' + e.message);
      return 0;
    }
  }

  // Helper: empfaengt ein Log-Entry vom adapter.on('log'-Event und macht draus ingest()
  // Wird entweder direkt von uns hier oder von main.js aufgerufen (siehe skipListener).
  function ingestEntry(info) {
    if (!info) return;
    const level = String(info.severity || info.level || '').toLowerCase();
    if (level !== 'error' && level !== 'warn' && level !== 'warning') return;
    const lvl = level === 'warning' ? 'warn' : level;
    const ts = Number(info.ts) || Date.now();
    const msg = stripAnsi(info.message || '');
    if (!msg) return;
    const ad = adapterOf(info.from);
    const sc = scriptOf(msg);
    ingest(lvl, ts, ad, sc, msg);
  }

  // ---- Lifecycle ----
  async function start(opts) {
    if (state.started) return;
    state.started = true;
    await restorePersisted();
    // Backfill nur wenn heute noch nichts da ist (sonst nach Bridge-Restart doppelt)
    if (state.today.errors === 0 && state.today.warnings === 0) {
      backfillToday();
    }

    // Listener registrieren - AUSSER der Aufrufer macht das selbst (skipListener: true).
    // Hintergrund: manche js-controller-Versionen erlauben nur einen einzigen
    // 'log'-Listener pro Adapter. Wenn main.js bereits einen registriert hat,
    // wuerde unser zweiter den ersten ueberschreiben/verdraengen.
    const skipListener = opts && opts.skipListener;
    if (!skipListener) {
      try {
        adapter.requireLog && adapter.requireLog(true);
        state.listener = ingestEntry;
        adapter.on('log', state.listener);
        adapter.log.info('Analyzer aktiviert (eigener Log-Listener, 48h Retention, ' + HISTORY_DAYS + ' Tage History)');
      } catch (e) {
        adapter.log.warn('Analyzer log-hook failed: ' + e.message);
      }
    } else {
      adapter.log.info('Analyzer aktiviert (gemeinsamer Log-Listener via main.js, 48h Retention, ' + HISTORY_DAYS + ' Tage History)');
    }

    // Rotations-Check alle 5 Minuten (falls Mitternacht vorbei ohne Event)
    state.rotateTimer = setInterval(() => {
      if (state.today.date !== todayKey()) rotateDay();
      pruneOldEvents();
    }, 5 * 60 * 1000);
    if (state.rotateTimer.unref) state.rotateTimer.unref();
  }

  async function stop() {
    if (!state.started) return;
    state.started = false;
    if (state.listener) {
      try { adapter.removeListener('log', state.listener); } catch (e) {}
      state.listener = null;
    }
    if (state.rotateTimer) { clearInterval(state.rotateTimer); state.rotateTimer = null; }
    if (state.flushTimer)  { clearTimeout(state.flushTimer); state.flushTimer = null; }
    try {
      adapter.requireLog && adapter.requireLog(false);
    } catch (e) {}
    await persistHistory().catch(() => {});
  }

  // ---- Query-Helpers (vom API-Layer aufgerufen) ----
  function getOverview() {
    pruneOldEvents();
    const now = Date.now();
    const hourAgo = now - 3600 * 1000;
    let errLastHour = 0, warnLastHour = 0;
    for (const e of state.events) {
      if (e.ts >= hourAgo) {
        if (e.level === 'error') errLastHour++;
        else warnLastHour++;
      }
    }
    const yest = state.history[state.history.length - 1] || null;
    return {
      today: {
        date: state.today.date,
        errors: state.today.errors,
        warnings: state.today.warnings,
        groups: state.today.patternsErr.size + state.today.patternsWarn.size,
        hourly: state.today.hourly.slice()
      },
      yesterday: yest ? {
        date: yest.date,
        errors: yest.errors,
        warnings: yest.warnings,
        groups: yest.groups || 0
      } : null,
      lastHour: { errors: errLastHour, warnings: warnLastHour },
      bufferedEvents: state.events.length,
      retentionHours: RETENTION_MS / 3600000,
      historyDays: state.history.length
    };
  }

  function getTop(bucket, kind, level, n) {
    n = Math.max(1, Math.min(Number(n) || TOP_N_DEFAULT, 50));
    let src, errMap, warnMap;
    if (bucket === 'today') {
      src = state.today;
      errMap = src.patternsErr;
      warnMap = src.patternsWarn;
    } else if (bucket === 'yesterday') {
      const yest = state.history[state.history.length - 1];
      if (!yest) return [];
      // Für Gestern haben wir nur die Aggregate-Counts, keine Pattern-Maps mehr
      if (kind === 'adapters')  return topNFromCounts(yest.adapters, n);
      if (kind === 'scripts')   return topNFromCounts(yest.scripts, n);
      return [];  // patterns für gestern: nicht persistiert
    } else {
      return [];
    }
    if (kind === 'patterns') {
      if (level === 'error') return topN(errMap, n);
      if (level === 'warn')  return topN(warnMap, n);
      // beides
      const merged = new Map();
      errMap.forEach((v, k) => merged.set('ERR: ' + k, v));
      warnMap.forEach((v, k) => merged.set('WARN: ' + k, v));
      return topN(merged, n);
    }
    if (kind === 'adapters') return topNFromCounts(src.adapters, n);
    if (kind === 'scripts')  return topNFromCounts(src.scripts, n);
    return [];
  }

  function getEvents(params) {
    params = params || {};
    pruneOldEvents();
    const level  = params.level;                  // 'error' | 'warn' | undefined
    const since  = Number(params.since)  || 0;
    const until  = Number(params.until)  || Date.now();
    const limit  = Math.max(1, Math.min(Number(params.limit) || RECENT_LIMIT, 5000));
    const query  = String(params.q || '').toLowerCase();
    const adapterFilter = params.adapter || '';
    const scriptFilter  = params.script || '';
    const out = [];
    // Rückwärts (neueste zuerst)
    for (let i = state.events.length - 1; i >= 0; i--) {
      const e = state.events[i];
      if (level && e.level !== level) continue;
      if (e.ts < since || e.ts > until) continue;
      if (adapterFilter && e.adapter !== adapterFilter) continue;
      if (scriptFilter  && e.script  !== scriptFilter)  continue;
      if (query && !e.msg.toLowerCase().includes(query) && !e.pattern.toLowerCase().includes(query)) continue;
      out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }

  function getHistory() {
    return state.history.slice();
  }

  function getStats() {
    return {
      started: state.started,
      bufferedEvents: state.events.length,
      hardCap: HARD_CAP_EVENTS,
      retentionMs: RETENTION_MS,
      todayDate: state.today.date,
      historyDays: state.history.length
    };
  }

  return {
    start, stop,
    getOverview, getTop, getEvents, getHistory, getStats,
    // Wird von main.js aufgerufen wenn dort der zentrale Log-Listener sitzt
    ingestEntry,
    // Für manuelles Triggern aus dem API-Layer
    forcePersist: persistHistory
  };
};
