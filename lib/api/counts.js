/* lib/api/counts.js
 *
 *   GET /api/counts  -> { datapoints, states, channels, devices, instances, alive, modules, hosts, scripts, enums }
 *
 * Cached 30s, da getObjectView pro Typ ein Datenbank-Roundtrip ist.
 */
'use strict';

const { Router } = require('express');

const TYPES = ['state', 'channel', 'device', 'instance', 'adapter', 'host', 'script', 'enum'];

module.exports = function ({ adapter }) {
  const router = Router();
  let cache = { ts: 0, data: null };
  const TTL_MS = 30000;

  router.get('/', async (req, res, next) => {
    try {
      const noCache = req.query.noCache === '1';
      if (!noCache && cache.data && (Date.now() - cache.ts) < TTL_MS) {
        return res.json(cache.data);
      }

      const results = await Promise.all(TYPES.map(t =>
        adapter.getObjectViewAsync('system', t, { startkey: '', endkey: '\u9999' })
          .then(v => v && Array.isArray(v.rows) ? v.rows.length : 0)
          .catch(() => 0)
      ));

      // alive aus States
      const aliveStates = await adapter.getForeignStatesAsync('system.adapter.*.alive');
      const aliveCount = Object.values(aliveStates || {}).filter(s => s && s.val === true).length;

      const c = {};
      TYPES.forEach((t, i) => { c[t] = results[i]; });

      const data = {
        datapoints: c.state || 0,
        states:     c.state || 0,
        channels:   c.channel || 0,
        devices:    c.device || 0,
        instances:  c.instance || 0,
        alive:      aliveCount,
        modules:    c.adapter || 0,
        hosts:      c.host || 0,
        scripts:    c.script || 0,
        enums:      c.enum || 0,
        cached:     false,
        timestamp:  Date.now()
      };
      cache = { ts: Date.now(), data: { ...data, cached: true } };
      res.json(data);
    } catch (e) { next(e); }
  });

  return router;
};
