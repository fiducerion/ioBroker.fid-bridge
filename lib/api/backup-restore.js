/* lib/api/backup-restore.js
 *
 *   POST   /api/backup-restore/upload     base64 upload nach /opt/iobroker/backups/
 *   POST   /api/backup-restore/restore    body { file } -> iobroker restore <file> via cmdExec
 *   DELETE /api/backup-restore/file       body { file } -> Datei loeschen aus backups/
 *
 *   GET    /api/objects/export?root=...&kind=tree|state-only
 *   POST   /api/objects/import            body { items: [...], overwrite: false }
 *
 *   GET    /api/scripts/export
 *   POST   /api/scripts/import            body { scripts: [...], overwrite: false }
 */
'use strict';

const { Router } = require('express');
const fs   = require('fs').promises;
const path = require('path');
const { detectHost } = require('./host');

module.exports = function ({ adapter, broadcast, registerHostMessageHandler }) {
  const router = Router();

  const BACKUP_DIR = '/opt/iobroker/backups';

  function safeFileName(name) {
    return String(name).replace(/[/\\]/g, '').replace(/^\.+/, '');
  }

  router.post('/upload', async (req, res, next) => {
    try {
      const { filename, data, base64 } = req.body || {};
      if (!filename || data == null) return res.status(400).json({ error: 'filename und data required' });
      const fn = safeFileName(filename);
      if (!/\.(tar|tar\.gz|gz|tgz|zip)$/i.test(fn)) return res.status(400).json({ error: 'Nur .tar.gz / .tgz / .tar / .zip erlaubt' });
      const buf = base64 ? Buffer.from(String(data), 'base64') : Buffer.from(String(data));
      // Backup-Dir sicherstellen
      try { await fs.mkdir(BACKUP_DIR, { recursive: true }); } catch (e) {}
      const target = path.join(BACKUP_DIR, fn);
      await fs.writeFile(target, buf);
      adapter.log.info(`Backup-Datei hochgeladen: ${target} (${buf.length} bytes)`);
      res.json({ ok: true, file: target, size: buf.length });
    } catch (e) { next(e); }
  });

  router.post('/restore', async (req, res, next) => {
    try {
      const filename = String((req.body || {}).file || '').trim();
      if (!filename) return res.status(400).json({ error: 'file required' });
      const fn = safeFileName(filename);
      const fullPath = path.isAbsolute(fn) ? fn : path.join(BACKUP_DIR, fn);
      try { await fs.access(fullPath); } catch (e) { return res.status(404).json({ error: 'file_not_found', detail: fullPath }); }

      const host = await detectHost(adapter);
      if (!host) return res.status(500).json({ error: 'no host detected' });

      const runId = 'fid-rest-' + Date.now();
      if (typeof registerHostMessageHandler === 'function') {
        registerHostMessageHandler(runId, (kind, payload) => {
          if (typeof broadcast !== 'function') return;
          if (kind === 'stdout')      broadcast({ type: 'cmd_stdout', runId, data: String(payload || '') });
          else if (kind === 'stderr') broadcast({ type: 'cmd_stderr', runId, data: String(payload || '') });
          else if (kind === 'exit')   broadcast({ type: 'cmd_exit',   runId, code: Number(payload) });
        });
      }
      if (typeof broadcast === 'function') {
        setTimeout(() => {
          broadcast({ type: 'cmd_stdout', runId, data:
            `RESTORE GESTARTET: ${fullPath}\n` +
            `WARNUNG: ioBroker wird komplett restauriert und neu gestartet.\n` +
            `Live-Ausgabe kommt evtl. erst am Ende. Bitte warten.\n\n`
          });
        }, 100).unref();
      }
      // iobroker restore Path/zu/file - das Tool akzeptiert auch nur den Basename wenn er im backups/ liegt
      adapter.log.info(`Restore gestartet [${runId}] auf ${host}: ${fullPath}`);
      adapter.sendToHost(host, 'cmdExec', { data: `restore "${fullPath}"`, id: runId });

      // Safety-Net
      setTimeout(() => {
        if (typeof broadcast === 'function') {
          broadcast({ type: 'cmd_exit', runId, code: -1, timeout: true });
        }
      }, 30 * 60 * 1000).unref();

      res.json({ ok: true, runId, host, file: fullPath });
    } catch (e) { next(e); }
  });

  router.delete('/file', async (req, res, next) => {
    try {
      const filename = String((req.body || {}).file || req.query.file || '').trim();
      if (!filename) return res.status(400).json({ error: 'file required' });
      const fn = safeFileName(filename);
      const fullPath = path.isAbsolute(fn) ? fn : path.join(BACKUP_DIR, fn);
      // Nur Loeschungen im Backup-Verzeichnis erlauben
      if (!fullPath.startsWith(BACKUP_DIR + path.sep) && !fullPath.startsWith(BACKUP_DIR + '/')) {
        return res.status(403).json({ error: 'nur Dateien im backups/-Ordner loeschbar' });
      }
      await fs.unlink(fullPath);
      res.json({ ok: true, file: fullPath });
    } catch (e) { next(e); }
  });

  // ---- Objects Export ----
  // GET /api/objects/export?root=0_userdata.0.Energie&includeStates=1
  router.get('/objects-export', async (req, res, next) => {
    try {
      const root = String(req.query.root || '').trim();
      const includeStates = String(req.query.includeStates || '1') === '1';
      if (!root) return res.status(400).json({ error: 'root required' });

      const view = await adapter.getObjectViewAsync('system', 'state', {
        startkey: root, endkey: root + '\u9999'
      }).catch(() => ({ rows: [] }));
      const objView = await adapter.getObjectViewAsync('system', 'channel', {
        startkey: root, endkey: root + '\u9999'
      }).catch(() => ({ rows: [] }));
      const devView = await adapter.getObjectViewAsync('system', 'device', {
        startkey: root, endkey: root + '\u9999'
      }).catch(() => ({ rows: [] }));
      const folderView = await adapter.getObjectViewAsync('system', 'folder', {
        startkey: root, endkey: root + '\u9999'
      }).catch(() => ({ rows: [] }));

      const allRows = [
        ...((folderView && folderView.rows) || []),
        ...((devView && devView.rows) || []),
        ...((objView && objView.rows) || []),
        ...((view && view.rows) || [])
      ];

      // Plus den root selbst falls vorhanden
      try {
        const rootObj = await adapter.getForeignObjectAsync(root);
        if (rootObj) allRows.unshift({ id: root, value: rootObj });
      } catch (e) {}

      const items = [];
      const seen = new Set();
      for (const r of allRows) {
        if (!r || !r.value || seen.has(r.id)) continue;
        seen.add(r.id);
        const entry = { id: r.id, type: r.value.type, common: r.value.common || {}, native: r.value.native || {} };
        if (includeStates && r.value.type === 'state') {
          try {
            const st = await adapter.getForeignStateAsync(r.id);
            if (st && st.val !== undefined) entry.state = { val: st.val, ack: !!st.ack };
          } catch (e) {}
        }
        items.push(entry);
      }
      items.sort((a, b) => a.id.localeCompare(b.id));
      res.json({
        exportVersion: 1,
        source: 'fid-bridge',
        timestamp: new Date().toISOString(),
        root,
        count: items.length,
        items
      });
    } catch (e) { next(e); }
  });

  // ---- Objects Import ----
  // POST /api/objects/import body { items: [...], overwrite: false, rootRewrite?: { from, to } }
  router.post('/objects-import', async (req, res, next) => {
    try {
      const b = req.body || {};
      const items = Array.isArray(b.items) ? b.items : null;
      if (!items) return res.status(400).json({ error: 'items array required' });
      const overwrite = !!b.overwrite;
      const rewrite = b.rootRewrite || null;

      let created = 0, skipped = 0, errors = 0, statesSet = 0;
      const errorList = [];

      for (const it of items) {
        if (!it || !it.id || !it.type) { errors++; continue; }
        let id = it.id;
        if (rewrite && rewrite.from && id.startsWith(rewrite.from)) {
          id = rewrite.to + id.slice(rewrite.from.length);
        }
        try {
          const ex = await adapter.getForeignObjectAsync(id);
          if (ex && !overwrite) { skipped++; continue; }
          const obj = { type: it.type, common: it.common || {}, native: it.native || {} };
          await adapter.setForeignObjectAsync(id, obj);
          created++;
          if (it.state && it.type === 'state') {
            try {
              await adapter.setForeignStateAsync(id, { val: it.state.val, ack: it.state.ack !== false });
              statesSet++;
            } catch (e) { /* state set best-effort */ }
          }
        } catch (e) {
          errors++;
          if (errorList.length < 20) errorList.push({ id, error: e.message });
        }
      }
      res.json({ ok: true, created, skipped, errors, statesSet, sample_errors: errorList });
    } catch (e) { next(e); }
  });

  // ---- Scripts Export ----
  router.get('/scripts-export', async (req, res, next) => {
    try {
      const singleId = req.query.id ? String(req.query.id) : null;
      let rows;
      if (singleId) {
        // Einzelnes Script
        const obj = await adapter.getForeignObjectAsync(singleId);
        if (!obj || obj.type !== 'script') return res.status(404).json({ error: 'script not found' });
        rows = [{ id: singleId, value: obj }];
      } else {
        const view = await adapter.getObjectViewAsync('system', 'script', {
          startkey: 'script.js.', endkey: 'script.js.\u9999'
        }).catch(() => ({ rows: [] }));
        rows = ((view && view.rows) || []).filter(r => r.value && r.value.type === 'script');
      }
      const scripts = rows.map(r => ({
        id: r.id,
        name: r.value.common && r.value.common.name || r.id.split('.').pop(),
        engineType: r.value.common && r.value.common.engineType || 'Javascript',
        engine: r.value.common && r.value.common.engine || 'system.adapter.javascript.0',
        enabled: !!(r.value.common && r.value.common.enabled),
        source: r.value.common && r.value.common.source || '',
        debug: !!(r.value.common && r.value.common.debug),
        verbose: !!(r.value.common && r.value.common.verbose)
      }));
      scripts.sort((a, b) => a.id.localeCompare(b.id));
      res.json({
        exportVersion: 1,
        source: 'fid-bridge',
        timestamp: new Date().toISOString(),
        count: scripts.length,
        scripts
      });
    } catch (e) { next(e); }
  });

  // ---- Scripts Import ----
  // body { scripts: [...], overwrite: false, enableAll?: bool }
  router.post('/scripts-import', async (req, res, next) => {
    try {
      const b = req.body || {};
      const scripts = Array.isArray(b.scripts) ? b.scripts : null;
      if (!scripts) return res.status(400).json({ error: 'scripts array required' });
      const overwrite = !!b.overwrite;
      const forceDisable = !!b.disableAll; // beim Import alle deaktivieren (sicherer Default)

      let created = 0, updated = 0, skipped = 0, errors = 0;
      const errorList = [];

      for (const s of scripts) {
        if (!s || !s.id || !s.id.startsWith('script.js.')) { errors++; continue; }
        try {
          const ex = await adapter.getForeignObjectAsync(s.id);
          if (ex && !overwrite) { skipped++; continue; }
          // Sicherheit: importierte Scripts erstmal deaktiviert anlegen, ausser overwrite explicit aktiviert ist
          const enabled = forceDisable ? false : !!s.enabled;
          // ensureChannels analog wie in scripts.js
          await ensureChannels(adapter, s.id);
          const obj = {
            type: 'script',
            common: {
              name: s.name || s.id.split('.').pop(),
              enabled,
              engineType: s.engineType || 'Javascript',
              engine: s.engine || 'system.adapter.javascript.0',
              source: typeof s.source === 'string' ? s.source : '',
              debug: !!s.debug,
              verbose: !!s.verbose
            },
            native: {}
          };
          await adapter.setForeignObjectAsync(s.id, obj);
          if (ex) updated++; else created++;
        } catch (e) {
          errors++;
          if (errorList.length < 20) errorList.push({ id: s.id, error: e.message });
        }
      }
      res.json({ ok: true, created, updated, skipped, errors, sample_errors: errorList });
    } catch (e) { next(e); }
  });

  return router;
};

async function ensureChannels(adapter, scriptId) {
  const parts = scriptId.split('.');
  for (let i = 2; i < parts.length - 1; i++) {
    const id = parts.slice(0, i + 1).join('.');
    try {
      const ex = await adapter.getForeignObjectAsync(id);
      if (!ex) {
        await adapter.setForeignObjectAsync(id, { type: 'channel', common: { name: parts[i] }, native: {} });
      }
    } catch (e) {}
  }
}
