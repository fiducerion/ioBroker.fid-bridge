/* lib/api/structure.js
 *
 * Aliase (alias.0.*) sowie Enums (enum.rooms.* / enum.functions.*).
 *
 *   GET    /api/structure/aliases
 *   POST   /api/structure/aliases             body { id, source, name?, role?, type?, unit?, read?, write? }
 *   PUT    /api/structure/aliases/:id         body { source?, name?, role?, type?, unit?, read?, write? }
 *   DELETE /api/structure/aliases/:id
 *
 *   GET    /api/structure/enums?cat=rooms|functions|all
 *   POST   /api/structure/enums               body { id, name, members? }
 *   PUT    /api/structure/enums/:id           body { name?, members?, icon?, color? }
 *   DELETE /api/structure/enums/:id
 *   POST   /api/structure/enums/:id/members   body { add?: id, remove?: id }
 */
'use strict';

const { Router } = require('express');

module.exports = function ({ adapter }) {
  const router = Router();

  // ---------- Aliase ----------
  router.get('/aliases', async (req, res, next) => {
    try {
      const view = await adapter.getObjectViewAsync('system', 'state', {
        startkey: 'alias.0.', endkey: 'alias.0.\u9999'
      }).catch(() => ({ rows: [] }));
      const items = ((view && view.rows) || []).filter(r => r.value && r.value.type === 'state').map(r => {
        const c = r.value.common || {};
        const a = c.alias || {};
        return {
          id: r.id,
          name: c.name || r.id.split('.').pop(),
          source: a.id || '',
          readFn:  typeof a.read  === 'string' ? a.read  : '',
          writeFn: typeof a.write === 'string' ? a.write : '',
          role: c.role || '',
          type: c.type || '',
          unit: c.unit || '',
          read: c.read !== false,
          write: c.write === true
        };
      });
      items.sort((a, b) => a.id.localeCompare(b.id));
      res.json({ count: items.length, items });
    } catch (e) { next(e); }
  });

  router.post('/aliases', async (req, res, next) => {
    try {
      const b = req.body || {};
      const id = String(b.id || '').trim();
      const source = String(b.source || '').trim();
      if (!id || !id.startsWith('alias.0.')) return res.status(400).json({ error: 'id muss mit "alias.0." beginnen' });
      if (!source) return res.status(400).json({ error: 'source-DP required' });
      const existing = await adapter.getForeignObjectAsync(id);
      if (existing) return res.status(409).json({ error: 'id existiert bereits' });

      const obj = aliasObjectFromBody(b, id);
      await adapter.setForeignObjectAsync(id, obj);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  router.put(/^\/aliases\/(alias\.0\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const obj = await adapter.getForeignObjectAsync(id);
      if (!obj) return res.status(404).json({ error: 'alias not found' });
      const b = req.body || {};
      obj.common = obj.common || {};
      obj.common.alias = obj.common.alias || {};
      if (b.source != null) obj.common.alias.id = String(b.source);
      if (b.readFn  != null) {
        if (b.readFn === '') delete obj.common.alias.read;  else obj.common.alias.read  = String(b.readFn);
      }
      if (b.writeFn != null) {
        if (b.writeFn === '') delete obj.common.alias.write; else obj.common.alias.write = String(b.writeFn);
      }
      if (b.name != null) obj.common.name = b.name;
      if (b.role != null) obj.common.role = b.role;
      if (b.type != null) obj.common.type = b.type;
      if (b.unit != null) obj.common.unit = b.unit;
      if (typeof b.read  === 'boolean') obj.common.read  = b.read;
      if (typeof b.write === 'boolean') obj.common.write = b.write;
      await adapter.setForeignObjectAsync(id, obj);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  router.delete(/^\/aliases\/(alias\.0\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      await adapter.delForeignObjectAsync(id);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  // ---------- Enums ----------
  router.get('/enums', async (req, res, next) => {
    try {
      const cat = String(req.query.cat || 'all');
      const view = await adapter.getObjectViewAsync('system', 'enum', { startkey: 'enum.', endkey: 'enum.\u9999' }).catch(() => ({ rows: [] }));
      const all = ((view && view.rows) || []).filter(r => r.value && r.value.type === 'enum');
      const filtered = cat === 'all' ? all : all.filter(r => r.id.startsWith('enum.' + cat + '.') || r.id === 'enum.' + cat);

      const items = filtered.map(r => {
        const c = r.value.common || {};
        return {
          id: r.id,
          category: r.id.split('.')[1],
          shortId: r.id.replace(/^enum\.[^.]+\./, ''),
          name: typeof c.name === 'object' ? (c.name.de || c.name.en) : (c.name || r.id.split('.').pop()),
          members: Array.isArray(c.members) ? c.members : [],
          icon: c.icon || '',
          color: c.color || ''
        };
      });
      items.sort((a, b) => a.id.localeCompare(b.id));
      res.json({ count: items.length, items });
    } catch (e) { next(e); }
  });

  router.post('/enums', async (req, res, next) => {
    try {
      const b = req.body || {};
      const id = String(b.id || '').trim();
      if (!id || !/^enum\.[a-zA-Z0-9_.\-]+$/.test(id)) return res.status(400).json({ error: 'id muss "enum.<cat>.<name>" sein' });
      const existing = await adapter.getForeignObjectAsync(id);
      if (existing) return res.status(409).json({ error: 'id existiert bereits' });
      const obj = {
        type: 'enum',
        common: {
          name:    b.name || id.split('.').pop(),
          members: Array.isArray(b.members) ? b.members : [],
          icon:    b.icon || '',
          color:   b.color || ''
        },
        native: {}
      };
      await adapter.setForeignObjectAsync(id, obj);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  router.put(/^\/enums\/(enum\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const obj = await adapter.getForeignObjectAsync(id);
      if (!obj || obj.type !== 'enum') return res.status(404).json({ error: 'enum not found' });
      const b = req.body || {};
      obj.common = obj.common || {};
      if (b.name  != null) obj.common.name  = b.name;
      if (Array.isArray(b.members)) obj.common.members = b.members;
      if (b.icon  != null) obj.common.icon  = b.icon;
      if (b.color != null) obj.common.color = b.color;
      await adapter.setForeignObjectAsync(id, obj);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  router.delete(/^\/enums\/(enum\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      await adapter.delForeignObjectAsync(id);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  router.post(/^\/enums\/(enum\..+)\/members$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const { add, remove } = req.body || {};
      const obj = await adapter.getForeignObjectAsync(id);
      if (!obj || obj.type !== 'enum') return res.status(404).json({ error: 'enum not found' });
      obj.common = obj.common || {};
      obj.common.members = Array.isArray(obj.common.members) ? obj.common.members.slice() : [];
      if (add)    { if (!obj.common.members.includes(add)) obj.common.members.push(add); }
      if (remove) { obj.common.members = obj.common.members.filter(x => x !== remove); }
      await adapter.setForeignObjectAsync(id, obj);
      res.json({ ok: true, id, members: obj.common.members });
    } catch (e) { next(e); }
  });

  return router;
};

function aliasObjectFromBody(b, id) {
  const common = {
    name:  b.name || id.split('.').pop(),
    role:  b.role || 'state',
    type:  b.type || 'mixed',
    read:  b.read !== false,
    write: b.write === true,
    alias: { id: String(b.source || '') }
  };
  if (b.unit) common.unit = b.unit;
  if (b.readFn)  common.alias.read  = b.readFn;
  if (b.writeFn) common.alias.write = b.writeFn;
  return { type: 'state', common, native: {} };
}
