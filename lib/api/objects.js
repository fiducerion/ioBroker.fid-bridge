/* lib/api/objects.js
 *
 *   GET    /api/objects?prefix=...&type=...&limit=...   -> Liste {id, type, name, hasState}
 *   GET    /api/objects/:id                              -> komplettes Objekt
 *   PUT    /api/objects/:id                              -> Body=Object schreiben (extendObject)
 *   DELETE /api/objects/:id                              -> delete
 *
 * Listet ueber getObjectViewAsync('system','state'|'channel'|'device'|...), kombiniert
 * mit prefix-Filter. Liefert nur kompakte Felder (id/type/name) fuer den Tree.
 */
'use strict';

const { Router } = require('express');

const SUPPORTED_TYPES = ['state','channel','device','folder','enum','instance','adapter','host','meta','script'];

function extractName(obj) {
  if (!obj || !obj.common || obj.common.name === undefined || obj.common.name === null) return '';
  const n = obj.common.name;
  if (typeof n === 'object') return String(n.de || n.en || n.ru || '');
  return String(n);
}

module.exports = function ({ adapter, config }) {
  const router = Router();

  // Simple TTL-Cache fuer Listen
  const cache = new Map();
  const ttl = (Number(config.objectCacheTtlSec) || 30) * 1000;
  function cacheKey(type, prefix) { return `${type}|${prefix}`; }
  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > ttl) { cache.delete(key); return null; }
    return hit.v;
  }
  function cacheSet(key, v) { cache.set(key, { t: Date.now(), v }); }

  // ---- Liste (Root des Routers)
  router.get('/', async (req, res, next) => {
    try {
      const prefix = req.query.prefix ? String(req.query.prefix) : '';
      const wantType = String(req.query.type || 'all').toLowerCase();
      const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 100000);
      const noCache = req.query.noCache === '1';
      // Spezial-Filter: customAdapter=history  -> nur DPs mit history-Custom
      //                 hasCustom=1            -> alle DPs mit irgendwelchem Custom
      //                 writable=1             -> nur schreibbare
      //                 role=switch.*          -> Role-Pattern (Wildcard mit *)
      const filterCustom = req.query.customAdapter ? String(req.query.customAdapter).trim() : '';
      const wantAnyCustom = req.query.hasCustom === '1';
      const wantWritable = req.query.writable === '1';
      const roleFilter = req.query.role ? String(req.query.role).trim() : '';
      // historyjson-Filter: liest aus dem Source des historyjson-Scripts welche DPs es überwacht
      const wantHistoryJson = req.query.historyJson === '1';
      let historyJsonSet = null;
      if (wantHistoryJson) {
        historyJsonSet = await collectHistoryJsonIds(adapter).catch(() => new Set());
      }

      const types = wantType === 'all' ? SUPPORTED_TYPES : [wantType];
      const result = [];
      const needCustomInfo = !!(filterCustom || wantAnyCustom);
      // Wenn Filter auf custom oder history aktiv ist: Cache umgehen, damit aktuelle Daten kommen
      const useCache = !noCache && !needCustomInfo;

      function roleMatches(role, pattern) {
        if (!pattern) return true;
        if (pattern.indexOf('*') < 0) return role === pattern;
        const re = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$', 'i');
        return re.test(role || '');
      }

      for (const t of types) {
        if (!SUPPORTED_TYPES.includes(t)) continue;
        const key = cacheKey(t, prefix) + (needCustomInfo ? '+custom' : '');
        let bucket = useCache ? cacheGet(key) : null;
        if (!bucket) {
          const startKey = prefix || '';
          const endKey   = prefix ? (prefix + '\u9999') : '\u9999';
          const view = await adapter.getObjectViewAsync('system', t, { startkey: startKey, endkey: endKey });
          bucket = (view && Array.isArray(view.rows) ? view.rows : []).map(r => {
            const c = (r.value && r.value.common) || {};
            const item = {
              id: r.id,
              type: t,
              name: extractName(r.value),
              role: c.role || '',
              stateType: t === 'state' ? (c.type || '') : '',
              unit: t === 'state' ? (c.unit || '') : '',
              write: !!(t === 'state' && c.write),
              read:  !!(t === 'state' && c.read)
            };
            if (needCustomInfo && t === 'state') {
              const custom = c.custom && typeof c.custom === 'object' ? c.custom : null;
              if (custom) {
                item.customAdapters = Object.keys(custom).filter(k => custom[k] && custom[k].enabled !== false);
              }
            }
            return item;
          });
          if (useCache) cacheSet(key, bucket);
        }
        for (const row of bucket) {
          if (prefix && !row.id.startsWith(prefix)) continue;
          // Filter anwenden
          if (wantWritable && !row.write) continue;
          if (roleFilter && !roleMatches(row.role, roleFilter)) continue;
          if (filterCustom) {
            // customAdapter=history matches every instance like "history.0", "history.1"
            const hits = row.customAdapters || [];
            const match = hits.some(inst => inst === filterCustom || inst.startsWith(filterCustom + '.'));
            if (!match) continue;
          }
          if (wantAnyCustom && (!row.customAdapters || !row.customAdapters.length)) continue;
          if (wantHistoryJson && historyJsonSet && !historyJsonSet.has(row.id)) continue;
          if (wantHistoryJson && historyJsonSet && historyJsonSet.has(row.id)) {
            row.historyJson = true;
          }
          result.push(row);
          if (result.length >= limit) break;
        }
        if (result.length >= limit) break;
      }

      res.json({ count: result.length, items: result });
    } catch (e) { next(e); }
  });

  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  router.get(/^\/(.+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const obj = await adapter.getForeignObjectAsync(id);
      res.json(obj || null);
    } catch (e) { next(e); }
  });

  // ---- WICHTIG: spezifische Routen (mit /rename, /custom) MUESSEN vor den generischen kommen,
  //      sonst schluckt die generische /^\/(.+)$/ alles inkl. der Suffixe.

  // Umbenennen / Verschieben eines Datenpunkts (kopiert Object + State, loescht Quelle)
  router.post(/^\/(.+)\/rename$/, async (req, res, next) => {
    try {
      const oldId = req.params[0];
      const newId = String((req.body || {}).newId || '').trim();
      if (!newId) return res.status(400).json({ error: 'newId required' });
      if (oldId === newId) return res.status(400).json({ error: 'same id' });
      if (!/^[a-zA-Z0-9_.\-]+$/.test(newId)) return res.status(400).json({ error: 'invalide Zeichen in newId' });

      const obj = await adapter.getForeignObjectAsync(oldId);
      if (!obj) return res.status(404).json({ error: 'object not found' });
      const existing = await adapter.getForeignObjectAsync(newId);
      if (existing) return res.status(409).json({ error: 'newId existiert bereits' });

      const newObj = JSON.parse(JSON.stringify(obj));
      delete newObj._id;
      delete newObj.ts;
      delete newObj.from;
      await adapter.setForeignObjectAsync(newId, newObj);

      // Wenn state-Wert vorhanden: rueberkopieren
      if (obj.type === 'state') {
        try {
          const st = await adapter.getForeignStateAsync(oldId);
          if (st && st.val !== undefined && st.val !== null) {
            await adapter.setForeignStateAsync(newId, { val: st.val, ack: !!st.ack });
          }
        } catch (e) { /* state-copy ist best-effort */ }
      }

      await adapter.delForeignObjectAsync(oldId);
      cache.clear();
      res.json({ ok: true, oldId, newId });
    } catch (e) { next(e); }
  });

  // Custom-Konfig schreiben (z.B. history-Adapter aktivieren)
  router.put(/^\/(.+)\/custom$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const { instance, config, remove } = req.body || {};
      if (!instance || !/^[a-zA-Z0-9_-]+\.\d+$/.test(instance)) {
        return res.status(400).json({ error: 'instance (z.B. history.0) required' });
      }
      const obj = await adapter.getForeignObjectAsync(id);
      if (!obj) return res.status(404).json({ error: 'object not found' });

      obj.common = obj.common || {};
      obj.common.custom = obj.common.custom || {};
      if (remove) delete obj.common.custom[instance];
      else        obj.common.custom[instance] = Object.assign({}, obj.common.custom[instance] || {}, config || {});

      await adapter.setForeignObjectAsync(id, obj);
      cache.clear();
      res.json({ ok: true, id, custom: obj.common.custom });
    } catch (e) { next(e); }
  });

  // Generische PUT/DELETE - schlucken alles, daher zuletzt registriert:
  router.put(/^\/(.+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      // Sicherheitsnetz: subroute durchgerutscht?
      if (id.endsWith('/custom') || id.endsWith('/rename')) {
        return res.status(404).json({ error: 'subroute not matched' });
      }
      const patch = req.body;
      if (!patch || typeof patch !== 'object') {
        return res.status(400).json({ error: 'object body required' });
      }
      await adapter.extendForeignObjectAsync(id, patch);
      cache.clear();
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  router.delete(/^\/(.+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      await adapter.delForeignObjectAsync(id);
      cache.clear();
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  return router;
};

// ---- HistoryJSON Auto-Discovery ----
// Liest die definitive Liste aus dem _meta.discoveredConfig-DP, den
// das HistoryJson-Script v1.1.x bei jedem Discovery-Lauf schreibt.
// Inhalt ist ein JSON-Object { "srcId": { retention, maxLength, ... }, ... }
// - die Keys sind die DPs, die das Script ueberwacht.
//
// Fallback: Falls _meta.discoveredConfig nicht existiert (Skript noch nicht
// gelaufen, oder anderer ROOT), nehmen wir die "history.0.custom"-Konfig.
// Die ist beim HistoryJson-Script per Design identisch.
async function collectHistoryJsonIds(adapter) {
  const ids = new Set();

  // Bekannte ROOT-Pfade von HistoryJson-Varianten probieren
  const metaCandidates = [
    '0_userdata.0.HistoryJson._meta.discoveredConfig',
    '0_userdata.0.historyjson._meta.discoveredConfig',
    '0_userdata.0.historyJson._meta.discoveredConfig'
  ];
  for (const path of metaCandidates) {
    try {
      const st = await adapter.getForeignStateAsync(path);
      if (!st || !st.val) continue;
      let v = st.val;
      if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch (e) { continue; }
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // Object mit srcId als Key
        Object.keys(v).forEach(srcId => ids.add(srcId));
      } else if (Array.isArray(v)) {
        // Falls jemand stattdessen ein Array gespeichert hat
        v.forEach(x => {
          const id = typeof x === 'string' ? x : (x && (x.id || x.state || x.source));
          if (id) ids.add(id);
        });
      }
      if (ids.size) return ids;
    } catch (e) {}
  }

  // Fallback: history.0.custom abgrasen - dieselbe Konfig die das Script
  // bei seiner Discovery liest. Wir holen die state-View und filtern auf
  // common.custom['history.0'].enabled !== false.
  try {
    const view = await adapter.getObjectViewAsync('system', 'state', {
      startkey: '\u0000', endkey: '\u9999'
    });
    ((view && view.rows) || []).forEach(r => {
      if (!r.value || !r.value.common) return;
      const custom = r.value.common.custom;
      if (!custom || typeof custom !== 'object') return;
      // history.0, history.1 etc.
      for (const k of Object.keys(custom)) {
        if (!k.startsWith('history.')) continue;
        if (custom[k] && custom[k].enabled !== false) {
          ids.add(r.id);
          break;
        }
      }
    });
  } catch (e) {}

  return ids;
}
