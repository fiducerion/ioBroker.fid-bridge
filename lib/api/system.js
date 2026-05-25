/* lib/api/system.js v2
 *
 *   GET /api/system/info             -> { host, hosts:[], versions, uptime, ... }
 *   GET /api/system/config           -> system.config (ioBroker Grundkonfig)
 *   PUT /api/system/config           body { common?, native? }
 *   GET /api/system/hosts            -> Liste aller hosts (Kurzform)
 *   GET /api/system/hosts/:hostId    -> Host-Detail inkl. States (alive/load/uptime/mem/disk)
 *   PUT /api/system/hosts/:hostId    body { common?, native? }
 */
'use strict';

const { Router } = require('express');
const os = require('os');

const HOST_STATE_KEYS = ['alive','load','uptime','freemem','freememPercent','diskFree','diskSize','diskWarning','cputime','cpu','mem'];

module.exports = function ({ adapter }) {
  const router = Router();

  router.get('/info', async (req, res, next) => {
    try {
      const aliveStates = await adapter.getForeignStatesAsync('system.host.*.alive');
      const hostIds = Object.keys(aliveStates || {}).map(id => id.replace(/\.alive$/, ''));
      const primary = hostIds.find(id => aliveStates[id + '.alive'] && aliveStates[id + '.alive'].val === true) || hostIds[0];

      const ctrlObj = primary ? await adapter.getForeignObjectAsync(primary) : null;
      const controllerVersion = ctrlObj && ctrlObj.common ? (ctrlObj.common.installedVersion || '') : '';

      // Host-Stats: CPU, RAM, Disk, Uptime, IP - vom primaeren Host
      let stats = null;
      if (primary) {
        const keys = ['cpu','load','freemem','freememPercent','uptime','diskFree','diskSize','diskWarning','mem'];
        const stPromises = keys.map(k => adapter.getForeignStateAsync(primary + '.' + k).catch(() => null));
        const stArr = await Promise.all(stPromises);
        const m = {};
        keys.forEach((k, i) => { m[k] = stArr[i] && stArr[i].val != null ? stArr[i].val : null; });

        // RAM: js-controller schreibt freemem in MB, totalmem im host-native ist in Bytes.
        // Wir normalisieren beides auf Bytes damit der Client einheitlich rechnet.
        const totalmemBytes = ctrlObj && ctrlObj.native && ctrlObj.native.hardware && ctrlObj.native.hardware.totalmem;
        const freememMB = m.freemem;
        const freememBytes = freememMB != null ? Number(freememMB) * 1024 * 1024 : null;
        // IPs aus native.hardware.networkInterfaces - erste non-internal IPv4
        let ip = null;
        const netifs = ctrlObj && ctrlObj.native && ctrlObj.native.hardware && ctrlObj.native.hardware.networkInterfaces;
        if (netifs) {
          for (const arr of Object.values(netifs)) {
            if (!Array.isArray(arr)) continue;
            const v4 = arr.find(a => a && !a.internal && a.family === 'IPv4');
            if (v4) { ip = v4.address; break; }
          }
        }

        stats = {
          cpu:        m.cpu,                                  // % aus dem load-state in einigen Setups
          load:       m.load,
          uptime:     m.uptime,
          freemem:    freememBytes,                           // in Bytes (war: in MB)
          freememPct: m.freememPercent,
          totalmem:   totalmemBytes || null,                  // in Bytes
          memUsedPct: m.freememPercent != null ? Math.round(100 - Number(m.freememPercent)) : null,
          diskFree:   m.diskFree,                             // in MB
          diskSize:   m.diskSize,                             // in MB
          diskUsedPct:(m.diskFree != null && m.diskSize) ? Math.round(100 - (Number(m.diskFree) / Number(m.diskSize) * 100)) : null,
          ip:         ip,
          hostname:   ctrlObj && ctrlObj.native && ctrlObj.native.os && ctrlObj.native.os.hostname || null
        };
      }

      res.json({
        host: primary || null,
        hosts: hostIds.map(id => ({
          id,
          alive: !!(aliveStates[id + '.alive'] && aliveStates[id + '.alive'].val === true)
        })),
        adapterVersion: adapter.version || (adapter.pack && adapter.pack.version) || '',
        controllerVersion,
        nodeVersion: process.version,
        platform: os.platform(),
        arch: os.arch(),
        uptime: Math.round(process.uptime()),
        stats
      });
    } catch (e) { next(e); }
  });

  // ---- admin-URL fuer "Open in Admin"-Buttons ----
  router.get('/admin-url', async (req, res, next) => {
    try {
      // Suche nach einer aktiven admin-Instanz, lese deren http-Port
      const view = await adapter.getObjectViewAsync('system', 'instance', {
        startkey: 'system.adapter.admin.',
        endkey:   'system.adapter.admin.\u9999'
      });
      let adminUrl = '';
      if (view && view.rows && view.rows.length) {
        for (const r of view.rows) {
          const native = r.value && r.value.native || {};
          if (native.port) {
            const proto = native.secure ? 'https' : 'http';
            const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
            adminUrl = `${proto}://${host}:${native.port}`;
            break;
          }
        }
      }
      if (!adminUrl) {
        const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
        adminUrl = `http://${host}:8081`;
      }
      res.json({ adminUrl });
    } catch (e) { next(e); }
  });

  // ---- system.config (ioBroker-Grundkonfig) ----
  router.get('/config', async (req, res, next) => {
    try {
      const obj = await adapter.getForeignObjectAsync('system.config');
      if (!obj) return res.status(404).json({ error: 'system.config not found' });
      res.json({ common: obj.common || {}, native: obj.native || {} });
    } catch (e) { next(e); }
  });

  router.put('/config', async (req, res, next) => {
    try {
      const body = req.body || {};
      const patch = {};
      if (body.common && typeof body.common === 'object') patch.common = body.common;
      if (body.native && typeof body.native === 'object') patch.native = body.native;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'no changes' });
      await adapter.extendForeignObjectAsync('system.config', patch);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---- Hosts ----
  router.get('/hosts', async (req, res, next) => {
    try {
      const aliveStates = await adapter.getForeignStatesAsync('system.host.*.alive');
      const ids = Object.keys(aliveStates || {}).map(id => id.replace(/\.alive$/, ''));

      const out = [];
      for (const id of ids) {
        const obj = await adapter.getForeignObjectAsync(id);
        const c = (obj && obj.common) || {};
        out.push({
          id,
          name: id.replace(/^system\.host\./, ''),
          title: c.title || c.name || id,
          alive: !!(aliveStates[id + '.alive'] && aliveStates[id + '.alive'].val === true),
          platform: c.platform || '',
          installedVersion: c.installedVersion || '',
          hostname: (obj && obj.native && obj.native.os && obj.native.os.hostname) || ''
        });
      }
      res.json({ hosts: out });
    } catch (e) { next(e); }
  });

  router.get(/^\/hosts\/(system\.host\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const obj = await adapter.getForeignObjectAsync(id);
      if (!obj) return res.status(404).json({ error: 'host not found' });

      const stateIds = HOST_STATE_KEYS.map(k => id + '.' + k);
      const sm = await adapter.getForeignStatesAsync(stateIds);
      const states = {};
      HOST_STATE_KEYS.forEach(k => {
        const s = sm[id + '.' + k];
        states[k] = s ? { val: s.val, ts: s.ts } : null;
      });

      res.json({
        id,
        common: obj.common || {},
        native: obj.native || {},
        states
      });
    } catch (e) { next(e); }
  });

  router.put(/^\/hosts\/(system\.host\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const body = req.body || {};
      const patch = {};
      if (body.common && typeof body.common === 'object') patch.common = body.common;
      if (body.native && typeof body.native === 'object') patch.native = body.native;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'no changes' });
      await adapter.extendForeignObjectAsync(id, patch);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return router;
};
