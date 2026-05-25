/* lib/server.js v0.3
 *
 * Express + WS-Server.
 * cfg ist mutable (TOTP-Aktivierung waehrend Laufzeit), daher Getter-/Setter-Pattern.
 */
'use strict';

const express = require('express');
const http    = require('http');
const path    = require('path');
const { WebSocketServer } = require('ws');

const auth = require('./auth');
const apiAuth      = require('./api/auth');
const apiStates    = require('./api/states');
const apiObjects   = require('./api/objects');
const apiLogs      = require('./api/logs');
const apiThemes    = require('./api/themes');
const apiSystem    = require('./api/system');
const apiAdapters  = require('./api/adapters');
const apiInstances = require('./api/instances');
const apiCounts    = require('./api/counts');
const apiHost      = require('./api/host');
const apiRepo      = require('./api/repo');
const apiConfig    = require('./api/config');
const apiScripts   = require('./api/scripts');
const apiFiles     = require('./api/files');
const apiLinks     = require('./api/links');
const apiStructure = require('./api/structure');
const apiNotifications = require('./api/notifications');
const apiBackupRestore = require('./api/backup-restore');
const apiBackupSchedule = require('./api/backup-schedule');
const apiUsers     = require('./api/users');
const apiSearch    = require('./api/search');
const apiAnalyzer  = require('./api/analyzer');

function createServer({ adapter, config, wwwRoot, logCollector, registerRunHandler, unregisterRunHandler }) {
  const app = express();
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Mutable cfg-Bag (TOTP wird zur Laufzeit aktiviert)
  let cfg = { ...config };
  const getCfg = () => cfg;
  const setCfg = (patch) => { cfg = { ...cfg, ...patch }; };

  const wsClients = new Set();
  const logRing = [];
  const MAX_RING = Math.max(100, Number(cfg.logHistorySize) || 500);

  // ---- Middleware ----
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use('/api', auth.middleware(getCfg));

  // Public Info-Endpoint
  app.get('/api/info', (req, res) => {
    res.json({
      name: 'fid-bridge',
      version: require('../package.json').version,
      defaultTheme: cfg.defaultTheme,
      defaultStartTab: cfg.defaultStartTab,
      requireAuth: !!cfg.requireAuth,
      requireTotp: !!cfg.requireTotp,
      totpConfigured: !!cfg.totpSecret,
      allowExec: !!cfg.allowExec
    });
  });

  // Host-Cmd-Handler-Registry an api/host weitergeben
  const hostHandlers = new Map();
  function registerHostMessageHandler(runId, handler) {
    hostHandlers.set(runId, handler);
    registerRunHandler(runId, (kind, data) => {
      const h = hostHandlers.get(runId);
      if (h) h(kind, data);
      if (kind === 'exit') {
        setTimeout(() => hostHandlers.delete(runId), 2000).unref();
      }
    });
  }

  const deps = {
    adapter, getCfg, setCfg,
    broadcast: wsBroadcast,
    getLogRing: () => logRing,
    registerHostMessageHandler,
    registerRunHandler,
    unregisterRunHandler,
    logCollector
  };
  // Backward-Compat fuer v0.2-Module (objects.js, themes.js), die `config` direkt lesen
  Object.defineProperty(deps, 'config', { get: getCfg, enumerable: true });

  app.use('/api/auth',      apiAuth(deps));
  app.use('/api/states',    apiStates(deps));
  app.use('/api/objects',   apiObjects(deps));
  app.use('/api/logs',      apiLogs(deps));
  app.use('/api/themes',    apiThemes(deps, wwwRoot));
  app.use('/api/system',    apiSystem(deps));
  app.use('/api/adapters',  apiAdapters(deps));
  app.use('/api/instances', apiInstances(deps));
  app.use('/api/counts',    apiCounts(deps));
  app.use('/api/host',      apiHost(deps));
  app.use('/api/repo',      apiRepo(deps));
  app.use('/api/config',    apiConfig(deps));
  app.use('/api/scripts',   apiScripts(deps));
  app.use('/api/files',     apiFiles(deps));
  app.use('/api/links',     apiLinks(deps));
  app.use('/api/structure', apiStructure(deps));
  app.use('/api/notifications', apiNotifications(deps));
  app.use('/api/users',     apiUsers(deps));
  app.use('/api/search',    apiSearch(deps));
  app.use('/api/analyzer',  apiAnalyzer(deps));
  // Backup-Restore mit Body-Limit 120MB (für Upload großer Backups)
  const heavyBody = require('body-parser').json({ limit: '120mb' });
  app.use('/api/backup-restore', heavyBody, apiBackupRestore(deps));
  app.use('/api/backup-schedule', heavyBody, apiBackupSchedule(deps));

  app.use(express.static(wwwRoot, {
    extensions: ['html'],
    fallthrough: true,
    setHeaders: (res, filePath) => {
      // HTML niemals cachen - sonst greift der ?v= Cache-Buster auf den JS/CSS-Resourcen nicht
      if (/\.html?$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
      // JS/CSS: kurz - dafuer nutzen wir den ?v= Cache-Buster ein-mal pro Release
      else if (/\.(css|js)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=60');
      else if (/\.(png|jpg|jpeg|svg|ico)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=3600');
      else res.setHeader('Cache-Control', 'no-cache');
    }
  }));

  app.get(/^\/(?!api\/).*/, (req, res) => {
    // Auch hier no-cache fuer den SPA-Fallback
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(wwwRoot, 'index.html'));
  });

  app.use((err, req, res, next) => {
    adapter.log.warn('Fiducerion Bridge API-Fehler: ' + (err && err.message || err));
    res.status(err.status || 500).json({ error: err.message || String(err) });
  });

  // ---- WebSocket ----
  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/ws')) { socket.destroy(); return; }
    if (cfg.requireAuth) {
      const q = new URL(req.url, 'http://x').searchParams;
      const tok = q.get('token') || '';
      if (tok !== cfg.authToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
      }
    }
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req); });
  });

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    updateClientCount();
    safeSend(ws, { type: 'hello', version: require('../package.json').version });
    if (logRing.length) safeSend(ws, { type: 'log_backlog', lines: logRing.slice(-200) });
    ws.on('close', () => { wsClients.delete(ws); updateClientCount(); });
    ws.on('error', () => { wsClients.delete(ws); updateClientCount(); });
  });

  function safeSend(ws, payload) { try { ws.send(JSON.stringify(payload)); } catch (e) {} }

  function wsBroadcast(payload) {
    const text = JSON.stringify(payload);
    for (const ws of wsClients) {
      if (ws.readyState === 1) { try { ws.send(text); } catch (e) {} }
    }
  }

  function updateClientCount() {
    adapter.setStateAsync('info.clients', { val: wsClients.size, ack: true }).catch(() => {});
  }

  function broadcastLog(entry) {
    const line = normalizeLogEntry(entry);
    logRing.push(line);
    while (logRing.length > MAX_RING) logRing.shift();
    wsBroadcast({ type: 'log', line });
  }

  function normalizeLogEntry(entry) {
    if (typeof entry === 'string') return { ts: Date.now(), severity: 'info', from: 'iobroker', message: entry };
    return {
      ts: entry.ts || Date.now(),
      severity: String(entry.severity || entry.level || 'info').toLowerCase(),
      from: String(entry.from || entry._id || 'iobroker'),
      message: typeof entry.message === 'object' ? JSON.stringify(entry.message) : String(entry.message ?? '')
    };
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(cfg.ownPort, cfg.bindHost, () => {
          httpServer.removeListener('error', reject);
          resolve();
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        for (const ws of wsClients) { try { ws.close(); } catch (e) {} }
        wsClients.clear();
        wss.close(() => httpServer.close(() => resolve()));
      });
    },
    broadcastLog,
    broadcast: wsBroadcast
  };
}

module.exports = createServer;
