/* lib/api/files.js
 *
 *   GET /api/files/namespaces          -> Kandidaten-Namespaces (alle Instance-IDs)
 *   GET /api/files/list?ns=...&path=.. -> Verzeichnisinhalt
 *   GET /api/files/get?ns=...&file=... -> Datei-Inhalt (optional ?download=1)
 *   PUT /api/files/upload              body { ns, file, data (base64) }   (multipart waere besser - hier reicht's)
 *   DELETE /api/files?ns=...&file=...  -> Datei loeschen
 */
'use strict';

const { Router } = require('express');

module.exports = function ({ adapter }) {
  const router = Router();

  router.get('/namespaces', async (req, res, next) => {
    try {
      // Alle Instance-IDs sind Kandidaten. Plus die typischen ohne Instanz-Nummer.
      const view = await adapter.getObjectViewAsync('system', 'instance', {
        startkey: 'system.adapter.', endkey: 'system.adapter.\u9999'
      });
      const set = new Set();
      (view.rows || []).forEach(r => {
        if (r.value && r.value.type === 'instance') {
          set.add(r.id.replace(/^system\.adapter\./, ''));
        }
      });
      // Plus 0_userdata.0 (user-Files) explizit, und typische .admin-namespaces
      set.add('0_userdata.0');
      // .admin-namespaces der Adapter (z.B. fuer admin-Assets)
      (view.rows || []).forEach(r => {
        const c = r.value && r.value.common;
        if (c && c.name) set.add(c.name + '.admin');
      });
      const items = Array.from(set).sort();
      res.json({ namespaces: items });
    } catch (e) { next(e); }
  });

  router.get('/list', async (req, res, next) => {
    const ns = String(req.query.ns || '').trim();
    const p  = String(req.query.path || '/');
    if (!ns) return res.status(400).json({ error: 'ns required' });
    try {
      const files = await new Promise((resolve, reject) => {
        try {
          adapter.readDir(ns, p, (err, list) => {
            if (err) return reject(err);
            resolve(Array.isArray(list) ? list : []);
          });
        } catch (e) { reject(e); }
      });
      const items = files.map(f => ({
        file:    f.file,
        isDir:   !!f.isDir,
        size:    f.stats && f.stats.size != null ? f.stats.size : null,
        modified:f.modifiedAt || (f.stats && f.stats.mtime) || null,
        acl:     f.acl || null
      }));
      items.sort((a, b) => (b.isDir - a.isDir) || a.file.localeCompare(b.file));
      res.json({ ns, path: p, items });
    } catch (e) {
      // Wenn der Pfad nicht existiert: leer zurueck statt 500
      const msg = String(e && e.message || '');
      if (/not exist|enoent|404/i.test(msg)) return res.json({ ns, path: p, items: [] });
      next(e);
    }
  });

  router.get('/get', async (req, res, next) => {
    const ns   = String(req.query.ns || '').trim();
    const file = String(req.query.file || '');
    if (!ns || !file) return res.status(400).json({ error: 'ns and file required' });
    try {
      const result = await new Promise((resolve, reject) => {
        try {
          adapter.readFile(ns, file, (err, data, mimeType) => {
            if (err) return reject(err);
            resolve({ data, mimeType });
          });
        } catch (e) { reject(e); }
      });
      const mt = result.mimeType || guessMime(file);
      res.setHeader('Content-Type', mt);
      if (req.query.download) {
        const base = file.split('/').pop() || 'file';
        res.setHeader('Content-Disposition', `attachment; filename="${base}"`);
      }
      const buf = Buffer.isBuffer(result.data) ? result.data : Buffer.from(String(result.data || ''));
      res.send(buf);
    } catch (e) { next(e); }
  });

  router.put('/upload', async (req, res, next) => {
    try {
      const { ns, file, data, base64 } = req.body || {};
      if (!ns || !file || data == null) return res.status(400).json({ error: 'ns, file and data required' });
      const buf = base64 ? Buffer.from(String(data), 'base64') : Buffer.from(String(data));
      await new Promise((resolve, reject) => {
        try {
          adapter.writeFile(ns, file, buf, (err) => err ? reject(err) : resolve());
        } catch (e) { reject(e); }
      });
      res.json({ ok: true, ns, file, size: buf.length });
    } catch (e) { next(e); }
  });

  router.delete('/', async (req, res, next) => {
    try {
      const ns   = String(req.query.ns || '').trim();
      const file = String(req.query.file || '');
      if (!ns || !file) return res.status(400).json({ error: 'ns and file required' });
      await new Promise((resolve, reject) => {
        try {
          adapter.delFile(ns, file, (err) => err ? reject(err) : resolve());
        } catch (e) { reject(e); }
      });
      res.json({ ok: true, ns, file });
    } catch (e) { next(e); }
  });

  return router;
};

function guessMime(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  return {
    'json': 'application/json',
    'js':   'application/javascript',
    'mjs':  'application/javascript',
    'css':  'text/css',
    'html': 'text/html',
    'htm':  'text/html',
    'txt':  'text/plain',
    'md':   'text/markdown',
    'xml':  'text/xml',
    'csv':  'text/csv',
    'png':  'image/png',
    'jpg':  'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif':  'image/gif',
    'svg':  'image/svg+xml',
    'webp': 'image/webp',
    'ico':  'image/x-icon',
    'pdf':  'application/pdf'
  }[ext] || 'application/octet-stream';
}
