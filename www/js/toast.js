(function (global) {
  'use strict';
  const host = () => document.getElementById('toastHost');

  function show(text, kind, ttl) {
    const h = host();
    if (!h) { console.log('[toast]', kind, text); return; }
    const el = document.createElement('div');
    el.className = 'ma-toast toast-' + (kind || 'info');
    el.textContent = text;
    h.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast-in'));
    setTimeout(() => {
      el.classList.remove('toast-in');
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 250);
    }, Math.max(1500, Math.min(15000, ttl || 4500)));
  }

  global.MA = global.MA || {};
  global.MA.toast = show;
})(window);
