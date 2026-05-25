/* lib/api/repo.js
 *
 *   GET  /api/repo                -> alle verfuegbaren Module aus Cache (TTL 5min)
 *   GET  /api/repo?noCache=1      -> erzwingt Cache-Bypass (liest die letzte
 *                                    geladene Repo aus dem Object-Store)
 *   POST /api/repo/refresh        -> echtes "iob update": laedt Repo neu vom
 *                                    Repository-Server. So macht's auch der
 *                                    iobroker.admin-Aktualisieren-Button.
 *   POST /api/repo/install-url    -> installiert per "iob url <github-or-npm>"
 *                                    Body: { url: "iobroker.adapter" | "https://github.com/...." }
 */
'use strict';

const { Router } = require('express');
const { detectHost } = require('./host');

module.exports = function ({ adapter, registerRunHandler }) {
  const router = Router();
  let cache = { ts: 0, data: null };
  const TTL_MS = 5 * 60 * 1000; // 5 min

  router.get('/', async (req, res, next) => {
    try {
      const noCache = req.query.noCache === '1';
      const forceUpdate = req.query.update === '1';
      if (!noCache && cache.data && (Date.now() - cache.ts) < TTL_MS) {
        return res.json({ ...cache.data, cached: true });
      }
      const host = await detectHost(adapter);
      if (!host) return res.status(500).json({ error: 'no host' });

      // update:true = echtes Neuladen vom Repository-Server, sonst cache vom Server
      const repo = await sendToHost(adapter, host, 'getRepository', { update: forceUpdate });

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

  /**
   * Echtes "iob update": forciert Neulesen der Repository-Liste vom Server.
   * Funktional aequivalent zum Aktualisieren-Button im iobroker.admin.
   */
  router.post('/refresh', async (req, res) => {
    try {
      const host = await detectHost(adapter);
      if (!host) return res.status(500).json({ ok: false, error: 'no host' });
      // update:true => Repository neu vom Server holen
      const repo = await sendToHost(adapter, host, 'getRepository', { update: true });
      // Plus expliziter Refresh ueber updateRepo command - der ist robuster:
      try {
        await sendToHost(adapter, host, 'updateRepo', { repo: null });
      } catch (e) { /* nicht alle Versionen kennen das */ }
      // Cache invalidaten
      cache = { ts: 0, data: null };
      const adapterCount = repo ? Object.keys(repo).length : 0;
      adapter.log.info('[repo] Aktualisierung getriggert - ' + adapterCount + ' Adapter im Repository');
      res.json({ ok: true, adapterCount, host });
    } catch (e) {
      adapter.log.warn('[repo] refresh failed: ' + e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /**
   * Installiert einen Adapter von einer URL (GitHub-Tarball oder npm-Name).
   * Body: { url: "iobroker.fid-smartlife" | "https://github.com/x/y" | "https://github.com/x/y/tarball/main" }
   * Streamt Output via terminal/run channel.
   */
  router.post('/install-url', async (req, res) => {
    try {
      const url = String((req.body && req.body.url) || '').trim();
      if (!url) return res.status(400).json({ ok: false, error: 'url required' });
      // Quick sanity check
      const looksNpm    = /^[a-z0-9._-]+\/?[a-z0-9._-]*$/i.test(url) || /^iobroker\.[a-z0-9-]+$/i.test(url);
      const looksGitHub = /^https?:\/\/(www\.)?github\.com\//.test(url);
      const looksNpmReg = /^https?:\/\/(www\.)?npmjs\.com\//.test(url);
      if (!looksNpm && !looksGitHub && !looksNpmReg) {
        return res.status(400).json({ ok: false, error: 'unbekanntes URL-Format. Akzeptiert: npm-Name (z.B. iobroker.xy) oder https://github.com/...' });
      }
      const host = await detectHost(adapter);
      if (!host) return res.status(500).json({ ok: false, error: 'no host' });

      const runId = 'repo-install-' + Date.now();
      // Output sammeln + via WS broadcasten (das macht registerRunHandler)
      if (typeof registerRunHandler === 'function') {
        registerRunHandler(runId, () => {}); // nur registrieren - WS-Broadcast laeuft via Run-Kanal
      }

      // sendToHost: iob url <ref>
      adapter.log.info('[repo] starte Installation: ' + url);
      adapter.sendToHost(host, 'cmdExec', { data: 'url ' + url, id: runId });
      // Cache invalidieren damit nach Install neuer Stand sichtbar
      setTimeout(() => { cache = { ts: 0, data: null }; }, 5000);
      res.json({ ok: true, runId, url });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
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
    const t = setTimeout(() => resolve(null), 60000);
    try {
      adapter.sendToHost(host, command, message, (payload) => {
        clearTimeout(t);
        resolve(payload);
      });
    } catch (e) { clearTimeout(t); resolve(null); }
  });
}
