/* Experten-Mode-Manager.
 * Lokal in localStorage, synchronisiert mit system.config.common.expertMode.
 *
 * Sichtbarkeit gefaehrlicher Aktionen wird ueber CSS-Klassen gesteuert:
 *   body.expert-mode .expert-only { display: inline-flex; }
 *   .expert-only { display: none; }
 */
(function (global) {
  'use strict';
  const KEY = 'fiducerion.expertMode';
  let value = localStorage.getItem(KEY) === '1';

  function apply() {
    document.body.classList.toggle('expert-mode', value);
    const ind = document.getElementById('expertBadge');
    if (ind) ind.hidden = !value;
    const tog = document.getElementById('expertToggle');
    if (tog) tog.checked = value;
  }

  async function set(newVal) {
    value = !!newVal;
    localStorage.setItem(KEY, value ? '1' : '0');
    apply();
    // Aktive Tab neu laden, damit Spalten/Buttons sich anpassen
    try {
      const active = document.querySelector('.ma-tab.active');
      const id = active && active.dataset && active.dataset.tab;
      const tab = id && global.MA.tabs && global.MA.tabs[id];
      if (tab && typeof tab.refresh === 'function') tab.refresh();
    } catch (e) {}
    // Best-effort sync mit system.config (nicht blockierend)
    try { await global.MA.api.saveSysConfig({ common: { expertMode: value } }); } catch (e) { /* ignore */ }
  }

  async function syncFromServer() {
    try {
      const cfg = await global.MA.api.getSysConfig();
      if (cfg && cfg.common && typeof cfg.common.expertMode === 'boolean') {
        // Wenn der Server explizit true/false sagt: das gewinnt beim Boot
        value = cfg.common.expertMode;
        localStorage.setItem(KEY, value ? '1' : '0');
        apply();
      }
    } catch (e) { /* ignore - kann fehlschlagen wenn user keine Berechtigung hat */ }
  }

  function get() { return value; }
  function toggle() { return set(!value); }

  global.MA = global.MA || {};
  global.MA.expertMode = { get, set, toggle, apply, syncFromServer };
})(window);
