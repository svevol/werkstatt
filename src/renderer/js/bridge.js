// Editor-frame bridge to the shell preload.
//
// Preload scripts run only in the top frame (the shell document), so the
// editor frame (hesite://app) has no window.he of its own. This module builds
// a thin postMessage facade shaped exactly like the preload's `he` surface:
// every method sends a {__heCall} envelope to `window.parent` (the shell) and
// resolves the {__heResp} reply it posts back. The shell verifies that the
// envelope's source is this frame's window, so exclusively the editor frame
// — never a page inside the preview canvas — can drive IPC.
//
// Push messages (menu actions, external-change notices) arrive from the shell
// and are dispatched to the handlers registered through `onMenu` /
// `onProjectChange`.

function relayInvoke(ch, args) {
  return new Promise((resolve, reject) => {
    const tid = bridgeTid();
    window.__heBridgePending.set(tid, { resolve, reject });
    try {
      window.parent.postMessage({ __heCall: 1, tid, ch, args }, '*');
    } catch (err) {
      window.__heBridgePending.delete(tid);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
    // Fail safely: a torn-down shell must not leave the editor hanging.
    setTimeout(() => {
      const waiter = window.__heBridgePending.get(tid);
      if (waiter) {
        window.__heBridgePending.delete(tid);
        waiter.reject(new Error(`Bridge call timed out: ${ch}`));
      }
    }, 30000);
  });
}
function bridgeTid() {
  window.__heBridgeSeq = (window.__heBridgeSeq || 0) + 1;
  return window.__heBridgeSeq + '-' + Date.now().toString(36);
}
window.__heBridgePending = new Map();

if (!window.he) {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const d = e.data || {};
    if (typeof d.__heResp === 'undefined') return;
    const waiter = window.__heBridgePending.get(d.__heResp);
    if (!waiter) return;
    window.__heBridgePending.delete(d.__heResp);
    if (d.ok) waiter.resolve(d.res);
    else {
      const raw = d.res;
      const m = (raw && (raw.message || raw._bridgeMessage)) || (typeof raw === 'string' ? raw : '');
      waiter.reject(new Error(m || 'Bridge call failed'));
    }
  });

  const pushHandlers = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const d = e.data || {};
    const channel = typeof d.__hePush === 'string' ? d.__hePush : null;
    if (!channel) return;
    const fns = pushHandlers.get(channel);
    if (!fns) return;
    for (const fn of fns) {
      try { fn(...(d.args || [])); } catch (err) { console.error('push handler failed', channel, err); }
    }
  });

  window.he = {
    openProject: () => relayInvoke('openProject', []),
    openProjectPath: (dir) => relayInvoke('openProjectPath', [dir]),
    // Electron >=32 removed File.path; the real path is only available in the
    // shell frame. The picked File travels across postMessage and is
    // registered as an approved copyInto source at the same time.
    pathForFile: async (file) => {
      if (!file) return null;
      return relayInvoke('pathForFile', [file]);
    },
    demoPath: () => relayInvoke('demoPath', []),
    gitInfo: (dir) => relayInvoke('gitInfo', [dir]),
    gitStatus: (dir) => relayInvoke('gitStatus', [dir]),
    getRecent: () => relayInvoke('getRecent', []),
    baseUrl: () => relayInvoke('baseUrl', []),
    readFile: (p) => relayInvoke('readFile', [p]),
    writeFile: (p, content) => relayInvoke('writeFile', [p, content]),
    statFile: (p) => relayInvoke('statFile', [p]),
    writeFileChecked: (p, content, expected) => relayInvoke('writeFileChecked', [p, content, expected]),
    exists: (p) => relayInvoke('exists', [p]),
    copyInto: (srcAbs, destRel) => relayInvoke('copyInto', [srcAbs, destRel]),
    selfhostFonts: (families) => relayInvoke('selfhostFonts', [families]),
    openFile: (p) => relayInvoke('openFile', [p]),
    agentPrompt: () => relayInvoke('agentPrompt', []),
    versions: {
      list: (dir) => relayInvoke('versions.list', [dir]),
      snapshot: (payload) => relayInvoke('versions.snapshot', [payload]),
      get: (dir, id) => relayInvoke('versions.get', [dir, id]),
      createBranch: (dir, name) => relayInvoke('versions.createBranch', [dir, name]),
      switchBranch: (dir, name) => relayInvoke('versions.switchBranch', [dir, name]),
    },
    setDirty: (dirty, pages) => relayInvoke('setDirty', [dirty, pages]),
    confirmDiscard: (message) => relayInvoke('confirmDiscard', [message]),
    confirmLeave: (message) => relayInvoke('confirmLeave', [message]),
    confirmRestore: (when) => relayInvoke('confirmRestore', [when]),
    confirmExternalConflict: (paths) => relayInvoke('confirmExternalConflict', [paths]),
    settings: {
      get: () => relayInvoke('settings.get', []),
      set: (patch) => relayInvoke('settings.set', [patch]),
    },
    drafts: {
      write: (payload) => relayInvoke('drafts.write', [payload]),
      read: (dir, page) => relayInvoke('drafts.read', [dir, page]),
      clear: (dir, page) => relayInvoke('drafts.clear', [dir, page]),
      list: (dir, pages) => relayInvoke('drafts.list', [dir, pages]),
      clearAll: (dir) => relayInvoke('drafts.clearAll', [dir]),
    },
    onProjectChange: (fn) => {
      const channel = 'project:external-change';
      const list = pushHandlers.get(channel) || [];
      list.push(fn);
      pushHandlers.set(channel, list);
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
      const list = pushHandlers.get(ipcChannel) || [];
      list.push(fn);
      pushHandlers.set(ipcChannel, list);
    },
  };
}
