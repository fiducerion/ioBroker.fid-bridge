(function (global) {
  'use strict';

  const STORAGE_KEY = 'fiducerion.theme';

  let availableThemes = [];
  let activeThemeId = '';

  async function init(defaultThemeId) {
    try {
      const r = await global.MA.api.themes();
      availableThemes = Array.isArray(r.themes) ? r.themes : [];
    } catch (e) {
      console.warn('Theme-Liste konnte nicht geladen werden:', e);
      availableThemes = [{ id: 'lcars', label: 'LCARS', cssUrl: '/themes/lcars/theme.css' }];
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    const want  = saved || defaultThemeId || (availableThemes[0] && availableThemes[0].id) || 'lcars';
    await apply(want);
    buildDropdown();
  }

  function buildDropdown() {
    const sel = document.getElementById('themeSelect');
    if (!sel) return;
    sel.innerHTML = '';
    for (const t of availableThemes) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label || t.id;
      if (t.id === activeThemeId) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = () => apply(sel.value);
  }

  function apply(themeId) {
    const link = document.getElementById('themeStyle');
    const theme = availableThemes.find(t => t.id === themeId) || availableThemes[0];
    if (!link || !theme) return Promise.resolve();
    return new Promise((resolve) => {
      // Vorhandenes Link-Element austauschen, damit der Browser sauber re-applied
      const newLink = link.cloneNode();
      newLink.id = 'themeStyle';
      newLink.href = theme.cssUrl + '?v=' + Date.now();
      newLink.onload = () => {
        link.replaceWith(newLink);
        activeThemeId = theme.id;
        localStorage.setItem(STORAGE_KEY, theme.id);
        document.body.dataset.theme = theme.id;
        resolve();
      };
      newLink.onerror = () => { resolve(); };
      link.parentNode.insertBefore(newLink, link.nextSibling);
      link.remove();
    });
  }

  global.MA = global.MA || {};
  global.MA.theme = { init, apply, getActive: () => activeThemeId, list: () => availableThemes.slice() };
})(window);
