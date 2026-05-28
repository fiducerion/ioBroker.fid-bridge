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

  // v0.13.6: Redis-Status fuer Dashboard. Probiert via system.config.objects/states
  // herauszufinden ob ein Redis-Backend genutzt wird, und liefert dann Status-Info.
  router.get('/redis-status', async (req, res, next) => {
    try {
      // 1) Aus system.config schauen ob Redis als Backend konfiguriert ist
      const cfg = await adapter.getForeignObjectAsync('system.config').catch(() => null);
      const objCfg = (cfg && cfg.native && cfg.native.objects) || {};
      const stateCfg = (cfg && cfg.native && cfg.native.states) || {};
      const objType = objCfg.type;
      const stateType = stateCfg.type;
      const isRedis = (objType === 'redis' || stateType === 'redis');

      // Redis-Verbindungsdaten aus der Config ableiten (states bevorzugt, da
      // States haeufiger in Redis liegen als Objects).
      const redisCfg = (stateType === 'redis') ? stateCfg : ((objType === 'redis') ? objCfg : stateCfg);
      const host = redisCfg.host || '127.0.0.1';
      const port = redisCfg.port || 6379;
      const pass = redisCfg.pass || redisCfg.password || '';

      // 2) redis-cli aufrufen (best effort). Auth + Host + Port aus Config.
      const { exec } = require('child_process');
      const cli = (args) => new Promise(resolve => {
        // -h host -p port [-a pass] <args>. stderr getrennt halten.
        const authPart = pass ? (' -a ' + JSON.stringify(pass) + ' --no-auth-warning') : '';
        const cmd = 'redis-cli -h ' + JSON.stringify(String(host)) + ' -p ' + Number(port) + authPart + ' ' + args;
        exec(cmd, { timeout: 2000 }, (err, stdout, stderr) => {
          if (err) return resolve({ ok: false, err: (err.message || String(err)), stderr: String(stderr || '') });
          resolve({ ok: true, out: String(stdout || '').trim(), stderr: String(stderr || '') });
        });
      });

      // Service-Status (systemd)
      const svc = await new Promise(resolve => {
        exec('systemctl is-active redis-server 2>/dev/null || systemctl is-active redis 2>/dev/null', { timeout: 1500 },
          (err, stdout) => resolve(String(stdout || '').trim()));
      });
      const serviceActive = /(^|\n)active/i.test(svc);

      // Ping
      const ping = await cli('ping');
      const pingOk = ping.ok && /PONG/i.test(ping.out);

      // Info abfragen
      let info = null;
      let infoErr = null;
      if (pingOk) {
        const r = await cli('info');
        if (r.ok && r.out) {
          info = {};
          const wanted = ['redis_version','uptime_in_seconds','used_memory_human','used_memory','used_memory_peak_human','used_cpu_sys','used_cpu_user','connected_clients','total_commands_processed','instantaneous_ops_per_sec','keyspace_hits','keyspace_misses','maxmemory_human','role','db0'];
          r.out.split(/\r?\n/).forEach(line => {
            const idx = line.indexOf(':');
            if (idx <= 0) return;
            const k = line.slice(0, idx).trim();
            const v = line.slice(idx + 1).trim();
            if (wanted.includes(k)) info[k] = v;
          });
          if (!Object.keys(info).length) { info = null; infoErr = 'info empty/unparsed'; }
        } else {
          infoErr = r.err || r.stderr || 'info failed';
        }
      }

      res.json({
        configured: !!isRedis,
        objectsType: objType || null,
        statesType: stateType || null,
        host: String(host),
        port: Number(port),
        authUsed: !!pass,
        serviceActive,
        pingOk: !!pingOk,
        pingErr: pingOk ? null : (ping.err || ping.stderr || null),
        info,
        infoErr
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
