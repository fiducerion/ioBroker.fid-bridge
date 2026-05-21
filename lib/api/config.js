/* lib/api/config.js
 *
 *   GET  /api/config/:instance     -> { instance, common, native, jsonConfig|null, fallback: 'raw'|'schema' }
 *   PUT  /api/config/:instance     body { native: {...} }  -> ok
 *
 * Versucht das jsonConfig-Schema von der Disk zu lesen (mehrere Pfad-Kandidaten),
 * Fallback ist ein roher JSON-Editor.
 */
'use strict';

const { Router } = require('express');
const fs   = require('fs').promises;
const path = require('path');

async function readJsonConfig(adapter, adapterName) {
  // 1) Disk: bei Standard-ioBroker-Installation passt der erste Pfad
  const adapterDir = adapter.adapterDir || '';
  const parentDir = path.dirname(adapterDir);
  const candidates = [
    `/opt/iobroker/node_modules/iobroker.${adapterName}/admin/jsonConfig.json`,
    path.join(parentDir, 'iobroker.' + adapterName, 'admin', 'jsonConfig.json'),
    `/opt/iobroker/node_modules/iobroker.${adapterName}/admin/jsonConfig.json5`,
    path.join(parentDir, 'iobroker.' + adapterName, 'admin', 'jsonConfig.json5')
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8');
      return { schema: parseLoose(raw), source: p };
    } catch (e) { /* try next */ }
  }

  // 2) Object-DB File-Storage (admin/alexa/web/tuya speichern dort)
  const fileTries = [
    [adapterName + '.admin', 'jsonConfig.json'],
    [adapterName + '.admin', 'jsonConfig.json5'],
    [adapterName,            'admin/jsonConfig.json'],
    [adapterName,            'admin/jsonConfig.json5']
  ];
  for (const [ns, fn] of fileTries) {
    try {
      const buf = await readAdapterFile(adapter, ns, fn);
      if (!buf) continue;
      const raw = Buffer.isBuffer(buf) ? buf.toString('utf-8') : String(buf);
      return { schema: parseLoose(raw), source: 'file://' + ns + '/' + fn };
    } catch (e) { /* try next */ }
  }
  return null;
}

function readAdapterFile(adapter, namespace, filename) {
  return new Promise((resolve, reject) => {
    try {
      adapter.readFile(namespace, filename, (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    } catch (e) { reject(e); }
  });
}

function parseLoose(raw) {
  // JSON5-light: Kommentare + trailing commas vertragen
  const clean = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(clean);
}

module.exports = function ({ adapter }) {
  const router = Router();

  router.get(/^\/(.+)$/, async (req, res, next) => {
    try {
      const instance = req.params[0];
      if (!/^[a-zA-Z0-9_-]+\.\d+$/.test(instance)) return res.status(400).json({ error: 'invalid instance' });

      const obj = await adapter.getForeignObjectAsync('system.adapter.' + instance);
      if (!obj) return res.status(404).json({ error: 'instance not found' });

      const adapterName = (obj.common && obj.common.name) || String(instance).split('.')[0];
      let jsonConfig = null;
      let schemaSource = null;
      let reason = null;
      let adminConfigUrl = null;
      const adminUI = obj.common && obj.common.adminUI;
      const adminUiType = adminUI && adminUI.config;

      const hasJsonConfig = adminUiType === 'json';
      if (!hasJsonConfig) {
        reason = `Adapter nutzt UI-Typ "${adminUiType || 'klassisch'}" (kein jsonConfig-Schema). Der Bridge-Editor kann hier nur den Roh-JSON-Modus anbieten — oder die offizielle Admin-UI einbinden.`;
      } else {
        const r = await readJsonConfig(adapter, adapterName);
        if (r) { jsonConfig = r.schema; schemaSource = r.source; }
        else   { reason = `jsonConfig-Schema wurde nicht gefunden (Disk + Object-DB-Files erfolglos durchsucht). Adapter hat eventuell ein React-Bundle statt einer schema-Datei.`; }
      }

      // Wenn kein Schema: versuchen wir die Admin-URL fuer iframe/Neuer-Tab anzubieten
      if (!jsonConfig) {
        try {
          const adminObj = await adapter.getForeignObjectAsync('system.adapter.admin.0');
          if (adminObj && adminObj.native && adminObj.native.port) {
            const hostname = req.headers.host ? String(req.headers.host).split(':')[0] : 'localhost';
            const proto = adminObj.native.secure ? 'https' : 'http';
            const port  = adminObj.native.port;
            adminConfigUrl = `${proto}://${hostname}:${port}/#tab-instances/config/system.adapter.${instance}`;
          }
        } catch (e) { /* admin.0 nicht da - egal */ }
      }

      const protectedFields = Array.isArray(obj.protectedNative) ? obj.protectedNative : [];

      res.json({
        instance,
        common: {
          name: obj.common.name,
          title: obj.common.titleLang ? (obj.common.titleLang.de || obj.common.titleLang.en) : (obj.common.title || ''),
          version: obj.common.version,
          adminUI
        },
        native: obj.native || {},
        jsonConfig,
        schemaSource,
        protectedFields,
        reason,
        adminConfigUrl,
        fallback: jsonConfig ? 'schema' : 'raw'
      });
    } catch (e) { next(e); }
  });

  router.put(/^\/(.+)$/, async (req, res, next) => {
    try {
      const instance = req.params[0];
      if (!/^[a-zA-Z0-9_-]+\.\d+$/.test(instance)) return res.status(400).json({ error: 'invalid instance' });
      const native = req.body && req.body.native;
      if (!native || typeof native !== 'object') return res.status(400).json({ error: 'native object required' });

      // Selbst-Schutz: kritische Bridge-Felder nicht von aussen kippen lassen
      if (instance === adapter.namespace) {
        const dangerous = ['sessionStore'];
        for (const k of dangerous) {
          if (k in native) delete native[k];
        }
      }

      await adapter.extendForeignObjectAsync('system.adapter.' + instance, { native });
      res.json({ ok: true, instance });
    } catch (e) { next(e); }
  });

  return router;
};
