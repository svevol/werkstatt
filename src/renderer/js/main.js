// Main — renderer entry point: app state, project loading, undo/redo,
// autosave, save, keyboard shortcuts, palette, mode switching, warnings.
// Feature modules register themselves on the HE registry (see he.js).

import { HE } from './he.js';
import { escapeHtml, VIEWPORT_MEDIA, viewportMediaFor, mediaMaxWidthPx, viewportLabel } from './util.js';
import { buildTokens } from './panel-sections.js';
import { summarizeChanges, summarizeCounts, formatHandoffNote } from './changes.js';
import './sheet.js';
import './hooks.js';
import './canvas.js';
import './tree.js';
import './panel.js';
import './actions.js';
import './components.js';
import './export-site.js';
import './versions-ui.js';
import './smoke.js';

HE.project = null; // { dir, pages, stylesheets }
HE.page = null;    // current page file name
HE.cssFile = null;
HE.cssLinked = false;
HE.cssExternal = [];
HE.pageScripts = null; // { external: [], inline: n } from scanScripts
HE.jsFiles = []; // [{ src, rel, full, text }] — cached JS text, never executed
HE.siblingPageDocs = null; // parsed sibling pages (null = still loading)
HE.dirty = false;
HE.autosaveDraft = null; // serialized current-page draft, kept in renderer memory only
HE.baseUrl = null;
HE.viewport = 'desktop'; // 'desktop' | 'tablet' | 'mobile' | a custom media condition
HE.VIEWPORT_MEDIA = VIEWPORT_MEDIA;
HE.viewportMedia = function () {
  const vp = HE.viewport || 'desktop';
  if (vp !== 'desktop' && vp !== 'tablet' && vp !== 'mobile') return vp;
  return viewportMediaFor(vp);
};
HE.scope = 'design'; // 'design' (element styles) | 'content' (text/images/links) | 'site' (classes/fonts/globals)
HE.contentMode = false; // back-compat mirror: true when scope === 'content'
HE.fileStamps = {}; // project-relative file -> { mtimeMs, size } we last read/wrote
HE.externalChanges = []; // [{ path, kind, at }] disk changes since load (agent/tool writes)
HE.skipDraftRestore = null; // page name to load from disk even when a draft exists
HE.watchBound = false;
HE.baselines = {}; // page -> { html, css, cssFile, at } last disk/save state for handoff notes
HE.siteCheckResults = null; // findings from the last Site check run
HE.siteCheckAt = null;

// Minimal toast stack (replaces blocking alert() on happy paths).
HE.toast = function (msg, kind) {
  try {
    const host = document.getElementById('toasts');
    if (!host) { alert(msg); return; }
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = msg;
    host.appendChild(el);
    while (host.children.length > 3) host.firstChild.remove();
    setTimeout(() => { try { el.remove(); } catch { /* ignore */ } }, 3500);
  } catch { try { alert(msg); } catch { /* ignore */ } }
};

// Surface renderer failures as toasts so a broken interaction names its
// cause (message + source line) instead of silently leaving a white canvas
// or dead clicks. Resource-load failures (e.g. offline fonts) don't bubble
// to window, so this only fires for real JS errors.
window.addEventListener('error', (e) => {
  try {
    const msg = (e && e.message) || 'Unknown error';
    const src = e && e.filename ? ` (${String(e.filename).split('/').pop()}:${e.lineno || '?'})` : '';
    try { console.error((e && e.error && e.error.stack) || msg); } catch { /* ignore */ }
    HE.toast('Error: ' + msg + src, 'error');
  } catch { /* ignore */ }
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    const r = e && e.reason;
    HE.toast('Error: ' + ((r && r.message) || r || 'unhandled rejection'), 'error');
  } catch { /* ignore */ }
});

HE.setScope = function (scope) {
  HE.scope = (scope === 'content' || scope === 'site') ? scope : 'design';
  HE.contentMode = HE.scope === 'content';
  try { document.body.dataset.contentmode = HE.contentMode ? '1' : '0'; } catch { /* ignore */ }
  try { document.body.dataset.scope = HE.scope; } catch { /* ignore */ }
  try {
    document.querySelectorAll('#content-switch button').forEach((b) => {
      const on = b.dataset.cm === HE.scope;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  } catch { /* ignore */ }
  if (HE.panel && HE.panel.refresh) HE.panel.refresh();
};

// Kept for existing callers/tests: Design <=> Content.
HE.setContentMode = function (v) {
  HE.setScope(v ? 'content' : 'design');
};

const undoStack = [];
const redoStack = [];
let burstTimer = null;

// ---------- snapshots / undo ----------

function snapshot() {
  return { html: HE.canvas.serializeDoc(), css: HE.sheet.serialize() };
}

HE.commit = function () {
  if (!HE.sheet || !HE.canvas.doc) return;
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
};

HE.commitDebounced = function () {
  if (!burstTimer) HE.commit();
  clearTimeout(burstTimer);
  burstTimer = setTimeout(() => (burstTimer = null), 800);
};

async function restore(snap) {
  await HE.canvas.loadPage(snap.html, snap.css);
  refreshCssStatusFromHtml(snap.html);
  markDirty();
  // Undo/redo replace the live DOM — shared-component refs go stale.
  if (HE.refreshComponents) HE.refreshComponents();
  if (HE.refreshViewports) HE.refreshViewports();
}

HE.undo = function () {
  if (!undoStack.length || !HE.page) return;
  if (HE.canvas.mode !== 'edit') return;
  redoStack.push(snapshot());
  const depth = undoStack.length - 1;
  const restored = restore(undoStack.pop());
  const reverted = revertCrossPageWrites(depth);
  return Promise.all([restored, reverted]);
};

HE.redo = function () {
  if (!redoStack.length || !HE.page) return;
  if (HE.canvas.mode !== 'edit') return;
  undoStack.push(snapshot());
  return restore(redoStack.pop());
};

// ---------- cross-page undo journal (Task 31) ----------
//
// Class rename/delete (and component sync) rewrite other pages' files on
// disk — outside the current-page undo snapshots. Every such write records
// { page, before, after, depth } so Undo can revert it. Redo stays
// current-page-only (documented limitation). The journal resets whenever
// the undo stack resets (page/project switch) and is capped.

const CROSS_PAGE_JOURNAL_MAX = 30;
HE.crossPageJournal = [];

HE.recordCrossPageWrite = function (page, before, after, fs) {
  HE.crossPageJournal.push({ page, before, after, depth: undoStack.length, fs: fs || window.he });
  while (HE.crossPageJournal.length > CROSS_PAGE_JOURNAL_MAX) HE.crossPageJournal.shift();
};

async function revertCrossPageWrites(depth) {
  const journal = HE.crossPageJournal;
  for (let i = journal.length - 1; i >= 0; i--) {
    const entry = journal[i];
    if (!entry || !(entry.depth > depth)) continue;
    journal.splice(i, 1);
    try {
      await (entry.fs || window.he).writeFile(entry.page, entry.before);
    } catch (err) {
      if (HE.toast) HE.toast('Could not revert ' + entry.page + ': ' + ((err && err.message) || err), 'error');
    }
  }
}
HE.revertCrossPageWrites = revertCrossPageWrites;

// ---------- dirty ----------

function markDirty() {
  HE.dirty = true;
  document.getElementById('dirty-dot').hidden = false;
  HE.syncDirtyIpc();
  setSaveState('Unsaved');
  scheduleAutosave();
}
HE.markDirty = markDirty;

function statusTime(prefix) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${prefix} ${hh}:${mm}`;
}

function clearDirty() {
  HE.dirty = false;
  HE.autosaveDraft = null;
  HE.clearDraft(HE.page);
  document.getElementById('dirty-dot').hidden = true;
  HE.syncDirtyIpc();
  setSaveState(statusTime('Saved'));
}

function setSaveState(text) {
  const el = document.getElementById('save-state');
  if (el) el.textContent = text;
}

// ---------- autosave (crash-safe drafts, whole project folder) ----------
//
// Drafts are per page and persist OUTSIDE the project folder, so a crash or
// quit never loses unsaved work: only an explicit Discard deletes a draft.
// Save writes files and clears the draft. Returning to a page with a live
// draft offers Restore/Discard before the saved file loads (see
// maybeRestoreDraft, wired into loadPage). Untied from versions on purpose:
// versions record saved states, drafts guard unsaved ones.

const AUTOSAVE_KEY = 'he-autosave';
const AUTOSAVE_DELAY = 2000;
let autosaveTimer = null;

HE.drafts = {}; // page -> { html, css, cssFile, capturedAt } (this session)

// Test seam: the drafts IPC bridge (stubbed in smoke tests).
HE.draftIpc = function () {
  return (window.he && window.he.drafts) || null;
};

// Test seam: the font self-host IPC bridge (stubbed in smoke tests so the
// suite never touches the network).
HE.fontsIpc = function () {
  return (window.he && window.he.selfhostFonts)
    ? { selfhostFonts: (families) => window.he.selfhostFonts(families) }
    : null;
};

// Test seam: the external-change bridge (stubbed in smoke tests so no real
// watcher or native dialog is needed).
HE.watchIpc = function () {
  return (window.he && window.he.onProjectChange) ? window.he : null;
};

// Test seam: file freshness/checked-write bridge (stubbed in smoke tests).
HE.fileIpc = function () {
  return (window.he && window.he.writeFileChecked) ? window.he : null;
};

// Remember the on-disk fingerprint of a file the editor just read, so a later
// Save can tell whether an agent rewrote it in the meantime.
HE.recordStamp = async function (rel) {
  if (!rel) return null;
  try {
    const ipc = HE.fileIpc();
    const stamp = (ipc && ipc.statFile) ? await ipc.statFile(rel) : null;
    if (stamp) HE.fileStamps[rel] = stamp;
    return stamp;
  } catch {
    return null;
  }
};

function sameFileStamp(a, b) {
  if (!a || !b) return false;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function projectDir() {
  return HE.project && HE.project.dir;
}

HE.storeDraft = function (page, draft) {
  if (page) HE.drafts[page] = draft;
  HE.syncDirtyIpc();
};

HE.getDraft = function (page) {
  return (page && HE.drafts[page]) || null;
};

HE.clearDraft = function (page) {
  if (page) delete HE.drafts[page];
  if (HE.autosaveDraft && HE.autosaveDraft.page === page) HE.autosaveDraft = null;
  const ipc = HE.draftIpc();
  if (ipc && page && projectDir()) ipc.clear(projectDir(), page).catch(() => {});
  HE.syncDirtyIpc();
};

// Dirty pages are exactly the pages holding a draft — the quit dialog and
// the dirty dot both follow this set.
HE.draftPages = function () {
  return Object.keys(HE.drafts);
};

HE.syncDirtyIpc = function () {
  try {
    if (window.he && window.he.setDirty) {
      const pages = HE.draftPages();
      window.he.setDirty(HE.dirty || pages.length > 0, pages);
    }
  } catch { /* quit guard is best-effort */ }
};

// Persist one page's draft outside the project folder. Fire-and-forget from
// the capture path; awaited directly in tests and the quit-time flush.
HE.persistDraft = async function (page) {
  const ipc = HE.draftIpc();
  const draft = HE.getDraft(page);
  if (!ipc || !draft || !projectDir()) return false;
  try {
    await ipc.write({ dir: projectDir(), page, cssFile: draft.cssFile, html: draft.html, css: draft.css });
    return true;
  } catch {
    return false;
  }
};

function draftTime(draft) {
  try {
    const d = new Date(draft && draft.capturedAt);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

// Test seam: native dialog in the app, window.confirm fallback elsewhere.
HE.confirmRestoreDraft = function (when) {
  if (window.he && window.he.confirmRestore) return window.he.confirmRestore(when);
  return Promise.resolve(confirm(`Unsaved draft${when ? ` from ${when}` : ''}.\nRestore your edits or load the saved file?`));
};

// Leaving a page with unsaved work: keeping the draft is the default, only
// an explicit Discard deletes it (memory + disk). Returns
// 'keep' | 'discard' | 'cancel'.
HE.askLeave = function (message) {
  if (window.he && window.he.confirmLeave) return window.he.confirmLeave(message);
  return Promise.resolve(confirm(message || 'Leave without saving?') ? 'keep' : 'cancel');
};

HE.confirmLeavePage = async function (message) {
  let choice = 'cancel';
  try {
    choice = await HE.askLeave(message);
  } catch {
    choice = 'cancel';
  }
  if (choice === 'discard') HE.clearDraft(HE.page);
  return choice;
};

// Pick the source for an incoming page load: live draft (after an explicit
// Restore choice) or the saved file. Falls back to the on-disk draft when
// memory is empty (fresh launch after a crash/quit). Returns
// { html, css, restored }.
HE.maybeRestoreDraft = async function (page, fileHtml, fileCss) {
  let draft = HE.getDraft(page);
  if (!draft) {
    const ipc = HE.draftIpc();
    if (ipc && projectDir()) {
      try {
        const stored = await ipc.read(projectDir(), page);
        if (stored && typeof stored.html === 'string') {
          draft = {
            html: stored.html,
            css: stored.css,
            cssFile: stored.cssFile,
            capturedAt: stored.capturedAt,
          };
          HE.storeDraft(page, draft);
        }
      } catch { /* no usable draft — load the file */ }
    }
  }
  if (!draft) return { html: fileHtml, css: fileCss, restored: false };
  let restore = false;
  try {
    restore = await HE.confirmRestoreDraft(draftTime(draft));
  } catch {
    restore = false;
  }
  if (!restore) {
    HE.clearDraft(page);
    return { html: fileHtml, css: fileCss, restored: false };
  }
  return { html: draft.html, css: draft.css, restored: true };
};

try {
  HE.autosave = localStorage.getItem(AUTOSAVE_KEY) !== 'off';
} catch {
  HE.autosave = true;
}

HE.setAutosave = function (v) {
  HE.autosave = !!v;
  try { localStorage.setItem(AUTOSAVE_KEY, HE.autosave ? 'on' : 'off'); } catch { /* ignore */ }
  const btn = document.getElementById('auto-btn');
  if (btn) {
    btn.classList.toggle('on', HE.autosave);
    btn.setAttribute('aria-pressed', String(HE.autosave));
  }
  if (!HE.autosave) cancelAutosave();
  else if (HE.dirty) scheduleAutosave();
};

function cancelAutosave() {
  if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
}
HE.cancelAutosave = cancelAutosave;

function captureAutosaveDraft() {
  if (!HE.page || !HE.canvas || HE.canvas.mode !== 'edit') return false;
  const snap = HE.canvas.editSnapshot();
  HE.autosaveDraft = {
    page: HE.page,
    cssFile: HE.cssFile,
    html: snap.html,
    css: snap.css,
    capturedAt: Date.now(),
  };
  HE.storeDraft(HE.page, {
    html: snap.html,
    css: snap.css,
    cssFile: HE.cssFile,
    capturedAt: HE.autosaveDraft.capturedAt,
  });
  setSaveState(statusTime('Draft kept'));
  HE.persistDraft(HE.page).catch(() => {});
  return true;
}

// Quit-time flush (called by the main process before the quit dialog): run
// a pending capture now so the last keystrokes reach disk too.
window.__heFlushDrafts = async function () {
  try {
    cancelAutosave();
    if (HE.dirty && HE.autosave && HE.page && HE.canvas && HE.canvas.mode === 'edit') {
      captureAutosaveDraft();
      await HE.persistDraft(HE.page);
    }
    return true;
  } catch {
    return false;
  }
};

function scheduleAutosave() {
  cancelAutosave();
  if (!HE.autosave || !HE.page) return;
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    if (!HE.autosave || !HE.dirty || !HE.page) return;
    if (!HE.canvas || HE.canvas.mode !== 'edit') return;
    setSaveState('Saving draft…');
    try {
      captureAutosaveDraft();
    } catch {
      setSaveState('Draft failed');
      if (HE.toast) HE.toast('Autosave failed — press Save.', 'error');
    }
  }, AUTOSAVE_DELAY);
}

HE.afterDomChange = function () {
  HE.tree.rebuild();
  HE.canvas.refreshOverlays();
  try { renderCrumbs(); } catch { /* ignore */ }
  markDirty();
};

// ---------- keyboard ----------

function focusInField(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

HE.onKeydown = function (e) {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  if (mod && key === 's') {
    e.preventDefault();
    save();
    return;
  }
  if (mod && key === 'o') {
    e.preventDefault();
    openProject();
    return;
  }
  if (mod && key === 'e') {
    e.preventDefault();
    setMode('edit');
    return;
  }
  if (mod && key === 'p') {
    e.preventDefault();
    setMode('preview');
    return;
  }
  if (mod && key === 'f') {
    e.preventDefault();
    if (!HE.contentMode) HE.setScope('content');
    const input = document.getElementById('find-query');
    if (input) {
      const det = input.closest('details');
      if (det) det.open = true;
      input.focus();
      if (input.select) input.select();
    }
    return;
  }
  if (mod && key === 'c') {
    if (focusInField(e) || HE.canvas.mode !== 'edit' || !HE.canvas.selected) return;
    e.preventDefault();
    HE.canvas.copySelected();
    return;
  }
  if (mod && key === 'v') {
    if (focusInField(e) || HE.canvas.mode !== 'edit') return;
    e.preventDefault();
    HE.canvas.pasteCopied();
    return;
  }
  if (mod && key === 'z') {
    if (focusInField(e)) return;
    e.preventDefault();
    e.shiftKey ? HE.redo() : HE.undo();
    return;
  }
  if (mod && key === 'd') {
    if (focusInField(e) || HE.canvas.mode !== 'edit') return;
    e.preventDefault();
    HE.canvas.duplicateSelected();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !HE.canvas.editing && !focusInField(e)) {
    if (HE.canvas.mode !== 'edit') return;
    e.preventDefault();
    HE.canvas.deleteSelected();
    return;
  }
  if (e.key === 'Escape' && !focusInField(e)) {
    if (closePreviewStatusIfOpen()) {
      e.preventDefault();
      return;
    }
    if (HE.canvas.mode === 'preview') {
      setMode('edit');
      return;
    }
    HE.canvas.deselect();
  }
};

document.addEventListener('keydown', (e) => HE.onKeydown(e));

// ---------- palette ----------

const PALETTE = [
  ['div', 'Div'], ['section', 'Section'], ['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3'],
  ['p', 'Text'], ['span', 'Span'], ['a', 'Link'], ['button', 'Button'],
  ['img', 'Image'], ['ul', 'List'], ['input', 'Input'],
];

// Long tail behind the "More elements" disclosure. Starter markup/text for
// each tag lives in canvas.js DEFAULTS; these are just [tag, label] pairs.
const PALETTE_MORE = [
  ['h4', 'H4'], ['h5', 'H5'], ['h6', 'H6'],
  ['ol', 'OL'], ['li', 'LI'],
  ['header', 'Header'], ['nav', 'Nav'], ['main', 'Main'], ['article', 'Article'],
  ['aside', 'Aside'], ['footer', 'Footer'],
  ['form', 'Form'], ['label', 'Label'], ['textarea', 'Textarea'], ['select', 'Select'],
  ['video', 'Video'], ['iframe', 'Embed'],
  ['blockquote', 'Quote'], ['hr', 'Divider'], ['figure', 'Figure'], ['table', 'Table'],
  ['svg', 'Icon'],
];

function paletteItem(tag, label) {
  const item = document.createElement('div');
  item.className = 'palette-item';
  item.textContent = label;
  item.draggable = true;
  item.addEventListener('dragstart', (e) => {
    if (HE.canvas.mode !== 'edit') {
      e.preventDefault();
      return;
    }
    HE.draggingTag = tag;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', tag);
  });
  item.addEventListener('dragend', () => (HE.draggingTag = null));
  item.addEventListener('click', () => {
    if (HE.canvas.mode !== 'edit') return;
    const sel = HE.canvas.selected;
    if (sel && sel !== HE.canvas.doc.body) {
      const pos = HE.canvas.canContainChildren(sel) ? 'append' : 'after';
      HE.canvas.insertElement(tag, sel, pos);
    } else if (HE.canvas.doc) {
      HE.canvas.insertElement(tag, HE.canvas.doc.body, 'append');
    }
  });
  return item;
}

function buildPalette() {
  const grid = document.getElementById('palette-grid');
  const moreGrid = document.getElementById('palette-more-grid');
  const toggle = document.getElementById('palette-more-toggle');
  if (!grid) return;
  for (const [tag, label] of PALETTE) grid.appendChild(paletteItem(tag, label));
  if (moreGrid) for (const [tag, label] of PALETTE_MORE) moreGrid.appendChild(paletteItem(tag, label));
  if (toggle && moreGrid) {
    toggle.addEventListener('click', () => {
      const willOpen = moreGrid.hidden;
      moreGrid.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
    });
  }
}

// Site-wide :root tokens live in the left sidebar (no selection needed).
// Reuses the panel's token builder; called from renderPanel so every
// refresh path (select, page load, undo/redo, versions, token add/delete)
// keeps it fresh. Value edits don't rebuild mid-typing (change on blur).
HE.renderTokens = function () {
  const host = document.getElementById('token-list');
  if (!host) return;
  host.innerHTML = '';
  if (!HE.sheet) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Open a site to manage tokens.';
    host.appendChild(empty);
    return;
  }
  try {
    buildTokens(host);
  } catch {
    /* token list is best-effort */
  }
};

// ---------- mode ----------

let previewStatusOpen = false;

function closePreviewStatus(focusTrigger = true) {
  const popover = document.getElementById('preview-status-popover');
  const trigger = document.getElementById('preview-status-trigger');
  if (popover) popover.hidden = true;
  previewStatusOpen = false;
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  if (focusTrigger && trigger && !document.getElementById('preview-status-wrap')?.hidden) {
    trigger.focus();
  }
}

function closePreviewStatusIfOpen() {
  const popover = document.getElementById('preview-status-popover');
  if (!previewStatusOpen && (!popover || popover.hidden)) return false;
  closePreviewStatus();
  return true;
}

function positionPreviewStatus() {
  const trigger = document.getElementById('preview-status-trigger');
  const popover = document.getElementById('preview-status-popover');
  if (!trigger || !popover || popover.hidden) return;
  try {
    const r = trigger.getBoundingClientRect();
    const gap = 6;
    const maxHeight = Math.min(popover.scrollHeight || 260, window.innerHeight - 16);
    const openUp = r.bottom + gap + maxHeight > window.innerHeight - 8;
    const top = openUp ? Math.max(8, r.top - gap - maxHeight) : r.bottom + gap;
    const width = Math.min(360, window.innerWidth - 16);
    const right = Math.min(window.innerWidth - 8, Math.max(8, r.right));
    popover.style.width = width + 'px';
    popover.style.top = top + 'px';
    popover.style.left = Math.max(8, right - width) + 'px';
  } catch { /* retain the last position */ }
}

function openPreviewStatus() {
  const wrap = document.getElementById('preview-status-wrap');
  const trigger = document.getElementById('preview-status-trigger');
  const popover = document.getElementById('preview-status-popover');
  if (!wrap || !trigger || !popover || wrap.hidden) return;
  popover.hidden = false;
  previewStatusOpen = true;
  trigger.setAttribute('aria-expanded', 'true');
  positionPreviewStatus();
  const close = document.getElementById('preview-status-close');
  if (close) close.focus();
}

function previewDiagnostics() {
  if (!HE.canvas || HE.canvas.mode !== 'preview') return { errors: [], resources: [] };
  try {
    const diagnostics = HE.canvas.getRuntimeDiagnostics
      ? HE.canvas.getRuntimeDiagnostics()
      : { errors: [], resources: [] };
    return diagnostics || { errors: [], resources: [] };
  } catch {
    return { errors: [], resources: [] };
  }
}

function syncPreviewStatus() {
  const wrap = document.getElementById('preview-status-wrap');
  const trigger = document.getElementById('preview-status-trigger');
  const dot = document.getElementById('preview-status-dot');
  const label = document.getElementById('preview-status-label');
  const title = document.getElementById('preview-status-title');
  const subtitle = document.getElementById('preview-status-subtitle');
  if (!wrap || !trigger || !dot || !label || !title || !subtitle) return;

  const isPreview = HE.canvas && HE.canvas.mode === 'preview';
  let retained = null;
  try {
    retained = HE.canvas && HE.canvas.getRetainedPreviewState
      ? HE.canvas.getRetainedPreviewState()
      : null;
  } catch { retained = null; }
  const diagnostics = previewDiagnostics();
  const count = (diagnostics.errors || []).length + (diagnostics.resources || []).length;
  const visible = isPreview || !!retained;
  wrap.hidden = !visible;
  if (!visible) {
    closePreviewStatus(false);
    return;
  }

  const issue = isPreview && count > 0;
  trigger.classList.toggle('has-error', issue);
  trigger.classList.toggle('has-retained', !isPreview && !!retained);
  trigger.classList.toggle('is-ok', isPreview && !issue);
  dot.className = 'preview-status-dot' + (issue ? ' error' : (!isPreview ? ' retained' : ' ok'));

  if (isPreview) {
    label.textContent = issue ? `Preview · ${count} issue${count === 1 ? '' : 's'}` : 'Preview · ready';
    title.textContent = 'Preview running';
    subtitle.textContent = issue ? 'Needs attention' : 'Temporary view';
    trigger.title = issue ? 'Show Preview runtime issues' : 'Show Preview status';
    trigger.setAttribute('aria-label', issue ? `Preview has ${count} runtime issue${count === 1 ? '' : 's'}` : 'Show Preview status');
  } else {
    label.textContent = 'State retained';
    title.textContent = 'Preview state retained';
    subtitle.textContent = 'Ready to style';
    trigger.title = 'Show retained Preview state';
    trigger.setAttribute('aria-label', 'Show retained Preview state');
  }
  if (previewStatusOpen) positionPreviewStatus();
}

async function setMode(next) {
  if (!HE.page) return;
  await HE.canvas.setMode(next);
  updateModeUI();
}

function updateRetainedStateUI() {
  const banner = document.getElementById('state-banner');
  const text = document.getElementById('state-banner-text');
  const commit = document.getElementById('state-commit-btn');
  if (!banner || !text || !commit) {
    syncPreviewStatus();
    return;
  }
  let retained = null;
  try {
    retained = HE.canvas && HE.canvas.getRetainedPreviewState
      ? HE.canvas.getRetainedPreviewState()
      : null;
  } catch { retained = null; }
  if (HE.canvas.mode !== 'edit' || !retained) {
    banner.hidden = true;
    syncPreviewStatus();
    return;
  }
  const details = retained.summary.text || 'The visible runtime state is available for styling.';
  const reminder = retained.summary.canCommit
    ? 'Runtime changes are temporary until you make a default.'
    : 'Runtime view state is temporary and will not be saved.';
  text.textContent = `${details}. ${reminder}`;
  commit.hidden = !retained.summary.canCommit;
  banner.hidden = false;
  syncPreviewStatus();
}

function updateRuntimeStatus() {
  const status = document.getElementById('preview-runtime-status');
  const row = document.getElementById('preview-runtime-row');
  if (!status) {
    syncPreviewStatus();
    return;
  }
  if (HE.canvas.mode !== 'preview') {
    status.textContent = '';
    status.className = 'runtime-status';
    status.removeAttribute('title');
    if (row) row.hidden = true;
    syncPreviewStatus();
    return;
  }
  if (row) row.hidden = false;
  let diagnostics = { errors: [], resources: [] };
  try {
    if (HE.canvas.getRuntimeDiagnostics) diagnostics = HE.canvas.getRuntimeDiagnostics();
  } catch { /* diagnostics are best-effort */ }
  diagnostics = diagnostics || { errors: [], resources: [] };
  const errors = diagnostics.errors || [];
  const resources = diagnostics.resources || [];
  const count = errors.length + resources.length;
  if (!count) {
    status.textContent = 'No runtime errors';
    status.className = 'runtime-status ok';
    status.title = 'Preview scripts have not reported an error.';
    syncPreviewStatus();
    return;
  }
  status.textContent = `${count} runtime issue${count === 1 ? '' : 's'}`;
  status.className = 'runtime-status error';
  const first = errors[0];
  status.title = first
    ? `${first.message}${first.source ? ` (${String(first.source).split('/').pop()}:${first.line || '?'})` : ''}`
    : `${resources.length} resource failed to load`;
  syncPreviewStatus();
}

HE.onRuntimeDiagnostics = updateRuntimeStatus;

function updateModeUI() {
  const m = HE.canvas.mode;
  document.body.dataset.mode = m;
  document.querySelectorAll('#mode-switch button').forEach((btn) => {
    const on = btn.dataset.mode === m;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  const banner = document.getElementById('preview-banner');
  if (banner) banner.hidden = m !== 'preview';
  updateRetainedStateUI();
  updateRuntimeStatus();
  const note = document.getElementById('preview-panel-note');
  const panel = document.getElementById('panel');
  const empty = document.getElementById('panel-empty');
  if (note && panel && empty) {
    if (m === 'preview') {
      note.hidden = false;
      panel.hidden = true;
      empty.hidden = true;
    } else {
      note.hidden = true;
      if (HE.canvas.selected) {
        panel.hidden = false;
        empty.hidden = true;
        HE.panel.refresh();
      } else {
        panel.hidden = true;
        empty.hidden = false;
      }
    }
  }
}

HE.onModeChange = function () {
  updateModeUI();
};

// In-preview link clicks → switch pages (relative HTML only)
HE.onPreviewNavigate = async function (href) {
  if (!HE.project) return;
  // resolve relative to current page dir
  const baseDir = HE.page.includes('/') ? HE.page.replace(/\/[^/]+$/, '') : '';
  let target = href.replace(/^\.\//, '');
  if (target.startsWith('../')) {
    // simple resolve
    const parts = (baseDir ? baseDir.split('/') : []).concat(target.split('/'));
    const stack = [];
    for (const p of parts) {
      if (p === '..') stack.pop();
      else if (p && p !== '.') stack.push(p);
    }
    target = stack.join('/');
  } else if (baseDir && !target.startsWith('/')) {
    target = baseDir + '/' + target;
  }
  target = target.replace(/^\//, '');
  if (!HE.project.pages.includes(target)) {
    // try index in folder etc. — ignore unknown
    return;
  }
  if (HE.dirty) {
    const choice = await HE.confirmLeavePage('Open the linked page without saving? Unsaved work stays as a draft.');
    if (choice === 'cancel') return;
  }
  await loadPage(target);
};

// ---------- project / pages ----------

async function applyProject(result) {
  if (!result || result.error) {
    if (result && result.error) HE.toast(result.error, 'error');
    return false;
  }
  HE.project = result;
  HE.cssFile = (result.stylesheets || [])[0] || null;
  HE.cssLinked = false;
  HE.cssExternal = [];
  HE.baseUrl = await window.he.baseUrl();
  HE.canvas.setBaseUrl(HE.baseUrl);

  document.getElementById('project-name').textContent = result.dir.split(/[\\/]/).pop();
  renderCssFileName();
  document.getElementById('welcome').hidden = true;
  document.getElementById('app').hidden = false;

  renderRecent(result.recent || []);

  // Fresh version state per project; memory drafts reset (on-disk drafts
  // persist per project and are offered back by loadPage).
  HE.versions.meta = null;
  HE.drafts = {};
  HE.autosaveDraft = null;
  HE.gitInfo = null;
  try {
    if (window.he && window.he.gitInfo) HE.gitInfo = await window.he.gitInfo(result.dir);
  } catch { /* branch display is best-effort */ }
  if (HE.renderBranchName) HE.renderBranchName();
  HE.versions.refresh().catch(() => null);

  const first = result.pages.includes('index.html') ? 'index.html' : result.pages[0];
  await loadPage(first);
  updateModeUI();
  HE.announceOtherDrafts(result.pages, first).catch(() => {});
  return true;
}

// After opening a project, point at on-disk drafts for the other pages —
// each page offers its own Restore/Discard when opened.
HE.announceOtherDrafts = async function (pages, exceptPage) {
  const ipc = HE.draftIpc();
  if (!ipc || !projectDir() || !HE.autosave) return;
  let list = [];
  try {
    list = await ipc.list(projectDir(), pages);
  } catch {
    return;
  }
  const others = (list || []).filter((d) => d.page !== exceptPage && !HE.getDraft(d.page));
  if (!others.length || !HE.toast) return;
  const names = others.slice(0, 3).map((d) => d.page).join(', ');
  HE.toast(
    `Unsaved draft${others.length === 1 ? '' : 's'} on ${names}${others.length > 3 ? ` +${others.length - 3} more` : ''} — open the page to restore.`,
    'info'
  );
};

async function openProject() {
  if (HE.dirty) {
    const choice = await HE.confirmLeavePage('Open another site without saving? Unsaved work stays as a draft.');
    if (choice === 'cancel') return;
  }
  const result = await window.he.openProject();
  if (!result) return;
  await applyProject(result);
}

async function openPath(dir) {
  if (HE.dirty) {
    const choice = await HE.confirmLeavePage('Open another site without saving? Unsaved work stays as a draft.');
    if (choice === 'cancel') return;
  }
  const result = await window.he.openProjectPath(dir);
  await applyProject(result);
}

async function openDemo() {
  const dir = await window.he.demoPath();
  await openPath(dir);
}

async function readCss(file = HE.cssFile) {
  if (!file) return '';
  const text = await window.he.readFile(file);
  void HE.recordStamp(file);
  return text;
}

// Target picker: switch the live stylesheet new rules are written to.
// Reloads the selected file into the live <style data-he-live> sheet.
HE.switchStylesheet = async function (file) {
  if (!HE.project || !(HE.project.stylesheets || []).includes(file)) return false;
  if (file === HE.cssFile) return true;
  if (HE.dirty) {
    const choice = await HE.confirmLeavePage('Switch stylesheet without saving? Unsaved work stays as a draft.');
    if (choice === 'cancel') {
      if (HE.panel && HE.panel.refresh) HE.panel.refresh();
      return false;
    }
  }
  HE.cssFile = file;
  const cssText = await readCss(file);
  const live = HE.canvas && HE.canvas.doc && HE.canvas.doc.querySelector('style[data-he-live]');
  if (live && HE.sheet) {
    HE.sheet.load(cssText);
    if (HE.canvas.syncGoogleFontsFromSheet) HE.canvas.syncGoogleFontsFromSheet();
  }
  const label = document.getElementById('css-file-name');
  if (label) label.textContent = file || '— none —';
  HE.externalChanges = HE.externalChanges.filter((c) => c.path !== file);
  renderExternalBanner();
  if (HE.tree) HE.tree.rebuild();
  if (HE.refreshViewports) HE.refreshViewports();
  if (HE.panel && HE.panel.refresh) HE.panel.refresh();
  return true;
};

function isExternalCssHref(href) {
  return /^(?:https?:)?\/\//i.test(String(href || '').trim());
}

// Classify all rel=stylesheet links on a page:
// - linked: project stylesheet resolved via relative href (or null)
// - external: CDN/remote stylesheet hrefs (warn-only, never auto-fix)
// - hasLocalLink: any non-external, non-data stylesheet link present
function analyzeStylesheets(page, html) {
  const out = { linked: null, external: [], hasLocalLink: false };
  if (!HE.project || !(HE.project.stylesheets || []).length) return out;
  let links = [];
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    links = [...parsed.querySelectorAll('link[href]')].filter((candidate) =>
      /(^|\s)stylesheet(\s|$)/i.test(candidate.getAttribute('rel') || '')
    );
  } catch {
    return out;
  }
  for (const link of links) {
    const href = (link.getAttribute('href') || '').trim();
    if (!href || /^(?:data|blob|javascript):/i.test(href)) continue;
    // Google Fonts injected/managed by the editor are not page stylesheets
    if (/fonts\.googleapis\.com\/css2/i.test(href)) continue;
    if (isExternalCssHref(href)) {
      out.external.push(href);
      continue;
    }
    out.hasLocalLink = true;
    if (out.linked) continue;
    try {
      const pageUrl = new URL(page, 'https://werkstatt.invalid/');
      const stylesheetUrl = new URL(href, pageUrl);
      if (stylesheetUrl.origin !== pageUrl.origin) continue;
      const relative = decodeURIComponent(stylesheetUrl.pathname).replace(/^\/+/, '');
      const match = HE.project.stylesheets.find((file) => file === relative);
      if (match) out.linked = match;
    } catch {
      /* unresolvable href — ignore */
    }
  }
  return out;
}
HE._analyzeStylesheets = analyzeStylesheets;

// Project-relative href from a page to a project CSS file, e.g.
// page "docs/about.html" + css "styles.css" -> "../styles.css".
function relativeHref(page, cssFile) {
  const pageDir = page && page.includes('/') ? page.split('/').slice(0, -1) : [];
  const cssParts = String(cssFile || '').split('/').filter(Boolean);
  const cssDir = cssParts.slice(0, -1);
  let common = 0;
  while (common < pageDir.length && common < cssDir.length && pageDir[common] === cssDir[common]) {
    common++;
  }
  const ups = pageDir.length - common;
  const rest = cssParts.slice(common);
  return [...Array(ups).fill('..'), ...rest].join('/') || cssParts[cssParts.length - 1] || '';
}
HE._relativeHref = relativeHref;

function renderCssFileName() {
  const elm = document.getElementById('css-file-name');
  if (!elm) return;
  if (!HE.cssFile) {
    elm.textContent = '— none —';
    return;
  }
  const base = HE.cssFile.split('/').pop() || HE.cssFile;
  elm.textContent = HE.cssLinked ? `${base} (linked from <link>)` : `${base} (fallback, not linked)`;
}

// Re-derive linked/fallback state from HTML source (used after undo/redo,
// which bypass loadPage). Keeps the fallback file so edits still have a
// target, but flips the header + warnings back to "not linked".
function refreshCssStatusFromHtml(html) {
  if (!HE.project || !HE.page) return;
  const info = analyzeStylesheets(HE.page, html);
  HE.cssExternal = info.external;
  if (info.linked) {
    HE.cssFile = info.linked;
    HE.cssLinked = true;
  } else {
    if (!HE.cssFile || !(HE.project.stylesheets || []).includes(HE.cssFile)) {
      HE.cssFile = (HE.project.stylesheets || [])[0] || null;
    }
    HE.cssLinked = false;
  }
  renderCssFileName();
  updateWarnings();
}

// Insert <link rel="stylesheet" href="..."> into the live document with the
// correct relative path for the page's subdirectory. Save round-trips it
// because serializeDoc preserves author <link> tags; Preview resolves it
// via the hesite:// <base> tag injected by canvas.js.
async function linkSharedStylesheet() {
  if (HE.canvas.mode !== 'edit') {
    // Preview DOM is throwaway — switch back so the link lands in the
    // editable document and survives save / mode switches.
    await HE.canvas.setMode('edit');
    if (typeof HE.onModeChange === 'function') HE.onModeChange();
  }
  const doc = HE.canvas.doc;
  if (!doc || !HE.page || !HE.cssFile) return false;
  // Already linked (e.g. double click) — just refresh state.
  try {
    const current = analyzeStylesheets(HE.page, HE.canvas.serializeDoc());
    if (current.linked) {
      HE.cssLinked = true;
      HE.cssFile = current.linked;
      HE.cssExternal = current.external;
      renderCssFileName();
      updateWarnings();
      return true;
    }
  } catch {
    /* fall through to insert */
  }
  HE.commit();
  const href = relativeHref(HE.page, HE.cssFile);
  const link = doc.createElement('link');
  link.setAttribute('rel', 'stylesheet');
  link.setAttribute('href', href);
  const head = doc.head || doc.documentElement;
  const firstCss = head.querySelector('link[rel~="stylesheet"], style[data-he-live]');
  if (firstCss && firstCss.parentElement === head) head.insertBefore(link, firstCss);
  else head.appendChild(link);
  HE.cssLinked = true;
  renderCssFileName();
  HE.afterDomChange();
  updateWarnings();
  return true;
}
HE.linkSharedStylesheet = linkSharedStylesheet;

async function loadPage(name) {
  cancelAutosave();
  if (HE.canvas && HE.canvas.clearRetainedPreviewState) HE.canvas.clearRetainedPreviewState();
  const html = await window.he.readFile(name);
  void HE.recordStamp(name);
  HE.pageScripts = scanScripts(html);
  const info = analyzeStylesheets(name, html);
  HE.cssFile = info.linked || (HE.project.stylesheets || [])[0] || null;
  HE.cssLinked = !!info.linked;
  HE.cssExternal = info.external;
  const cssText = await readCss();
  // An explicit "reload from disk" skips the draft offer — the user already
  // chose the disk version.
  const src = (HE.skipDraftRestore === name)
    ? { html, css: cssText, restored: false }
    : await HE.maybeRestoreDraft(name, html, cssText);
  HE.skipDraftRestore = null;
  // Handoff baseline: the last content loaded from or written to disk.
  if (!src.restored || !HE.baselines[name]) {
    HE.baselines[name] = { html, css: cssText, cssFile: HE.cssFile, at: Date.now() };
  }
  HE.handoffNoteCache = null;
  HE.canvas.setPageRel(name);
  await HE.canvas.loadPage(src.html, src.css);
  HE.page = name;
  renderCssFileName();
  undoStack.length = 0;
  redoStack.length = 0;
  HE.crossPageJournal.length = 0;
  if (src.restored) {
    const draft = HE.getDraft(name);
    HE.autosaveDraft = {
      page: name,
      cssFile: HE.cssFile,
      html: src.html,
      css: src.css,
      capturedAt: (draft && draft.capturedAt) || Date.now(),
    };
    markDirty();
    if (HE.toast) HE.toast('Unsaved draft restored — press Save to write it to files.', 'info');
  } else {
    clearDirty();
  }
  renderPageList();
  renderScriptList();
  await loadJsFiles();
  void loadSiblingPageDocs();
  updateWarnings();
  // Shared-component scan reads the other pages; run it in the background
  // so page switches stay snappy.
  if (HE.refreshComponents) HE.refreshComponents();
  if (HE.refreshViewports) HE.refreshViewports();
}
HE.loadPage = loadPage;

// ---------- external changes (agent/tool writes while the folder is open) ----------

function externalBannerEl() {
  let el = document.getElementById('external-change-banner');
  if (el) return el;
  const warnings = document.getElementById('page-warnings');
  const host = warnings && warnings.parentNode;
  if (!host) return null;
  el = document.createElement('div');
  el.id = 'external-change-banner';
  el.className = 'external-change';
  el.hidden = true;
  el.setAttribute('role', 'status');
  host.insertBefore(el, warnings.nextSibling);
  return el;
}

function changeKindWord(kind) {
  if (kind === 'add') return 'added';
  if (kind === 'unlink') return 'deleted';
  return 'changed';
}

function renderExternalBanner() {
  const el = externalBannerEl();
  if (!el) return;
  const current = HE.externalChanges.filter((c) => c.path === HE.page || c.path === HE.cssFile);
  if (!current.length) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = '';
  const names = current.map((c) => `${c.path} (${changeKindWord(c.kind)})`).join(', ');
  el.append(document.createTextNode(`Changed on disk: ${names} — another program wrote these files.`));
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload from disk';
  reload.addEventListener('click', () => { void HE.reloadFromDisk(); });
  const keep = document.createElement('button');
  keep.type = 'button';
  keep.textContent = 'Keep my edits';
  keep.addEventListener('click', () => {
    HE.externalChanges = HE.externalChanges.filter((c) => c.path !== HE.page && c.path !== HE.cssFile);
    renderExternalBanner();
  });
  const show = document.createElement('button');
  show.type = 'button';
  show.textContent = 'Show file';
  show.addEventListener('click', () => {
    const first = current[0];
    if (first && window.he && window.he.openFile) window.he.openFile(first.path);
  });
  el.append(reload, keep, show);
}

// Explicit user choice: replace the in-memory page with the fresh disk copy.
HE.reloadFromDisk = async function () {
  if (!HE.page) return false;
  let keepDraft = false;
  if (HE.dirty) {
    let choice = 'keep';
    try {
      choice = await HE.confirmLeavePage('Files changed on disk. Reload this page?');
    } catch {
      choice = 'cancel';
    }
    if (choice === 'cancel') return false;
    if (choice === 'discard') {
      HE.clearDraft(HE.page);
      clearDirty();
    } else {
      keepDraft = true;
    }
  }
  HE.skipDraftRestore = HE.page;
  await loadPage(HE.page);
  HE.externalChanges = HE.externalChanges.filter((c) => c.path !== HE.page && c.path !== HE.cssFile);
  if (keepDraft) markDirty();
  renderExternalBanner();
  updateWarnings();
  return true;
};

HE.onExternalChange = function (payload) {
  if (!payload || !Array.isArray(payload.changes) || !HE.project) return;
  if (Array.isArray(payload.pages) && payload.pages.length) HE.project.pages = payload.pages;
  if (Array.isArray(payload.stylesheets) && payload.stylesheets.length) HE.project.stylesheets = payload.stylesheets;
  for (const change of payload.changes) {
    if (!change || !change.path) continue;
    if (HE.fileStamps[change.path]) delete HE.fileStamps[change.path];
    const existing = HE.externalChanges.find((c) => c.path === change.path);
    if (existing) {
      existing.kind = change.kind;
      existing.at = Date.now();
    } else {
      HE.externalChanges.push({ path: change.path, kind: change.kind, at: Date.now() });
    }
  }
  renderPageList();
  renderExternalBanner();
  const relevant = HE.externalChanges.some((c) => c.path === HE.page || c.path === HE.cssFile);
  if (!relevant && HE.toast) {
    const first = HE.externalChanges[HE.externalChanges.length - 1];
    if (first) HE.toast(`Folder changed: ${first.path} (${changeKindWord(first.kind)})`, 'info');
  }
};

function initExternalWatch() {
  if (HE.watchBound) return;
  const ipc = HE.watchIpc();
  if (!ipc || !ipc.onProjectChange) return;
  HE.watchBound = true;
  ipc.onProjectChange((payload) => HE.onExternalChange(payload));
}
HE.initExternalWatch = initExternalWatch;

// ---------- agent handoff note (what to tell the next agent run) ----------

HE.buildHandoffNote = function () {
  if (!HE.page || !HE.canvas) return null;
  if (HE.canvas.editing) {
    // A live text session would be ended by serializeDoc — finish it first.
    try {
      const active = HE.canvas.doc && HE.canvas.doc.activeElement;
      if (active && active.blur) active.blur();
    } catch { /* ignore */ }
  }
  const snap = HE.canvas.editSnapshot();
  const base = HE.baselines[HE.page];
  if (!base) return null;
  const summary = summarizeChanges({
    baselineHtml: base.html,
    currentHtml: snap.html,
    baselineCss: base.css || '',
    currentCss: snap.css || '',
  });
  const when = Date.now();
  return {
    page: HE.page,
    when,
    count: summarizeCounts(summary),
    note: formatHandoffNote(summary, { page: HE.page, when }),
  };
};

HE.copyHandoffNote = async function () {
  const result = HE.buildHandoffNote();
  if (!result) {
    if (HE.toast) HE.toast('No baseline yet — open the page first.', 'info');
    return false;
  }
  try {
    await navigator.clipboard.writeText(result.note);
    if (HE.toast) {
      HE.toast(
        `Copied handoff note (${result.count} change${result.count === 1 ? '' : 's'}) — paste it into the next agent prompt.`,
        'success'
      );
    }
    return true;
  } catch {
    if (HE.toast) HE.toast('Copy failed.', 'error');
    return false;
  }
};

HE.saveHandoffNote = async function () {
  const result = HE.buildHandoffNote();
  if (!result) return false;
  try {
    await window.he.writeFile('AGENT_HANDOFF.md', result.note + '\n');
    void HE.recordStamp('AGENT_HANDOFF.md');
    if (HE.toast) HE.toast('Saved AGENT_HANDOFF.md — the next agent run can read it.', 'success');
    return true;
  } catch {
    if (HE.toast) HE.toast('Could not write AGENT_HANDOFF.md.', 'error');
    return false;
  }
};

// ---------- page scripts (read-only visibility) ----------

// The editor never edits JS — it only makes scripts visible and keeps them
// from breaking the editing model (neutralized in Edit, live in Preview).
function scanScripts(html) {
  const external = [];
  let inline = 0;
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const s of parsed.querySelectorAll('script')) {
      const src = s.getAttribute('src');
      if (src) external.push(src.trim());
      else if ((s.textContent || '').trim()) inline++;
    }
  } catch {
    /* unparseable — treat as no scripts */
  }
  return { external, inline };
}

function isExternalScript(src) {
  return /^(?:https?:)?\/\//i.test(src);
}

// Resolve a script src to a project-relative path, or null for
// external/data URLs (mirrors stylesheet link resolution).
function resolveScriptPath(src) {
  if (!src || isExternalScript(src) || /^(?:data|blob|javascript):/i.test(src)) return null;
  try {
    const pageUrl = new URL(HE.page, 'https://werkstatt.invalid/');
    const scriptUrl = new URL(src, pageUrl);
    if (scriptUrl.origin !== pageUrl.origin) return null;
    return decodeURIComponent(scriptUrl.pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
}
HE._resolveScriptPath = resolveScriptPath;

// Load project JS files as text for the source-backed Behavior panel.
// Never executes the code — regex parsing only (see hooks.js).
// Paths are project-relative; the main process resolves them (safeResolve).
async function loadJsFiles() {
  HE.jsFiles = [];
  if (!HE.project || !HE.pageScripts || !HE.pageScripts.external) return HE.jsFiles;
  const seen = new Set();
  for (const src of HE.pageScripts.external) {
    let rel = null;
    try {
      rel = resolveScriptPath(src);
    } catch {
      rel = null;
    }
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    try {
      const text = await window.he.readFile(rel);
      HE.jsFiles.push({ src, rel, full: rel, text: String(text || '') });
    } catch {
      /* unreadable — skip, script list still shows the file */
    }
    if (HE.jsFiles.length >= 10) break;
  }
  if (HE.canvas && HE.canvas.selected && HE.panel && HE.panel.refresh) {
    try {
      HE.panel.refresh();
    } catch {
      /* panel refresh is best-effort */
    }
  }
  return HE.jsFiles;
}

// Parsed sibling pages, read once per page switch/save so a shared app.js hook
// that lives on another page does not warn on this one (Task 113). Runs in the
// background: warnings are suppressed while the docs are unknown, then recomputed.
let siblingLoadToken = 0;
async function loadSiblingPageDocs() {
  const token = ++siblingLoadToken;
  HE.siblingPageDocs = null; // unknown while reading — suppress missing-hook notes
  if (!HE.project || !Array.isArray(HE.project.pages) || !HE.page) {
    HE.siblingPageDocs = [];
    return;
  }
  const pages = HE.project.pages.filter((p) => p && p !== HE.page).slice(0, 25);
  const docs = [];
  for (const p of pages) {
    try {
      const html = await window.he.readFile(p);
      docs.push(new DOMParser().parseFromString(String(html || ''), 'text/html'));
    } catch {
      /* unreadable sibling — skip, it cannot vouch for a hook */
    }
  }
  if (token !== siblingLoadToken) return; // superseded by a newer load
  HE.siblingPageDocs = docs;
  updateWarnings();
}
HE._loadSiblingPageDocs = loadSiblingPageDocs;

function renderScriptList() {
  const ul = document.getElementById('script-list');
  if (!ul) return;
  ul.innerHTML = '';
  const info = HE.pageScripts;
  if (!info || (!info.external.length && !info.inline)) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '— none —';
    ul.appendChild(li);
    return;
  }
  for (const src of info.external) {
    const li = document.createElement('li');
    const local = resolveScriptPath(src);
    const name = src.split('/').pop() || src;
    if (local) {
      li.textContent = name;
      li.className = 'script-file';
      li.title = src + ' — click to open in external editor';
      li.addEventListener('click', async () => {
        if (!window.he.openFile) return;
        const err = await window.he.openFile(local);
        if (err) HE.toast('Could not open ' + src + ':\n' + err, 'error');
      });
    } else {
      li.textContent = name + ' ';
      li.className = 'script-external';
      li.title = src;
      const chip = document.createElement('span');
      chip.className = 'script-chip';
      chip.textContent = 'blocked';
      chip.title = 'External scripts are blocked in Preview — vendor this file into the site folder';
      li.appendChild(chip);
    }
    ul.appendChild(li);
  }
  if (info.inline) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = info.inline + ' inline script' + (info.inline > 1 ? 's' : '');
    ul.appendChild(li);
  }
}

// ---------- page warnings (blocked scripts, duplicate ids) ----------
//
// Two tiers: the actionable "not linked to the shared stylesheet" warning stays
// above the canvas (nothing applies until it is fixed), while the per-page
// notes — styleguide hint, blocked external scripts, duplicate ids and missing
// JS hooks — are collected on HE.pageIssues and rendered in the panel's
// collapsed "Page issues" section instead of stacking up over the page.

function updateWarnings() {
  const bar = document.getElementById('page-warnings');
  if (!bar) return;
  bar.innerHTML = '';
  let count = 0;

  // Actionable: the page does not link the project stylesheet.
  if (HE.project && (HE.project.stylesheets || []).length && HE.page && HE.cssFile && !HE.cssLinked) {
    const cssBase = HE.cssFile.split('/').pop() || HE.cssFile;
    const external = HE.cssExternal || [];
    const div = document.createElement('div');
    div.className = 'page-warning';
    const label = document.createElement('span');
    if (external.length) {
      label.textContent =
        '⚠ Not linked to shared stylesheet — page uses external/CDN stylesheet only' +
        ' (' + external.slice(0, 2).join(', ') + '). Link ' + cssBase + ' to edit styles locally.';
      div.appendChild(label);
      // warn-only: no auto-fix for CDN CSS
    } else {
      label.textContent = '⚠ Not linked to shared stylesheet — styles in ' + cssBase + " won't apply to this page. ";
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Link ' + cssBase;
      btn.addEventListener('click', () => linkSharedStylesheet());
      div.appendChild(label);
      div.appendChild(btn);
    }
    bar.appendChild(div);
    count++;
  }
  bar.hidden = count === 0;

  const issues = [];
  if (HE.page && /(^|\/)styleguide[^/]*\.html?$/i.test(HE.page)) {
    issues.push({
      kind: 'note',
      text: 'Styleguide — optional reference. Edit tokens/classes here; safe to exclude from deploy.',
    });
  }
  if (HE.pageScripts) {
    for (const src of HE.pageScripts.external) {
      if (isExternalScript(src)) {
        issues.push({
          kind: 'warning',
          text: 'External script will not run in Preview (blocked by the editor): ' +
            src +
            ' — vendor it into the site folder to use it.',
        });
      }
    }
  }
  const doc = HE.canvas.doc;
  if (doc) {
    const seen = new Set();
    const dupes = new Set();
    for (const elm of doc.querySelectorAll('[id]')) {
      if (elm.id === 'he-overlay-root') continue;
      if (seen.has(elm.id)) dupes.add(elm.id);
      seen.add(elm.id);
    }
    for (const id of [...dupes].slice(0, 5)) {
      issues.push({
        kind: 'warning',
        text: 'Duplicate id "' + id + '" — scripts and anchor links will only find the first one.',
      });
    }
    // Per-page check: JS queries a selector that matches nothing on this page.
    try {
      if (HE.hooks && HE.hooks.missingSelectors) {
        for (const m of HE.hooks.missingSelectors(doc, 5, { otherDocs: HE.siblingPageDocs })) {
          issues.push({
            kind: 'warning',
            text: 'JS queries ' + m.selector + ' (' + m.file + ') but no element matches on this page.',
          });
        }
      }
    } catch {
      /* warnings are best-effort */
    }
  }

  // Only re-render the panel when the list actually changed — updateWarnings
  // fires on every page load, selection and mode switch.
  const signature = JSON.stringify(issues);
  if (signature !== HE.pageIssuesSig) {
    HE.pageIssuesSig = signature;
    HE.pageIssues = issues;
    try { if (HE.panel && HE.panel.refresh) HE.panel.refresh(); } catch { /* best-effort */ }
  }
}
HE.refreshWarnings = updateWarnings;

function renderPageList() {
  const ul = document.getElementById('page-list');
  ul.innerHTML = '';
  for (const name of HE.project.pages) {
    const li = document.createElement('li');
    const isGuide = /(^|\/)styleguide[^/]*\.html?$/i.test(name);
    li.textContent = isGuide ? name + ' · guide' : name;
    if (isGuide) li.title = 'Styleguide — optional reference, safe to exclude from deploy';
    if (name === HE.page) li.classList.add('on');
    li.addEventListener('click', async () => {
      if (name === HE.page) return;
      if (HE.dirty) {
        const choice = await HE.confirmLeavePage('Leave this page without saving? Unsaved work stays as a draft.');
        if (choice === 'cancel') return;
      }
      await loadPage(name);
    });
    ul.appendChild(li);
  }
}

function renderRecent(list) {
  const host = document.getElementById('recent-list');
  if (!host) return;
  host.innerHTML = '';
  if (!list || !list.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const title = document.createElement('h2');
  title.textContent = 'Recent';
  host.appendChild(title);
  const ul = document.createElement('ul');
  for (const dir of list) {
    const li = document.createElement('li');
    const name = dir.split(/[\\/]/).pop();
    li.innerHTML = `<strong>${escapeHtml(name)}</strong><span class="muted">${escapeHtml(dir)}</span>`;
    li.addEventListener('click', () => openPath(dir));
    ul.appendChild(li);
  }
  host.appendChild(ul);
}

async function save(writer) {
  if (!HE.page) return false;
  // Preview is throwaway: editSnapshot() returns the last edit state there,
  // so page-script mutations never get baked into the saved file.
  // Preview-only state simulation (.is-open etc.) is likewise stripped by
  // serializeDoc inside editSnapshot — the live Edit view keeps its preview
  // but the file only keeps classes attached via chips (noteRealClass).
  cancelAutosave();
  const page = HE.page;
  const cssFile = HE.cssFile;
  const customWriter = typeof writer === 'function';
  const snap = HE.canvas.editSnapshot();
  const targets = [[page, snap.html]];
  if (cssFile) targets.push([cssFile, snap.css]);

  // External-change guard: if an agent rewrote a file after we loaded it,
  // never silently overwrite. Checked writes in main close the race.
  let forceOverwrite = false;
  if (!customWriter) {
    const ipc = HE.fileIpc();
    const conflicts = [];
    if (ipc && ipc.statFile) {
      for (const [file] of targets) {
        const expected = HE.fileStamps[file];
        if (!expected) continue;
        let current = null;
        try { current = await ipc.statFile(file); } catch { current = null; }
        if (!current || !sameFileStamp(expected, current)) conflicts.push(file);
      }
    }
    if (conflicts.length) {
      let choice = 2;
      try {
        choice = ipc.confirmExternalConflict
          ? await ipc.confirmExternalConflict(conflicts)
          : 2;
      } catch {
        choice = 2;
      }
      if (choice === 2) return false;
      if (choice === 1) {
        captureAutosaveDraft();
        try { await HE.persistDraft(page); } catch { /* memory draft still holds it */ }
        if (HE.toast) HE.toast('Kept your edits as a draft — files on disk were not overwritten.', 'info');
        return false;
      }
      // choice 0: overwrite the newer disk files with the editor version.
      forceOverwrite = true;
    }
  }

  if (customWriter) {
    await writer(page, snap.html);
    if (cssFile) await writer(cssFile, snap.css);
  } else {
    const ipc = HE.fileIpc();
    for (const [file, content] of targets) {
      const expected = forceOverwrite ? null : (HE.fileStamps[file] || null);
      let res = null;
      try {
        res = (ipc && ipc.writeFileChecked)
          ? await ipc.writeFileChecked(file, content, expected)
          : { ok: true, stamp: null };
      } catch {
        res = { ok: false, error: true };
      }
      if (!res || res.ok === false) {
        if (res && res.conflict && HE.toast) {
          HE.toast(`Could not save ${file} — it changed on disk again.`, 'error');
        }
        return false;
      }
      if (res.stamp) HE.fileStamps[file] = res.stamp;
      else void HE.recordStamp(file);
    }
  }
  clearDirty();
  HE.externalChanges = HE.externalChanges.filter((c) => c.path !== page && c.path !== cssFile);
  HE.baselines[page] = { html: snap.html, css: snap.css, cssFile, at: Date.now() };
  HE.handoffNoteCache = null;
  renderExternalBanner();
  // Saved markup may have gained/lost shared blocks — rescan lazily.
  if (HE.refreshComponents) HE.refreshComponents();
  void loadSiblingPageDocs();
  if (HE.versions && typeof HE.versions.afterSave === 'function') {
    try { await HE.versions.afterSave(); } catch { /* versions are best-effort */ }
  }
  return true;
}
HE.save = save;

// ---------- breadcrumb bar (selection path above canvas) ----------

function crumbLabel(elm) {
  const tag = elm.tagName.toLowerCase();
  const cls = [...elm.classList].slice(0, 2).map((c) => '.' + c).join('');
  const id = elm.id ? '#' + elm.id : '';
  return tag + id + cls;
}

function renderCrumbs() {
  const host = document.getElementById('crumbs');
  if (!host) return;
  const sel = HE.canvas && HE.canvas.selected;
  const doc = HE.canvas && HE.canvas.doc;
  host.innerHTML = '';
  if (!HE.page || !doc) { host.hidden = true; return; }
  host.hidden = false;
  const pageBtn = document.createElement('button');
  pageBtn.type = 'button';
  pageBtn.className = 'crumb' + (!sel ? ' on' : '');
  pageBtn.textContent = HE.page.split('/').pop();
  pageBtn.title = HE.page;
  pageBtn.addEventListener('click', () => { if (HE.canvas.deselect) HE.canvas.deselect(); });
  host.appendChild(pageBtn);
  if (!sel) return;
  const chain = [];
  let node = sel;
  while (node && node !== doc.body && node.nodeType === 1) {
    chain.unshift(node);
    node = node.parentElement;
  }
  if (doc.body) chain.unshift(doc.body);
  for (const elm of chain) {
    const sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.textContent = '›';
    host.appendChild(sep);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'crumb' + (elm === sel ? ' on' : '');
    b.textContent = crumbLabel(elm);
    b.title = crumbLabel(elm);
    b.addEventListener('click', () => { if (HE.canvas.select) HE.canvas.select(elm); });
    host.appendChild(b);
  }
}
HE.renderCrumbs = renderCrumbs;

// ---------- viewport ----------

function buildViewport() {
  const frame = document.getElementById('canvas-frame');
  const host = document.getElementById('viewport-switch');
  const setVp = (vp) => {
    HE.viewport = vp;
    host.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.vp === vp;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const px = mediaMaxWidthPx(vp);
    let width = '100%';
    if (vp === 'tablet') width = '768px';
    else if (vp === 'mobile') width = '375px';
    else if (px != null) width = px + 'px';
    frame.style.width = width;
    if (HE.panel && HE.panel.refresh) HE.panel.refresh();
  };
  HE.setViewport = setVp;
  host.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => setVp(btn.dataset.vp));
  });
  // Author-defined breakpoints from the stylesheet join the two fixed
  // defaults, so overrides can target the widths the site actually uses.
  const renderExtras = () => {
    const defaults = new Set([VIEWPORT_MEDIA.tablet, VIEWPORT_MEDIA.mobile]);
    let conditions = [];
    try {
      conditions = (HE.sheet && HE.sheet.mediaConditions) ? HE.sheet.mediaConditions() : [];
    } catch { conditions = []; }
    const extras = conditions.filter((c) => !defaults.has(c) && mediaMaxWidthPx(c) != null);
    const key = extras.join('|');
    const signature = key + '::' + [...host.querySelectorAll('button.vp-extra')]
      .map((b) => b.dataset.vp).join('|');
    if (signature !== renderExtras._signature) {
      renderExtras._signature = signature;
      host.querySelectorAll('button.vp-extra').forEach((b) => b.remove());
      for (const cond of extras) {
        const px = mediaMaxWidthPx(cond);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vp-extra';
        b.dataset.vp = cond;
        b.textContent = `≤${px}`;
        b.title = `Custom breakpoint @media ${cond}`;
        b.setAttribute('aria-label', `Custom breakpoint width ${px} pixels`);
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => setVp(cond));
        host.appendChild(b);
      }
    }
    // The active custom breakpoint can vanish with a stylesheet switch.
    if (HE.viewport !== 'desktop' && HE.viewport !== 'tablet' && HE.viewport !== 'mobile' &&
        ![...host.querySelectorAll('button.vp-extra')].some((b) => b.dataset.vp === HE.viewport)) {
      setVp('desktop');
    }
  };
  HE.refreshViewports = renderExtras;
  renderExtras();
}

function buildModeSwitch() {
  document.querySelectorAll('#mode-switch button').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  document.querySelectorAll('#content-switch button').forEach((btn) => {
    btn.addEventListener('click', () => HE.setScope(btn.dataset.cm));
  });
  try { document.body.dataset.contentmode = '0'; document.body.dataset.scope = 'design'; } catch { /* ignore */ }
}

// ---------- settings (single History/git off switch) ----------

HE.settings = { historyUi: true };

// Test seam: the settings IPC bridge (stubbed in smoke tests).
HE.settingsIpc = function () {
  return (window.he && window.he.settings) || null;
};

HE.applySettings = function () {
  const on = !HE.settings || HE.settings.historyUi !== false;
  const historyBtn = document.getElementById('history-btn');
  if (historyBtn) historyBtn.hidden = !on;
  const branchName = document.getElementById('branch-name');
  if (branchName) branchName.hidden = !on;
  const checkbox = document.getElementById('settings-history-ui');
  if (checkbox) checkbox.checked = on;
};

HE.setHistoryUi = async function (on) {
  HE.settings = { ...(HE.settings || {}), historyUi: !!on };
  try {
    const saved = await HE.settingsIpc()?.set({ historyUi: !!on });
    if (saved) HE.settings = { ...HE.settings, ...saved };
  } catch { /* chrome still updates — persisted next toggle */ }
  HE.applySettings();
};

function buildSettings() {
  const btn = document.getElementById('settings-btn');
  const menu = document.getElementById('settings-menu');
  if (!btn || !menu) return;
  const closeMenu = () => { menu.hidden = true; };
  const positionMenu = () => {
    try {
      const r = btn.getBoundingClientRect();
      menu.style.minWidth = '220px';
      const mh = menu.offsetHeight || 110;
      const openUp = r.bottom + 4 + mh > window.innerHeight - 8;
      menu.style.top = openUp
        ? Math.max(8, r.top - 4 - mh) + 'px'
        : (r.bottom + 4) + 'px';
      const mw = menu.offsetWidth || 220;
      menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
    } catch { /* fall back to last position */ }
  };
  const openMenu = () => {
    menu.hidden = false;
    positionMenu();
    const first = menu.querySelector('input');
    if (first) first.focus();
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !document.getElementById('settings-menu-wrap').contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { closeMenu(); btn.focus(); }
  });
  window.addEventListener('resize', closeMenu);
  try {
    const bar = btn.closest('#topbar');
    if (bar) bar.addEventListener('scroll', closeMenu);
  } catch { /* menu simply stays until next close trigger */ }
  const checkbox = document.getElementById('settings-history-ui');
  if (checkbox) {
    checkbox.addEventListener('change', () => {
      HE.setHistoryUi(checkbox.checked).catch(() => {
        HE.toast('Could not save the setting.', 'error');
      });
    });
  }
}

// ---------- boot ----------

window.addEventListener('DOMContentLoaded', async () => {
  buildPalette();
  buildViewport();
  buildModeSwitch();
  try {
    const stored = await HE.settingsIpc()?.get();
    if (stored) HE.settings = { ...HE.settings, ...stored };
  } catch { /* defaults stand */ }
  HE.applySettings();
  buildSettings();
  const previewStatusWrap = document.getElementById('preview-status-wrap');
  const previewStatusTrigger = document.getElementById('preview-status-trigger');
  const previewStatusPopover = document.getElementById('preview-status-popover');
  const previewStatusClose = document.getElementById('preview-status-close');
  if (previewStatusWrap && previewStatusTrigger && previewStatusPopover) {
    previewStatusTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (previewStatusPopover.hidden) openPreviewStatus();
      else closePreviewStatus();
    });
    if (previewStatusClose) previewStatusClose.addEventListener('click', () => closePreviewStatus());
    document.addEventListener('click', (e) => {
      if (previewStatusOpen && !previewStatusWrap.contains(e.target)) closePreviewStatus(false);
    });
    window.addEventListener('resize', () => {
      if (previewStatusOpen) positionPreviewStatus();
    });
    const topbar = previewStatusTrigger.closest('#topbar');
    if (topbar) topbar.addEventListener('scroll', () => closePreviewStatus(false));
  }
  const resetStateBtn = document.getElementById('state-reset-btn');
  if (resetStateBtn) {
    resetStateBtn.addEventListener('click', async () => {
      try {
        const reset = HE.canvas && HE.canvas.resetPreviewState
          ? await HE.canvas.resetPreviewState()
          : false;
        if (reset) HE.toast('Preview state reset. Your authored files were not changed.', 'info');
      } catch {
        HE.toast('Could not reset the Preview state.', 'error');
      }
    });
  }
  const commitStateBtn = document.getElementById('state-commit-btn');
  if (commitStateBtn) {
    commitStateBtn.addEventListener('click', () => {
      try {
        const committed = HE.canvas && HE.canvas.makePreviewStateDefault
          ? HE.canvas.makePreviewStateDefault()
          : false;
        if (committed) HE.toast('Preview state is now the authored default. Save to write it to disk.', 'success');
      } catch {
        HE.toast('Could not make the Preview state default.', 'error');
      }
    });
  }
  // Breadcrumb follows selection: wrap panel.onSelect once panel exists.
  try {
    if (HE.panel && HE.panel.onSelect) {
      const orig = HE.panel.onSelect.bind(HE.panel);
      HE.panel.onSelect = (elm) => { orig(elm); try { renderCrumbs(); } catch { /* ignore */ } };
    }
  } catch { /* ignore */ }
  document.getElementById('open-project-btn').addEventListener('click', openProject);
  const demoBtn = document.getElementById('open-demo-btn');
  if (demoBtn) demoBtn.addEventListener('click', openDemo);
  const promptBtn = document.getElementById('copy-prompt-btn');
  if (promptBtn) promptBtn.addEventListener('click', async () => {
    try {
      const text = window.he.agentPrompt ? await window.he.agentPrompt() : null;
      if (!text) { HE.toast('Could not load agent prompt.', 'error'); return; }
      await navigator.clipboard.writeText(text);
      HE.toast(`Copied agent prompt (${text.length} chars) — paste into your AI agent to generate a compatible site.`, 'success');
    } catch {
      HE.toast('Copy failed — open AGENT_SITE_PROMPT.md manually.', 'error');
    }
  });
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    ['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'drop') {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        const p = f && ((window.he.pathForFile && window.he.pathForFile(f)) || f.path);
        if (p) openPath(p);
        else HE.toast('Drop a site folder from your file manager.', 'error');
      }
      dropZone.classList.remove('over');
    }));
  }
  document.getElementById('save-btn').addEventListener('click', () => save());
  initExternalWatch();
  const autoBtn = document.getElementById('auto-btn');
  if (autoBtn) {
    autoBtn.classList.toggle('on', !!HE.autosave);
    autoBtn.setAttribute('aria-pressed', String(!!HE.autosave));
    autoBtn.addEventListener('click', () => {
      HE.setAutosave(!HE.autosave);
      HE.toast(HE.autosave ? 'Autosave on — drafts are kept outside your folder and offered back; press Save to write files.' : 'Autosave off — press Save.', 'info');
    });
  }
  const historyBtn = document.getElementById('history-btn');
  if (historyBtn) historyBtn.addEventListener('click', () => HE.versions.openHistory());
  // History opens only from the History button; the branch name beside
  // the project is a status label, not a second entry point.
  const historyOverlay = document.getElementById('history-overlay');
  const closeHistory = () => HE.versions.closeHistory();
  const historyClose = document.getElementById('history-close');
  if (historyClose) historyClose.addEventListener('click', closeHistory);
  if (historyOverlay) {
    historyOverlay.addEventListener('click', (e) => { if (e.target === historyOverlay) closeHistory(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !historyOverlay.hidden) closeHistory();
    });
  }
  const historyBranch = document.getElementById('history-branch');
  if (historyBranch) historyBranch.addEventListener('change', () => HE.versions.selectBranch(historyBranch.value));
  const historySnapshot = document.getElementById('history-snapshot');
  if (historySnapshot) historySnapshot.addEventListener('click', () => HE.versions.takeSnapshot());
  const historyCreate = document.getElementById('history-create-branch');
  if (historyCreate) historyCreate.addEventListener('click', () => HE.versions.createBranch());
  setSaveState('');
  const copyBtn = document.getElementById('copy-ai-btn');
  if (copyBtn) copyBtn.addEventListener('click', () => { closeExportMenu(); HE.copyAiContext(); });
  const handoffBtn = document.getElementById('copy-handoff-btn');
  if (handoffBtn) handoffBtn.addEventListener('click', () => { closeExportMenu(); void HE.copyHandoffNote(); });
  const zipBtn = document.getElementById('zip-btn');
  if (zipBtn) zipBtn.addEventListener('click', () => { closeExportMenu(); HE.exportZip(); });
  const exportBtn = document.getElementById('export-btn');
  const exportMenu = document.getElementById('export-menu');
  const closeExportMenu = () => { if (exportMenu) exportMenu.hidden = true; };
  if (exportBtn && exportMenu) {
    // Positioned from the button rect on every open: with position:fixed
    // the menu escapes the topbar's overflow clipping entirely.
    const positionExportMenu = () => {
      try {
        const r = exportBtn.getBoundingClientRect();
        exportMenu.style.minWidth = Math.max(150, r.width) + 'px';
        const mh = exportMenu.offsetHeight || 80;
        const openUp = r.bottom + 4 + mh > window.innerHeight - 8;
        exportMenu.style.top = openUp
          ? Math.max(8, r.top - 4 - mh) + 'px'
          : (r.bottom + 4) + 'px';
        const mw = exportMenu.offsetWidth || 150;
        exportMenu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
      } catch { /* fall back to last position */ }
    };
    const openExportMenu = () => {
      exportMenu.hidden = false;
      positionExportMenu();
      const first = exportMenu.querySelector('button');
      if (first) first.focus();
    };
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (exportMenu.hidden) openExportMenu();
      else closeExportMenu();
    });
    document.addEventListener('click', (e) => {
      if (!exportMenu.hidden && !document.getElementById('export-menu-wrap').contains(e.target)) closeExportMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !exportMenu.hidden) { closeExportMenu(); exportBtn.focus(); }
    });
    window.addEventListener('resize', closeExportMenu);
    try {
      const bar = exportBtn.closest('#topbar');
      if (bar) bar.addEventListener('scroll', closeExportMenu);
    } catch { /* menu simply stays until next close trigger */ }
  }

  // menus
  if (window.he && window.he.onMenu) {
    window.he.onMenu('open', () => openProject());
    window.he.onMenu('openDemo', () => openDemo());
    window.he.onMenu('save', () => save());
    window.he.onMenu('undo', () => HE.undo());
    window.he.onMenu('redo', () => HE.redo());
    window.he.onMenu('mode', (m) => setMode(m));
  }

  // welcome: recent projects
  try {
    const { recent } = await window.he.getRecent();
    renderRecent(recent);
  } catch {
    /* ignore */
  }
});
