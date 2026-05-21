/* lib/api/search.js
 *
 *   GET /api/search?q=...&limit=200
 *     Sucht parallel in:
 *       - Datenpunkten (system/state-View)
 *       - Automationen (system/script-View)
 *       - Services (system/instance-View)
 *       - Aliasen (alias.0.*)
 *       - Räumen/Funktionen (enum.*)
 *     Liefert ein gemeinsames Result-Array nach Score sortiert.
 */
'use strict';

const { Router } = require('express');

module.exports = function ({ adapter }) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      if (!q || q.length < 2) return res.json({ q, count: 0, results: [] });

      // Parallel alle Views holen
      const [stateView, scriptView, instView, enumView] = await Promise.all([
        adapter.getObjectViewAsync('system', 'state',    { startkey: '\u0000', endkey: '\u9999' }).catch(() => ({ rows: [] })),
        adapter.getObjectViewAsync('system', 'script',   { startkey: 'script.js.', endkey: 'script.js.\u9999' }).catch(() => ({ rows: [] })),
        adapter.getObjectViewAsync('system', 'instance', { startkey: 'system.adapter.', endkey: 'system.adapter.\u9999' }).catch(() => ({ rows: [] })),
        adapter.getObjectViewAsync('system', 'enum',     { startkey: 'enum.', endkey: 'enum.\u9999' }).catch(() => ({ rows: [] }))
      ]);

      const results = [];

      function scoreMatch(haystack, needle) {
        if (!haystack) return 0;
        const h = String(haystack).toLowerCase();
        if (h === needle) return 100;
        if (h.startsWith(needle)) return 80;
        const idx = h.indexOf(needle);
        if (idx >= 0) return Math.max(50 - idx, 10);
        return 0;
      }
      function nameStr(v) {
        if (!v) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'object') return v.de || v.en || v.ru || '';
        return String(v);
      }

      function tryAdd(category, id, label, sub, type) {
        const idScore   = scoreMatch(id, q);
        const nameScore = scoreMatch(label, q);
        const subScore  = scoreMatch(sub, q) * 0.5;
        const score = Math.max(idScore, nameScore, subScore);
        if (score > 0) results.push({ category, id, label: label || id, sub: sub || '', type, score });
      }

      // States/Channels/Devices/Folders aus state-View (enthält de facto alle DP-Typen)
      ((stateView && stateView.rows) || []).forEach(r => {
        if (!r.value) return;
        const c = r.value.common || {};
        const n = nameStr(c.name);
        tryAdd('Datenpunkt', r.id, n, c.role || '', r.value.type || 'state');
      });

      // Scripts
      ((scriptView && scriptView.rows) || []).forEach(r => {
        if (!r.value || r.value.type !== 'script') return;
        const c = r.value.common || {};
        // Auch im Source-Code suchen
        const source = String(c.source || '').toLowerCase();
        const sourceMatch = source.includes(q);
        const baseScore = Math.max(scoreMatch(r.id, q), scoreMatch(nameStr(c.name), q));
        if (baseScore > 0 || sourceMatch) {
          results.push({
            category: 'Automation',
            id: r.id,
            label: nameStr(c.name) || r.id.split('.').pop(),
            sub: c.enabled ? 'aktiv' : 'inaktiv',
            type: 'script',
            score: Math.max(baseScore, sourceMatch ? 30 : 0)
          });
        }
      });

      // Services / Instanzen
      ((instView && instView.rows) || []).forEach(r => {
        if (!r.value || r.value.type !== 'instance') return;
        const c = r.value.common || {};
        const inst = r.id.replace(/^system\.adapter\./, '');
        tryAdd('Service', r.id, inst, nameStr(c.title) || c.name || '', 'instance');
      });

      // Enums (Räume, Funktionen)
      ((enumView && enumView.rows) || []).forEach(r => {
        if (!r.value || r.value.type !== 'enum') return;
        const c = r.value.common || {};
        const cat = r.id.split('.')[1];
        const label = nameStr(c.name) || r.id.split('.').pop();
        const catLabel = cat === 'rooms' ? 'Raum' : cat === 'functions' ? 'Funktion' : 'Enum';
        tryAdd(catLabel, r.id, label, `${(c.members || []).length} Mitglieder`, 'enum');
      });

      results.sort((a, b) => b.score - a.score);
      res.json({
        q,
        count: results.length,
        results: results.slice(0, limit)
      });
    } catch (e) { next(e); }
  });

  return router;
};
