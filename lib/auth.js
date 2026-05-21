/* lib/auth.js v2
 *
 * Drei-stufige Auth:
 *   1) Bearer-Token  (requireAuth)
 *   2) TOTP-Code     (requireTotp + totpSecret)
 *   3) Session       (Cookie nach erfolgreicher TOTP-Verifizierung)
 *
 * Sessions koennen ueber setPersistFn() in einen externen Store geschrieben werden
 * (z.B. native.sessionStore in der Object-DB), damit sie einen Adapter-Restart
 * ueberleben. Persistierung ist debounced (500ms) um DB-Hammering zu vermeiden.
 */
'use strict';

const crypto = require('crypto');

const SESSION_TTL_MS = 8 * 3600 * 1000;
const COOKIE_NAME = 'fid_session';

let sessions = new Map();
let persistFn = null;
let persistTimer = null;

function setPersistFn(fn) { persistFn = fn; }

function loadSessions(arr) {
  if (!Array.isArray(arr)) return 0;
  const now = Date.now();
  let n = 0;
  for (const entry of arr) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [id, s] = entry;
    if (typeof id === 'string' && s && typeof s === 'object' && s.expires > now) {
      sessions.set(id, {
        created: Number(s.created) || now,
        expires: Number(s.expires),
        totpVerified: !!s.totpVerified
      });
      n++;
    }
  }
  return n;
}

function exportSessions() {
  cleanupInternal();
  return Array.from(sessions.entries());
}

function schedulePersist() {
  if (!persistFn) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snap = exportSessions();
    try { persistFn(snap); } catch (e) { /* persistFn is fire-and-forget */ }
  }, 500);
  persistTimer.unref && persistTimer.unref();
}

function createSession(totpVerified) {
  cleanupInternal();
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(id, {
    created: now,
    expires: now + SESSION_TTL_MS,
    totpVerified: !!totpVerified
  });
  schedulePersist();
  return id;
}

function getSession(id) {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(id); schedulePersist(); return null; }
  return s;
}

function dropSession(id) {
  if (id && sessions.delete(id)) schedulePersist();
}

function cleanupInternal() {
  const now = Date.now();
  let changed = false;
  for (const [id, s] of sessions) {
    if (s.expires < now) { sessions.delete(id); changed = true; }
  }
  if (changed) schedulePersist();
}

function parseCookies(req) {
  const out = {};
  const h = req.headers && req.headers.cookie;
  if (!h) return out;
  for (const p of h.split(';')) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    out[p.slice(0, eq).trim()] = decodeURIComponent(p.slice(eq + 1).trim());
  }
  return out;
}

function setSessionCookie(res, id) {
  const parts = [
    `${COOKIE_NAME}=${id}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    'SameSite=Lax'
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function getTokenFromReq(req) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.query && req.query.token) return String(req.query.token);
  return '';
}

function middleware(getCfg) {
  return function authGate(req, res, next) {
    const cfg = getCfg();

    if (req.method === 'GET' && (req.path === '/info' || req.path === '/auth/status')) return next();

    if (cfg.requireAuth) {
      const tok = getTokenFromReq(req);
      if (!tok || tok !== cfg.authToken) {
        return res.status(401).json({ error: 'auth_required' });
      }
    }

    const totpActive = !!cfg.requireTotp && !!cfg.totpSecret;
    if (totpActive) {
      if (req.path.startsWith('/auth/')) return next();
      const cookies = parseCookies(req);
      const sess = getSession(cookies[COOKIE_NAME]);
      if (!sess || !sess.totpVerified) {
        return res.status(401).json({ error: 'totp_required' });
      }
    }

    next();
  };
}

module.exports = {
  middleware,
  createSession, getSession, dropSession,
  loadSessions, setPersistFn, exportSessions,
  parseCookies, setSessionCookie, clearSessionCookie,
  getTokenFromReq,
  COOKIE_NAME, SESSION_TTL_MS
};
