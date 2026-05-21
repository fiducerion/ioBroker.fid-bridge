(function (global) {
  'use strict';
  const { $, escapeHtml } = global.MA.ui;
  let initialized = false;
  let namespaces = [];
  let currentNs = '';
  let currentPath = '/';

  function init() {
    if (initialized) return;
    initialized = true;
    $('flReload') && $('flReload').addEventListener('click', () => load());
    $('flNs')     && $('flNs').addEventListener('change', () => { currentNs = $('flNs').value; currentPath = '/'; load(); });
    $('flUpload') && $('flUpload').addEventListener('click', () => $('flUploadInput').click());
    $('flUploadInput') && $('flUploadInput').addEventListener('change', onUpload);
  }

  async function refresh() {
    init();
    if (!namespaces.length) {
      try {
        const r = await global.MA.api.listFileNamespaces();
        namespaces = r.namespaces || [];
        const sel = $('flNs');
        sel.innerHTML = '<option value="">— wähle Namespace —</option>' +
          namespaces.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
      } catch (e) {
        $('flBody').innerHTML = `<div class="ma-muted">Fehler beim Laden der Namespaces: ${escapeHtml(e.message)}</div>`;
        return;
      }
    }
    if (currentNs) await load();
  }

  async function load() {
    if (!currentNs) { $('flBody').innerHTML = '<div class="ma-muted">Bitte einen Namespace wählen.</div>'; return; }
    $('flBody').innerHTML = '<div class="ma-muted">Lade...</div>';
    try {
      const r = await global.MA.api.listFiles(currentNs, currentPath);
      render(r);
    } catch (e) {
      $('flBody').innerHTML = `<div class="ma-muted">Fehler: ${escapeHtml(e.message)}</div>`;
    }
  }

  function render(r) {
    const body = $('flBody');
    const crumbs = renderCrumbs();
    const rows = (r.items || []).map(it => {
      const fullPath = (currentPath === '/' ? '' : currentPath.replace(/\/$/, '')) + '/' + it.file;
      const cleanPath = fullPath.replace(/^\/+/, '');
      const icon = it.isDir ? '📁' : iconFor(it.file);
      const size = it.size != null ? fmtBytes(it.size) : '';
      const modified = it.modified ? fmtDate(it.modified) : '';
      const dlUrl = !it.isDir ? global.MA.api.fileUrl(currentNs, cleanPath, true) : '';
      const viewUrl = !it.isDir ? global.MA.api.fileUrl(currentNs, cleanPath, false) : '';
      return `<tr class="${it.isDir ? 'fl-dir' : 'fl-file'}">
        <td class="fl-icon">${icon}</td>
        <td class="fl-name">${it.isDir
          ? `<a href="#" data-dir="${escapeHtml(cleanPath)}">${escapeHtml(it.file)}/</a>`
          : `<span>${escapeHtml(it.file)}</span>`}</td>
        <td class="ma-muted">${size}</td>
        <td class="ma-muted">${escapeHtml(modified)}</td>
        <td class="fl-actions">${it.isDir
          ? ''
          : `<a class="ma-btn ma-btn-ghost ma-btn-xs" href="${escapeHtml(viewUrl)}" target="_blank" rel="noopener">Öffnen</a>
             <a class="ma-btn ma-btn-ghost ma-btn-xs" href="${escapeHtml(dlUrl)}" download>↓</a>
             <button class="ma-btn ma-btn-ghost ma-btn-xs ma-btn-danger expert-only" data-del="${escapeHtml(cleanPath)}">×</button>`}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      ${crumbs}
      <div class="ma-table-scroll" style="max-height:none">
        <table class="ma-table fl-table">
          <thead><tr><th></th><th>Name</th><th>Größe</th><th>Geändert</th><th style="text-align:right">Aktionen</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="ma-muted">Leer</td></tr>'}</tbody>
        </table>
      </div>
    `;

    body.querySelectorAll('a[data-dir]').forEach(a => {
      a.addEventListener('click', (ev) => { ev.preventDefault(); currentPath = '/' + a.dataset.dir.replace(/^\/+/, ''); load(); });
    });
    body.querySelectorAll('a[data-crumb]').forEach(a => {
      a.addEventListener('click', (ev) => { ev.preventDefault(); currentPath = a.dataset.crumb || '/'; load(); });
    });
    body.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.dataset.del;
        if (!confirm(`Datei wirklich löschen?\n${currentNs}/${path}`)) return;
        try {
          await global.MA.api.deleteFile(currentNs, path);
          global.MA.toast('Datei gelöscht', 'ok');
          load();
        } catch (e) { global.MA.toast('Fehler: ' + e.message, 'bad'); }
      });
    });
  }

  function renderCrumbs() {
    const parts = currentPath.split('/').filter(Boolean);
    let acc = '/';
    let html = `<div class="fl-crumbs"><span class="ma-muted">${escapeHtml(currentNs)}</span> <a href="#" data-crumb="/">/</a>`;
    for (let i = 0; i < parts.length; i++) {
      acc = acc + parts[i] + '/';
      html += ` <a href="#" data-crumb="${escapeHtml(acc)}">${escapeHtml(parts[i])}</a> /`;
    }
    html += '</div>';
    return html;
  }

  async function onUpload(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file || !currentNs) return;
    const targetPath = (currentPath === '/' ? '' : currentPath.replace(/\/$/, '')) + '/' + file.name;
    const targetClean = targetPath.replace(/^\/+/, '');
    try {
      const b64 = await fileToBase64(file);
      await global.MA.api.uploadFile(currentNs, targetClean, b64);
      global.MA.toast(`Datei hochgeladen: ${file.name}`, 'ok');
      load();
    } catch (e) { global.MA.toast('Upload-Fehler: ' + e.message, 'bad'); }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = () => { const s = String(r.result); const idx = s.indexOf(','); resolve(idx >= 0 ? s.slice(idx + 1) : s); };
      r.onerror = () => reject(new Error('FileReader-Fehler'));
      r.readAsDataURL(file);
    });
  }

  function iconFor(name) {
    const ext = String(name).toLowerCase().split('.').pop();
    if (['json','js','mjs','ts','css','html','htm','xml','md','yml','yaml'].includes(ext)) return '📄';
    if (['png','jpg','jpeg','gif','svg','webp','ico'].includes(ext)) return '🖼';
    if (['pdf'].includes(ext)) return '📕';
    if (['zip','tar','gz','7z'].includes(ext)) return '📦';
    if (['mp3','wav','ogg'].includes(ext)) return '🎵';
    if (['mp4','webm','mkv','mov'].includes(ext)) return '🎬';
    return '📄';
  }

  function fmtBytes(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(2) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function fmtDate(v) {
    try { return new Date(v).toLocaleString('de-DE'); } catch (e) { return String(v); }
  }

  global.MA = global.MA || {};
  global.MA.tabs = global.MA.tabs || {};
  global.MA.tabs.files = { init, refresh };
})(window);
