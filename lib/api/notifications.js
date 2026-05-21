/* lib/api/notifications.js
 *
 *   GET  /api/notifications         -> Liste aller aktiven Host-Notifications
 *   POST /api/notifications/clear   body { host, scope?, category? }  -> clear via sendToHost
 *   POST /api/notifications/backup  -> triggert "iobroker backup" via cmdExec (Live-Stream)
 *   GET  /api/notifications/backups -> Liste der Backup-Dateien (best-effort)
 */
'use strict';

const { Router } = require('express');
const fs   = require('fs').promises;
const path = require('path');

// detectHost defensiv laden - falls host.js die Funktion nicht exportiert,
// definieren wir einen Fallback. Verhindert, dass der Adapter beim Start crasht.
let detectHost;
try {
  const hostModule = require('./host');
  detectHost = hostModule.detectHost || fallbackDetectHost;
} catch (e) {
  detectHost = fallbackDetectHost;
}

async function fallbackDetectHost(adapter) {
  try {
    const view = await adapter.getObjectViewAsync('system', 'host', { startkey: 'system.host.', endkey: 'system.host.\u9999' });
    const rows = (view && view.rows) || [];
    if (rows.length) return rows[0].id;
  } catch (e) {}
  return null;
}

module.exports = function ({ adapter, broadcast, registerHostMessageHandler }) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      // Kill-Switch: wenn fid-bridge.notificationsDisabled === true (in instance config), nie sendToHost machen.
      // So kann man die Funktion bei controller-Inkompatibilitaeten deaktivieren ohne Code-Change.
      const instCfg = adapter.config || {};
      if (instCfg.disableNotifications) {
        return res.json({ count: 0, items: [], disabled: true });
      }
      const aliveStates = await adapter.getForeignStatesAsync('system.host.*.alive').catch(() => ({}));
      const hostIds = Object.keys(aliveStates || {}).map(id => id.replace(/\.alive$/, ''));
      const out = [];

      for (const hostId of hostIds) {
        const notifs = await new Promise((resolve) => {
          let resolved = false;
          const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 4000);
          try {
            // js-controller liest msg.scope - das MUSS gesetzt sein, sonst crash host-prozess.
            // scope: null = alle scopes (laut js-controller doc)
            adapter.sendToHost(hostId, 'getNotifications', { scope: null }, (resp) => {
              if (resolved) return;
              resolved = true; clearTimeout(timer);
              resolve(resp);
            });
          } catch (e) { resolved = true; clearTimeout(timer); resolve(null); }
        });
        if (!notifs || typeof notifs !== 'object') continue;

        const result = notifs.result || notifs;
        try {
          for (const [scope, scopeObj] of Object.entries(result || {})) {
            if (!scopeObj || typeof scopeObj !== 'object') continue;
            const cats = scopeObj.categories || {};
            for (const [cat, catObj] of Object.entries(cats)) {
              if (!catObj || typeof catObj !== 'object') continue;
              const instances = catObj.instances || {};
              const messages = [];
              for (const [inst, instObj] of Object.entries(instances)) {
                const msgs = (instObj && instObj.messages) || [];
                if (Array.isArray(msgs)) msgs.forEach(m => messages.push({
                  instance: inst,
                  message: (m && (m.message || m.msg)) || '',
                  ts: (m && m.ts) || null
                }));
              }
              if (messages.length) out.push({
                host: hostId,
                scope,
                category: cat,
                severity: catObj.severity || 'info',
                description: (catObj.description && (catObj.description.de || catObj.description.en)) || cat,
                messages
              });
            }
          }
        } catch (e) {
          adapter.log.warn('notifications parse failed for ' + hostId + ': ' + e.message);
        }
      }
      res.json({ count: out.length, items: out });
    } catch (e) { next(e); }
  });

  router.post('/clear', async (req, res, next) => {
    try {
      const { host, scope, category } = req.body || {};
      if (!host) return res.status(400).json({ error: 'host required' });
      if (!scope || typeof scope !== 'string') return res.status(400).json({ error: 'scope (string) required' });
      // ZWINGEND scope als string - js-controller crashed wenn null
      const msg = { scope: String(scope) };
      if (category) msg.category = String(category);
      adapter.sendToHost(host, 'clearNotifications', msg);
      res.json({ ok: true, host, scope, category });
    } catch (e) { next(e); }
  });

  router.post('/backup', async (req, res, next) => {
    try {
      const host = await detectHost(adapter);
      if (!host) return res.status(500).json({ error: 'no host detected' });
      const runId = 'fid-bkp-' + Date.now();
      if (typeof registerHostMessageHandler === 'function') {
        registerHostMessageHandler(runId, (kind, payload) => {
          if (typeof broadcast !== 'function') return;
          if (kind === 'stdout')      broadcast({ type: 'cmd_stdout', runId, data: String(payload || '') });
          else if (kind === 'stderr') broadcast({ type: 'cmd_stderr', runId, data: String(payload || '') });
          else if (kind === 'exit')   broadcast({ type: 'cmd_exit',   runId, code: Number(payload) });
        });
      }
      adapter.log.info(`Backup gestartet [${runId}] auf ${host}`);
      // Sofort-Info ins Terminal, damit der User sieht dass es laeuft -
      // bei sehr langen Operationen sendet js-controller stdout erst am Ende.
      if (typeof broadcast === 'function') {
        setTimeout(() => {
          broadcast({ type: 'cmd_stdout', runId, data: 'Backup gestartet. Dies kann mehrere Minuten dauern.\nLive-Ausgabe kommt möglicherweise erst am Ende - das ist normal.\nDu kannst das Fenster mit × oben rechts schließen, das Backup läuft im Hintergrund weiter.\nDie Backup-Datei erscheint in der Liste sobald fertig.\n\n' });
        }, 100).unref();
      }
      adapter.sendToHost(host, 'cmdExec', { data: 'backup', id: runId });

      // Safety-Net: nach 15min Auto-Exit damit das Modal nicht ewig haengt
      setTimeout(() => {
        if (typeof broadcast === 'function') {
          broadcast({ type: 'cmd_exit', runId, code: -1, timeout: true });
        }
      }, 15 * 60 * 1000).unref();

      res.json({ ok: true, runId, host, cmd: 'backup' });
    } catch (e) { next(e); }
  });

  router.get('/backups', async (req, res, next) => {
    try {
      const candidateDirs = [
        '/opt/iobroker/backups',
        path.join(adapter.adapterDir || '', '..', '..', 'backups')
      ];
      let dir = null, entries = null;
      for (const d of candidateDirs) {
        try {
          entries = await fs.readdir(d);
          dir = d; break;
        } catch (e) {}
      }
      if (!dir) return res.json({ dir: null, files: [], reason: 'kein Backup-Verzeichnis gefunden' });
      const files = [];
      for (const f of entries) {
        try {
          const st = await fs.stat(path.join(dir, f));
          if (st.isFile()) files.push({ name: f, size: st.size, modified: st.mtime });
        } catch (e) {}
      }
      files.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
      res.json({ dir, count: files.length, files });
    } catch (e) { next(e); }
  });

  return router;
};
