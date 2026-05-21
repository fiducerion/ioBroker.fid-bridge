(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;

  let initialized = false;
  let users = [];
  let groups = [];

  function init() {
    if (initialized) return;
    initialized = true;
    $('usrReload')  && $('usrReload').addEventListener('click', refresh);
    $('usrNew')     && $('usrNew').addEventListener('click', openNewUserDialog);
    $('grpNew')     && $('grpNew').addEventListener('click', openNewGroupDialog);
  }

  async function refresh() {
    init();
    try {
      const [u, g] = await Promise.all([
        global.MA.api.listUsers().catch(() => ({ items: [] })),
        global.MA.api.listGroups().catch(() => ({ items: [] }))
      ]);
      users = u.items || [];
      groups = g.items || [];
      renderUsers();
      renderGroups();
    } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
  }

  function renderUsers() {
    const body = $('usrBody'); if (!body) return;
    if (!users.length) { body.innerHTML = '<div class="ma-muted">Keine Benutzer.</div>'; return; }
    body.innerHTML = `
      <table class="ma-table">
        <thead><tr><th>Name</th><th>Status</th><th>Passwort</th><th>Gruppen</th><th style="text-align:right">Aktion</th></tr></thead>
        <tbody>${users.map(u => `
          <tr>
            <td class="ma-mono">${escapeHtml(u.name)}${u.isSystemUser ? ' <span class="ma-pill ma-pill-info" style="font-size:10px">system</span>' : ''}</td>
            <td><span class="ma-pill ${u.enabled ? 'ma-pill-ok' : ''}">${u.enabled ? 'aktiv' : 'aus'}</span></td>
            <td class="ma-muted">${u.hasPassword ? 'gesetzt' : '—'}</td>
            <td class="ma-mono ma-muted" style="font-size:11px;">${(u.groups || []).map(g => escapeHtml(g.replace(/^system\.group\./, ''))).join(', ') || '—'}</td>
            <td style="text-align:right; white-space:nowrap;">
              <button class="ma-btn ma-btn-ghost ma-btn-xs" data-u-edit="${escapeHtml(u.id)}">✎</button>
              <button class="ma-btn ma-btn-ghost ma-btn-xs" data-u-pw="${escapeHtml(u.id)}">🔑 Passwort</button>
              ${u.isSystemUser ? '' : `<button class="ma-btn ma-btn-ghost ma-btn-xs ma-btn-danger expert-only" data-u-del="${escapeHtml(u.id)}">🗑</button>`}
            </td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
    body.querySelectorAll('button[data-u-edit]').forEach(b => b.addEventListener('click', () => openEditUserDialog(b.dataset.uEdit)));
    body.querySelectorAll('button[data-u-pw]').forEach(b => b.addEventListener('click', () => openPasswordDialog(b.dataset.uPw)));
    body.querySelectorAll('button[data-u-del]').forEach(b => b.addEventListener('click', () => deleteUser(b.dataset.uDel)));
  }

  function renderGroups() {
    const body = $('grpBody'); if (!body) return;
    if (!groups.length) { body.innerHTML = '<div class="ma-muted">Keine Gruppen.</div>'; return; }
    body.innerHTML = groups.map(g => `
      <div class="grp-card">
        <div class="grp-head">
          <strong>${escapeHtml(g.name)}</strong>
          <span class="ma-muted ma-mono" style="font-size:11px;">${escapeHtml(g.id.replace(/^system\.group\./, ''))}</span>
          ${g.isSystem ? '<span class="ma-pill ma-pill-info" style="font-size:10px">system</span>' : ''}
          <span class="enum-count">${(g.members || []).length} Benutzer</span>
          <span class="enum-actions">
            <button class="ma-btn ma-btn-ghost ma-btn-xs" data-g-edit="${escapeHtml(g.id)}">✎</button>
            ${g.isSystem ? '' : `<button class="ma-btn ma-btn-ghost ma-btn-xs ma-btn-danger expert-only" data-g-del="${escapeHtml(g.id)}">🗑</button>`}
          </span>
        </div>
        ${g.description ? `<div class="ma-muted" style="font-size:11px; padding: 0 14px 6px;">${escapeHtml(g.description)}</div>` : ''}
        <div class="enum-members">
          ${(g.members || []).map(m => `<span class="enum-member"><span class="ma-mono">${escapeHtml(m.replace(/^system\.user\./, ''))}</span></span>`).join('') || '<span class="ma-muted">— leer —</span>'}
        </div>
      </div>
    `).join('');
    body.querySelectorAll('button[data-g-edit]').forEach(b => b.addEventListener('click', () => openEditGroupDialog(b.dataset.gEdit)));
    body.querySelectorAll('button[data-g-del]').forEach(b => b.addEventListener('click', () => deleteGroup(b.dataset.gDel)));
  }

  // ---- Dialoge ----
  function openNewUserDialog() {
    const name = prompt('Neuer Benutzer\n\nName (Klein-/Großbuchstaben, Ziffern, _, ., -):', '');
    if (!name) return;
    const password = prompt('Passwort (kann leer bleiben):', '');
    if (password === null) return;
    (async () => {
      try {
        await global.MA.api.createUser({ name, password: password || undefined, enabled: true });
        global.MA.toast('Benutzer angelegt', 'ok');
        refresh();
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function openEditUserDialog(id) {
    const u = users.find(x => x.id === id); if (!u) return;
    const enabled = confirm(`Benutzer ${u.name}\n\nAktuelle Status: ${u.enabled ? 'aktiv' : 'aus'}\n\nOK = aktiv, Abbrechen = aus`);
    (async () => {
      try {
        await global.MA.api.updateUser(id, { enabled });
        global.MA.toast('Geändert', 'ok');
        refresh();
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function openPasswordDialog(id) {
    const u = users.find(x => x.id === id); if (!u) return;
    const password = prompt(`Neues Passwort für ${u.name}:\n\n(Leer = altes Passwort behalten)`, '');
    if (!password) return;
    (async () => {
      try {
        await global.MA.api.updateUser(id, { password });
        global.MA.toast('Passwort gesetzt', 'ok');
        refresh();
      } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function deleteUser(id) {
    const u = users.find(x => x.id === id); if (!u) return;
    if (!confirm(`Benutzer ${u.name} wirklich löschen?\n\nAus allen Gruppen entfernt und gelöscht.`)) return;
    (async () => {
      try { await global.MA.api.deleteUser(id); global.MA.toast('Gelöscht', 'ok'); refresh(); }
      catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function openNewGroupDialog() {
    const name = prompt('Neue Gruppe\n\nName:', '');
    if (!name) return;
    const description = prompt('Beschreibung (optional):', '') || '';
    (async () => {
      try { await global.MA.api.createGroup({ name, description }); global.MA.toast('Gruppe angelegt', 'ok'); refresh(); }
      catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function openEditGroupDialog(id) {
    const g = groups.find(x => x.id === id); if (!g) return;
    // Members als komma-separierte Liste editieren
    const currentMembers = (g.members || []).map(m => m.replace(/^system\.user\./, '')).join(', ');
    const newMembersStr = prompt(`Gruppe: ${g.name}\n\nMitglieder (Benutzernamen, komma-separiert):\n\nVerfügbare Benutzer: ${users.map(u => u.id.replace(/^system\.user\./, '')).join(', ')}`, currentMembers);
    if (newMembersStr === null) return;
    const members = newMembersStr.split(',').map(s => s.trim()).filter(Boolean).map(n => 'system.user.' + n.toLowerCase());
    (async () => {
      try { await global.MA.api.updateGroup(id, { members }); global.MA.toast('Geändert', 'ok'); refresh(); }
      catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  function deleteGroup(id) {
    const g = groups.find(x => x.id === id); if (!g) return;
    if (!confirm(`Gruppe ${g.name} wirklich löschen?\n\nMitglieder werden nicht gelöscht, nur die Zuordnung.`)) return;
    (async () => {
      try { await global.MA.api.deleteGroup(id); global.MA.toast('Gelöscht', 'ok'); refresh(); }
      catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
    })();
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.users = { init, refresh };
})(window);
