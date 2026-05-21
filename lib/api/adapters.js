/* lib/api/adapters.js v0.3
 *
 *   GET    /api/adapters                 -> Liste installierter Module
 *   POST   /api/adapters/install         body {name, version?}
 *   POST   /api/adapters/upgrade         body {name, version?}
 *   DELETE /api/adapters/:name
 *
 * Alle Aktionen laufen ueber cmdExec mit Live-Stream. Antwort enthaelt runId,
 * Output kommt via WebSocket.
 */
'use strict';

const { Router } = require('express');
const { detectHost } = require('./host');

module.exports = function ({ adapter, getCfg, broadcast, registerHostMessageHandler }) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const view = await adapter.getObjectViewAsync('system', 'adapter', { startkey: 'system.adapter.', endkey: 'system.adapter.\u9999' });
      const items = (view && Array.isArray(view.rows) ? view.rows : []).map(r => {
        const c = (r.value && r.value.common) || {};
        return {
          id: r.id,
          name: c.name || r.id.replace(/^system\.adapter\./, ''),
          version: c.version || '',
          title: c.titleLang ? (c.titleLang.de || c.titleLang.en) : (c.title || ''),
          enabled: !!c.enabled,
          mode: c.mode || '',
          icon: c.icon ? r.id + '/' + c.icon : null
        };
      });
      items.sort((a, b) => a.name.localeCompare(b.name));
      res.json({ count: items.length, items });
    } catch (e) { next(e); }
  });

  router.post('/install', (req, res, next) => execCmd(req, res, next, 'install', { adapter, getCfg, broadcast, registerHostMessageHandler }));
  router.post('/upgrade', (req, res, next) => execCmd(req, res, next, 'upgrade', { adapter, getCfg, broadcast, registerHostMessageHandler }));

  router.delete(/^\/(.+)$/, async (req, res, next) => {
    try {
      const cfg = getCfg();
      if (!cfg.allowExec) return res.status(403).json({ error: 'allowExec=false' });
      const name = req.params[0];
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'invalid name' });
      await runHostCmd(`del ${name}`, { adapter, broadcast, registerHostMessageHandler })
        .then(r => res.json(r))
        .catch(e => next(e));
    } catch (e) { next(e); }
  });

  return router;
};

async function execCmd(req, res, next, verb, deps) {
  try {
    const cfg = deps.getCfg();
    if (!cfg.allowExec) return res.status(403).json({ error: 'allowExec=false' });
    const name = String(req.body && req.body.name || '').trim();
    const version = req.body && req.body.version ? String(req.body.version).trim() : '';
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'invalid module name' });
    if (version && !/^[a-zA-Z0-9._+-]+$/.test(version)) return res.status(400).json({ error: 'invalid version' });

    const arg = version ? `${name}@${version}` : name;
    const cmd = `${verb} ${arg}`;
    const r = await runHostCmd(cmd, deps);
    res.json(r);
  } catch (e) { next(e); }
}

async function runHostCmd(cmd, { adapter, broadcast, registerHostMessageHandler }) {
  const host = await detectHost(adapter);
  if (!host) throw new Error('no host');
  const runId = 'fid-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);

  registerHostMessageHandler(runId, (kind, payload) => {
    if (kind === 'stdout') broadcast({ type: 'cmd_stdout', runId, data: String(payload || '') });
    else if (kind === 'stderr') broadcast({ type: 'cmd_stderr', runId, data: String(payload || '') });
    else if (kind === 'exit')   broadcast({ type: 'cmd_exit',   runId, code: Number(payload) });
  });
  adapter.log.info(`cmdExec [${runId}] ${host}: ${cmd}`);
  adapter.sendToHost(host, 'cmdExec', { data: cmd, id: runId });
  return { ok: true, runId, host, cmd };
}
