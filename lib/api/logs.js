/* lib/api/logs.js
 *
 *   GET /api/logs/recent?limit=200   -> Ring-Buffer der letzten Logs (vom Server gesammelt)
 *   GET /api/logs/tail?lines=200     -> Log-File-Tail vom Host (sendToHost getLogs)
 *
 * Live-Logs kommen ueber WebSocket {type:'log', line:{ts,severity,from,message}}
 */
'use strict';

const { Router } = require('express');

module.exports = function ({ adapter, getLogRing }) {
  const router = Router();

  router.get('/recent', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);
    const ring = getLogRing();
    res.json({ lines: ring.slice(-limit) });
  });

  router.get('/tail', async (req, res, next) => {
    try {
      const lines = Math.min(Math.max(Number(req.query.lines) || 200, 1), 2000);
      const host = await detectHost(adapter);
      if (!host) return res.json({ lines: [], host: null });

      const result = await sendToHost(adapter, host, 'getLogs', { lines });
      const norm = normalize(result);
      res.json({ host, lines: norm.slice(-lines) });
    } catch (e) { next(e); }
  });

  return router;
};

async function detectHost(adapter) {
  try {
    const states = await adapter.getForeignStatesAsync('system.host.*.alive');
    const ids = Object.keys(states || {});
    if (!ids.length) return null;
    const aliveId = ids.find(id => states[id] && states[id].val === true) || ids[0];
    return aliveId.replace(/\.alive$/, '');
  } catch (e) { return null; }
}

function sendToHost(adapter, host, command, message) {
  return new Promise((resolve) => {
    let timeout = setTimeout(() => resolve(null), 8000);
    try {
      adapter.sendToHost(host, command, message, (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    } catch (e) {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

function normalize(payload) {
  if (!payload) return [];
  if (typeof payload === 'string') return payload.split(/\r?\n/).filter(Boolean);
  if (Array.isArray(payload)) {
    // Wenn das Array Dateimetadaten liefert (fileName/size), ignorieren
    if (payload.every(x => x && typeof x === 'object' && x.fileName)) return [];
    return payload.flatMap(x => normalize(x));
  }
  if (typeof payload === 'object') {
    if (payload.result !== undefined) return normalize(payload.result);
    if (payload.lines  !== undefined) return normalize(payload.lines);
    if (payload.logs   !== undefined) return normalize(payload.logs);
    if (payload.data   !== undefined) return normalize(payload.data);
    if (payload.message !== undefined) return [String(payload.message)];
  }
  return [];
}
