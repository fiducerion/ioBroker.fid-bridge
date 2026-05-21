/* lib/api/auth.js
 *
 *   GET    /api/auth/status                   -> { requireAuth, requireTotp, totpConfigured, totpVerified }
 *   POST   /api/auth/totp/setup               -> { secret, otpauthUri }  (transient, noch nicht aktiviert)
 *   POST   /api/auth/totp/activate {code,secret} -> aktiviert TOTP; setzt Session-Cookie
 *   POST   /api/auth/totp/verify   {code}     -> verifiziert TOTP fuer Login; setzt Session-Cookie
 *   POST   /api/auth/totp/disable  {code}     -> deaktiviert TOTP (Code als Schutz)
 *   POST   /api/auth/logout                   -> Session loeschen
 */
'use strict';

const { Router } = require('express');
const totp = require('../totp');
const auth = require('../auth');

module.exports = function ({ adapter, getCfg, setCfg }) {
  const router = Router();

  router.get('/status', (req, res) => {
    const cfg = getCfg();
    const cookies = auth.parseCookies(req);
    const sess = auth.getSession(cookies[auth.COOKIE_NAME]);
    res.json({
      requireAuth: !!cfg.requireAuth,
      requireTotp: !!cfg.requireTotp,
      totpConfigured: !!cfg.totpSecret,
      totpVerified: !!(sess && sess.totpVerified)
    });
  });

  // Bei Setup wird ein NEUES Secret generiert; das alte bleibt aktiv bis activate
  router.post('/totp/setup', (req, res) => {
    if (!authPreCheck(req, res)) return;
    const secret = totp.generateSecret();
    const label = (adapter.namespace || 'fid-bridge') + '@' + (req.headers.host || 'fiducerion');
    res.json({
      secret,
      otpauthUri: totp.otpauthUri(label, secret)
    });
  });

  // Aktiviert TOTP-Schutz mit dem in /setup gelieferten secret, sobald ein Code passt
  router.post('/totp/activate', async (req, res) => {
    if (!authPreCheck(req, res)) return;
    const { secret, code } = req.body || {};
    if (!secret || !code) return res.status(400).json({ error: 'secret and code required' });
    if (!totp.verify(secret, code)) {
      return res.status(401).json({ error: 'invalid_code' });
    }
    // Persistieren ueber Object-Patch der eigenen Adapter-Config
    await adapter.extendForeignObjectAsync(`system.adapter.${adapter.namespace}`, {
      native: { totpSecret: secret, requireTotp: true }
    });
    setCfg({ totpSecret: secret, requireTotp: true });

    // Sofort eine verifizierte Session geben
    const sid = auth.createSession(true);
    auth.setSessionCookie(res, sid);
    res.json({ ok: true, totpActive: true });
  });

  // Reines TOTP-Login: liefert eine verifizierte Session
  router.post('/totp/verify', (req, res) => {
    if (!authPreCheck(req, res)) return;
    const cfg = getCfg();
    if (!cfg.totpSecret) return res.status(400).json({ error: 'no_totp_configured' });
    const { code } = req.body || {};
    if (!totp.verify(cfg.totpSecret, code)) {
      // Debug: nuetzlich um Time-Drift / kaputten Secret zu erkennen
      const secretOK = /^[A-Z2-7]+=*$/i.test(cfg.totpSecret);
      const expected = secretOK ? totp.totp(cfg.totpSecret) : '(secret invalid)';
      adapter.log.warn(`TOTP-Verify fehlgeschlagen. Eingegeben: ${code}, erwartet aktuell: ${expected}, Secret-Laenge: ${cfg.totpSecret.length}, Secret-Base32-OK: ${secretOK}`);
      return res.status(401).json({ error: 'invalid_code' });
    }
    const sid = auth.createSession(true);
    auth.setSessionCookie(res, sid);
    res.json({ ok: true });
  });

  router.post('/totp/disable', async (req, res) => {
    if (!authPreCheck(req, res)) return;
    const cfg = getCfg();
    if (!cfg.totpSecret) { return res.json({ ok: true, totpActive: false }); }
    const { code } = req.body || {};
    if (!totp.verify(cfg.totpSecret, code)) {
      return res.status(401).json({ error: 'invalid_code' });
    }
    await adapter.extendForeignObjectAsync(`system.adapter.${adapter.namespace}`, {
      native: { totpSecret: '', requireTotp: false }
    });
    setCfg({ totpSecret: '', requireTotp: false });
    res.json({ ok: true, totpActive: false });
  });

  router.post('/logout', (req, res) => {
    const cookies = auth.parseCookies(req);
    auth.dropSession(cookies[auth.COOKIE_NAME]);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ---- intern: TOTP-Setup-Endpoints duerfen nur, wenn Bearer-Auth (falls aktiv) gueltig
  function authPreCheck(req, res) {
    const cfg = getCfg();
    if (!cfg.requireAuth) return true;
    const tok = auth.getTokenFromReq(req);
    if (!tok || tok !== cfg.authToken) {
      res.status(401).json({ error: 'auth_required' });
      return false;
    }
    return true;
  }

  return router;
};
