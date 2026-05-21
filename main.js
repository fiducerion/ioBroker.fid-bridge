/* MiniAdmin / Fiducerion Bridge — main.js v0.3
 *
 * Lifecycle + cmdExec-Handler:
 *   onMessage faengt cmdStdout/cmdStderr/cmdExit auf, die ueber sendToHost
 *   cmdExec mit unserer runId zurueckgeschickt werden.
 *   Routet das an die im host.js registrierten Listener.
 */
'use strict';

const utils = require('@iobroker/adapter-core');
const path  = require('path');

const createServer = require('./lib/server');
const createLogCollector = require('./lib/logCollector');

class MiniAdmin extends utils.Adapter {
  constructor(options) {
    super({ ...(options || {}), name: 'fid-bridge' });
    this.server = null;
    this.logCollector = null;
    this.runHandlers = new Map(); // runId -> handler(kind, data)

    this.on('ready',   this.onReady.bind(this));
    this.on('message', this.onMessage.bind(this));
    this.on('unload',  this.onUnload.bind(this));
  }

  async onReady() {
    // ==== Self-Check: sind unsere statischen Files alle da? ====
    // Wenn node_modules-Inhalte gefressen wurden (z.B. durch npm prune oder
    // einen js-controller-Reinstall-Versuch der nur halb durchgekommen ist),
    // ist www/index.html weg. Lieber sofort hart fehlschlagen mit klarer
    // Diagnose als sich durchwurschteln und 1000 ENOENT-Warnings ins Log
    // schreiben.
    try {
      const fs = require('fs');
      const path = require('path');
      const required = [
        'www/index.html',
        'www/js/core.js',
        'lib/server.js'
      ];
      const missing = [];
      for (const r of required) {
        const full = path.join(__dirname, r);
        if (!fs.existsSync(full)) missing.push(r);
      }
      if (missing.length) {
        this.log.error('======================================================');
        this.log.error('SELF-CHECK FEHLGESCHLAGEN: ' + missing.length + ' kritische Files fehlen.');
        this.log.error('Vermutlich hat npm-prune oder ein anderer Prozess die');
        this.log.error('node_modules teilweise geloescht. Heile mit:');
        this.log.error('  /opt/iobroker/.fid-bridge-watchdog.sh');
        this.log.error('oder neu installieren mit install-bridge.sh.');
        this.log.error('Fehlende Files:');
        for (const m of missing) this.log.error('  - ' + m);
        this.log.error('======================================================');
        // WICHTIG: NICHT automatisch den Watchdog triggern. Das hat in v0.5.1
        // bei smartlife einen Restart-Loop verursacht der die ioredis-
        // Connection von js-controller umgebracht hat ("DB closed" bei allen
        // Adaptern). Manueller Eingriff bleibt.
        // Terminate damit js-controller den Adapter nicht endlos restartet
        // mit kaputten Files
        this.terminate ? this.terminate('Self-check failed', 13) : process.exit(13);
        return;
      }
    } catch (e) {
      this.log.warn('Self-Check selbst fehlgeschlagen: ' + (e && e.message || e));
    }

    // Migration aus dem alten Adapter "miniadmin.0" - native und sessionStore uebernehmen
    try {
      await this.migrateFromMiniadmin();
    } catch (e) {
      this.log.warn('Migration aus miniadmin fehlgeschlagen (kein Drama, kann ignoriert werden): ' + e.message);
    }

    // Nach Migration: this.config aus dem frisch gepatchten Object neu laden,
    // weil adapter-core das nur einmal beim Start liest und Migration-Aenderungen sonst verloren waeren.
    try {
      const fresh = await this.getForeignObjectAsync('system.adapter.' + this.namespace);
      if (fresh && fresh.native) {
        // Felder mergen - this.config ist read-only-ish, aber wir koennen Eigenschaften setzen
        Object.assign(this.config, fresh.native);
      }
    } catch (e) {}

    const c = this.config || {};
    const cfg = {
      ownPort:           Number(c.ownPort) || 8008,
      bindHost:          c.bindHost || '0.0.0.0',
      enableOwnPort:     c.enableOwnPort !== false,
      enableWebExtension:!!c.enableWebExtension,
      webInstance:       c.webInstance || 'web.0',
      webMountPath:      c.webMountPath || 'fid-bridge',
      authToken:         c.authToken || '',
      requireAuth:       !!c.requireAuth,
      requireTotp:       !!c.requireTotp,
      totpSecret:        c.totpSecret || '',
      defaultTheme:      c.defaultTheme || 'lcars',
      defaultStartTab:   c.defaultStartTab || 'dashboard',
      logTailLines:      Number(c.logTailLines) || 200,
      logHistorySize:    Number(c.logHistorySize) || 500,
      objectCacheTtlSec: Number(c.objectCacheTtlSec) || 30,
      allowExec:         !!c.allowExec
    };

    if (cfg.requireAuth && !cfg.authToken) {
      cfg.authToken = this.generateToken();
      this.log.warn('Fiducerion Bridge: Auth-Token wurde generiert. Bitte in der Adapter-Konfig speichern:');
      this.log.warn('Fiducerion Bridge: TOKEN=' + cfg.authToken);
    }

    // Migration: kaputtes TOTP-Secret (z.B. durch Encryption-Bug der v0.3.0-0.3.2) bereinigen.
    // Ein gueltiges Base32-Secret enthaelt nur A-Z, 2-7 (und ggf. Padding).
    if (cfg.totpSecret && !/^[A-Z2-7]+=*$/i.test(cfg.totpSecret)) {
      this.log.warn('Fiducerion Bridge: totpSecret in Object-DB ist kein gueltiges Base32 (verdaechtig: Encryption-Verfaelschung).');
      this.log.warn('Fiducerion Bridge: TOTP wird zurueckgesetzt. Bitte 2FA im Settings-Tab neu einrichten.');
      cfg.totpSecret = '';
      cfg.requireTotp = false;
      try {
        await this.extendForeignObjectAsync('system.adapter.' + this.namespace, {
          native: { totpSecret: '', requireTotp: false }
        });
      } catch (e) { this.log.warn('TOTP-Reset fehlgeschlagen: ' + (e && e.message || e)); }
    }

    // ---- Persistente Sessions: laden + persist-Funktion verdrahten ----
    const auth = require('./lib/auth');
    try {
      const myObj = await this.getForeignObjectAsync('system.adapter.' + this.namespace);
      if (myObj && myObj.native && Array.isArray(myObj.native.sessionStore)) {
        const n = auth.loadSessions(myObj.native.sessionStore);
        if (n > 0) this.log.info(`Fiducerion Bridge: ${n} gespeicherte Sessions wiederhergestellt`);
      }
    } catch (e) { this.log.warn('Session-Load: ' + (e && e.message || e)); }

    auth.setPersistFn((arr) => {
      this.extendForeignObjectAsync('system.adapter.' + this.namespace, {
        native: { sessionStore: arr }
      }).catch(e => this.log.warn('Session-Persist: ' + (e && e.message || e)));
    });

    await this.setStateAsync('info.connection', { val: false, ack: true });

    try {
      // Log-Collector hochfahren BEVOR der Server gestartet wird, damit der
      // Server ihn an die API weitergeben kann.
      //
      // WICHTIG: Wir registrieren NUR EINEN 'log'-Listener am Adapter, nicht zwei.
      // Manche js-controller-Versionen ersetzen den vorherigen Listener statt
      // ihn additiv hinzuzufuegen - das war der Bug, dass entweder der
      // Logs-Tab oder der Analyzer leer blieben.
      // Der Collector exportiert daher nur seine ingest-Funktion; das
      // tatsaechliche Listening machen wir hier in onAdapterLog().
      this.logCollector = createLogCollector(this);
      await this.logCollector.start({ skipListener: true });

      if (cfg.enableOwnPort) {
        this.server = createServer({
          adapter: this,
          config: cfg,
          wwwRoot: path.join(__dirname, 'www'),
          logCollector: this.logCollector,
          registerRunHandler: (runId, fn) => this.runHandlers.set(runId, fn),
          unregisterRunHandler: (runId) => this.runHandlers.delete(runId)
        });
        await this.server.start();

        const url = `http://${cfg.bindHost === '0.0.0.0' ? 'localhost' : cfg.bindHost}:${cfg.ownPort}/`;
        await this.setStateAsync('info.url', { val: url, ack: true });
        await this.setStateAsync('info.connection', { val: true, ack: true });
        this.log.info(`Fiducerion Bridge laeuft auf ${url}`);
      }

      // EIN zentraler Log-Listener bedient Server (Logs-Tab) UND Collector (Analyzer)
      try { await this.requireLog(true); } catch (e) { /* ignore */ }
      this.on('log', this.onAdapterLog.bind(this));

    } catch (e) {
      this.log.error('Fiducerion Bridge Start fehlgeschlagen: ' + (e && e.stack || e));
    }
  }

  onAdapterLog(entry) {
    // 1) An den Server weitergeben (Live-Logs, Logs-Tab via WebSocket)
    if (this.server) {
      try { this.server.broadcastLog(entry); } catch (e) {}
    }
    // 2) An den Collector weitergeben (Analyzer-Tab)
    if (this.logCollector) {
      try { this.logCollector.ingestEntry(entry); } catch (e) {}
    }
  }

  async onMessage(obj) {
    if (!obj) return;
    const cmd = obj.command;
    const msg = obj.message;
    // cmdStdout/cmdStderr/cmdExit kommen mit unserer runId zurueck
    if (cmd === 'cmdStdout' || cmd === 'cmdStderr' || cmd === 'cmdExit') {
      const runId = msg && msg.id;
      const data  = msg && msg.data;
      const h = runId ? this.runHandlers.get(runId) : null;
      if (h) {
        h(cmd === 'cmdStdout' ? 'stdout' : cmd === 'cmdStderr' ? 'stderr' : 'exit', data);
        if (cmd === 'cmdExit') {
          // nach 2s aufraeumen (falls noch nachzuegler kommen)
          setTimeout(() => this.runHandlers.delete(runId), 2000).unref();
        }
      }
      return;
    }
    if (obj.callback) this.sendTo(obj.from, obj.command, { error: 'not handled' }, obj.callback);
  }

  async onUnload(callback) {
    try {
      try { await this.requireLog(false); } catch (e) { /* ignore */ }
      if (this.logCollector) { await this.logCollector.stop(); this.logCollector = null; }
      if (this.server) { await this.server.stop(); this.server = null; }
      await this.setStateAsync('info.connection', { val: false, ack: true });
      callback();
    } catch (e) { callback(); }
  }

  generateToken() {
    const chars = '0123456789abcdef';
    let out = '';
    for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * 16)];
    return out;
  }

  // Einmal-Migration: kopiere native-Settings (Sessions, TOTP-Secret, customLinks, Themes)
  // vom alten "miniadmin.0" Adapter auf den neuen "fid-bridge.0".
  // Wird nur ausgefuehrt wenn unsere native.migratedFromMiniadmin noch nicht gesetzt ist.
  async migrateFromMiniadmin() {
    const myId = 'system.adapter.' + this.namespace;
    const myObj = await this.getForeignObjectAsync(myId);
    if (!myObj) return;
    if (myObj.native && myObj.native.migratedFromMiniadmin) return;

    const oldObj = await this.getForeignObjectAsync('system.adapter.miniadmin.0');
    if (!oldObj || !oldObj.native) {
      // Kein Vorgaenger gefunden - Migrations-Marker setzen damit wir nicht jeden Start probieren
      await this.extendForeignObjectAsync(myId, { native: { migratedFromMiniadmin: true } });
      return;
    }

    this.log.info('Migration aus miniadmin.0: uebernehme customLinks, theme, Auth-Settings (kein TOTP)');
    const o = oldObj.native;
    const patch = { native: {
      migratedFromMiniadmin: true
    } };
    // Felder die wir uebernehmen - TOTP-Felder bewusst NICHT, weil das bisher
    // nicht zuverlaessig geklappt hat. User richtet 2FA in der neuen Bridge einmal neu ein.
    const carryFields = ['authToken', 'requireAuth', 'allowExec',
                         'defaultTheme', 'defaultStartTab', 'customLinks', 'disableNotifications',
                         'sessionStore', 'logTailLines', 'logHistorySize', 'objectCacheTtlSec',
                         'ownPort', 'bindHost'];
    for (const f of carryFields) {
      if (o[f] !== undefined && o[f] !== null && o[f] !== '') {
        // Nur uebernehmen wenn beim neuen noch Default-Wert steht
        const curr = (myObj.native || {})[f];
        const isDefault = curr === undefined || curr === '' || curr === false || (Array.isArray(curr) && !curr.length);
        if (isDefault) patch.native[f] = o[f];
      }
    }
    await this.extendForeignObjectAsync(myId, patch);
    this.log.info('Migration abgeschlossen. Du kannst miniadmin.0 jetzt deaktivieren.');
  }
}

if (require.main !== module) module.exports = (options) => new MiniAdmin(options);
else new MiniAdmin();
