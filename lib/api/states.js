/* lib/api/states.js
 *
 *   GET    /api/states/:id          -> State
 *   PUT    /api/states/:id          -> Body {val, ack?, expire?}
 *   DELETE /api/states/:id          -> delete state
 *   GET    /api/states?pattern=...  -> Map von States
 */
'use strict';

const { Router } = require('express');

module.exports = function ({ adapter }) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const pattern = String(req.query.pattern || '*');
      const states = await adapter.getForeignStatesAsync(pattern);
      res.json(states || {});
    } catch (e) { next(e); }
  });

  // ID koennen Punkte enthalten -> wildcard match auf alles nach /api/states/
  router.get(/^\/(.+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const state = await adapter.getForeignStateAsync(id);
      res.json(state || null);
    } catch (e) { next(e); }
  });

  router.put(/^\/(.+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      const body = req.body || {};
      if (!Object.prototype.hasOwnProperty.call(body, 'val')) {
        return res.status(400).json({ error: 'body.val required' });
      }
      const payload = { val: body.val, ack: body.ack === true };
      if (Number.isFinite(body.expire)) payload.expire = body.expire;
      await adapter.setForeignStateAsync(id, payload);
      res.json({ ok: true, id, val: body.val, ack: payload.ack });
    } catch (e) { next(e); }
  });

  router.delete(/^\/(.+)$/, async (req, res, next) => {
    try {
      const id = req.params[0];
      await adapter.delForeignStateAsync(id);
      res.json({ ok: true, id });
    } catch (e) { next(e); }
  });

  return router;
};
