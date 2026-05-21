/* lib/api/analyzer.js
 *
 *   GET  /api/analyzer/overview      Heute + Gestern + letzte Stunde
 *   GET  /api/analyzer/top           ?bucket=today|yesterday &kind=patterns|adapters|scripts &level=error|warn &n=10
 *   GET  /api/analyzer/events        ?level=error|warn &since=ts &until=ts &limit=200 &q=... &adapter=... &script=...
 *   GET  /api/analyzer/history       Tages-Aggregate (max 7 Tage)
 *   GET  /api/analyzer/stats         Sammler-Metadaten (Debug)
 */
'use strict';

const { Router } = require('express');

module.exports = function ({ adapter, logCollector }) {
  const router = Router();

  if (!logCollector) {
    router.get('*', (req, res) => res.status(503).json({ error: 'logCollector not active' }));
    return router;
  }

  router.get('/overview', (req, res) => {
    try { res.json(logCollector.getOverview()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/top', (req, res) => {
    try {
      const bucket = String(req.query.bucket || 'today');
      const kind   = String(req.query.kind   || 'patterns');
      const level  = req.query.level ? String(req.query.level) : null;
      const n      = Number(req.query.n) || 10;
      res.json({ bucket, kind, level, items: logCollector.getTop(bucket, kind, level, n) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/events', (req, res) => {
    try {
      const items = logCollector.getEvents({
        level:   req.query.level   ? String(req.query.level)   : null,
        since:   req.query.since,
        until:   req.query.until,
        limit:   req.query.limit,
        q:       req.query.q       ? String(req.query.q)       : null,
        adapter: req.query.adapter ? String(req.query.adapter) : null,
        script:  req.query.script  ? String(req.query.script)  : null
      });
      res.json({ count: items.length, items });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/history', (req, res) => {
    try { res.json({ days: logCollector.getHistory() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/stats', (req, res) => {
    try { res.json(logCollector.getStats()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
