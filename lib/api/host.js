/* lib/api/host.js
 *
 * Wickelt sendToHost cmdExec mit Live-Streaming ab.
 *
 *   POST /api/host/exec  body { cmd, host? }
 *     -> startet Kommando, antwortet sofort mit { runId, host }
 *     -> Output kommt via WS push:  { type: 'cmd_stdout'|'cmd_stderr'|'cmd_exit', runId, data|code }
 *
 * Sicherheit: allowExec muss true sein, sonst 403.
 * Kein freier Shell-Zugriff: nur whitelisted ioBroker-CLI-Subcommands.
 */
'use strict';

const { Router } = require('express');

const ALLOWED_CMDS = [
  'add',       // adapter installieren / instanz anlegen
  'install',   // adapter installieren
  'upgrade',   // adapter aktualisieren
  'del',       // adapter / instanz entfernen
  'delete',
  'uninstall',
  'upload',
  'restart',
  'backup',
  'status',
  'list'
];

function isAllowed(cmd) {
  const first = String(cmd || '').trim().split(/\s+/)[0];
  return ALLOWED_CMDS.includes(first);
}

module.exports = function ({ adapter, getCfg, broadcast, registerHostMessageHandler }) {
  const router = Router();

  router.post('/exec', async (req, res, next) => {
    try {
      const cfg = getCfg();
      if (!cfg.allowExec) return res.status(403).json({ error: 'allowExec=false' });

      const cmd = String(req.body && req.body.cmd || '').trim();
      if (!cmd) return res.status(400).json({ error: 'cmd required' });
      if (!isAllowed(cmd)) return res.status(403).json({ error: 'cmd not whitelisted', whitelist: ALLOWED_CMDS });

      let host = req.body && req.body.host;
      if (!host) host = await detectHost(adapter);
      if (!host) return res.status(500).json({ error: 'no host found' });

      const runId = 'fid-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
      registerHostMessageHandler(runId, (kind, payload) => {
        if (kind === 'stdout') broadcast({ type: 'cmd_stdout', runId, data: String(payload || '') });
        else if (kind === 'stderr') broadcast({ type: 'cmd_stderr', runId, data: String(payload || '') });
        else if (kind === 'exit') broadcast({ type: 'cmd_exit',   runId, code: Number(payload) });
      });

      adapter.log.info(`cmdExec [${runId}] ${host}: ${cmd}`);
      // sendToHost - kein await, callback fuer kurze Bestaetigung reicht
      adapter.sendToHost(host, 'cmdExec', { data: cmd, id: runId });

      // Timeout-Schutz: wenn nach 10min nichts kommt, schliessen
      setTimeout(() => {
        broadcast({ type: 'cmd_exit', runId, code: -1, timeout: true });
      }, 10 * 60 * 1000).unref();

      res.json({ ok: true, runId, host });
    } catch (e) { next(e); }
  });

  return router;
};

async function detectHost(adapter) {
  try {
    const states = await adapter.getForeignStatesAsync('system.host.*.alive');
    const ids = Object.keys(states || {});
    if (!ids.length) return null;
    const aliveId = ids.find(id => states[id] && states[id].val === true) || ids[0];
    return aliveId.replace(/\.alive$/, '');
  } catch (e) { return null; }
}

module.exports.detectHost = detectHost;
