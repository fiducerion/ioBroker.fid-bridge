(function (global) {
  'use strict';

  const listeners = {};
  function on(ev, fn)   { (listeners[ev] = listeners[ev] || []).push(fn); }
  function off(ev, fn)  { listeners[ev] = (listeners[ev] || []).filter(x => x !== fn); }
  function emit(ev, p)  { (listeners[ev] || []).forEach(fn => { try { fn(p); } catch (e) { console.warn(e); } }); }

  const state = { token: '', wsConnected: false, retryMs: 1000 };
  function setToken(t) { state.token = t || ''; }

  async function req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include' // Session-Cookie mitschicken
    };
    if (state.token) opts.headers['Authorization'] = 'Bearer ' + state.token;
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    const text = await r.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
    if (!r.ok) {
      const err = new Error((parsed && parsed.error) || ('HTTP ' + r.status));
      err.status = r.status;
      err.code = parsed && parsed.error;
      throw err;
    }
    return parsed;
  }

  const api = {
    info:        () => req('GET',    '/api/info'),
    themes:      () => req('GET',    '/api/themes'),
    systemInfo:  () => req('GET',    '/api/system/info'),
    systemHosts: () => req('GET',    '/api/system/hosts'),
    getSysConfig:  () => req('GET',  '/api/system/config'),
    saveSysConfig: (patch) => req('PUT', '/api/system/config', patch),
    getHost:    (id) => req('GET',  '/api/system/hosts/' + encodeURI(id)),
    saveHost:   (id, patch) => req('PUT', '/api/system/hosts/' + encodeURI(id), patch),

    // Auth
    authStatus:   () => req('GET',  '/api/auth/status'),
    totpSetup:    () => req('POST', '/api/auth/totp/setup'),
    totpActivate: (secret, code) => req('POST', '/api/auth/totp/activate', { secret, code }),
    totpVerify:   (code) => req('POST', '/api/auth/totp/verify', { code }),
    totpDisable:  (code) => req('POST', '/api/auth/totp/disable', { code }),
    logout:       () => req('POST', '/api/auth/logout'),

    // Objects/States
    listObjects: (params) => {
      const q = new URLSearchParams();
      if (params) Object.keys(params).forEach(k => { if (params[k] !== undefined && params[k] !== '') q.set(k, params[k]); });
      return req('GET', '/api/objects' + (q.toString() ? '?' + q.toString() : ''));
    },
    getObject:    (id) => req('GET', '/api/objects/' + encodeURI(id)),
    getState:     (id) => req('GET', '/api/states/' + encodeURI(id)),
    getStates:    (pattern) => req('GET', '/api/states?pattern=' + encodeURIComponent(pattern || '*')),
    setState:     (id, val, ack) => req('PUT', '/api/states/' + encodeURI(id), { val, ack: !!ack }),

    // Modules / Repo
    listAdapters:  () => req('GET', '/api/adapters'),
    installAdapter:   (name, version) => req('POST', '/api/adapters/install', { name, version }),
    upgradeAdapter:   (name, version) => req('POST', '/api/adapters/upgrade', { name, version }),
    uninstallAdapter: (name) => req('DELETE', '/api/adapters/' + encodeURIComponent(name)),
    listRepo:      (noCache) => req('GET', '/api/repo' + (noCache ? '?noCache=1' : '')),
    refreshRepo:   ()        => req('POST', '/api/repo/refresh', {}),
    installRepoUrl:(url)     => req('POST', '/api/repo/install-url', { url }),

    // Instances
    listInstances: (withStats) => req('GET', '/api/instances' + (withStats ? '?stats=1' : '')),
    instanceAction:     (id, action) => req('POST', '/api/instances/' + encodeURI(id) + '/' + action),
    setInstanceLogLevel:(id, level)  => req('PUT',  '/api/instances/' + encodeURI(id) + '/logLevel', { level }),
    addInstance:        (adapterName) => req('POST', '/api/instances/add', { adapter: adapterName }),
    deleteInstance:     (id) => req('DELETE', '/api/instances/' + encodeURI(id)),

    // Counts
    counts: (noCache) => req('GET', '/api/counts' + (noCache ? '?noCache=1' : '')),

    // Config
    getConfig:  (instance) => req('GET', '/api/config/' + encodeURI(instance)),
    saveConfig: (instance, native) => req('PUT', '/api/config/' + encodeURI(instance), { native }),

    // Scripts
    listScripts:  () => req('GET', '/api/scripts'),
    getScript:    (id) => req('GET', '/api/scripts/' + encodeURI(id)),
    updateScript: (id, patch) => req('PUT', '/api/scripts/' + encodeURI(id), patch),
    createScript: (payload) => req('POST', '/api/scripts', payload),
    deleteScript: (id) => req('DELETE', '/api/scripts/' + encodeURI(id)),
    renameScript: (id, newId) => req('POST', '/api/scripts/' + encodeURI(id) + '/rename', { newId }),

    // Files
    listFileNamespaces: () => req('GET', '/api/files/namespaces'),
    listFiles:          (ns, path) => req('GET', '/api/files/list?ns=' + encodeURIComponent(ns) + '&path=' + encodeURIComponent(path || '/')),
    fileUrl:            (ns, file, download) => '/api/files/get?ns=' + encodeURIComponent(ns) + '&file=' + encodeURIComponent(file) + (download ? '&download=1' : '') + (state.token ? '&token=' + encodeURIComponent(state.token) : ''),
    deleteFile:         (ns, file) => req('DELETE', '/api/files?ns=' + encodeURIComponent(ns) + '&file=' + encodeURIComponent(file)),
    uploadFile:         (ns, file, base64data) => req('PUT', '/api/files/upload', { ns, file, data: base64data, base64: true }),

    // Links
    listLinks: () => req('GET', '/api/links'),
    getCustomLinks: () => req('GET', '/api/links/custom'),
    setCustomLinks: (items) => req('PUT', '/api/links/custom', { items }),

    // Objects extras
    renameObject: (id, newId) => req('POST', '/api/objects/' + encodeURI(id) + '/rename', { newId }),
    setObjectCustom: (id, instance, config, remove) => req('PUT', '/api/objects/' + encodeURI(id) + '/custom', { instance, config, remove: !!remove }),
    deleteObject: (id) => req('DELETE', '/api/objects/' + encodeURI(id)),
    saveObject: (id, body) => req('PUT', '/api/objects/' + encodeURI(id), body),

    // Struktur (Aliase + Enums)
    listAliases:   () => req('GET',  '/api/structure/aliases'),
    createAlias:   (b) => req('POST', '/api/structure/aliases', b),
    updateAlias:   (id, b) => req('PUT',  '/api/structure/aliases/' + encodeURI(id), b),
    deleteAlias:   (id) => req('DELETE','/api/structure/aliases/' + encodeURI(id)),
    listEnums:     (cat) => req('GET', '/api/structure/enums' + (cat ? '?cat=' + encodeURIComponent(cat) : '')),
    createEnum:    (b) => req('POST', '/api/structure/enums', b),
    updateEnum:    (id, b) => req('PUT', '/api/structure/enums/' + encodeURI(id), b),
    deleteEnum:    (id) => req('DELETE', '/api/structure/enums/' + encodeURI(id)),
    enumMember:    (id, body) => req('POST', '/api/structure/enums/' + encodeURI(id) + '/members', body),

    // Notifications + Backup
    listNotifications: () => req('GET', '/api/notifications'),
    clearNotification: (body) => req('POST', '/api/notifications/clear', body),
    triggerBackup:     () => req('POST', '/api/notifications/backup'),
    listBackups:       () => req('GET', '/api/notifications/backups'),

    // Backup-Restore
    uploadBackup: (filename, base64data) => req('POST', '/api/backup-restore/upload', { filename, data: base64data, base64: true }),
    triggerRestore: (file) => req('POST', '/api/backup-restore/restore', { file }),
    deleteBackup: (file) => req('DELETE', '/api/backup-restore/file', { file }),

    // Objects Export/Import
    exportObjects: (root, includeStates) => req('GET', '/api/backup-restore/objects-export?root=' + encodeURIComponent(root) + (includeStates ? '&includeStates=1' : '')),
    importObjects: (body) => req('POST', '/api/backup-restore/objects-import', body),

    // Scripts Export/Import
    exportScripts: (id) => req('GET', '/api/backup-restore/scripts-export' + (id ? '?id=' + encodeURIComponent(id) : '')),
    importScripts: (body) => req('POST', '/api/backup-restore/scripts-import', body),

    // Users + Groups
    listUsers:    () => req('GET',  '/api/users'),
    createUser:   (body) => req('POST', '/api/users', body),
    updateUser:   (id, body) => req('PUT', '/api/users/' + encodeURI(id), body),
    deleteUser:   (id) => req('DELETE', '/api/users/' + encodeURI(id)),
    listGroups:   () => req('GET',  '/api/users/groups'),
    createGroup:  (body) => req('POST', '/api/users/groups', body),
    updateGroup:  (id, body) => req('PUT', '/api/users/groups/' + encodeURI(id), body),
    deleteGroup:  (id) => req('DELETE', '/api/users/groups/' + encodeURI(id)),

    // Globale Suche
    globalSearch: (q, limit) => req('GET', '/api/search?q=' + encodeURIComponent(q) + (limit ? '&limit=' + limit : '')),

    // Analyzer
    analyzerOverview: () => req('GET', '/api/analyzer/overview'),
    analyzerTop: (bucket, kind, level, n) => {
      const u = new URLSearchParams();
      if (bucket) u.set('bucket', bucket);
      if (kind)   u.set('kind', kind);
      if (level)  u.set('level', level);
      if (n)      u.set('n', n);
      return req('GET', '/api/analyzer/top?' + u.toString());
    },
    analyzerEvents: (params) => {
      const u = new URLSearchParams();
      if (params) Object.keys(params).forEach(k => { if (params[k] != null && params[k] !== '') u.set(k, params[k]); });
      return req('GET', '/api/analyzer/events' + (u.toString() ? '?' + u.toString() : ''));
    },
    analyzerHistory: () => req('GET', '/api/analyzer/history'),

    // Logs
    logsRecent: (limit) => req('GET', '/api/logs/recent?limit=' + (limit || 200)),

    // Backup-Schedule (Punkt 8)
    backupStatus:       ()        => req('GET',  '/api/backup-schedule/status'),
    backupSaveConfig:   (cfg)     => req('POST', '/api/backup-schedule/config', cfg),
    backupRunNow:       ()        => req('POST', '/api/backup-schedule/run-now', {}),
    backupExternalList: ()        => req('GET',  '/api/backup-schedule/external-list')
  };

  function wsConnect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const tokenQs = state.token ? ('?token=' + encodeURIComponent(state.token)) : '';
    const url = `${proto}//${location.host}/ws${tokenQs}`;
    let ws;
    try { ws = new WebSocket(url); }
    catch (e) { setTimeout(wsConnect, state.retryMs); state.retryMs = Math.min(state.retryMs * 2, 15000); return; }
    ws.onopen = () => { state.wsConnected = true; state.retryMs = 1000; emit('ws:open'); };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg && msg.type) emit('ws:' + msg.type, msg);
    };
    ws.onclose = () => { state.wsConnected = false; emit('ws:close'); setTimeout(wsConnect, state.retryMs); state.retryMs = Math.min(state.retryMs * 2, 15000); };
    ws.onerror = () => {};
  }

  global.MA = { api, on, off, emit, setToken, wsConnect, isConnected: () => state.wsConnected };
})(window);
