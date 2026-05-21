/* lib/api/instances.js v0.3
 *
 *   GET  /api/instances                       -> Liste
 *   POST /api/instances/add                   body {adapter}  -> "iobroker add <name>"
 *   POST /api/instances/:id/start|stop|restart
 *   PUT  /api/instances/:id/logLevel          body {level}
 *   DELETE /api/instances/:id                 -> "iobroker del <id>"
 */
'use strict';

const { Router } = require('express');
const { detectHost } = require('./host');

module.exports = function ({ adapter, getCfg, broadcast, registerHostMessageHandler }) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const wantStats = String(req.query.stats || '') === '1';
      const view = await adapter.getObjectViewAsync('system', 'instance', {
        startkey: 'system.adapter.', endkey: 'system.adapter.\u9999'
      });
      const rows = (view && Array.isArray(view.rows) ? view.rows : [])
        .filter(r => r && r.value && r.value.type === 'instance');

      const aliveIds = rows.map(r => r.id + '.alive');
      const connIds  = rows.map(r => r.id + '.connected');
      const promises = [
        adapter.getForeignStatesAsync(aliveIds),
        adapter.getForeignStatesAsync(connIds)
      ];
      // Stats nur on-demand wegen Performance (5x mehr State-Reads pro Service)
      if (wantStats) {
        const memIds = rows.map(r => r.id + '.memRss');
        const cpuIds = rows.map(r => r.id + '.cpu');
        const inIds  = rows.map(r => r.id + '.inputCount');
        const outIds = rows.map(r => r.id + '.outputCount');
        const upIds  = rows.map(r => r.id + '.uptime');
        promises.push(
          adapter.getForeignStatesAsync(memIds).catch(() => ({})),
          adapter.getForeignStatesAsync(cpuIds).catch(() => ({})),
          adapter.getForeignStatesAsync(inIds).catch(() => ({})),
          adapter.getForeignStatesAsync(outIds).catch(() => ({})),
          adapter.getForeignStatesAsync(upIds).catch(() => ({}))
        );
      }
      const results = await Promise.all(promises);
      const [aliveMap, connMap, memMap, cpuMap, inMap, outMap, upMap] = results;

      const items = rows.map(r => {
        const inst = r.id.replace(/^system\.adapter\./, '');
        const c = (r.value && r.value.common) || {};
        const adapterName = String(inst).split('.')[0];
        const aliveSt = aliveMap[r.id + '.alive'];
        const connSt  = connMap[r.id + '.connected'];
        const out = {
          id: r.id,
          instance: inst,
          adapter: adapterName,
          name: c.name || adapterName,
          title: c.titleLang ? (c.titleLang.de || c.titleLang.en) : (c.title || ''),
          enabled: !!c.enabled,
          mode: c.mode || '',
          alive: !!(aliveSt && aliveSt.val === true),
          connected: !!(connSt && connSt.val === true),
          version: c.version || '',
          logLevel: c.loglevel || 'info'
        };
        if (wantStats) {
          const mem = memMap[r.id + '.memRss'];
          const cpu = cpuMap[r.id + '.cpu'];
          const ic  = inMap[r.id + '.inputCount'];
          const oc  = outMap[r.id + '.outputCount'];
          const up  = upMap[r.id + '.uptime'];
          out.memRss     = mem && mem.val != null ? Number(mem.val) : null;  // in MB
          out.cpu        = cpu && cpu.val != null ? Number(cpu.val) : null;  // in %
          out.inputs     = ic  && ic.val  != null ? Number(ic.val)  : null;  // subscribes-in (events/min)
          out.outputs    = oc  && oc.val  != null ? Number(oc.val)  : null;
          out.uptime     = up  && up.val  != null ? Number(up.val)  : null;
        }
        return out;
      });
      items.sort((a, b) => a.instance.localeCompare(b.instance));
      res.json({ count: items.length, items });
    } catch (e) { next(e); }
  });

  // Neue Instanz aus Modul anlegen
  router.post('/add', async (req, res, next) => {
    try {
      const cfg = getCfg();
      if (!cfg.allowExec) return res.status(403).json({ error: 'allowExec=false' });
      const name = String(req.body && req.body.adapter || '').trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'invalid adapter name' });

      const host = await detectHost(adapter);
      const runId = 'fid-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
      registerHostMessageHandler(runId, (kind, data) => {
        if (kind === 'stdout') broadcast({ type: 'cmd_stdout', runId, data: String(data || '') });
        else if (kind === 'stderr') broadcast({ type: 'cmd_stderr', runId, data: String(data || '') });
        else if (kind === 'exit')   broadcast({ type: 'cmd_exit',   runId, code: Number(data) });
      });
      adapter.log.info(`cmdExec [${runId}] ${host}: add ${name}`);
      adapter.sendToHost(host, 'cmdExec', { data: `add ${name}`, id: runId });
      res.json({ ok: true, runId, host, cmd: `add ${name}` });
    } catch (e) { next(e); }
  });

  router.post(/^\/(system\.adapter\..+)\/(start|stop|restart)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const action = req.params[1];
      const own = `system.adapter.${adapter.namespace}`;
      if (id === own && action !== 'start') {
        return res.status(400).json({ error: 'Fiducerion Bridge kann sich nicht selbst stoppen oder neustarten.' });
      }
      if (action === 'start') {
        await adapter.extendForeignObjectAsync(id, { common: { enabled: true } });
        return res.json({ ok: true, id, action });
      }
      if (action === 'stop') {
        await adapter.extendForeignObjectAsync(id, { common: { enabled: false } });
        return res.json({ ok: true, id, action });
      }
      if (action === 'restart') {
        await adapter.extendForeignObjectAsync(id, { common: { enabled: false } });
        setTimeout(() => {
          adapter.extendForeignObjectAsync(id, { common: { enabled: true } })
            .catch(e => adapter.log.warn('restart re-enable failed: ' + (e && e.message || e)));
        }, 1200);
        return res.json({ ok: true, id, action });
      }
      res.status(400).json({ error: 'unknown action' });
    } catch (e) { next(e); }
  });

  router.put(/^\/(system\.adapter\..+)\/logLevel$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const level = String(req.body && req.body.level || '').toLowerCase();
      if (!['silly','debug','info','warn','error'].includes(level)) {
        return res.status(400).json({ error: 'invalid level' });
      }
      await adapter.extendForeignObjectAsync(id, { common: { loglevel: level } });
      res.json({ ok: true, id, level });
    } catch (e) { next(e); }
  });

  // Instanz loeschen via cmdExec
  router.delete(/^\/(system\.adapter\..+)$/, async (req, res, next) => {
    try {
      const cfg = getCfg();
      if (!cfg.allowExec) return res.status(403).json({ error: 'allowExec=false' });
      const fullId = req.params[0];
      const own = `system.adapter.${adapter.namespace}`;
      if (fullId === own) return res.status(400).json({ error: 'Selbstloeschung blockiert' });
      const inst = fullId.replace(/^system\.adapter\./, '');
      if (!/^[a-zA-Z0-9_-]+\.\d+$/.test(inst)) return res.status(400).json({ error: 'invalid instance' });

      const host = await detectHost(adapter);
      const runId = 'fid-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
      registerHostMessageHandler(runId, (kind, data) => {
        if (kind === 'stdout') broadcast({ type: 'cmd_stdout', runId, data: String(data || '') });
        else if (kind === 'stderr') broadcast({ type: 'cmd_stderr', runId, data: String(data || '') });
        else if (kind === 'exit')   broadcast({ type: 'cmd_exit',   runId, code: Number(data) });
      });
      adapter.log.info(`cmdExec [${runId}] ${host}: del ${inst}`);
      adapter.sendToHost(host, 'cmdExec', { data: `del ${inst}`, id: runId });
      res.json({ ok: true, runId, host, cmd: `del ${inst}` });
    } catch (e) { next(e); }
  });

  return router;
};
