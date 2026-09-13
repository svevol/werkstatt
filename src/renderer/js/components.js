// Shared components — visual-builder-style "edit once, sync everywhere" for plain
// static sites. AI-generated sites repeat identical blocks (header, nav,
// footer, hero) across pages without explicit symbols, so the editor detects
// them: a candidate block on the current page whose normalized markup appears
// on other pages is a shared component. Sync replaces matching instances on
// the other pages via a throwaway DOM (same parse→serialize technique as
// save, so scripts and formatting survive); diverged targets are skipped.

import { HE } from './he.js';

const CANDIDATE_SELECTOR =
  'header[class], footer[class], nav[class], main[class], section[class], article[class], aside[class], div[class]';
const CANDIDATE_MAX = 24;
const CANDIDATE_MIN_HTML = 40;

export function normalizeHtml(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Per-page active-state markers (current nav link etc.) are expected to differ
// between pages, so shared-component detection compares markup with those
// stripped. Sync re-applies each page's own markers after replacing the block.
const ACTIVE_MARKER_CLASSES = new Set(['is-active', 'active', 'is-current', 'current']);

export function stripActiveState(html) {
  let s = String(html || '');
  s = s.replace(/\s+(?:aria-current|data-active)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
  s = s.replace(/\bclass\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _quoted, dq, sq) => {
    const raw = dq != null ? dq : sq;
    const kept = raw.split(/\s+/).filter((c) => c && !ACTIVE_MARKER_CLASSES.has(c.toLowerCase()));
    if (!kept.length) return '';
    const quote = m.charAt(m.indexOf('=') + 1);
    return `class=${quote}${kept.join(' ')}${quote}`;
  });
  return s;
}

// Signature that ignores active-state markers — used for detection and sync
// verification, while the exact signature still tells "already in sync".
export function looseSignature(html) {
  return normalizeHtml(stripActiveState(html));
}

function captureActiveMarkers(root) {  const out = [];
  const visit = (el, path) => {
    let classes = [];
    try { classes = [...el.classList].filter((c) => ACTIVE_MARKER_CLASSES.has(c.toLowerCase())); } catch { classes = []; }
    const aria = el.getAttribute ? el.getAttribute('aria-current') : null;
    const dataActive = el.hasAttribute ? el.hasAttribute('data-active') : false;
    if (classes.length || aria || dataActive) out.push({ path, classes, aria, dataActive });
  };
  visit(root, []);
  const walk = (el, path) => {
    [...el.children].forEach((child, i) => {
      visit(child, path.concat(i));
      walk(child, path.concat(i));
    });
  };
  walk(root, []);
  return out;
}

function applyActiveMarkers(root, markers) {
  for (const m of markers) {
    let el = root;
    for (const i of m.path) {
      el = el && el.children ? el.children[i] : null;
      if (!el) break;
    }
    if (!el || !el.classList) continue;
    for (const c of m.classes) {
      try { el.classList.add(c); } catch { /* ignore */ }
    }
    if (m.aria) {
      try { el.setAttribute('aria-current', m.aria); } catch { /* ignore */ }
    }
    if (m.dataActive) {
      try { el.setAttribute('data-active', ''); } catch { /* ignore */ }
    }
  }
}

function clearActiveMarkers(root) {
  const visit = (el) => {
    try {
      for (const c of [...el.classList]) {
        if (ACTIVE_MARKER_CLASSES.has(c.toLowerCase())) el.classList.remove(c);
      }
    } catch { /* ignore */ }
    if (el.removeAttribute) {
      el.removeAttribute('aria-current');
      el.removeAttribute('data-active');
    }
  };
  visit(root);
  if (root.querySelectorAll) for (const el of root.querySelectorAll('*')) visit(el);
}

function findCandidates(doc) {
  const out = [];
  if (!doc || !doc.querySelectorAll) return out;
  const all = doc.querySelectorAll(CANDIDATE_SELECTOR);
  for (const el of all) {
    if (out.length >= CANDIDATE_MAX) break;
    if (!el.classList || !el.classList.length) continue;
    if (el.id === 'he-overlay-root' || (el.closest && el.closest('#he-overlay-root'))) continue;
    const html = el.outerHTML || '';
    if (html.length < CANDIDATE_MIN_HTML) continue;
    out.push({
      el,
      signature: normalizeHtml(html),
      looseSig: looseSignature(html),
      tag: el.tagName.toLowerCase(),
      cls: el.classList[0],
    });
  }
  return out;
}

function findLooseMatches(doc, looseSig) {
  const out = [];
  if (!doc || !doc.querySelectorAll || !looseSig) return out;
  const all = doc.querySelectorAll(CANDIDATE_SELECTOR);
  for (const el of all) {
    if (looseSignature(el.outerHTML) === looseSig) out.push(el);
  }
  return out;
}

// Detect shared blocks: candidates on the current (live) page that also
// occur on other pages. fs defaults to the real IPC bridge; tests inject a mock.
async function scanShared(fs = window.he) {
  const doc = HE.canvas && HE.canvas.doc;
  if (!doc || !HE.project || !HE.page) return [];
  const entries = [];
  for (const { el, signature, looseSig, tag, cls } of findCandidates(doc)) {
    const pages = [];
    for (const page of HE.project.pages) {
      if (page === HE.page) continue;
      let text;
      try {
        text = await fs.readFile(page);
      } catch {
        continue;
      }
      let parsed;
      try {
        parsed = new DOMParser().parseFromString(text, 'text/html');
      } catch {
        continue;
      }
      if (findLooseMatches(parsed, looseSig).length) pages.push(page);
    }
    if (pages.length) {
      entries.push({ key: tag + '.' + cls, label: tag + '.' + cls, tag, cls, signature, looseSig, liveEl: el, pages });
    }
  }
  return entries;
}

// Sync the (possibly edited) live instance to the other pages. Targets are
// re-verified against the original signature: diverged or already-in-sync
// pages are skipped, never overwritten. The current page is never touched
// (it saves normally). Every write is journaled for Undo (Task 31).
async function syncShared(entry, fs = window.he) {
  const synced = [];
  const skipped = [];
  if (!entry || !entry.liveEl || !entry.signature || !HE.project) return { synced, skipped };
  const newHtml = entry.liveEl.outerHTML;
  if (!newHtml) return { synced, skipped };
  const baseLoose = entry.looseSig || looseSignature(entry.signature);
  const newLoose = looseSignature(newHtml);
  for (const page of HE.project.pages) {
    if (page === HE.page) continue;
    let text;
    try {
      text = await fs.readFile(page);
    } catch {
      skipped.push({ page, reason: 'unreadable' });
      continue;
    }
    let parsed;
    try {
      parsed = new DOMParser().parseFromString(text, 'text/html');
    } catch {
      skipped.push({ page, reason: 'unparseable' });
      continue;
    }
    if (!findLooseMatches(parsed, baseLoose).length) {
      skipped.push({
        page,
        reason: findLooseMatches(parsed, newLoose).length ? 'already in sync' : 'changed on that page',
      });
      continue;
    }
    const tmp = parsed.createElement('template');
    tmp.innerHTML = newHtml;
    const replacement = tmp.content.firstElementChild;
    if (!replacement) {
      skipped.push({ page, reason: 'empty update' });
      continue;
    }
    // Keep each page's own active-state markers (current nav link etc.):
    // the incoming markup supplies structure/content, the target supplies
    // its own "which page am I on" state.
    for (const m of findLooseMatches(parsed, baseLoose)) {
      const markers = captureActiveMarkers(m);
      const clone = replacement.cloneNode(true);
      clearActiveMarkers(clone);
      applyActiveMarkers(clone, markers);
      m.replaceWith(clone);
    }
    const out = '<!DOCTYPE html>\n' + parsed.documentElement.outerHTML;
    try {
      await fs.writeFile(page, out);
      if (HE.recordCrossPageWrite) HE.recordCrossPageWrite(page, text, out, fs);
      synced.push(page);
    } catch (err) {
      skipped.push({ page, reason: 'write failed' });
    }
  }
  return { synced, skipped };
}

function entryFor(elm) {
  if (!elm || !elm.isConnected) return null;
  return (HE.sharedEntries || []).find((e) => e && e.liveEl === elm) || null;
}

function renderComponentList() {
  const host = document.getElementById('component-list');
  const section = document.getElementById('components');
  if (!host || !section) return;
  host.innerHTML = '';
  const entries = HE.sharedEntries || [];
  section.hidden = !entries.length;
  if (!entries.length) return;
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'component-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    const total = entry.pages.length + 1;
    row.textContent = `${entry.label} · ${total} page${total === 1 ? '' : 's'}`;
    row.title = `Shared block on: ${[HE.page, ...entry.pages].join(', ')} — click to select it`;
    const activate = () => {
      if (entry.liveEl && entry.liveEl.isConnected && HE.canvas) {
        HE.canvas.select(entry.liveEl);
        try {
          entry.liveEl.scrollIntoView({ block: 'center' });
        } catch { /* ignore */ }
      } else if (entry.pages.length && HE.loadPage) {
        HE.loadPage(entry.pages[0]);
      }
    };
    row.addEventListener('click', activate);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
    host.appendChild(row);
  }
}

async function refreshComponents() {
  const host = document.getElementById('component-list');
  if (!host) return;
  try {
    HE.sharedEntries = await scanShared();
  } catch {
    HE.sharedEntries = [];
  }
  renderComponentList();
}

HE.sharedEntries = [];
HE.scanSharedComponents = scanShared;
HE.syncSharedComponent = syncShared;
HE.sharedEntryFor = entryFor;
HE.refreshComponents = refreshComponents;
