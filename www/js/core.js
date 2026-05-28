(function (global) {
  'use strict';
  const { ui } = global.MA;
  const REFRESH_KEY = 'fiducerion.autorefresh.sec';

  let info = { defaultTheme: 'lcars', defaultStartTab: 'dashboard' };
  let authStatus = null;
  let activeTab = 'dashboard';
  let refreshHandle = null;

  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    setSplash('Lade Konfiguration...');

    const url = new URL(location.href);
    const tok = url.searchParams.get('token');
    if (tok) global.MA.setToken(tok);

    try {
      info = await global.MA.api.info();
    } catch (e) {
      if (e.code === 'auth_required') { showAuthPrompt(); return; }
      setSplash('Fehler beim Laden: ' + e.message);
      return;
    }

    // Auth-Status pruefen
    try {
      authStatus = await global.MA.api.authStatus();
    } catch (e) {
      setSplash('Auth-Status nicht abrufbar: ' + e.message);
      return;
    }

    // Wenn TOTP konfiguriert + nicht verifiziert: Modal zeigen
    if (authStatus.requireTotp && authStatus.totpConfigured && !authStatus.totpVerified) {
      // Splash weg, sonst wirkt's als haenge die App
      document.body.classList.remove('theme-loading');
      // totp.js macht nach erfolgreichem Verify location.reload() - kein callback noetig
      global.MA.totp.show();
      return;
    }

    continueBoot();
  }

  async function continueBoot() {
    setSplash('Lade Theme...');
    await global.MA.theme.init(info.defaultTheme);

    setSplash('Initialisiere UI...');
    document.getElementById('appTitle').textContent = 'Fiducerion Bridge';
    document.getElementById('appSubtitle').textContent = 'Teil von Fiducerion Core · v' + (info.version || '0.0.0');
    document.getElementById('appVersion').textContent = 'v' + (info.version || '0.0.0');

    const wantedTab = new URL(location.href).searchParams.get('tab');
    // Punkt 5: Start-Tab aus localStorage (vom Settings-Tab gesetzt), fallback auf Server-Config
    const userStartTab = localStorage.getItem('fiducerion.startTab');
    activeTab = wantedTab || userStartTab || info.defaultStartTab || 'dashboard';
    ui.buildTabs(activeTab, onTabChange);
    ui.startClock();

    document.getElementById('reloadAllBtn').addEventListener('click', refreshActive);
    const gsBtn = document.getElementById('globalSearchBtn');
    if (gsBtn) gsBtn.addEventListener('click', () => global.MA.globalSearch && global.MA.globalSearch.show());

    // Start-Tab-Auswahl im Settings-Tab befuellen + Persistenz
    const stSel = document.getElementById('startTabSelect');
    if (stSel) {
      // Optionen aus ui.TABS holen (ui.js exportiert sie via MA.ui._tabList wenn vorhanden,
      // sonst aus dem DOM die data-tab Attribute der gerenderten Tabs lesen)
      const tabIds = Array.from(document.querySelectorAll('#navTabs .ma-tab'))
        .map(b => ({ id: b.dataset.tab, label: (b.querySelector('.ma-tab-label') || b).textContent.trim() }));
      stSel.innerHTML = tabIds.map(t => `<option value="${t.id}">${t.label || t.id}</option>`).join('');
      const cur = userStartTab || activeTab;
      stSel.value = cur;
      stSel.addEventListener('change', () => {
        localStorage.setItem('fiducerion.startTab', stSel.value);
        global.MA.toast('Start-Tab gespeichert: ' + stSel.options[stSel.selectedIndex].text, 'ok');
      });
    }

    // Refresh-Select
    const refSel = document.getElementById('refreshSelect');
    if (refSel) {
      const saved = localStorage.getItem(REFRESH_KEY);
      if (saved !== null) refSel.value = saved;
      refSel.addEventListener('change', () => { localStorage.setItem(REFRESH_KEY, refSel.value); startAutoRefresh(); });
    }

    // Logout-Button nur wenn 2FA aktiv
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      if (authStatus && authStatus.requireTotp && authStatus.totpConfigured) {
        logoutBtn.hidden = false;
        logoutBtn.addEventListener('click', async () => {
          try { await global.MA.api.logout(); } catch(e) {}
          location.reload();
        });
      }
    }

    global.MA.on('ws:open',  () => { ui.setConn('online',  'online'); refreshActive(); });
    global.MA.on('ws:close', () => { ui.setConn('offline', 'offline'); });

    Object.values(global.MA.tabs || {}).forEach(t => { if (typeof t.init === 'function') t.init(); });

    document.body.classList.remove('theme-loading');
    document.getElementById('app').hidden = false;

    // Expert-Mode aus localStorage anwenden, dann (best-effort) vom Server synchen
    global.MA.expertMode.apply();
    const expertToggle = document.getElementById('expertToggle');
    if (expertToggle) {
      expertToggle.addEventListener('change', () => global.MA.expertMode.set(expertToggle.checked));
    }
    global.MA.expertMode.syncFromServer();

    // Card-Collapse-Toggle: Klick auf .ma-card-head bei .ma-card[data-collapsed] toggle't
    document.addEventListener('click', (ev) => {
      const head = ev.target && ev.target.closest && ev.target.closest('.ma-card-head');
      if (!head) return;
      const card = head.parentElement;
      if (!card || !card.hasAttribute('data-collapsed')) return;
      // Klicks auf Buttons/Inputs im Header NICHT als Collapse werten
      if (ev.target.closest('button, input, select, a')) return;
      const cur = card.getAttribute('data-collapsed');
      card.setAttribute('data-collapsed', cur === 'true' ? 'false' : 'true');
    });

    global.MA.wsConnect();
    refreshActive();
    startAutoRefresh();
  }

  function setSplash(msg) { const el = document.getElementById('splashMsg'); if (el) el.textContent = msg; }

  function showAuthPrompt() {
    const tok = prompt('Auth erforderlich. Bitte Token eingeben:');
    if (tok) { const u = new URL(location.href); u.searchParams.set('token', tok); location.href = u.toString(); }
    else setSplash('Kein Token uebergeben.');
  }

  function onTabChange(tab) {
    activeTab = tab;
    try { const u = new URL(location.href); u.searchParams.set('tab', tab); history.replaceState(null, '', u.toString()); } catch (e) {}
    refreshActive();
  }

  function refreshActive() {
    const t = global.MA.tabs && global.MA.tabs[activeTab];
    if (t && typeof t.refresh === 'function') {
      t.refresh().catch(e => global.MA.toast('Refresh-Fehler: ' + e.message, 'bad'));
    }
    updateClientStat();
    updateBadges();
  }

  // v0.13.7: Menue-Badges aktualisieren (Adapter-Updates, Notifications, Backup-Fail).
  // Laeuft unabhaengig vom aktiven Tab damit man Updates auch sieht wenn man
  // gerade woanders ist.
  let _badgesRunning = false;
  async function updateBadges() {
    if (_badgesRunning) return;
    if (!global.MA.ui || typeof global.MA.ui.setTabBadge !== 'function') return;
    _badgesRunning = true;
    try {
      // 1) Adapter-Updates -> Badge an REPOSITORY
      try {
        const repo = await global.MA.api.listRepo();
        const items = (repo && repo.items) || repo || [];
        const updates = Array.isArray(items) ? items.filter(x => x && x.updateAvailable).length : 0;
        global.MA.ui.setTabBadge('repo', updates, 'warn');
      } catch (e) { /* ignore */ }

      // 2) Offene Notifications -> Badge an UEBERSICHT
      try {
        const n = await global.MA.api.listNotifications();
        if (n && !n.disabled) {
          const cnt = (n.items || []).length;
          // Schwere bestimmen: wenn irgendeine alert/error -> err sonst info
          const hasAlert = (n.items || []).some(it => it.severity === 'alert' || it.severity === 'error');
          global.MA.ui.setTabBadge('dashboard', cnt, hasAlert ? 'err' : 'info');
        }
      } catch (e) { /* ignore */ }

      // 3) Backup-Status -> Badge an BACKUP.
      // ioBroker meldet Backup-Fehler als Notification (scope backitup/system).
      // Plus: wenn das neueste Backup-File aelter als 48h ist -> Warnung.
      try {
        let backupBadge = 0, backupKind = 'info';
        // a) Notification mit backup-Bezug?
        const n2 = await global.MA.api.listNotifications();
        if (n2 && !n2.disabled) {
          const backupNotif = (n2.items || []).some(it =>
            /backup|backitup/i.test((it.category || '') + ' ' + (it.scope || '') + ' ' + (it.description || '')));
          if (backupNotif) { backupBadge = '!'; backupKind = 'err'; }
        }
        // b) Neuestes Backup zu alt?
        if (!backupBadge) {
          const b = await global.MA.api.listBackups();
          const files = (b && b.files) || [];
          if (files.length) {
            // files koennen {name, mtime} oder nur Strings sein
            let newest = 0;
            files.forEach(f => {
              const t = (f && (f.modified || f.mtime)) ? new Date(f.modified || f.mtime).getTime() : 0;
              if (t > newest) newest = t;
            });
            if (newest > 0) {
              const ageH = (Date.now() - newest) / 3600000;
              if (ageH > 48) { backupBadge = '!'; backupKind = 'warn'; }
            }
          }
        }
        global.MA.ui.setTabBadge('backup', backupBadge, backupKind);
      } catch (e) { /* ignore */ }
    } finally {
      _badgesRunning = false;
    }
  }

  async function updateClientStat() {
    try {
      const st = await global.MA.api.getState('fid-bridge.0.info.clients');
      const el = document.getElementById('statClients');
      if (el && st) el.textContent = st.val;
    } catch (e) {}
  }

  function startAutoRefresh() {
    if (refreshHandle) { clearInterval(refreshHandle); refreshHandle = null; }
    const sec = Number(localStorage.getItem(REFRESH_KEY));
    if (!Number.isFinite(sec) || sec <= 0) return;
    refreshHandle = setInterval(() => { if (global.MA.isConnected()) refreshActive(); }, sec * 1000);
  }
})(window);
