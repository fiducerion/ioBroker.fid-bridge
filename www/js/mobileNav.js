/* Mobile-Navigation: Off-Canvas Sidebar fuer schmale Screens.
 *
 *  - Hamburger toggled .nav-open auf #app
 *  - Backdrop und Hamburger schliessen den Drawer per Klick
 *  - Tab-Klick (.ma-tab) schliesst den Drawer ebenfalls automatisch
 *  - Swipe von links nach rechts oeffnet (touch beginnt in den ersten 24px)
 *  - Swipe nach links schliesst (wenn Drawer offen)
 *  - Esc schliesst
 *  - History-State, damit der Android-Zurueck-Button den Drawer schliesst statt
 *    die Seite zu verlassen
 */
(function (global) {
  'use strict';

  let app = null, toggle = null, backdrop = null, side = null;
  let touchStartX = 0, touchStartY = 0, touchStartT = 0, swipeActive = false;
  const EDGE = 24;        // wieviel Pixel vom linken Rand zaehlen als "Edge-Swipe"
  const THRESHOLD = 50;   // minimale X-Distanz fuer Swipe
  const TIME_MAX = 600;   // max Dauer fuer Swipe-Geste (sonst ist es Scroll)

  function init() {
    app      = document.getElementById('app');
    toggle   = document.getElementById('navToggle');
    backdrop = document.getElementById('navBackdrop');
    side     = document.getElementById('appSide');
    if (!app || !toggle) return;

    toggle.addEventListener('click', toggleDrawer);
    backdrop.addEventListener('click', closeDrawer);

    // Tab-Klicks schliessen den Drawer
    document.addEventListener('click', (ev) => {
      const tab = ev.target.closest('.ma-tab');
      if (tab && isOpen()) closeDrawer();
    });

    // ESC schliesst
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && isOpen()) closeDrawer();
    });

    // Swipe-Gesten (Touch)
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend',   onTouchEnd,   { passive: true });
    document.addEventListener('touchcancel', onTouchEnd,  { passive: true });

    // Browser-Back schliesst Drawer wenn offen, statt die Seite zu verlassen
    window.addEventListener('popstate', () => {
      if (isOpen()) {
        app.classList.remove('nav-open');
      }
    });
  }

  function isOpen() {
    return app && app.classList.contains('nav-open');
  }

  function openDrawer() {
    if (!app) return;
    app.classList.add('nav-open');
    // History-State pushen damit Back-Button schliesst
    try { history.pushState({ navDrawer: true }, ''); } catch (e) {}
  }

  function closeDrawer() {
    if (!app) return;
    app.classList.remove('nav-open');
    // Falls wir einen History-State gepusht haben: zurueck (loescht den State)
    try {
      if (history.state && history.state.navDrawer) history.back();
    } catch (e) {}
  }

  function toggleDrawer() {
    if (isOpen()) closeDrawer();
    else openDrawer();
  }

  function onTouchStart(ev) {
    if (!ev.touches || !ev.touches.length) return;
    const t = ev.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchStartT = Date.now();
    // Bedingung fuer Edge-Swipe (oeffnen): Touch beginnt in den ersten EDGE Pixeln
    // Bedingung fuer Close-Swipe: Drawer ist offen, ueberall auf der Seite OK
    swipeActive = (touchStartX <= EDGE) || isOpen();
  }

  function onTouchEnd(ev) {
    if (!swipeActive) return;
    swipeActive = false;
    if (!ev.changedTouches || !ev.changedTouches.length) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const dt = Date.now() - touchStartT;
    if (dt > TIME_MAX) return;
    // Bewegung muss ueberwiegend horizontal sein
    if (Math.abs(dy) > Math.abs(dx)) return;

    if (!isOpen() && touchStartX <= EDGE && dx > THRESHOLD) {
      openDrawer();
    } else if (isOpen() && dx < -THRESHOLD) {
      closeDrawer();
    }
  }

  // Init nach DOM-Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.MA = global.MA || {};
  global.MA.mobileNav = { open: openDrawer, close: closeDrawer, toggle: toggleDrawer, isOpen };
})(window);
