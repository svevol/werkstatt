const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('he', {
  openProject: () => ipcRenderer.invoke('project:open'),
  openProjectPath: (dir) => ipcRenderer.invoke('project:openPath', dir),
  // Electron >=32 removed File.path; the real path is only available here.
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || null; } catch { return null; }
  },
  demoPath: () => ipcRenderer.invoke('project:demoPath'),
  gitInfo: (dir) => ipcRenderer.invoke('project:gitInfo', dir),
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
});
