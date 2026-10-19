const { contextBridge, ipcRenderer, webUtils } = require('electron');

const heApi = {
  openProject: () => ipcRenderer.invoke('project:open'),
  openProjectPath: (dir) => ipcRenderer.invoke('project:openPath', dir),
  // Electron >=32 removed File.path; the real path is only available here.
  // Reading the path also registers the file as a dialog-approved copyInto
  // source: main only copies files that went through a user pick.
  pathForFile: async (file) => {
    try {
      const p = webUtils.getPathForFile(file);
      if (p && ipcRenderer) {
        try { await ipcRenderer.invoke('file:pickup:approve', p, file && file.size); } catch { /* approval is best-effort */ }
      }
      return p || null;
    } catch { return null; }
  },
  demoPath: () => ipcRenderer.invoke('project:demoPath'),
  gitInfo: (dir) => ipcRenderer.invoke('project:gitInfo', dir),
  gitStatus: (dir) => ipcRenderer.invoke('project:gitStatus', dir),
  getRecent: () => ipcRenderer.invoke('project:getRecent'),
  baseUrl: () => ipcRenderer.invoke('project:baseUrl'),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  writeFile: (p, content) => ipcRenderer.invoke('file:write', p, content),
  statFile: (p) => ipcRenderer.invoke('file:stat', p),
  writeFileChecked: (p, content, expected) => ipcRenderer.invoke('file:writeChecked', p, content, expected),
  exists: (p) => ipcRenderer.invoke('file:exists', p),
  copyInto: (srcAbs, destRel) => ipcRenderer.invoke('file:copyInto', srcAbs, destRel),
  selfhostFonts: (families) => ipcRenderer.invoke('fonts:selfhost', families),
  openFile: (p) => ipcRenderer.invoke('file:openExternal', p),
  agentPrompt: () => ipcRenderer.invoke('app:agentPrompt'),
  versions: {
    list: (dir) => ipcRenderer.invoke('versions:list', dir),
    snapshot: (payload) => ipcRenderer.invoke('versions:snapshot', payload),
    get: (dir, id) => ipcRenderer.invoke('versions:get', dir, id),
    createBranch: (dir, name) => ipcRenderer.invoke('versions:createBranch', dir, name),
    switchBranch: (dir, name) => ipcRenderer.invoke('versions:switchBranch', dir, name),
  },
  setDirty: (dirty, pages) => ipcRenderer.invoke('app:setDirty', dirty, pages),
  confirmDiscard: (message) => ipcRenderer.invoke('app:confirmDiscard', message),
  confirmLeave: (message) => ipcRenderer.invoke('app:confirmLeave', message),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  drafts: {
    write: (payload) => ipcRenderer.invoke('drafts:write', payload),
    read: (dir, page) => ipcRenderer.invoke('drafts:read', dir, page),
    clear: (dir, page) => ipcRenderer.invoke('drafts:clear', dir, page),
    list: (dir, pages) => ipcRenderer.invoke('drafts:list', dir, pages),
    clearAll: (dir) => ipcRenderer.invoke('drafts:clearAll', dir),
  },
  confirmRestore: (when) => ipcRenderer.invoke('app:confirmRestore', when),
  confirmExternalConflict: (paths) => ipcRenderer.invoke('app:confirmExternalConflict', paths),
  onProjectChange: (fn) => {
    ipcRenderer.on('project:external-change', (_e, payload) => fn(payload));
  },
  onMenu: (channel, fn) => {
    const map = {
      open: 'menu:open',
      openDemo: 'menu:open-demo',
      save: 'menu:save',
      undo: 'menu:undo',
      redo: 'menu:redo',
      mode: 'menu:mode',
    };
    const ipcChannel = map[channel];
    if (!ipcChannel) return;
    ipcRenderer.on(ipcChannel, (_e, ...args) => fn(...args));
  },
};

contextBridge.exposeInMainWorld('he', heApi);

// --- Editor-shell relay (preview-frame isolation) ---
//
// Preload scripts run only in the top frame (the shell document), so the
// editor frame (hesite://app) reaches IPC through this relay: the shell
// document forwards {__heCall} envelopes to `call` and posts responses/pushes
// back into the editor frame via the callback the shell provides. Responses
// and pushes only ever flow between the shell and the editor frame — a page
// inside the preview canvas cannot join because the shell verifies
// `event.source` is the editor frame window before calling into the bridge.

contextBridge.exposeInMainWorld('heRelay', {
  // The shell document passes `respond` (its toEditor callback); contextBridge
  // binds it into the isolated world where ipcRenderer lives.
  call: (d, respond) => {
    const post = (ok, payload) => {
      try {
        respond({ __heResp: d && d.tid, ok, res: payload });
      } catch { /* shell/iframe torn down */ }
    };
    if (!d || d.__heCall !== 1 || typeof d.ch !== 'string') {
      post(false, new Error('Invalid bridge call'));
      return;
    }
    // Resolve `ch` against the same surface exposed as `he` above: e.g.
    // "versions.list" -> he.versions.list. Adding API here automatically
    // extends the relay; no second channel table exists. Each segment must
    // be a real property of the object above it — `__proto__`,
    // `constructor`, and `prototype` are refused so a crafted channel can
    // never walk off the API surface (e.g. into Function).
    let target = heApi;
    for (const key of String(d.ch).split('.')) {
      if (target == null || (typeof target !== 'object' && typeof target !== 'function')) {
        target = undefined;
        break;
      }
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        target = undefined;
        break;
      }
      target = target[key];
    }
    if (typeof target !== 'function') {
      post(false, new Error(`Unknown bridge method: ${d.ch}`));
      return;
    }
    try {
      Promise.resolve(target(...(Array.isArray(d.args) ? d.args : [])))
        .then((res) => post(true, res))
        .catch((err) => post(false, err));
    } catch (err) {
      post(false, err);
    }
  },
  onPush: (fn) => {
    if (typeof fn !== 'function') return;
    const wire = (channel) => ipcRenderer.on(channel, (_e, ...args) => {
      try { fn({ __hePush: channel, args }); } catch { /* shell is gone */ }
    });
    wire('project:external-change');
    ['open', 'open-demo', 'save', 'undo', 'redo', 'mode'].forEach((k) => wire(`menu:${k}`));
  },
});
