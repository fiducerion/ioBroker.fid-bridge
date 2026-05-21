/* lib/api/themes.js
 *
 *   GET /api/themes              -> Liste { id, label, description, dark, accent }
 *
 * Frontend laedt das eigentliche CSS direkt via <link href="/themes/{id}/theme.css">
 */
'use strict';

const { Router } = require('express');
const fs   = require('fs');
const path = require('path');

module.exports = function ({ adapter, config }, wwwRoot) {
  const router = Router();
  const themesRoot = path.join(wwwRoot, 'themes');

  router.get('/', (req, res, next) => {
    try {
      if (!fs.existsSync(themesRoot)) return res.json({ themes: [], defaultTheme: config.defaultTheme });
      const entries = fs.readdirSync(themesRoot, { withFileTypes: true })
        .filter(d => d.isDirectory());
      const themes = [];
      for (const d of entries) {
        const metaPath = path.join(themesRoot, d.name, 'theme.json');
        const cssPath  = path.join(themesRoot, d.name, 'theme.css');
        if (!fs.existsSync(cssPath)) continue;
        let meta = { id: d.name, label: d.name };
        if (fs.existsSync(metaPath)) {
          try {
            meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, 'utf-8')) };
          } catch (e) {
            adapter.log.warn(`theme.json ${d.name} ungueltig: ${e.message}`);
          }
        }
        meta.id = d.name;
        meta.cssUrl = `/themes/${d.name}/theme.css`;
        themes.push(meta);
      }
      themes.sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
      res.json({ themes, defaultTheme: config.defaultTheme });
    } catch (e) { next(e); }
  });

  return router;
};
