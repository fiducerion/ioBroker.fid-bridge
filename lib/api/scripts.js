/* lib/api/scripts.js
 *
 *   GET  /api/scripts                  -> Liste aller script.js.* (ohne source)
 *   GET  /api/scripts/:id              -> komplettes Script inkl. source
 *   PUT  /api/scripts/:id              body { source?, enabled?, name?, debug?, verbose?, engine?, engineType? }
 *
 * Beim Update von "source" oder "enabled" reagiert der javascript-Adapter
 * automatisch (Reload / Stop). Wir setzen also nur das Object und Vertrauen
 * der Adapter-Logik den Rest.
 */
'use strict';

const { Router } = require('express');

module.exports = function ({ adapter }) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const view = await adapter.getObjectViewAsync('system', 'script', {
        startkey: 'script.js.',
        endkey: 'script.js.\u9999'
      });
      const rows = (view && Array.isArray(view.rows)) ? view.rows : [];
      const items = rows.filter(r => r.value && r.value.type === 'script').map(r => {
        const c = (r.value && r.value.common) || {};
        return {
          id: r.id,
          shortId: r.id.replace(/^script\.js\./, ''),
          name: c.name || r.id,
          enabled: !!c.enabled,
          engineType: c.engineType || 'Javascript',
          engine: c.engine || '',
          debug: !!c.debug,
          verbose: !!c.verbose,
          sourceLength: typeof c.source === 'string' ? c.source.length : 0
        };
      });
      items.sort((a, b) => a.shortId.localeCompare(b.shortId));
      res.json({ count: items.length, items });
    } catch (e) { next(e); }
  });

  router.get(/^\/(script\.js\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const obj = await adapter.getForeignObjectAsync(id);
      if (!obj || obj.type !== 'script') return res.status(404).json({ error: 'script not found' });
      res.json({ id, common: obj.common || {} });
    } catch (e) { next(e); }
  });

  router.put(/^\/(script\.js\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const body = req.body || {};
      const patch = { common: {} };
      if (typeof body.source === 'string')      patch.common.source = body.source;
      if (typeof body.enabled === 'boolean')    patch.common.enabled = body.enabled;
      if (typeof body.name === 'string')        patch.common.name = body.name;
      if (typeof body.debug === 'boolean')      patch.common.debug = body.debug;
      if (typeof body.verbose === 'boolean')    patch.common.verbose = body.verbose;
      if (typeof body.engine === 'string')      patch.common.engine = body.engine;
      if (typeof body.engineType === 'string')  patch.common.engineType = body.engineType;
      if (!Object.keys(patch.common).length) return res.status(400).json({ error: 'no changes' });

      await adapter.extendForeignObjectAsync(id, patch);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  // ---- Neu anlegen ----
  router.post('/', async (req, res, next) => {
    try {
      const b = req.body || {};
      const id = String(b.id || '').trim();
      if (!id.startsWith('script.js.')) return res.status(400).json({ error: 'id muss mit "script.js." beginnen' });
      if (!/^script\.js\.[A-Za-z0-9_.\-]+$/.test(id)) return res.status(400).json({ error: 'invalide Zeichen in id' });

      const existing = await adapter.getForeignObjectAsync(id);
      if (existing) return res.status(409).json({ error: 'id existiert bereits' });

      // Wenn der Pfad ein Channel-Element enthaelt das es nicht gibt, leg auch das an
      await ensureChannels(adapter, id);

      const obj = {
        type: 'script',
        common: {
          name:       b.name || id.split('.').pop(),
          enabled:    !!b.enabled,
          engineType: b.engineType || 'Javascript',
          engine:     b.engine || 'system.adapter.javascript.0',
          source:     typeof b.source === 'string' ? b.source : '',
          debug:      !!b.debug,
          verbose:    !!b.verbose
        },
        native: {}
      };
      await adapter.setForeignObjectAsync(id, obj);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  // ---- Loeschen ----
  router.delete(/^\/(script\.js\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const obj = await adapter.getForeignObjectAsync(id);
      if (!obj || obj.type !== 'script') return res.status(404).json({ error: 'script not found' });
      // Erst deaktivieren, damit der JS-Adapter nicht in die Quere kommt
      if (obj.common && obj.common.enabled) {
        await adapter.extendForeignObjectAsync(id, { common: { enabled: false } });
      }
      await adapter.delForeignObjectAsync(id);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  // ---- Umbenennen / Verschieben (gleicher Path-Schema) ----
  router.post(/^\/(script\.js\..+)\/rename$/, async (req, res, next) => {
    try {
      const oldId = req.params[0];
      const newId = String((req.body || {}).newId || '').trim();
      if (!newId.startsWith('script.js.')) return res.status(400).json({ error: 'newId muss mit "script.js." beginnen' });
      if (!/^script\.js\.[A-Za-z0-9_.\-]+$/.test(newId)) return res.status(400).json({ error: 'invalide Zeichen' });
      if (oldId === newId) return res.status(400).json({ error: 'identische id' });

      const obj = await adapter.getForeignObjectAsync(oldId);
      if (!obj || obj.type !== 'script') return res.status(404).json({ error: 'script not found' });

      const existing = await adapter.getForeignObjectAsync(newId);
      if (existing) return res.status(409).json({ error: 'newId existiert bereits' });

      const wasEnabled = !!(obj.common && obj.common.enabled);
      // Erst aus, damit kein Doppellauf:
      if (wasEnabled) {
        await adapter.extendForeignObjectAsync(oldId, { common: { enabled: false } });
      }

      await ensureChannels(adapter, newId);

      const newObj = JSON.parse(JSON.stringify(obj));
      delete newObj._id;
      delete newObj.ts;
      delete newObj.from;
      if (newObj.common) newObj.common.name = newId.split('.').pop();
      await adapter.setForeignObjectAsync(newId, newObj);
      await adapter.delForeignObjectAsync(oldId);

      // Falls vorher aktiv: jetzt im neuen Pfad wieder aktivieren
      if (wasEnabled) {
        await adapter.extendForeignObjectAsync(newId, { common: { enabled: true } });
      }

      res.json({ ok: true, oldId, newId });
    } catch (e) { next(e); }
  });

  return router;
};

// Stellt sicher, dass alle zwischen-Channels (script.js.common, script.js.alarm, ...) existieren
async function ensureChannels(adapter, scriptId) {
  const parts = scriptId.split('.');
  // Bauen wir: script.js → script.js.common → script.js.common.sub → ...
  // Letztes part = script-name, das brauchen wir nicht als channel
  for (let i = 2; i < parts.length - 1; i++) {
    const id = parts.slice(0, i + 1).join('.');
    try {
      const ex = await adapter.getForeignObjectAsync(id);
      if (!ex) {
        await adapter.setForeignObjectAsync(id, {
          type: 'channel',
          common: { name: parts[i] },
          native: {}
        });
      }
    } catch (e) { /* ignore */ }
  }
}
