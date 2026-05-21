(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;

  let initialized = false;
  let pendingSecret = null;

  function init() {
    if (initialized) return;
    initialized = true;
  }

  async function refresh() {
    init();
    const wrap = $('settingsBody'); if (!wrap) return;
    wrap.innerHTML = 'Lade...';
    try {
      const [info, auth] = await Promise.all([
        global.MA.api.info(),
        global.MA.api.authStatus()
      ]);
      render(wrap, info, auth);
    } catch (e) {
      wrap.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`;
    }
  }

  function render(wrap, info, auth) {
    const allowExec = !!info.allowExec;
    wrap.innerHTML = `
      <div class="ma-settings-grid">

        <div class="ma-settings-card">
          <h3>Authentifizierung</h3>
          <div class="row"><div class="k">Token erforderlich</div><div class="v">${auth.requireAuth ? '<span class="ma-pill ma-pill-ok">an</span>' : '<span class="ma-pill">aus</span>'}</div></div>
          <div class="row"><div class="k">2FA (TOTP)</div><div class="v">${auth.requireTotp && auth.totpConfigured ? '<span class="ma-pill ma-pill-ok">aktiv</span>' : '<span class="ma-pill">inaktiv</span>'}</div></div>
          <div class="row"><div class="k">Host-Kommandos</div><div class="v">${allowExec ? '<span class="ma-pill ma-pill-ok">erlaubt</span>' : '<span class="ma-pill ma-pill-warn">deaktiviert</span>'}</div></div>
          <p class="ma-muted" style="font-size:12px; margin-top:8px;">
            Token und Host-Kommando-Schalter werden in der Adapter-Config (im Admin) verwaltet.
          </p>
        </div>

        <div class="ma-settings-card">
          <h3>2-Faktor-Authentifizierung (TOTP)</h3>
          ${
            auth.totpConfigured
              ? `<p>TOTP ist aktiv. Zum Deaktivieren bitte einen aktuellen 6-stelligen Code aus der Authenticator-App eingeben.</p>
                 <input class="ma-input" id="totpDisableCode" placeholder="000000" maxlength="6" inputmode="numeric" />
                 <button class="ma-btn" id="totpDisableBtn">Deaktivieren</button>`
              : `<p>TOTP ist nicht eingerichtet. Klicke auf "Setup starten", um ein neues Secret zu generieren und in deiner Authenticator-App (Google Authenticator, Authy, 1Password, etc.) einzurichten.</p>
                 <button class="ma-btn" id="totpSetupBtn">Setup starten</button>
                 <div id="totpSetupArea" style="margin-top:14px;"></div>`
          }
        </div>

      </div>
    `;

    if (!auth.totpConfigured) {
      $('totpSetupBtn').addEventListener('click', startSetup);
    } else {
      $('totpDisableBtn').addEventListener('click', async () => {
        const code = $('totpDisableCode').value.trim();
        if (!/^\d{6}$/.test(code)) { global.MA.toast('6-stelligen Code eingeben', 'warn'); return; }
        try {
          await global.MA.api.totpDisable(code);
          global.MA.toast('TOTP deaktiviert', 'ok');
          refresh();
        } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
      });
    }
  }

  async function startSetup() {
    const area = $('totpSetupArea');
    area.innerHTML = 'Generiere Secret...';
    try {
      const s = await global.MA.api.totpSetup();
      pendingSecret = s.secret;
      const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(s.otpauthUri)}`;
      area.innerHTML = `
        <div class="ma-totp-setup">
          <div class="ma-totp-qr-wrap">
            <img src="${qrSrc}" alt="QR-Code" class="ma-totp-qr" />
            <p class="ma-muted" style="font-size:11px;">Falls QR-Code nicht laedt (kein Internet): Secret manuell in die Authenticator-App eintragen.</p>
          </div>
          <div class="ma-totp-secret-wrap">
            <div class="row"><div class="k">Secret</div><div class="v ma-mono">${escapeHtml(s.secret)}</div></div>
            <div class="row"><div class="k">URI</div><div class="v ma-mono" style="font-size:11px; word-break:break-all;">${escapeHtml(s.otpauthUri)}</div></div>
            <p>Nach dem Scannen / Eintragen bitte den 6-stelligen Code aus der App eingeben, um zu bestätigen:</p>
            <input class="ma-input" id="totpActCode" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code" />
            <button class="ma-btn ma-btn-block" id="totpActBtn">Aktivieren</button>
          </div>
        </div>
      `;
      $('totpActBtn').addEventListener('click', async () => {
        const code = $('totpActCode').value.trim();
        if (!/^\d{6}$/.test(code)) { global.MA.toast('6-stelligen Code eingeben', 'warn'); return; }
        try {
          await global.MA.api.totpActivate(pendingSecret, code);
          global.MA.toast('TOTP aktiviert. Session ist verifiziert.', 'ok');
          refresh();
        } catch (e) { global.MA.toast('Code falsch: ' + e.message, 'bad'); }
      });
    } catch (e) { area.innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`; }
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.settings = { init, refresh };
})(window);
