/* TOTP-Modal: Blockiert die App, bis 6-stelliger Code eingegeben ist.
 */
(function (global) {
  'use strict';
  let modalEl = null;
  let inputEl = null;
  let submitBtn = null;
  let errEl = null;
  let onOk = null;

  function ensure() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.className = 'ma-modal-overlay ma-modal-blocking';
    modalEl.innerHTML = `
      <div class="ma-modal ma-modal-totp">
        <div class="ma-modal-head">
          <img src="/assets/logo.png" alt="" style="width:24px;height:24px;border-radius:5px;flex:0 0 24px;" />
          <div class="ma-modal-title">2-Faktor-Authentifizierung</div>
        </div>
        <div class="ma-modal-body">
          <p>Bitte den aktuellen 6-stelligen Code aus deiner Authenticator-App eingeben.</p>
          <input class="ma-input ma-totp-input" id="totpInput" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000" />
          <div class="ma-totp-err" id="totpErr"></div>
          <button class="ma-btn ma-btn-block" id="totpSubmit">Bestätigen</button>
          <p style="margin-top:14px; font-size:12px; color:#98a0aa; line-height:1.4;">
            Bei Problemen kann 2FA per SSH ausgeschaltet werden:<br>
            <code style="font-size:11px;">iobroker object set system.adapter.fid-bridge.0 --field native.requireTotp --value false</code>
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
    inputEl = modalEl.querySelector('#totpInput');
    submitBtn = modalEl.querySelector('#totpSubmit');
    errEl = modalEl.querySelector('#totpErr');
    submitBtn.addEventListener('click', submit);
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    inputEl.addEventListener('input', () => { errEl.textContent = ''; });
  }

  async function submit() {
    const code = inputEl.value.trim();
    if (!/^\d{6}$/.test(code)) { errEl.textContent = 'Bitte 6 Ziffern eingeben.'; return; }
    submitBtn.disabled = true;
    errEl.textContent = '';
    try {
      await global.MA.api.totpVerify(code);
      // Session-Cookie ist gesetzt. Statt komplizierten Boot-Resume-Flow:
      // einfach neu laden. Beim naechsten Boot ist totpVerified=true, App startet sauber.
      location.reload();
    } catch (e) {
      errEl.textContent = 'Code falsch oder abgelaufen.';
      inputEl.select();
      submitBtn.disabled = false;
    }
  }

  function show(cb) { ensure(); onOk = cb; errEl.textContent = ''; inputEl.value = ''; modalEl.classList.add('open'); setTimeout(() => inputEl.focus(), 50); }
  function hide() { if (modalEl) modalEl.classList.remove('open'); onOk = null; }

  global.MA = global.MA || {};
  global.MA.totp = { show, hide };
})(window);
