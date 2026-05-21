/* lib/api/users.js
 *
 *   GET    /api/users                   -> Liste system.user.*
 *   POST   /api/users                   body { name, password?, enabled? } -> neu
 *   PUT    /api/users/:id               body { password?, enabled?, groups?, ... } -> Patch
 *   DELETE /api/users/:id               -> Loeschen
 *
 *   GET    /api/users/groups            -> Liste system.group.*
 *   POST   /api/users/groups            body { name, members?, permissions? }
 *   PUT    /api/users/groups/:id        body { members?, permissions? }
 *   DELETE /api/users/groups/:id
 */
'use strict';

const { Router } = require('express');
const crypto = require('crypto');

module.exports = function ({ adapter }) {
  const router = Router();

  function hashPassword(plain) {
    // ioBroker speichert PBKDF2-SHA256 mit 10000 Iterations und 16-byte Salt, hex-codiert.
    // Format: <salt-hex>:<hash-hex>
    return new Promise((resolve, reject) => {
      const salt = crypto.randomBytes(16);
      crypto.pbkdf2(plain, salt, 10000, 64, 'sha256', (err, hash) => {
        if (err) return reject(err);
        resolve(salt.toString('hex') + ':' + hash.toString('hex'));
      });
    });
  }

  // ---------- Benutzer ----------
  router.get('/', async (req, res, next) => {
    try {
      const view = await adapter.getObjectViewAsync('system', 'user', {
        startkey: 'system.user.', endkey: 'system.user.\u9999'
      }).catch(() => ({ rows: [] }));

      // Welche Gruppen enthalten welche User?
      const groupView = await adapter.getObjectViewAsync('system', 'group', {
        startkey: 'system.group.', endkey: 'system.group.\u9999'
      }).catch(() => ({ rows: [] }));
      const userToGroups = {};
      ((groupView && groupView.rows) || []).forEach(r => {
        const members = r.value && r.value.common && Array.isArray(r.value.common.members) ? r.value.common.members : [];
        members.forEach(uid => {
          if (!userToGroups[uid]) userToGroups[uid] = [];
          userToGroups[uid].push(r.id);
        });
      });

      const items = ((view && view.rows) || []).filter(r => r.value && r.value.type === 'user').map(r => {
        const c = r.value.common || {};
        return {
          id: r.id,
          name: typeof c.name === 'object' ? (c.name.de || c.name.en) : (c.name || r.id.split('.').pop()),
          enabled: c.enabled !== false,
          hasPassword: !!c.password,
          groups: userToGroups[r.id] || [],
          isSystemUser: r.id === 'system.user.admin'
        };
      });
      items.sort((a, b) => a.id.localeCompare(b.id));
      res.json({ count: items.length, items });
    } catch (e) { next(e); }
  });

  router.post('/', async (req, res, next) => {
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name required' });
      if (!/^[a-zA-Z0-9_.\-]+$/.test(name)) return res.status(400).json({ error: 'name invalide Zeichen' });
      const id = 'system.user.' + name.toLowerCase();
      const existing = await adapter.getForeignObjectAsync(id);
      if (existing) return res.status(409).json({ error: 'user existiert bereits' });

      const obj = {
        type: 'user',
        common: {
          name: name,
          enabled: b.enabled !== false,
          password: ''
        },
        native: {}
      };
      if (b.password) obj.common.password = await hashPassword(String(b.password));
      await adapter.setForeignObjectAsync(id, obj);

      // Optional in Gruppen aufnehmen
      if (Array.isArray(b.groups)) {
        for (const gid of b.groups) {
          try {
            const g = await adapter.getForeignObjectAsync(gid);
            if (g && g.type === 'group') {
              g.common = g.common || {};
              g.common.members = Array.isArray(g.common.members) ? g.common.members : [];
              if (!g.common.members.includes(id)) g.common.members.push(id);
              await adapter.setForeignObjectAsync(gid, g);
            }
          } catch (e) { /* ignore */ }
        }
      }
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  router.put(/^\/(system\.user\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const obj = await adapter.getForeignObjectAsync(id);
      if (!obj) return res.status(404).json({ error: 'user not found' });
      const b = req.body || {};
      obj.common = obj.common || {};
      if (typeof b.enabled === 'boolean') obj.common.enabled = b.enabled;
      if (b.password) obj.common.password = await hashPassword(String(b.password));
      await adapter.setForeignObjectAsync(id, obj);

      // Gruppen-Sync (optional - body.groups als komplette neue Liste)
      if (Array.isArray(b.groups)) {
        const groupView = await adapter.getObjectViewAsync('system', 'group', {
          startkey: 'system.group.', endkey: 'system.group.\u9999'
        });
        const all = ((groupView && groupView.rows) || []).filter(r => r.value && r.value.type === 'group');
        for (const r of all) {
          const members = Array.isArray(r.value.common && r.value.common.members) ? r.value.common.members : [];
          const has = members.includes(id);
          const should = b.groups.includes(r.id);
          if (has === should) continue;
          const g = r.value;
          g.common = g.common || {};
          g.common.members = should
            ? members.concat([id]).filter((v,i,a) => a.indexOf(v) === i)
            : members.filter(x => x !== id);
          await adapter.setForeignObjectAsync(r.id, g);
        }
      }
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  router.delete(/^\/(system\.user\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      if (id === 'system.user.admin') return res.status(403).json({ error: 'admin-User kann nicht geloescht werden' });
      // Erst aus allen Gruppen rausnehmen
      const groupView = await adapter.getObjectViewAsync('system', 'group', {
        startkey: 'system.group.', endkey: 'system.group.\u9999'
      });
      for (const r of ((groupView && groupView.rows) || [])) {
        if (!r.value || r.value.type !== 'group') continue;
        const members = (r.value.common && r.value.common.members) || [];
        if (members.includes(id)) {
          r.value.common.members = members.filter(x => x !== id);
          await adapter.setForeignObjectAsync(r.id, r.value);
        }
      }
      await adapter.delForeignObjectAsync(id);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  // ---------- Gruppen ----------
  router.get('/groups', async (req, res, next) => {
    try {
      const view = await adapter.getObjectViewAsync('system', 'group', {
        startkey: 'system.group.', endkey: 'system.group.\u9999'
      }).catch(() => ({ rows: [] }));
      const items = ((view && view.rows) || []).filter(r => r.value && r.value.type === 'group').map(r => {
        const c = r.value.common || {};
        return {
          id: r.id,
          name: typeof c.name === 'object' ? (c.name.de || c.name.en) : (c.name || r.id.split('.').pop()),
          description: typeof c.desc === 'object' ? (c.desc.de || c.desc.en) : (c.desc || ''),
          members: Array.isArray(c.members) ? c.members : [],
          permissions: c.acl || c.permissions || {},
          isSystem: ['system.group.administrator','system.group.user'].includes(r.id)
        };
      });
      items.sort((a, b) => a.id.localeCompare(b.id));
      res.json({ count: items.length, items });
    } catch (e) { next(e); }
  });

  router.post('/groups', async (req, res, next) => {
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name required' });
      const safe = name.toLowerCase().replace(/[^a-z0-9_\-]/g, '_');
      const id = 'system.group.' + safe;
      const existing = await adapter.getForeignObjectAsync(id);
      if (existing) return res.status(409).json({ error: 'group existiert bereits' });
      const obj = {
        type: 'group',
        common: {
          name: name,
          desc: b.description || '',
          members: Array.isArray(b.members) ? b.members : [],
          acl: b.permissions || {}
        },
        native: {}
      };
      await adapter.setForeignObjectAsync(id, obj);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  router.put(/^\/groups\/(system\.group\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const obj = await adapter.getForeignObjectAsync(id);
      if (!obj || obj.type !== 'group') return res.status(404).json({ error: 'group not found' });
      const b = req.body || {};
      obj.common = obj.common || {};
      if (b.description != null) obj.common.desc = b.description;
      if (Array.isArray(b.members)) obj.common.members = b.members;
      if (b.permissions) obj.common.acl = b.permissions;
      await adapter.setForeignObjectAsync(id, obj);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  router.delete(/^\/groups\/(system\.group\..+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      if (['system.group.administrator','system.group.user'].includes(id)) {
        return res.status(403).json({ error: 'System-Gruppe kann nicht geloescht werden' });
      }
      await adapter.delForeignObjectAsync(id);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  return router;
};
