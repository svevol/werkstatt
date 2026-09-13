// Site check — a project-wide "what should I look at after an agent run"
// pass. Reads the saved files through an injected bridge so the engine is
// testable without Electron; only the parsing is browser-bound (DOMParser).

import { HE } from './he.js';

const MAX_FINDINGS = 200;
const MAX_EXISTS = 300;

const EXTERNAL_REF_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const ASSET_NON_FILE_RE = /^(?:#|mailto:|tel:|data:|blob:|javascript:)/i;

// A URL that leaves the project (CDN, analytics, social link).
export function isExternalRef(ref) {
  const value = String(ref || '').trim();
  if (!value) return false;
  if (value.startsWith('#') || value.startsWith('?')) return false;
  return EXTERNAL_REF_RE.test(value);
}

// Resolve a page-relative href to a project-relative path ('..' cannot escape
// the project root). Returns null for external/anchor/empty refs.
export function resolvePageRef(href, page) {
  const raw = String(href || '').trim().split(/[?#]/)[0];
  if (!raw || raw.startsWith('#') || isExternalRef(raw)) return null;
  if (ASSET_NON_FILE_RE.test(raw)) return null;
  const pageDir = page && page.includes('/') ? page.replace(/[^/]+$/, '') : '';
  const rel = raw.startsWith('/') ? raw.slice(1) : pageDir + raw;
  const parts = [];
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export function classTokensFromHtml(html) {
  const out = new Set();
  const rx = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = rx.exec(String(html || ''))) !== null) {
    const raw = m[1] != null ? m[1] : m[2];
    for (const token of raw.split(/\s+/)) {
      if (token) out.add(token);
    }
  }
  return out;
}

export function classTokensFromCss(css) {
  const out = new Set();
  const rx = /\.(-?[_a-zA-Z][-\w]*)/g;
  let m;
  while ((m = rx.exec(String(css || ''))) !== null) out.add(m[1]);
  return out;
}

function parseDoc(html) {
  try {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  } catch {
    return null;
  }
}

function pageDirs(pages) {
  return new Set((pages || []).map((p) => (p.includes('/') ? p.replace(/[^/]+$/, '') : '')));
}

// Run every check over the saved project files. `readFile(rel)` and
// `exists(rel)` come from the window.he bridge; both may be async.
export async function runSiteCheck(options = {}) {
  const {
    pages = [],
    stylesheets = [],
    readFile,
    exists,
    currentPage = null,
    limit = MAX_FINDINGS,
  } = options;
  const findings = [];
  const push = (finding) => {
    if (findings.length >= limit) return;
    findings.push(finding);
  };
  const readText = async (rel) => {
    try { return await readFile(rel); } catch { return null; }
  };
  const existsCache = new Map();
  let existsCalls = 0;
  const fileExists = async (rel) => {
    if (existsCache.has(rel)) return existsCache.get(rel);
    if (!exists || existsCalls >= MAX_EXISTS) return true; // unknown — don't cry wolf
    existsCalls++;
    let ok = true;
    try { ok = await exists(rel); } catch { ok = true; }
    existsCache.set(rel, !!ok);
    return !!ok;
  };

  const knownPages = new Set(pages);
  const knownStyles = new Set(stylesheets);
  const htmlByPage = new Map();
  for (const page of pages) {
    const html = await readText(page);
    if (html != null) htmlByPage.set(page, html);
  }

  // CSS classes defined across every stylesheet (also feeds class drift).
  const definedClasses = new Set();
  const classWhere = new Map();
  for (const sheet of stylesheets) {
    const css = await readText(sheet);
    if (css == null) {
      push({ id: 'missing-css', severity: 'warning', file: sheet, message: `${sheet} could not be read.` });
      continue;
    }
    for (const cls of classTokensFromCss(css)) {
      definedClasses.add(cls);
      if (!classWhere.has(cls)) classWhere.set(cls, sheet);
    }
  }

  for (const page of pages) {
    const raw = htmlByPage.get(page);
    if (raw == null) {
      push({ id: 'missing-page', severity: 'warning', file: page, message: `${page} could not be read.` });
      continue;
    }
    const doc = parseDoc(raw);
    if (!doc) continue;
    const label = page === currentPage ? `${page} (open)` : page;

    // Head basics.
    const title = doc.querySelector('title');
    if (!title || !(title.textContent || '').trim()) {
      push({ id: 'missing-title', severity: 'info', page, message: `${label}: no page title.` });
    }
    const desc = doc.querySelector('meta[name="description"]');
    if (!desc || !(desc.getAttribute('content') || '').trim()) {
      push({ id: 'missing-description', severity: 'info', page, message: `${label}: no meta description.` });
    }

    // Duplicate ids.
    const idCount = new Map();
    const ids = new Set();
    for (const el of doc.querySelectorAll('[id]')) {
      const id = el.getAttribute('id');
      if (!id) continue;
      ids.add(id);
      idCount.set(id, (idCount.get(id) || 0) + 1);
    }
    for (const [id, count] of idCount) {
      if (count > 1) {
        push({ id: 'duplicate-id', severity: 'warning', page, selector: `#${id}`, message: `${label}: duplicate id "${id}" (${count}×).` });
      }
    }

    // Images without alt.
    for (const img of doc.querySelectorAll('img:not([alt])')) {
      push({ id: 'img-alt', severity: 'info', page, selector: 'img', message: `${label}: <img> without alt text.` });
    }

    // Broken local references and empty anchors.
    for (const el of doc.querySelectorAll('a[href], img[src], script[src], link[href]')) {
      const attr = el.hasAttribute('href') ? 'href' : 'src';
      const ref = el.getAttribute(attr);
      if (!ref) continue;
      if (ref.startsWith('#')) {
        if (ref.length > 1 && !ids.has(ref.slice(1))) {
          push({ id: 'missing-anchor', severity: 'warning', page, selector: `${el.tagName.toLowerCase()}[${attr}="${ref}"]`, message: `${label}: anchor ${ref} has no target on this page.` });
        }
        continue;
      }
      if (isExternalRef(ref) || ASSET_NON_FILE_RE.test(ref)) {
        if (isExternalRef(ref) && (el.tagName === 'SCRIPT' || el.tagName === 'LINK')) {
          push({ id: 'external-cdn', severity: 'info', page, message: `${label}: external asset ${ref}.` });
        }
        continue;
      }
      const rel = resolvePageRef(ref, page);
      if (!rel) continue;
      if (el.tagName === 'A') {
        if (!knownPages.has(rel) && !knownStyles.has(rel)) {
          push({ id: 'link-target', severity: 'warning', page, selector: `a[href="${ref}"]`, message: `${label}: link target ${rel} not found in the project.` });
        }
      } else if (!(await fileExists(rel))) {
        push({ id: 'missing-asset', severity: 'warning', page, selector: `${el.tagName.toLowerCase()}[${attr}="${ref}"]`, message: `${label}: missing file ${rel}.` });
      }
    }

    // Stylesheet link status.
    const localLinks = [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]
      .map((l) => resolvePageRef(l.getAttribute('href'), page))
      .filter(Boolean);
    if (!localLinks.some((rel) => knownStyles.has(rel))) {
      push({ id: 'stylesheet-link', severity: 'warning', page, message: `${label}: no project stylesheet linked.` });
    }
  }

  // Class drift: used but never defined, defined but never used.
  const STATE_LIKE = /^(?:is-|has-|no-|js-)/; // JS state hooks often have no rule
  const usedClasses = new Set();
  for (const page of pages) {
    const raw = htmlByPage.get(page);
    if (raw == null) continue;
    for (const cls of classTokensFromHtml(raw)) usedClasses.add(cls);
  }
  for (const cls of usedClasses) {
    if (definedClasses.has(cls) || STATE_LIKE.test(cls)) continue;
    push({ id: 'class-undefined', severity: 'info', page: null, message: `class .${cls} is used on pages but has no rule.` });
  }
  for (const cls of definedClasses) {
    if (!usedClasses.has(cls)) {
      push({ id: 'class-unused', severity: 'info', page: null, file: classWhere.get(cls) || null, message: `class .${cls} is defined but never used.` });
    }
  }

  return findings;
}

// Group findings for the panel list (stable order, empty groups dropped).
const GROUP_ORDER = [
  ['stylesheet-link', 'Stylesheet links'],
  ['duplicate-id', 'Duplicate ids'],
  ['missing-anchor', 'Anchors'],
  ['link-target', 'Links'],
  ['missing-asset', 'Missing files'],
  ['missing-css', 'Missing CSS'],
  ['missing-page', 'Unreadable pages'],
  ['img-alt', 'Image alt text'],
  ['missing-title', 'Titles'],
  ['missing-description', 'Descriptions'],
  ['class-undefined', 'Classes without rules'],
  ['class-unused', 'Unused classes'],
  ['external-cdn', 'External references'],
];

export function groupFindings(findings) {
  const groups = [];
  for (const [id, title] of GROUP_ORDER) {
    const items = (findings || []).filter((f) => f.id === id);
    if (items.length) groups.push({ id, title, items });
  }
  const known = new Set(GROUP_ORDER.map(([id]) => id));
  const rest = (findings || []).filter((f) => !known.has(f.id));
  if (rest.length) groups.push({ id: 'other', title: 'Other', items: rest });
  return groups;
}

export function findingCount(findings) {
  return (findings || []).length;
}

HE.runSiteCheck = runSiteCheck;

export default { runSiteCheck, groupFindings, classTokensFromHtml, classTokensFromCss, resolvePageRef, isExternalRef };
