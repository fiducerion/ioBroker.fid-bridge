/* lib/api/backup-schedule.js
 *
 * Backup-Schedule-Manager fuer fid-bridge.
 *
 * Triggert iobroker eigenes Backup (via sendToHost cmdExec) und kopiert
 * dann das fertige Backup-File optional nach einem externen Pfad
 * (z.B. NAS-Mount /mnt/Daten/Backup/iobroker).
 *
 * Schedule wird in adapter.config.backup gespeichert:
 *   backup: {
 *     enabled: true,
 *     times: ['03:00', '15:00'],         // tagesweite Termine HH:MM (Lokalzeit)
 *     copyTo:  '/mnt/Daten/Backup/iobroker',  // optional externer Pfad
 *     keepDays: 14                       // max Alter im copyTo-Ziel
 *   }
 *
 * API:
 *   GET  /api/backup-schedule/config       -> aktuelle Settings
 *   POST /api/backup-schedule/config       -> Settings setzen { enabled, times, copyTo, keepDays }
 *   GET  /api/backup-schedule/status       -> letzter Lauf, nextRun, log
 *   POST /api/backup-schedule/run-now      -> sofort einen Backup-Run triggern
 *   GET  /api/backup-schedule/external-list -> Files im copyTo-Pfad
 */
'use strict';

const { Router } = require('express');
const fs   = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const { detectHost } = require('./host');

module.exports = function ({ adapter, broadcast, registerHostMessageHandler, getCfg }) {
  const router = Router();

  const SCHEDULE_STATE_ID = adapter.namespace + '.scheduler.state';

  // ---- State helpers
  let lastRun     = null;     // { ts, ok, file, copyOk, copyError, durationMs }
  let nextRunTs   = null;
  let scheduleTimer = null;
  let runningNow  = false;

  async function getCfgBackupAsync() {
    // Direkt aus dem Adapter-Objekt lesen (nicht aus getCfg(), das ist die
    // beim Adapter-Start eingelesene Snapshot-Config und sieht spaetere
    // Speicher-Aktionen nicht).
    let b = {};
    try {
      const obj = await adapter.getForeignObjectAsync('system.adapter.' + adapter.namespace);
      b = (obj && obj.native && obj.native.backup) || {};
    } catch (e) {}
    return {
      enabled:  !!b.enabled,
      times:    Array.isArray(b.times) ? b.times.filter(s => /^\d{2}:\d{2}$/.test(s)) : [],
      copyTo:   String(b.copyTo || '').trim(),
      keepDays: Number(b.keepDays) || 0,
      host:     String(b.host || '').trim()
    };
  }
  function getCfgBackup() {
    // Sync-Fallback fuer scheduleNext/runBackup - nutzt getCfg()
    const c = getCfg ? getCfg() : (adapter.config || {});
    const b = (c.backup) || {};
    return {
      enabled:  !!b.enabled,
      times:    Array.isArray(b.times) ? b.times.filter(s => /^\d{2}:\d{2}$/.test(s)) : [],
      copyTo:   String(b.copyTo || '').trim(),
      keepDays: Number(b.keepDays) || 0,
      host:     String(b.host || '').trim()
    };
  }

  async function saveCfgBackup(newCfg) {
    // adapter-instance-config updaten
    const obj = await adapter.getForeignObjectAsync('system.adapter.' + adapter.namespace);
    if (!obj) throw new Error('adapter config object not found');
    obj.native = obj.native || {};
    obj.native.backup = {
      enabled:  !!newCfg.enabled,
      times:    Array.isArray(newCfg.times) ? newCfg.times.filter(s => /^\d{2}:\d{2}$/.test(s)) : [],
      copyTo:   String(newCfg.copyTo || '').trim(),
      keepDays: Math.max(0, Math.min(365, Number(newCfg.keepDays) || 0)),
      host:     String(newCfg.host || '').trim()
    };
    await adapter.setForeignObjectAsync(obj._id, obj);
    // Auch in den lokalen Snapshot schreiben damit der Scheduler sofort
    // die richtigen Werte sieht (ohne Adapter-Restart)
    if (getCfg) {
      const c = getCfg();
      if (c) c.backup = obj.native.backup;
    } else if (adapter.config) {
      adapter.config.backup = obj.native.backup;
    }
    return obj.native.backup;
  }

  // ---- Scheduler

  function computeNextRun(cfg, now) {
    if (!cfg.enabled || !cfg.times.length) return null;
    now = now || new Date();
    const candidates = [];
    for (const t of cfg.times) {
      const [hh, mm] = t.split(':').map(Number);
      const cand = new Date(now);
      cand.setHours(hh, mm, 0, 0);
      if (cand.getTime() <= now.getTime()) cand.setDate(cand.getDate() + 1);
      candidates.push(cand.getTime());
    }
    candidates.sort((a, b) => a - b);
    return candidates[0] || null;
  }

  async function scheduleNext() {
    if (scheduleTimer) { clearTimeout(scheduleTimer); scheduleTimer = null; }
    // Aus Adapter-Objekt lesen damit wir auch nach Save den richtigen Stand kriegen
    const cfg = await getCfgBackupAsync();
    if (!cfg.enabled || !cfg.times.length) {
      nextRunTs = null;
      adapter.log.debug('[backup-schedule] Plan inaktiv oder keine Zeiten');
      return;
    }
    const t = computeNextRun(cfg);
    if (!t) { nextRunTs = null; return; }
    nextRunTs = t;
    const ms = Math.max(1000, t - Date.now());
    adapter.log.info('[backup-schedule] naechster Backup-Run: ' + new Date(t).toLocaleString() + ' (in ' + Math.round(ms/60000) + ' min)');
    scheduleTimer = setTimeout(() => {
      runBackup('schedule').catch(e => adapter.log.warn('[backup-schedule] scheduled run failed: ' + (e && e.message || e)));
      scheduleNext().catch(() => {});
    }, ms);
  }

  // ---- Backup ausfuehren

  async function runBackup(trigger) {
    if (runningNow) throw new Error('already running');
    runningNow = true;
    const start = Date.now();
    let result = {
      ts: new Date().toISOString(),
      trigger: trigger || 'manual',
      ok: false,
      file: '',
      copyOk: false,
      copyError: '',
      durationMs: 0,
      output: []
    };
    try {
      const cfg = await getCfgBackupAsync();
      const host = cfg.host || await detectHost(adapter);
      if (!host || typeof host !== 'string') {
        throw new Error('Host nicht ermittelbar (host config + detectHost beide leer)');
      }
      const runId = 'bkschd-' + Date.now();

      adapter.log.info('[backup-schedule] starte Backup-Run (' + (trigger || 'manual') + ') auf ' + host);

      // sendToHost cmdExec mit 'backup' command
      // Result-Stream sammelt stdout/stderr Zeilen
      const done = new Promise((resolve) => {
        let timedOut = false;
        const tHandle = setTimeout(() => {
          timedOut = true;
          adapter.log.warn('[backup-schedule] timeout');
          resolve({ ok: false, error: 'timeout after 15min' });
        }, 15 * 60 * 1000);

        registerHostMessageHandler(runId, (kind, data) => {
          if (kind === 'stdout' || kind === 'stderr') {
            const line = String(data || '').trim();
            if (line) result.output.push(line);
            // Backup-File-Name aus Output extrahieren
            const m = line.match(/(?:Backup|Saved|written|created).*?(\S+\.tar\.gz)/i)
                  || line.match(/(\/opt\/iobroker\/backups\/\S+\.tar\.gz)/i);
            if (m) result.file = m[1];
          }
          if (kind === 'exit') {
            clearTimeout(tHandle);
            if (!timedOut) resolve({ ok: data === 0, code: data });
          }
        });
      });

      adapter.sendToHost(host, 'cmdExec', { data: 'backup', id: runId });
      const r = await done;
      result.ok = !!r.ok;
      if (!r.ok && r.error) result.output.push('ERROR: ' + r.error);

      // Wenn kein file im output gefunden wurde, in /opt/iobroker/backups neueste suchen
      if (result.ok && !result.file) {
        try {
          const files = await fs.readdir('/opt/iobroker/backups');
          const tars = files.filter(f => /\.tar\.gz$/.test(f));
          if (tars.length) {
            const stats = await Promise.all(tars.map(async f => {
              const fp = '/opt/iobroker/backups/' + f;
              const s = await fs.stat(fp);
              return { fp, mt: s.mtimeMs };
            }));
            stats.sort((a, b) => b.mt - a.mt);
            if (stats.length) result.file = stats[0].fp;
          }
        } catch (e) {}
      }

      // Kopie nach externem Pfad
      if (result.ok && result.file && cfg.copyTo) {
        try {
          await fs.mkdir(cfg.copyTo, { recursive: true });
          const baseName = path.basename(result.file);
          const target = path.join(cfg.copyTo, baseName);
          // Atomic copy: tmp + rename
          const tmp = target + '.tmp';
          await fs.copyFile(result.file, tmp);
          await fs.rename(tmp, target);
          result.copyOk = true;
          adapter.log.info('[backup-schedule] copy OK -> ' + target);
          // Alte Files im copyTo loeschen (keepDays)
          if (cfg.keepDays > 0) {
            try {
              const files = await fs.readdir(cfg.copyTo);
              const cutoff = Date.now() - cfg.keepDays * 86400 * 1000;
              for (const f of files) {
                if (!/\.tar\.gz$/.test(f)) continue;
                const fp = path.join(cfg.copyTo, f);
                const s = await fs.stat(fp);
                if (s.mtimeMs < cutoff) {
                  await fs.unlink(fp);
                  adapter.log.info('[backup-schedule] geloescht (alt): ' + f);
                }
              }
            } catch (e) {
              adapter.log.warn('[backup-schedule] cleanup failed: ' + e.message);
            }
          }
        } catch (e) {
          result.copyError = String(e.message || e);
          adapter.log.warn('[backup-schedule] copy FAILED: ' + result.copyError);
        }
      }
    } catch (e) {
      result.output.push('ERROR: ' + (e.message || e));
      adapter.log.error('[backup-schedule] run failed: ' + (e.message || e));
    } finally {
      runningNow = false;
      result.durationMs = Date.now() - start;
      lastRun = result;
      try { broadcast && broadcast({ type: 'backup-schedule.run', result }); } catch (e) {}
    }
    return result;
  }

  // ---- HTTP routes

  router.get('/config', async (req, res) => {
    try {
      const cfg = await getCfgBackupAsync();
      res.json({ ok: true, config: cfg });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/config', async (req, res) => {
    try {
      const saved = await saveCfgBackup(req.body || {});
      // direkt reschedule mit neuer Config
      await scheduleNext();
      res.json({ ok: true, config: saved });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/status', async (req, res) => {
    try {
      const cfg = await getCfgBackupAsync();
      res.json({
        ok: true,
        lastRun: lastRun,
        nextRunTs: nextRunTs,
        nextRunIso: nextRunTs ? new Date(nextRunTs).toISOString() : null,
        running: runningNow,
        config: cfg
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  router.post('/run-now', async (req, res) => {
    if (runningNow) return res.status(409).json({ ok: false, error: 'already running' });
    runBackup('manual')
      .then(r => res.json({ ok: r.ok, result: r }))
      .catch(e => res.status(500).json({ ok: false, error: e.message }));
  });

  router.get('/external-list', async (req, res) => {
    try {
      const cfg = await getCfgBackupAsync();
      if (!cfg.copyTo) return res.json({ ok: true, files: [], note: 'kein copyTo konfiguriert' });
      let files = [];
      try {
        const list = await fs.readdir(cfg.copyTo);
        for (const f of list) {
          if (!/\.tar\.gz$/.test(f)) continue;
          const fp = path.join(cfg.copyTo, f);
          const s = await fs.stat(fp);
          files.push({ name: f, size: s.size, mtimeMs: s.mtimeMs });
        }
      } catch (e) {
        return res.json({ ok: false, error: 'copyTo nicht erreichbar: ' + e.message, files: [] });
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      res.json({ ok: true, files, copyTo: cfg.copyTo });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ---- Scheduler aktivieren beim Adapter-Start
  scheduleNext().catch(e => adapter.log.warn('[backup-schedule] init: ' + (e && e.message || e)));

  // public API damit main.js bei config-change rescheduln kann
  router._fidBackup = { scheduleNext, runBackup };

  return router;
};
