/* lib/api/links.js
 *
 *   GET /api/links     -> Liste aller Adapter mit Web-UIs (localLink + welcomeScreen),
 *                         mit Template-Vars aufgeloest gegen den anfragenden Host.
 *                         Plus Whitelist-Fallback fuer bekannte Adapter, die kein
 *                         localLink in io-package.json haben (zigbee2mqtt etc.).
 */
'use strict';

const { Router } = require('express');

// Adapter, die eine Web-UI auf einem nicht-standardmaessigen Endpoint anbieten und kein localLink mitliefern.
// Pro Adapter: Funktion, die das URL aus dem instance-native + Host ableitet, oder null retourniert wenn unklar.
const KNOWN_WEB_ADAPTERS = {
  // zigbee2mqtt: das HTTP-Frontend laeuft typischerweise auf dem gleichen Host wie der MQTT-Broker
  // (z.B. wenn z2m als Container/Service auf einem dedizierten Host laeuft, hat es eingebautes Frontend auf Port 8080).
  // Der ioBroker-Adapter selbst verbindet sich per MQTT - wir parsen die MQTT-URL und nehmen die IP an + Standard-Frontend-Port.
  // Wenn das nicht zuverlaessig moeglich ist: null retournieren, damit keine falsche URL erscheint.
  'zigbee2mqtt': (native) => {
    // Probiere mehrere bekannte Felder
    const candidates = [
      native.frontendUrl, native.frontend, native.externalFrontendUrl,
      native.server, native.broker, native.mqttServer, native.mqttBroker
    ].filter(Boolean);
    for (const c of candidates) {
      const s = String(c);
      // Wenn schon HTTP-URL: direkt nehmen
      if (/^https?:\/\//.test(s)) return s;
      // mqtt://IP:port - IP extrahieren, Standard-Frontend-Port 8080
      const m = s.match(/^(?:mqtts?|tcp):\/\/([^/:]+)(?::(\d+))?/);
      if (m) {
        const ip = m[1];
        const port = native.frontendPort || 8080;
        return `http://${ip}:${port}`;
      }
      // Reine IP/Hostname ohne Schema
      const m2 = s.match(/^([\w.\-]+?)(?::(\d+))?$/);
      if (m2) {
        const port = native.frontendPort || 8080;
        return `http://${m2[1]}:${port}`;
      }
    }
    return null;  // Lieber gar nichts als falscher Link
  },
  'frontail':         (n, ctx) => `http://${ctx.hostname}:${n.port || 9001}`,
  'node-red':         (n, ctx) => `http://${ctx.hostname}:${n.port || 1880}`,
  'octoprint':        (n, ctx) => n.host ? `http://${n.host}:${n.port || 80}` : null,
  'esphome':          (n, ctx) => `http://${ctx.hostname}:${n.port || 6052}`,
  'eufy-security':    (n, ctx) => `http://${ctx.hostname}:${n.port || 8080}`,
  'fullybrowser':     (n, ctx) => n.host ? `http://${n.host}:${n.port || 2323}` : null,
  'fullybrowser-mqtt':(n, ctx) => n.host ? `http://${n.host}:${n.port || 2323}` : null,
  'apcupsd':          (n, ctx) => `http://${ctx.hostname}:${n.port || 3551}`,
  'fhem':             (n, ctx) => `http://${ctx.hostname}:${n.port || 8083}/fhem`
};

module.exports = function ({ adapter }) {
  const router = Router();

  // Custom-Links: speichern in der eigenen Instance-Native
  router.get('/custom', async (req, res, next) => {
    try {
      const obj = await adapter.getForeignObjectAsync('system.adapter.' + adapter.namespace);
      const list = (obj && obj.native && Array.isArray(obj.native.customLinks)) ? obj.native.customLinks : [];
      res.json({ items: list });
    } catch (e) { next(e); }
  });

  router.put('/custom', async (req, res, next) => {
    try {
      const items = req.body && req.body.items;
      if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
      // Sanitize
      const clean = items.filter(it => it && typeof it === 'object' && it.url).map(it => ({
        label: String(it.label || it.url).slice(0, 100),
        url: String(it.url).slice(0, 500)
      }));
      await adapter.extendForeignObjectAsync('system.adapter.' + adapter.namespace, {
        native: { customLinks: clean }
      });
      // Reload des im-memory configs damit GET / sofort die neuen Links sieht
      if (adapter.config) adapter.config.customLinks = clean;
      res.json({ ok: true, items: clean });
    } catch (e) { next(e); }
  });

  router.get('/', async (req, res, next) => {
    try {
      const view = await adapter.getObjectViewAsync('system', 'instance', {
        startkey: 'system.adapter.', endkey: 'system.adapter.\u9999'
      });

      // Web-/Admin-Instanzen sammeln fuer %web_*% / %admin_*% Substitution
      let webNative = null, adminNative = null;
      for (const r of (view.rows || [])) {
        const obj = r.value;
        if (!obj || obj.type !== 'instance') continue;
        const n = obj.common && obj.common.name;
        if (n === 'web'   && !webNative)   webNative = obj.native || {};
        if (n === 'admin' && !adminNative) adminNative = obj.native || {};
      }

      const hostname = req.headers.host ? String(req.headers.host).split(':')[0] : 'localhost';
      const aliveStates = await adapter.getForeignStatesAsync('system.adapter.*.alive');

      const links = [];
      for (const r of (view.rows || [])) {
        const obj = r.value;
        if (!obj || obj.type !== 'instance') continue;
        const c = obj.common || {};
        const n = obj.native || {};
        const id = obj._id.replace(/^system\.adapter\./, '');
        const alive = aliveStates && aliveStates[obj._id + '.alive'] && aliveStates[obj._id + '.alive'].val === true;

        if (c.localLink) {
          const url = resolve(c.localLink, n, webNative, adminNative, hostname);
          if (url) links.push({
            id,
            instance: id,
            adapter: c.name,
            label: c.titleLang ? (c.titleLang.de || c.titleLang.en) : (c.title || c.name || id),
            url,
            alive,
            kind: 'primary'
          });
        } else if (KNOWN_WEB_ADAPTERS[c.name]) {
          // Fallback fuer bekannte Adapter ohne localLink - adapter-spezifischer URL-Builder
          try {
            const url = KNOWN_WEB_ADAPTERS[c.name](n, { hostname });
            if (url) links.push({
              id,
              instance: id,
              adapter: c.name,
              label: c.titleLang ? (c.titleLang.de || c.titleLang.en) : (c.title || c.name || id),
              url,
              alive,
              kind: 'fallback'
            });
          } catch (e) { /* skip bad builder */ }
        }

        if (Array.isArray(c.welcomeScreen)) {
          c.welcomeScreen.forEach(ws => {
            if (!ws || !ws.link) return;
            const url = resolve(ws.link, n, webNative, adminNative, hostname);
            if (url) links.push({
              id: id + '#' + (ws.name || ''),
              instance: id,
              adapter: c.name,
              label: ws.name || c.name || id,
              url,
              alive,
              kind: 'welcome'
            });
          });
        }
      }

      // Custom-Links aus der Bridge-Adapter-Konfig (instance native.customLinks: [{label, url}])
      try {
        const myCfg = adapter.config || {};
        if (Array.isArray(myCfg.customLinks)) {
          myCfg.customLinks.forEach((l, i) => {
            if (!l || !l.url) return;
            const url = String(l.url).replace(/%ip%/g, hostname);
            links.push({
              id: 'custom-' + i,
              instance: 'custom',
              adapter: 'custom',
              label: l.label || url,
              url,
              alive: true,
              kind: 'custom'
            });
          });
        }
      } catch (e) {}

      links.sort((a, b) => a.adapter.localeCompare(b.adapter) || a.label.localeCompare(b.label));
      res.json({ count: links.length, links });
    } catch (e) { next(e); }
  });

  return router;
};

function resolve(tpl, native, webNative, adminNative, hostname) {
  if (!tpl) return null;
  let url = String(tpl);

  // Self
  url = url.replace(/%protocol%/g, native.secure ? 'https' : 'http');
  url = url.replace(/%ip%/g,        hostname);
  url = url.replace(/%bind%/g,      bindOrHost(native.bind, hostname));
  if (native.port != null) url = url.replace(/%port%/g, String(native.port));

  // Web
  if (webNative) {
    url = url.replace(/%web_protocol%/g, webNative.secure ? 'https' : 'http');
    url = url.replace(/%web_port%/g,     String(webNative.port || 8082));
    url = url.replace(/%web_bind%/g,     bindOrHost(webNative.bind, hostname));
  }

  // Admin
  if (adminNative) {
    url = url.replace(/%admin_protocol%/g, adminNative.secure ? 'https' : 'http');
    url = url.replace(/%admin_port%/g,     String(adminNative.port || 8081));
    url = url.replace(/%admin_bind%/g,     bindOrHost(adminNative.bind, hostname));
  }

  // Wenn noch Platzhalter uebrig: nicht ausgeben
  if (/%[a-zA-Z_]+%/.test(url)) return null;
  return url;
}

function bindOrHost(bind, hostname) {
  if (!bind || bind === '0.0.0.0' || bind === '::') return hostname;
  return bind;
}
