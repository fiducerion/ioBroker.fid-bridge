/* lib/api/repo.js
 *
 *   GET /api/repo            -> alle verfuegbaren Module
 *   GET /api/repo/:name      -> Detail
 *
 * Cached, da sendToHost teuer ist.
 */
'use strict';

const { Router } = require('express');
const { detectHost } = require('./host');

module.exports = function ({ adapter }) {
  const router = Router();
  let cache = { ts: 0, data: null };
  const TTL_MS = 5 * 60 * 1000; // 5 min

  router.get('/', async (req, res, next) => {
    try {
      const noCache = req.query.noCache === '1';
      if (!noCache && cache.data && (Date.now() - cache.ts) < TTL_MS) {
        return res.json({ ...cache.data, cached: true });
      }
      const host = await detectHost(adapter);
      if (!host) return res.status(500).json({ error: 'no host' });

      const repo = await sendToHost(adapter, host, 'getRepository', { update: false });

      // Installed-Map fuer Anzeige "Update verfuegbar"
      const view = await adapter.getObjectViewAsync('system', 'adapter', { startkey: 'system.adapter.', endkey: 'system.adapter.\u9999' });
      const installed = {};
      (view && view.rows ? view.rows : []).forEach(r => {
        const c = r.value && r.value.common;
        if (c && c.name) installed[c.name] = c.version || '';
      });

      const items = [];
      for (const name of Object.keys(repo || {})) {
        const r = repo[name] || {};
        items.push({
          name,
          version: r.version || '',
          installedVersion: installed[name] || '',
          isInstalled: !!installed[name],
          updateAvailable: !!(installed[name] && r.version && compareVersion(installed[name], r.version) < 0),
          title: r.titleLang ? (r.titleLang.de || r.titleLang.en) : (r.title || ''),
          desc:  r.desc && (r.desc.de || r.desc.en || (typeof r.desc === 'string' ? r.desc : '')) || '',
          keywords: r.keywords || [],
          icon: r.icon || '',
          extIcon: r.extIcon || '',
          type: r.type || '',
          mode: r.mode || ''
        });
      }
      items.sort((a, b) => a.name.localeCompare(b.name));
      const data = { count: items.length, items, host, timestamp: Date.now() };
      cache = { ts: Date.now(), data };
      res.json(data);
    } catch (e) { next(e); }
  });

  return router;
};

function compareVersion(a, b) {
  const aa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const bb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] || 0, y = bb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function sendToHost(adapter, host, command, message) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 30000);
    try {
      adapter.sendToHost(host, command, message, (payload) => {
        clearTimeout(t);
        resolve(payload);
      });
    } catch (e) { clearTimeout(t); resolve(null); }
  });
}
