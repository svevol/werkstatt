// werkstatt — Electron main process
// Owns all file-system access; the renderer talks to files only through IPC.

const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const fsNative = require('node:fs');
const { execFile } = require('node:child_process');
const { normalizeRel, isIgnoredRel, stampOf, sameStamp, classifyStamp, isSelfWrite } = require('./watchstore');
const { assertInsideRoot, assertWriteTarget, hesitePathFromUrlPath, isGoogleFontFileUrl } = require('./projectpaths');

const SMOKE = process.argv.includes('--smoke');
const STATE_FILE = () => path.join(app.getPath('userData'), 'state.json');

let mainWindow = null;
let projectRoot = null; // absolute path, no trailing sep
let rendererDirty = false;
let rendererDirtyPages = []; // project-relative page names with unsaved drafts
let allowQuit = false;
let closingPrompt = false;

// Must run before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'hesite',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      // Kept deliberately: project files are served behind hesite://, and
      // authored HTML that carries its own CSP meta would otherwise block its
      // own assets/scripts inside the preview canvas — hesite:// is the only
      // way a project file loads as a document, so bypassCSP stays.
      bypassCSP: true,
    },
  },
]);

function statePath() {
  return STATE_FILE();
}

async function readState() {
  try {
    const raw = await fs.readFile(statePath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { recent: [], settings: { ...DEFAULT_SETTINGS } };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(statePath()), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8');
}

async function pushRecent(dir) {
  const state = await readState();
  const recent = [dir, ...(state.recent || []).filter((d) => d !== dir)].slice(0, 8);
  state.recent = recent;
  state.lastProject = dir;
  await writeState(state);
  return recent;
}

// Lexical check first, then the nearest existing path (the target itself for
// reads, the closest existing parent for new-file writes). A symlink inside
// the project — including a broken one, which a later write would follow —
// must not point outside the folder.
async function assertInsideProject(full) {
  if (!projectRoot) throw new Error('No project open');
  try {
    const st = await fs.stat(projectRoot);
    if (!st.isDirectory()) throw new Error('Project folder is missing');
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('Project folder is missing');
    throw err;
  }
  await assertInsideRoot(projectRoot, full);
}

// O_NOFOLLOW is POSIX-only; on Windows a final-component symlink is caught by
// assertWriteTarget's lstat instead.
const O_NOFOLLOW = fsNative.constants.O_NOFOLLOW || 0;

// Project-file write that refuses to follow a symlink swapped in at the
// final path component between the check and the open: the fd is created
// with O_NOFOLLOW, so a symlink target in the way fails with ELOOP instead
// of being written through.
async function writeFileGuarded(full, data) {
  let mode = 0o644;
  try {
    const st = await fs.lstat(full);
    if (st.isSymbolicLink()) throw new Error('Path outside project');
    mode = st.mode & 0o777 || 0o644;
  } catch (err) {
    if (err instanceof Error && err.message === 'Path outside project') throw err;
    /* new file */
  }
  const fh = await fs.promises.open(full, fsNative.constants.O_WRONLY | fsNative.constants.O_CREAT | fsNative.constants.O_TRUNC | O_NOFOLLOW, mode);
  try {
    // fd.fstat() describes the inode that will actually receive the bytes;
    // comparing it with the disc stat proves no swap happened in between.
    await fh.writeFile(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  } finally {
    await fh.close();
  }
}

function requirePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Invalid path');
  return value;
}

function requireText(value) {
  if (typeof value !== 'string') throw new Error('File content must be text');
  return value;
}

async function safeResolve(relOrAbs) {
  const full = path.resolve(projectRoot, relOrAbs);
  await assertInsideProject(full);
  return full;
}

async function walkDir(dir, base, pages, stylesheets) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.name === 'node_modules') continue;
    if (e.isDirectory()) {
      await walkDir(path.join(dir, e.name), base, pages, stylesheets);
      continue;
    }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    const rel = path.relative(base, path.join(dir, e.name));
    if (ext === '.html' || ext === '.htm') pages.push(rel);
    if (ext === '.css') stylesheets.push(rel);
  }
}

async function listSiteFiles(dir) {
  const pages = [];
  const stylesheets = [];
  await walkDir(dir, dir, pages, stylesheets);
  pages.sort();
  stylesheets.sort();
  return { pages, stylesheets };
}

// --- External-change watch (agent/tool writes while the folder is open) ---
//
// The renderer keeps an authored page/CSS in memory; an AI agent run between
// edits can rewrite those files on disk. A recursive watcher reports batched
// changes to the renderer so it can warn before a Save overwrites fresher
// files. Every editor-initiated write is registered first so the watcher never
// reports the user's own Save.

let projectWatcher = null;
const projectStamps = new Map(); // rel -> { mtimeMs, size }
const selfWrites = new Map(); // rel -> { stamp, at }
const watchTimers = new Map(); // rel -> timeout

async function walkAllFiles(dir, base, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.name === 'node_modules') continue;
    if (e.isDirectory()) {
      await walkAllFiles(path.join(dir, e.name), base, out);
      continue;
    }
    if (e.isFile()) out.push(path.relative(base, path.join(dir, e.name)));
  }
  return out;
}

function stopProjectWatch() {
  if (projectWatcher) {
    try { projectWatcher.close(); } catch { /* already closed */ }
    projectWatcher = null;
  }
  for (const timer of watchTimers.values()) clearTimeout(timer);
  watchTimers.clear();
  projectStamps.clear();
  selfWrites.clear();
}

// Remember a write the editor just made so the watcher ignores its echo.
function registerSelfWrite(rel, stat) {
  const key = normalizeRel(rel);
  if (!key) return;
  selfWrites.set(key, { stamp: stampOf(stat), at: Date.now() });
}

async function registerSelfWritePath(full) {
  if (!projectRoot) return;
  try {
    const st = await fs.stat(full);
    registerSelfWrite(path.relative(projectRoot, full), st);
  } catch { /* best-effort */ }
}

function sendExternalChange(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.webContents.send('project:external-change', payload); } catch { /* window gone */ }
}

async function handleWatchEvent(rel) {
  if (!projectRoot) return;
  const key = normalizeRel(rel);
  if (!key || isIgnoredRel(key)) return;
  const full = path.join(projectRoot, key);
  let next = null;
  try { next = stampOf(await fs.stat(full)); } catch { next = null; }
  const prev = projectStamps.get(key) || null;
  if (next && isSelfWrite(selfWrites, key, next, Date.now())) {
    projectStamps.set(key, next);
    return;
  }
  const kind = classifyStamp(prev, next);
  if (!kind) return;
  if (next) projectStamps.set(key, next);
  else projectStamps.delete(key);
  let files = { pages: [], stylesheets: [] };
  try { files = await listSiteFiles(projectRoot); } catch { /* keep previous lists */ }
  sendExternalChange({ changes: [{ path: key, kind }], pages: files.pages, stylesheets: files.stylesheets });
}

function queueWatchEvent(filename) {
  const key = normalizeRel(filename);
  if (!key || isIgnoredRel(key)) return;
  const existing = watchTimers.get(key);
  if (existing) clearTimeout(existing);
  watchTimers.set(key, setTimeout(() => {
    watchTimers.delete(key);
    void handleWatchEvent(key);
  }, 150));
}

async function startProjectWatch() {
  stopProjectWatch();
  if (SMOKE || !projectRoot) return;
  try {
    const all = await walkAllFiles(projectRoot, projectRoot, []);
    for (const rel of all) {
      try {
        projectStamps.set(normalizeRel(rel), stampOf(await fs.stat(path.join(projectRoot, rel))));
      } catch { /* vanished during seed */ }
    }
    projectWatcher = fsNative.watch(projectRoot, { recursive: true }, (_event, filename) => {
      if (filename) queueWatchEvent(String(filename));
    });
    projectWatcher.on('error', () => stopProjectWatch());
  } catch {
    projectWatcher = null; // watching is best-effort (e.g. platforms without recursive watch)
  }
}

async function openDir(dir) {
  const resolved = path.resolve(dir);
  const files = await listSiteFiles(resolved);
  if (!files.pages.length) {
    return { error: 'No .html files found in that folder.' };
  }
  projectRoot = resolved;
  const recent = await pushRecent(resolved);
  await startProjectWatch();
  return { dir: resolved, ...files, recent };
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
  };
  return map[ext] || 'application/octet-stream';
}

// --- Editor-shell framework origins -----------------------------------------
//
// The top-level document (hesite://shell/) is a minimal host page: it holds
// the preload bridge and nothing else. The entire editor UI lives one frame
// down at hesite://app/ — from there, the ONLY Sensible ancestor is the shell
// document (cross-origin by host), and every ancestor of an untrusted preview
// page stops at the guarded canvas realm (its parent/top are shadowed).
// Untrusted nested iframes therefore find a cross-origin, contentless `top`
// instead of the editor window.
const FRAME_HOST_SHELL = 'shell';
const FRAME_HOST_APP = 'app';

function serveBuiltinShell() {
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
  // Minimal top document: one iframe (the editor) and a bridge forwarder.
  // It has no state, no nav, and no APIs — untrusted preview scripts that
  // reach `top` find a cross-origin document with nothing in it.
  return new Response(
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; frame-src hesite:; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'">' +
    '<title>werkstatt</title><style>html,body{margin:0;height:100%;background:#1e1e24}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>' +
    '<iframe id="editor-frame" src="hesite://app/index.html" title="werkstatt editor" allow="clipboard-write"></iframe>' +
    '<script>(()=>{const f=document.getElementById("editor-frame");' +
    'const toEditor=(msg)=>{try{if(f&&f.contentWindow)f.contentWindow.postMessage(msg,"*")}catch(_){}};' +
    'window.addEventListener("message",(e)=>{if(!f||e.source!==f.contentWindow)return;' +
    'const d=e.data||{};if(!d.__heCall)return;window.heRelay.call(d,toEditor);});' +
    'try{window.heRelay.onPush((m)=>toEditor(m))}catch(_){}})();<\/script>' +
    '</body></html>',
    { status: 200, headers }
  );
}

// The editor surface is code we ship — only these files exist, keyed by
// extension so a crafted hesite://app path can never read arbitrary disk
// content (e.g. a hostile argv, user config) through this host.
function serveEditorAsset(rel) {
  const base = path.join(__dirname, 'renderer');
  let full;
  try {
    full = path.normalize(path.join(base, rel));
    if (!full.startsWith(base + path.sep) && full !== base) return new Response('Not found', { status: 404 });
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const ext = path.extname(full).toLowerCase();
  if (!['.html', '.css', '.js', '.svg', '.woff2'].includes(ext)) {
    return new Response('Not found', { status: 404 });
  }
  return fsNative.promises.readFile(full).then(
    (data) => new Response(data, {
      status: 200,
      headers: {
        'Content-Type': mimeFor(full),
        // The editor UI is embeddable only by the shell host document; other
        // pages (e.g. a hostile preview page over hesite://v) cannot frame it.
        'Content-Security-Policy': 'frame-ancestors hesite://shell',
        'Cache-Control': 'no-cache',
      },
    }),
    () => new Response('Not found', { status: 404 })
  );
}

function registerHesiteProtocol() {
  protocol.handle('hesite', async (request) => {
    let url = null;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const host = String(url.hostname || '').toLowerCase();
    // hesite://shell/ — the built-in editor-shape host document.
    if (host === FRAME_HOST_SHELL) {
      return url.pathname !== '/' && url.pathname !== '' && url.pathname !== '/index.html'
        ? new Response('Not found', { status: 404 })
        : serveBuiltinShell();
    }
    // hesite://app/... — the bundled editor UI (whitelist, no project files).
    if (host === FRAME_HOST_APP) {
      return serveEditorAsset(url.pathname || '/index.html');
    }
    // Project documents and assets: hesite://v/path/to/file — dotfiles and
    // parent segments are not served.
    try {
      if (!projectRoot) {
        return new Response('No project', { status: 404 });
      }
      // hesite://v/path/to/file — dotfiles and parent segments are not served.
      const rel = hesitePathFromUrlPath(url.pathname || '/');
      if (!rel) {
        return new Response('Not found', { status: 404 });
      }
      const full = path.resolve(projectRoot, rel);
      try {
        await assertInsideProject(full);
      } catch {
        return new Response('Forbidden', { status: 403 });
      }
      const data = await fs.readFile(full);
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': mimeFor(full),
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Site Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow && mainWindow.webContents.send('menu:open'),
        },
        {
          label: 'Open Demo Site',
          click: () => mainWindow && mainWindow.webContents.send('menu:open-demo'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow && mainWindow.webContents.send('menu:save'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow && mainWindow.webContents.send('menu:undo'),
        },
        {
          label: 'Redo',
          accelerator: 'Shift+CmdOrCtrl+Z',
          click: () => mainWindow && mainWindow.webContents.send('menu:redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Edit Mode',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow && mainWindow.webContents.send('menu:mode', 'edit'),
        },
        {
          label: 'Preview Mode',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow && mainWindow.webContents.send('menu:mode', 'preview'),
        },
        { type: 'separator' },
        { role: 'reload' },
        // DevTools attach to the editor window (which can write project
        // files), so they stay a development-only convenience.
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The editor side is the shell's only child frame (hesite://app). Some calls
// (close-prompt draft flush, smoke runner) must execute INSIDE its context.
function editorFrame() {
  try {
    const wc = mainWindow && mainWindow.webContents;
    if (!wc) return null;
    return wc.mainFrame.frames.find((f) => String(f.url || '').startsWith('hesite://app/')) || null;
  } catch {
    return null;
  }
}

// Editor frames appear slightly after the shell loads; retry briefly so a
// burst right after open still lands in the editor context.
async function editorFrameReady(maxMs = 5000) {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const frame = editorFrame();
    if (frame) return frame;
    if (Date.now() > deadline || !mainWindow) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e24',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Minimal cross-origin shell: it embeds the full editor (hesite://app/…) so
  // an untrusted preview page's nested iframes top out at this empty host
  // document instead of the editor window.
  mainWindow.loadURL('hesite://shell/');

  // The canvas renders untrusted site content in a same-origin frame. Never
  // let page scripts escalate to OS windows or navigate the app shell:
  // popups are denied (the frame guard also neuters window.open) and the top
  // frame stays on the shell document.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('hesite://shell/')) e.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault());

  mainWindow.on('close', async (e) => {
    if (SMOKE || allowQuit) return;
    const pages = rendererDirtyPages;
    if (!rendererDirty && !pages.length) return;
    e.preventDefault();
    if (closingPrompt) return;
    closingPrompt = true;
    try {
      // Flush the latest edits first — the debounced capture may not have fired.
      try {
        await Promise.race([
          (async () => {
            const frame = await editorFrameReady();
            if (!frame) return;
            await frame.executeJavaScript('window.__heFlushDrafts ? window.__heFlushDrafts() : null');
          })(),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      } catch { /* best effort — on-disk drafts still cover earlier edits */ }
      const names = pages.slice(0, 4).join(', ') + (pages.length > 4 ? ` +${pages.length - 4} more` : '');
      // Async box — showMessageBoxSync crashed with GLib on some Linux setups.
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Quit — drafts kept', 'Discard all drafts', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: pages.length
          ? `Unsaved changes on ${pages.length} page${pages.length === 1 ? '' : 's'}.`
          : 'You have unsaved changes.',
        detail: `${names ? names + '.\n' : ''}Drafts stay on disk outside your folder and are offered back — quitting loses nothing.`,
      });
      const choice = result.response;
      if (choice === 2) return;
      if (choice === 1) {
        if (projectRoot) {
          try { await fs.rm(draftsRoot(projectRoot), { recursive: true, force: true }); } catch { /* nothing stored */ }
        }
        rendererDirty = false;
        rendererDirtyPages = [];
      }
      allowQuit = true;
      mainWindow.close();
    } finally {
      closingPrompt = false;
    }
  });

  if (SMOKE) {
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log('[renderer]', message);
    });
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const frame = await editorFrameReady(10000);
          const code = 'window.HE && HE.test ? HE.test.run() : "no HE test hook"';
          const result = frame
            ? await frame.executeJavaScript(code)
            : (await mainWindow.webContents.executeJavaScript(code).catch(() => 'no editor frame'));
          console.log('SMOKE RESULT:', result);
          app.exit(String(result).startsWith('SMOKE OK') ? 0 : 1);
        } catch (err) {
          console.log('SMOKE ERROR:', err.message);
          app.exit(1);
        }
      }, 2500);
    });
  }

  mainWindow.on('closed', () => {
    stopProjectWatch();
    mainWindow = null;
  });
}

// --- IPC ---

// The renderer UI lives in the main frame only. The preview canvas is a
// same-origin srcdoc iframe whose page scripts could reach window.parent.he,
// so reject IPC from any subframe at the boundary (defense in depth alongside
// the renderer-side parent/top/frameElement guard injected in Preview).
function ipcHandle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
      return Promise.reject(new Error(`Blocked IPC "${channel}" from subframe`));
    }
    return fn(event, ...args);
  });
}

ipcHandle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open site folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return openDir(result.filePaths[0]);
});

ipcHandle('project:openPath', async (_e, dir) => {
  if (typeof dir !== 'string' || !dir.trim() || dir.includes('\0')) {
    return { error: 'Invalid folder path' };
  }
  try {
    return await openDir(dir);
  } catch (err) {
    return { error: err.message };
  }
});

ipcHandle('project:demoPath', async () => {
  return path.join(__dirname, '..', 'demo-site');
});

ipcHandle('project:getRecent', async () => {
  const state = await readState();
  const recent = [];
  for (const dir of state.recent || []) {
    try {
      const st = await fs.stat(dir);
      if (st.isDirectory()) recent.push(dir);
    } catch {
      /* gone */
    }
  }
  return { recent, lastProject: state.lastProject || null };
});

ipcHandle('project:baseUrl', async () => {
  if (!projectRoot) return null;
  return 'hesite://v/';
});

ipcHandle('file:read', async (_e, filePath) => {
  const full = await safeResolve(requirePath(filePath));
  return fs.readFile(full, 'utf8');
});

ipcHandle('file:write', async (_e, filePath, content) => {
  const full = await safeResolve(requirePath(filePath));
  await assertWriteTarget(projectRoot, full);
  await writeFileGuarded(full, requireText(content));
  await registerSelfWritePath(full);
  return true;
});

// Fingerprint of a project file (mtime + size) so the renderer can detect
// that an agent rewrote it before saving over it.
ipcHandle('file:stat', async (_e, filePath) => {
  try {
    const st = await fs.stat(await safeResolve(requirePath(filePath)));
    if (!st.isFile()) return null;
    return stampOf(st);
  } catch (err) {
    // A gone project root is not "the file changed". Let Save say so.
    if (err && /Project folder is missing|No project open/.test(String(err.message || ''))) throw err;
    return null;
  }
});

// Save one file only if its on-disk fingerprint still matches what the
// renderer loaded. The compare + write happen in one main-process step, so an
// agent cannot slip a write between the check and the save.
ipcHandle('file:writeChecked', async (_e, filePath, content, expected) => {
  const full = await safeResolve(requirePath(filePath));
  requireText(content);
  let current = null;
  try { current = stampOf(await fs.stat(full)); } catch { current = null; }
  const expectedStamp = expected && typeof expected.mtimeMs === 'number'
    ? { mtimeMs: Number(expected.mtimeMs) || 0, size: Number(expected.size) || 0 }
    : null;
  if (expectedStamp && !current) return { ok: false, conflict: true, current: null };
  if (expectedStamp && !sameStamp(expectedStamp, current)) {
    return { ok: false, conflict: true, current };
  }
  await assertWriteTarget(projectRoot, full);
  await writeFileGuarded(full, content);
  const st = await fs.stat(full);
  await registerSelfWritePath(full);
  return { ok: true, stamp: stampOf(st) };
});

// Open a project file (e.g. a script) in the user's default external editor.
// The editor itself never edits JS — it only makes it visible.
ipcHandle('file:openExternal', async (_e, filePath) => {
  const full = await safeResolve(requirePath(filePath));
  const err = await shell.openPath(full);
  return err || null;
});

ipcHandle('file:exists', async (_e, filePath) => {
  try {
    const st = await fs.stat(await safeResolve(requirePath(filePath)));
    return st.isFile();
  } catch {
    return false;
  }
});

const COPY_INTO_MAX_BYTES = 25 * 1024 * 1024;
const PICKUP_TTL_MS = 120 * 1000;
// Paths the renderer may copy into the project. Only a user-initiated file
// pick (file input in the editor chrome → preload pathForFile) can land here,
// so the renderer cannot smuggle an arbitrary absolute path through copyInto.
const approvedPickups = new Map(); // path -> { size, at }

ipcHandle('file:pickup:approve', async (_e, srcAbs, size) => {
  if (typeof srcAbs !== 'string' || !srcAbs.includes(path.sep) || srcAbs.includes('\0')) {
    throw new Error('Invalid source file');
  }
  approvedPickups.set(srcAbs, { size: Number(size) || 0, at: Date.now() });
  return true;
});

// Vendor an approved outside file (a picked image/favicon) into the project
// at a project-relative destination. Creates parent dirs; refuses to
// overwrite (the renderer picks a fresh name first). The source must be one
// the user picked in a dialog — main rejects paths copied from anywhere else.
ipcHandle('file:copyInto', async (_e, srcAbs, destRel) => {
  const dest = await safeResolve(requirePath(destRel));
  if (typeof srcAbs !== 'string') throw new Error('Invalid source file');
  const src = path.resolve(requirePath(srcAbs));
  if (!src || src === dest) throw new Error('Invalid source file');
  const approved = approvedPickups.get(src);
  approvedPickups.delete(src);
  if (!approved || Date.now() - approved.at > PICKUP_TTL_MS) {
    throw new Error('Source file was not picked in a dialog');
  }
  const st = await fs.stat(src);
  if (!st.isFile()) throw new Error('Not a file');
  if (st.size > COPY_INTO_MAX_BYTES) throw new Error('File is larger than 25 MB');
  // The approval recorded the picked file's size: a swapped-in replacement
  // between pick and copy is rejected instead of vendored into the project.
  if (approved.size > 0 && st.size !== approved.size) {
    throw new Error('Picked file changed before copying');
  }
  try {
    await fs.stat(dest);
    throw new Error('Destination already exists');
  } catch (err) {
    if (err.message === 'Destination already exists') throw err;
    /* missing — good */
  }
  await assertWriteTarget(projectRoot, dest);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const buf = await fs.readFile(src);
  await writeFileGuarded(dest, buf);
  await registerSelfWritePath(dest);
  return true;
});

// --- Self-host Google Fonts (Task 72: 1-click local copy, GDPR-safe) ---
//
// Downloads the woff2 files for the requested families into project `fonts/`
// and returns per-subset entries so the renderer can write local `@font-face`
// rules. Google answers css2 with one block per (weight, style, unicode-range
// subset) — every subset is vendored, otherwise e.g. latin-ext text breaks.
// Repeat runs are idempotent: existing non-empty files are kept, so a second
// click changes nothing when Google answers identically.

function slugFontFamily(family) {
  return String(family || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'font';
}

// Mirror of the renderer's parseGoogleCss (kept here because main is CJS).
function parseGoogleFontCssBlocks(cssText) {
  const out = [];
  const blocks = String(cssText || '').match(/@font-face\s*\{[^}]*\}/gi) || [];
  for (const block of blocks) {
    const family = String((block.match(/font-family\s*:\s*([^;]+);/i) || [])[1] || '')
      .trim().replace(/^['"]|['"]$/g, '');
    if (!family) continue;
    const style = String((block.match(/font-style\s*:\s*([^;]+);/i) || [])[1] || 'normal').trim().toLowerCase();
    const weight = String((block.match(/font-weight\s*:\s*([^;]+);/i) || [])[1] || '400').trim();
    const src = (block.match(/src\s*:\s*([^;]+);/i) || [])[1] || '';
    const urlRx = /url\(\s*(['"]?)(https:\/\/[^)'"]+\.woff2[^)'"]*)\1\s*\)\s*format\(\s*(['"]?)woff2\3\s*\)/gi;
    let m;
    const urls = [];
    while ((m = urlRx.exec(src)) !== null) urls.push(m[2]);
    if (!urls.length) continue;
    const unicodeRange = String((block.match(/unicode-range\s*:\s*([^;]+);/i) || [])[1] || '').trim();
    out.push({ family, weight, style, url: urls[0], unicodeRange });
  }
  return out;
}

const SELFSHOST_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

ipcHandle('fonts:selfhost', async (_e, families) => {
  if (!projectRoot) throw new Error('No project open');
  const list = [...new Set(
    (Array.isArray(families) ? families : []).map((f) => String(f || '').trim()).filter(Boolean)
  )].slice(0, 12);
  if (!list.length) throw new Error('No fonts requested');
  for (const fam of list) {
    // Catalog names are letters/digits/spaces/hyphens (e.g. 'Source Sans 3').
    if (!/^[A-Za-z0-9][A-Za-z0-9 \-']{0,59}$/.test(fam)) throw new Error(`Unknown font: ${fam}`);
  }
  const out = [];
  for (const fam of list) {
    const encoded = fam.replace(/ /g, '+');
    const cssUrl =
      `https://fonts.googleapis.com/css2?family=${encoded}` +
      ':ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,700&display=swap';
    let css;
    try {
      const res = await fetch(cssUrl, { headers: { 'User-Agent': SELFSHOST_UA } });
      if (!res.ok) throw new Error(`Google Fonts answered ${res.status}`);
      css = await res.text();
    } catch (err) {
      throw new Error(`Could not reach Google Fonts for ${fam}: ${(err && err.message) || err}`);
    }
    const blocks = parseGoogleFontCssBlocks(css);
    if (!blocks.length) throw new Error(`Google Fonts has no files for ${fam}`);
    const counters = {};
    const entries = [];
    for (const b of blocks) {
      const key = `${b.weight}/${b.style}`;
      counters[key] = (counters[key] || 0) + 1;
      const file = `fonts/${slugFontFamily(fam)}-${b.weight}${b.style === 'italic' ? 'italic' : ''}-${counters[key]}.woff2`;
      const dest = await safeResolve(file);
      let exists = false;
      try {
        const st = await fs.stat(dest);
        exists = st.isFile() && st.size > 0;
      } catch { exists = false; }
      if (!exists) {
        if (!isGoogleFontFileUrl(b.url)) throw new Error(`Unexpected font URL for ${fam}`);
        let buf;
        try {
          const dl = await fetch(b.url, { headers: { 'User-Agent': SELFSHOST_UA } });
          if (!dl.ok) throw new Error(`download answered ${dl.status}`);
          buf = Buffer.from(await dl.arrayBuffer());
        } catch (err) {
          throw new Error(`Could not download ${fam}: ${(err && err.message) || err}`);
        }
        if (!buf.length || buf.length > 5 * 1024 * 1024) throw new Error(`Unexpected file size for ${fam}`);
        if (buf.subarray(0, 4).toString('ascii') !== 'wOF2') throw new Error(`Not a font file for ${fam}`);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, buf);
        await registerSelfWritePath(dest);
      }
      entries.push({ family: fam, weight: b.weight, style: b.style, file, unicodeRange: b.unicodeRange });
    }
    out.push({ family: fam, entries });
  }
  return out;
});

ipcHandle('app:agentPrompt', async () => {
  // Bundled AI contract (read-only source for the welcome Copy button).
  try {
    return await fs.readFile(path.join(__dirname, '..', 'AGENT_SITE_PROMPT.md'), 'utf8');
  } catch (err) {
    return null;
  }
});

ipcHandle('app:setDirty', async (_e, dirty, pages) => {
  rendererDirty = !!dirty;
  rendererDirtyPages = Array.isArray(pages)
    ? pages.map((p) => String(p).slice(0, 200)).filter(Boolean).slice(0, 50)
    : (rendererDirty ? rendererDirtyPages : []);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setDocumentEdited(!!dirty);
  }
  return true;
});

ipcHandle('app:confirmDiscard', async (_e, message) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Discard', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: message || 'Discard unsaved changes?',
  });
  return result.response === 0;
});

// In-memory drafts never touch disk — on return to a drafted page the
// renderer offers the draft back before loading the saved file.
ipcHandle('app:confirmRestore', async (_e, when) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Restore draft', 'Discard draft'],
    defaultId: 0,
    cancelId: 1,
    message: `Unsaved draft${when ? ` from ${when}` : ''}.`,
    detail: 'Restore your in-memory edits or load the saved file?',
  });
  return result.response === 0;
});

// Save collided with a newer file on disk (agent/tool write). Returns:
// 0 = overwrite disk, 1 = keep my work as a draft (no save), 2 = cancel.
ipcHandle('app:confirmExternalConflict', async (_e, paths) => {
  const list = (Array.isArray(paths) ? paths : []).slice(0, 4).map(String);
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Overwrite disk', 'Keep my edits as draft', 'Cancel'],
    defaultId: 2,
    cancelId: 2,
    message: 'Files changed on disk since they were loaded.',
    detail: `${list.join('\n')}\n\nAnother program (an agent run?) wrote newer content. Overwriting replaces those changes.`,
  });
  return result.response;
});

// --- Versions + branches (Task 28: git-like history, local only) ---
//
// Version content lives OUTSIDE the site folder (userData/versions/<slug>/)
// so history never leaks into the deployed site. No git binary involved:
// each version is a full page+css snapshot with a branch label.

const VERSIONS_MAX_PER_BRANCH = 50;

function versionsSlug(dir) {
  return crypto.createHash('sha1').update(path.resolve(dir)).digest('hex');
}

function versionsRoot(dir) {
  return path.join(app.getPath('userData'), 'versions', versionsSlug(dir));
}

function validBranchName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(name.trim());
}

async function readVersionsMeta(dir) {
  const meta = { dir: path.resolve(dir), currentBranch: 'main', branches: ['main'], versions: [] };
  try {
    const raw = await fs.readFile(path.join(versionsRoot(dir), 'meta.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) {
      meta.branches = [...new Set(parsed.branches.filter((b) => validBranchName(b)))];
      if (!meta.branches.length) meta.branches = ['main'];
    }
    if (parsed && validBranchName(parsed.currentBranch) && meta.branches.includes(parsed.currentBranch)) {
      meta.currentBranch = parsed.currentBranch;
    }
    if (parsed && Array.isArray(parsed.versions)) {
      // Meta holds summaries only; content lives in <id>.json. Dropping
      // html/css here also migrates older meta files that embedded content.
      meta.versions = parsed.versions.map(versionSummary);
    }
  } catch {
    /* first run — defaults */
  }
  return meta;
}

async function writeVersionsMeta(dir, meta) {
  const root = versionsRoot(dir);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
}

function versionSummary(v) {
  return { id: v.id, branch: v.branch, createdAt: v.createdAt, label: v.label, page: v.page, cssFile: v.cssFile };
}

async function assertVersionsDir(dir) {
  const resolved = path.resolve(dir);
  // A missing folder is legal here: every caller creates its own subtree
  // (meta.json, drafts/<page>.json, <id>.json) with mkdir recursive.
  try {
    const st = await fs.stat(resolved);
    if (!st.isDirectory()) throw new Error('Not a directory');
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
  return resolved;
}

// A project is usually listed before the first snapshot, so the versions
// folder does not exist yet. A missing folder is an empty history, not an
// error — readVersionsMeta falls back to the defaults.
async function assertVersionsDirOrEmpty(dir) {
  const resolved = path.resolve(dir);
  try {
    const st = await fs.stat(resolved);
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }
  return resolved;
}

ipcHandle('versions:list', async (_e, dir) => {
  if (dir === null || typeof dir !== 'string') throw new Error('Invalid folder');
  const resolved = await assertVersionsDirOrEmpty(dir);
  if (!resolved) {
    const meta = await readVersionsMeta(path.resolve(dir)); // missing folder → defaults
    const versions = [...meta.versions].sort((a, b) => b.createdAt - a.createdAt).map(versionSummary);
    return { currentBranch: meta.currentBranch, branches: meta.branches, versions };
  }
  const meta = await readVersionsMeta(resolved);
  const versions = [...meta.versions].sort((a, b) => b.createdAt - a.createdAt).map(versionSummary);
  return { currentBranch: meta.currentBranch, branches: meta.branches, versions };
});

ipcHandle('versions:snapshot', async (_e, payload) => {
  const { dir, label, page, cssFile, html, css } = payload || {};
  const resolved = await assertVersionsDir(dir);
  const meta = await readVersionsMeta(resolved);
  const branch = payload && validBranchName(payload.branch) && meta.branches.includes(payload.branch)
    ? payload.branch
    : meta.currentBranch;
  if (typeof html !== 'string' || typeof css !== 'string') throw new Error('Missing content');
  if (!page || !cssFile) throw new Error('Missing page/cssFile');
  const v = {
    id: crypto.randomBytes(8).toString('hex') + Date.now().toString(36),
    branch,
    createdAt: Date.now(),
    label: String(label || '').slice(0, 80) || 'Snapshot',
    page: String(page).slice(0, 200),
    cssFile: String(cssFile).slice(0, 200),
    html,
    css,
  };
  meta.versions.push(versionSummary(v)); // summary only; content in <id>.json
  // Prune oldest beyond the cap, per branch (delete content files too).
  const perBranch = {};
  for (const item of [...meta.versions].sort((a, b) => b.createdAt - a.createdAt)) {
    perBranch[item.branch] = (perBranch[item.branch] || 0) + 1;
    if (perBranch[item.branch] > VERSIONS_MAX_PER_BRANCH) {
      meta.versions = meta.versions.filter((x) => x.id !== item.id);
      try { await fs.unlink(path.join(versionsRoot(resolved), item.id + '.json')); } catch { /* gone */ }
    }
  }
  await fs.mkdir(versionsRoot(resolved), { recursive: true });
  await fs.writeFile(path.join(versionsRoot(resolved), v.id + '.json'), JSON.stringify(v), 'utf8');
  await writeVersionsMeta(resolved, meta);
  return versionSummary(v);
});

ipcHandle('versions:get', async (_e, dir, id) => {
  const resolved = await assertVersionsDir(dir);
  // Version ids are generated (hex + base36 timestamp); reject anything else
  // so '../../state' style traversal can never escape the versions folder.
  if (!/^[A-Za-z0-9]{1,64}$/.test(String(id))) throw new Error('Unknown version');
  const raw = await fs.readFile(path.join(versionsRoot(resolved), String(id) + '.json'), 'utf8');
  const v = JSON.parse(raw);
  return { id: v.id, branch: v.branch, createdAt: v.createdAt, label: v.label, page: v.page, cssFile: v.cssFile, html: v.html, css: v.css };
});

ipcHandle('versions:createBranch', async (_e, dir, name) => {
  const resolved = await assertVersionsDir(dir);
  const clean = String(name || '').trim();
  if (!validBranchName(clean)) throw new Error('Branch names: letters/numbers/._-, max 40 chars.');
  const meta = await readVersionsMeta(resolved);
  if (!meta.branches.includes(clean)) meta.branches.push(clean);
  meta.currentBranch = clean;
  await writeVersionsMeta(resolved, meta);
  return { currentBranch: meta.currentBranch, branches: meta.branches };
});

ipcHandle('versions:switchBranch', async (_e, dir, name) => {
  const resolved = await assertVersionsDir(dir);
  const meta = await readVersionsMeta(resolved);
  if (!meta.branches.includes(name)) throw new Error('Unknown branch');
  meta.currentBranch = name;
  await writeVersionsMeta(resolved, meta);
  const tip = [...meta.versions]
    .filter((v) => v.branch === name)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return { currentBranch: name, tip: tip ? versionSummary(tip) : null };
});

// --- Settings (Task 64: single History/git off switch) ---
//
// Only known boolean keys are accepted; unknown payload shapes fall back to
// defaults. Drafts keep working with history UI off — the switch hides
// chrome and pauses snapshots, it never deletes data.

const DEFAULT_SETTINGS = { historyUi: true };

function normalizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  if (s && typeof s === 'object' && typeof s.historyUi === 'boolean') out.historyUi = s.historyUi;
  return out;
}

ipcHandle('settings:get', async () => normalizeSettings((await readState()).settings));

ipcHandle('settings:set', async (_e, patch) => {
  const state = await readState();
  const next = normalizeSettings({ ...normalizeSettings(state.settings), ...(patch && typeof patch === 'object' ? patch : {}) });
  state.settings = next;
  await writeState(state);
  return next;
});

// --- Crash-safe drafts (Task 64: untied from versions, whole folder) ---
//
// Drafts persist OUTSIDE the site folder (userData/drafts/<slug>/), one
// file per page, so a crash or quit never loses unsaved work. Only an
// explicit Discard deletes them. Same slug scheme as versions, separate
// root, separate lifecycle.

const { draftFileName, draftPageFromFile, isStaleDraft } = require('./draftstore');
const { parseGitHead, isGitPointerTarget } = require('./gitinfo');

function draftsRoot(dir) {
  return path.join(app.getPath('userData'), 'drafts', versionsSlug(dir));
}

function draftSummary(d) {
  return { page: d.page, cssFile: d.cssFile, capturedAt: d.capturedAt };
}

async function pruneDrafts(resolved, knownPages) {
  let entries = [];
  try {
    entries = await fs.readdir(draftsRoot(resolved));
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    const page = draftPageFromFile(name);
    if (!page) continue;
    let summary = null;
    try {
      const raw = await fs.readFile(path.join(draftsRoot(resolved), name), 'utf8');
      const parsed = JSON.parse(raw);
      summary = { page, cssFile: parsed.cssFile, capturedAt: parsed.capturedAt };
    } catch {
      summary = { page, cssFile: null, capturedAt: 0 };
    }
    if (isStaleDraft(summary, now, knownPages)) {
      try { await fs.unlink(path.join(draftsRoot(resolved), name)); } catch { /* gone */ }
    }
  }
}

ipcHandle('drafts:write', async (_e, payload) => {
  const { dir, page, cssFile, html, css } = payload || {};
  const resolved = await assertVersionsDir(dir);
  if (typeof html !== 'string' || typeof css !== 'string') throw new Error('Missing content');
  if (!page || !cssFile) throw new Error('Missing page/cssFile');
  const draft = {
    page: String(page).slice(0, 200),
    cssFile: String(cssFile).slice(0, 200),
    html,
    css,
    capturedAt: Date.now(),
  };
  await fs.mkdir(draftsRoot(resolved), { recursive: true });
  await fs.writeFile(path.join(draftsRoot(resolved), draftFileName(draft.page)), JSON.stringify(draft), 'utf8');
  return draftSummary(draft);
});

ipcHandle('drafts:read', async (_e, dir, page) => {
  const resolved = await assertVersionsDir(dir);
  const name = draftFileName(String(page || ''));
  if (draftPageFromFile(name) === null) return null;
  try {
    const raw = await fs.readFile(path.join(draftsRoot(resolved), name), 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.html !== 'string' || typeof parsed.css !== 'string') return null;
    return { page: parsed.page, cssFile: parsed.cssFile, html: parsed.html, css: parsed.css, capturedAt: parsed.capturedAt };
  } catch {
    return null;
  }
});

ipcHandle('drafts:clear', async (_e, dir, page) => {
  const resolved = await assertVersionsDir(dir);
  const name = draftFileName(String(page || ''));
  if (draftPageFromFile(name) === null) return false;
  try {
    await fs.unlink(path.join(draftsRoot(resolved), name));
    return true;
  } catch {
    return false;
  }
});

ipcHandle('drafts:list', async (_e, dir, pages) => {
  const resolved = await assertVersionsDir(dir);
  const known = Array.isArray(pages) ? pages.map(String) : undefined;
  await pruneDrafts(resolved, known);
  let entries = [];
  try {
    entries = await fs.readdir(draftsRoot(resolved));
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    const page = draftPageFromFile(name);
    if (!page) continue;
    try {
      const raw = await fs.readFile(path.join(draftsRoot(resolved), name), 'utf8');
      const parsed = JSON.parse(raw);
      out.push({ page, cssFile: parsed.cssFile, capturedAt: parsed.capturedAt });
    } catch { /* unreadable — pruned next list */ }
  }
  return out.sort((a, b) => b.capturedAt - a.capturedAt);
});

ipcHandle('drafts:clearAll', async (_e, dir) => {
  const resolved = await assertVersionsDir(dir);
  try {
    await fs.rm(draftsRoot(resolved), { recursive: true, force: true });
  } catch { /* nothing stored */ }
  return true;
});

// Three-way leave choice: keeping the draft is the default, discarding is
// explicit. Returns 'keep' | 'discard' | 'cancel'.
ipcHandle('app:confirmLeave', async (_e, message) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Keep draft & leave', 'Discard draft', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: message || 'Leave without saving?',
    detail: 'Kept drafts are offered back when you return to the page.',
  });
  return ['keep', 'discard', 'cancel'][result.response] || 'cancel';
});

// --- Real-git awareness (Task 64: read-only) ---
//
// Detects a git repo in the opened folder and reports its branch so the
// topbar never confuses it with the editor's own history branches. Parses
// .git/HEAD directly: no git binary, no writes into the project, nothing
// staged or committed. Supports worktree .git pointer files.

ipcHandle('project:gitInfo', async (_e, dir) => {
  const resolved = await assertVersionsDir(dir);
  const dotGit = path.join(resolved, '.git');
  let st = null;
  try {
    st = await fs.stat(dotGit);
  } catch {
    return { isRepo: false };
  }
  try {
    let gitDir = dotGit;
    if (st.isFile()) {
      const link = await fs.readFile(dotGit, 'utf8');
      const m = /^gitdir:\s*(.+)$/m.exec(link);
      const target = m && m[1].trim();
      if (!target || target.includes('\0')) return { isRepo: true, kind: 'unknown' };
      const absolute = path.resolve(resolved, target.slice(0, 500));
      if (!isGitPointerTarget(absolute)) return { isRepo: true, kind: 'unknown' };
      gitDir = absolute;
    }
    const head = await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8');
    const info = parseGitHead(head);
    if (info.kind === 'unknown') return { isRepo: true, kind: 'unknown' };
    return { isRepo: true, kind: info.kind, branch: String(info.branch).slice(0, 100) };
  } catch {
    return { isRepo: true, kind: 'unknown' };
  }
});

// Read-only uncommitted-changes hint for the topbar (no repo writes; the
// editor still never commits, stages, or touches git state). Starvation-safe:
// a 5s timeout treats a hung git call as "unknown".
function runGit(dir, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, '--no-optional-locks', ...args], { timeout: 5000 }, (err, stdout) => {
      if (err) resolve({ ok: false, stdout: err.code == null ? '' : String(stdout || '') });
      else resolve({ ok: true, stdout: String(stdout || '') });
    });
  });
}

ipcHandle('project:gitStatus', async (_e, dir) => {
  // Scoped to the project like every other path-taking handler: a relay
  // caller cannot probe arbitrary directories for git state.
  const resolved = await safeResolve(requirePath(dir));
  const info = runGit(resolved, ['status', '--porcelain', '-z']);
  const branch = runGit(resolved, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const [status, head] = await Promise.all([info, branch]);
  if (!status.ok || !head.ok) return { isRepo: false };
  // porcelain -z: NUL-separated "XY path" fields; a rename emits
  // "R  new\0old" — the src half has a blank XY and counts only once (it is
  // the move's second half, not another change).
  let count = 0;
  for (const entry of status.stdout.split('\0').filter(Boolean)) {
    const m = /^(..) (.*)$/.exec(entry);
    if (!m) continue;
    if (m[1].trim()) count += 1;
  }
  const dirty = count > 0;
  return {
    isRepo: true,
    dirty,
    count,
    branch: String(head.stdout || '').trim().slice(0, 100),
  };
});

app.whenReady().then(() => {
  registerHesiteProtocol();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopProjectWatch();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
