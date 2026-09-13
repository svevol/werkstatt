// Canvas — the live page rendered in an iframe, with selection overlays,
// inline text editing and drag & drop insertion.
//
// Loading strategy:
// - Pages are written to a temp hesite:// document so relative CSS/JS/images resolve
//   against the project folder (custom protocol served by main).
// - Edit mode: page scripts are neutralized so they can't break selection/overlays.
// - Preview mode: scripts run; editor chrome is hidden; clicks work like a browser.

import { HE } from './he.js';
import { Sheet } from './sheet.js';
import { fonts } from './fonts.js';
import { escapeAttr, neutralizeEditHtml } from './util.js';

const EDITOR_CSS = `
#he-overlay-root, #he-overlay-root * { pointer-events: none !important; }
div:empty, section:empty, main:empty, article:empty, aside:empty,
header:empty, footer:empty, nav:empty, form:empty, fieldset:empty {
min-height: 40px; outline: 1px dashed rgba(0, 0, 0, 0.18);
}
html[data-he-mode="preview"] #he-overlay-root { display: none !important; }
`;

const CONTAINER_TAGS = new Set([
  'DIV', 'SECTION', 'MAIN', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV',
  'UL', 'OL', 'FORM', 'FIELDSET', 'FIGURE', 'BODY',
]);

const IMG_PLACEHOLDER_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
  '<rect width="100%" height="100%" fill="#dde1e7"/>' +
  '<text x="50%" y="50%" font-family="sans-serif" font-size="18" fill="#8a94a3" ' +
  'text-anchor="middle" dominant-baseline="middle">Image</text></svg>');
const SVG_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" ' +
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>';

const DEFAULTS = {
  h1: { text: 'Heading 1' }, h2: { text: 'Heading 2' }, h3: { text: 'Heading 3' },
  h4: { text: 'Heading 4' }, h5: { text: 'Heading 5' }, h6: { text: 'Heading 6' },
  p: { text: 'Paragraph text. Double-click to edit.' },
  span: { text: 'Text' },
  button: { text: 'Button' },
  a: { text: 'Link', attrs: { href: '#' } },
  li: { text: 'List item' },
  label: { text: 'Label' },
  input: { attrs: { type: 'text', placeholder: 'Input' } },
  textarea: { attrs: { rows: '4', placeholder: 'Textarea' } },
  select: { html: '<option>Option 1</option><option>Option 2</option>' },
  img: { attrs: { alt: '', src: IMG_PLACEHOLDER_SRC } },
  video: { attrs: { controls: '' } },
  iframe: { attrs: { title: 'Embed' } },
  ul: { html: '<li>List item</li><li>List item</li><li>List item</li>' },
  ol: { html: '<li>List item</li><li>List item</li><li>List item</li>' },
  table: {
    html: '<thead><tr><th>Header</th><th>Header</th></tr></thead>' +
      '<tbody><tr><td>Cell</td><td>Cell</td></tr></tbody>',
  },
  figure: {
    html: `<img src="${IMG_PLACEHOLDER_SRC}" alt=""><figcaption>Caption</figcaption>`,
  },
  blockquote: { text: 'Quote' },
  hr: {},
  svg: { html: SVG_ICON },
};

let iframe, doc, overlayRoot, hoverBox, selectBox, selectLabel, dropLine;
let hoverEl = null;

// ---------- JS-impact helpers (class actions + id hygiene) ----------

// Duplicate ids break scripts (getElementById finds the first one) — every
// clone path strips ids from the copy + descendants so the duplicate-id
// warning stays green. The helpers below share this with duplicate/copy/paste.
function stripIds(root) {
  if (!root) return;
  try {
    if (root.hasAttribute && root.hasAttribute('id')) root.removeAttribute('id');
    if (root.querySelectorAll) {
      for (const node of root.querySelectorAll('[id]')) node.removeAttribute('id');
    }
  } catch { /* ignore */ }
}

function subtreeClassNames(root) {
  const out = new Set();
  if (!root) return [];
  try {
    if (root.classList) for (const c of root.classList) if (c) out.add(c);
    if (root.querySelectorAll) {
      for (const node of root.querySelectorAll('[class]')) {
        try {
          for (const c of node.classList) if (c) out.add(c);
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return [...out];
}

function jsUsagesFor(names) {
  try {
    if (window.HE && HE.jsUsagesForClasses) return HE.jsUsagesForClasses(names) || [];
  } catch { /* ignore */ }
  return [];
}

function confirmImpact(action, names, usages) {
  if (window.HE && HE.confirmJsImpact) {
    return HE.confirmJsImpact({ action, classes: names, usages });
  }
  return Promise.resolve({ proceed: true, updateJs: false });
}

// Sync bodies behind the JS-impact confirms (fast path stays synchronous).
function doDeleteSelected(elm) {
  HE.commit();
  const parent = elm.parentElement;
  elm.remove();
  HE.afterDomChange();
  this.select(parent === doc.body ? null : parent);
}

function doDuplicateSelected(elm) {
  HE.commit();
  const copy = elm.cloneNode(true);
  stripIds(copy);
  elm.parentElement.insertBefore(copy, elm.nextSibling);
  HE.afterDomChange();
  this.select(copy);
  if (HE.refreshWarnings) HE.refreshWarnings(); // ids stripped, but re-check anyway
  return copy;
}

function doPasteCopied(target) {
  HE.commit();
  const copy = doc.importNode(copiedNode, true);
  stripIds(copy);
  if (target === doc.body) {
    doc.body.appendChild(copy);
  } else if (target.parentElement) {
    target.parentElement.insertBefore(copy, target.nextSibling);
  } else {
    return null;
  }
  HE.afterDomChange();
  this.select(copy);
  if (HE.refreshWarnings) HE.refreshWarnings(); // ids stripped, but re-check anyway
  return copy;
}
let mode = 'edit'; // 'edit' | 'preview'
let baseUrl = null; // e.g. hesite://v/
let pageRel = null; // e.g. index.html or pages/about.html
let lastHtml = '';
let lastCss = '';
let copiedNode = null;
let recoveryAttempts = 0; // preview re-renders after a script hijacked the frame
const loadedGoogleFonts = new Set();
// Families served by local @font-face rules (project `fonts/` folder, Task 72).
// These never get a Google <link>: the folder copy wins, so saved pages make
// no external font request and preview works offline.
const localFontFamilies = new Set();

function refreshLocalFonts(cssText) {
  localFontFamilies.clear();
  try {
    for (const fam of fonts.localFamilies(cssText)) localFontFamilies.add(fam);
  } catch { /* best-effort */ }
}

function isLocalFont(family) {
  if (!family) return false;
  const lower = String(family).toLowerCase();
  for (const fam of localFontFamilies) {
    if (String(fam).toLowerCase() === lower) return true;
  }
  return false;
}
let retainedPreviewState = null;
let previewBaselineState = null;
let previewBaselineScroll = null;

// ---------- preview-only state simulation (Edit mode) ----------
// Temporarily toggles classes/attrs on the selected element for styling,
// WITHOUT running handlers and WITHOUT marking dirty. Never leaks into
// serializeDoc / editSnapshot: originals are restored around serialization.
let simElm = null;
let simClasses = new Map(); // cls -> originallyHad (bool)
let simAttrs = new Map(); // attr -> original value (string|null)

function updateSelectLabel(elm) {
  if (!elm || !selectBox || !selectLabel) return;
  if (HE.canvas.selected !== elm) return;
  const cls = [...elm.classList].map((c) => ' .' + c).join('');
  selectLabel.textContent = elm.tagName.toLowerCase() + cls;
}

function clearSimulation() {
  if (!simElm) {
    simClasses.clear();
    simAttrs.clear();
    return;
  }
  try {
    for (const [cls, had] of simClasses) {
      try {
        if (had) simElm.classList.add(cls);
        else simElm.classList.remove(cls);
      } catch { /* ignore */ }
    }
    for (const [name, orig] of simAttrs) {
      try {
        if (orig === null) simElm.removeAttribute(name);
        else simElm.setAttribute(name, orig);
      } catch { /* ignore */ }
    }
    if (HE.canvas.selected === simElm) updateSelectLabel(simElm);
  } catch { /*Elm may be detached — ignore*/ }
  simElm = null;
  simClasses.clear();
  simAttrs.clear();
  try {
    if (HE.canvas.refreshOverlays) HE.canvas.refreshOverlays();
  } catch { /* ignore */ }
}

function ensureSimElm(elm) {
  if (simElm && simElm !== elm) clearSimulation();
  if (!simElm) simElm = elm;
}

// ---------- preview-only tab switching (Edit mode) ----------
// Page scripts are neutralized in Edit, so tab buttons can't switch panels.
// This preview shows one tab's panel so its text can be selected + edited,
// WITHOUT running handlers and WITHOUT marking dirty. Original hidden /
// aria-selected state is restored around serializeDoc / editSnapshot, on
// mode switch and on page load — the saved file keeps its default tab.
let tabPreviews = new Map(); // rootEl -> { btns, panels, btnAria, panelHidden, previewIndex }

function tabsInRoot(root) {
  if (!root || !root.querySelectorAll) return null;
  const btns = [...root.querySelectorAll('.tab-btn, [role="tab"]')]
    .filter((b) => b.closest && b.closest('.tabs') === root);
  const panels = [...root.querySelectorAll('.tab-panel, [role="tabpanel"]')]
    .filter((p) => p.closest && p.closest('.tabs') === root);
  if (!btns.length || !panels.length) return null;
  return { btns, panels };
}

function findTabsRoot(elm) {
  if (!elm || !elm.closest) return null;
  try {
    if (elm.classList && elm.classList.contains('tabs')) return elm;
    return elm.closest('.tabs');
  } catch { return null; }
}

function applyTabIndex(entry, index) {
  const { btns, panels } = entry;
  btns.forEach((b, j) => {
    try { b.setAttribute('aria-selected', String(index === j)); } catch { /* ignore */ }
  });
  panels.forEach((p, j) => {
    try {
      if (index === j) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    } catch { /* ignore */ }
  });
  entry.previewIndex = index;
}

function restoreTabEntry(root, entry) {
  try {
    (entry.btns || []).forEach((b, j) => {
      try {
        const orig = (entry.btnAria || [])[j];
        if (orig === null || orig === undefined) b.removeAttribute('aria-selected');
        else b.setAttribute('aria-selected', orig);
      } catch { /* ignore */ }
    });
    (entry.panels || []).forEach((p, j) => {
      try {
        const hadHidden = (entry.panelHidden || [])[j];
        if (hadHidden) p.setAttribute('hidden', '');
        else p.removeAttribute('hidden');
      } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

function clearTabPreview(root) {
  if (root) {
    const entry = tabPreviews.get(root);
    if (!entry) return;
    restoreTabEntry(root, entry);
    tabPreviews.delete(root);
  } else {
    for (const [r, entry] of [...tabPreviews]) {
      restoreTabEntry(r, entry);
    }
    tabPreviews.clear();
  }
  try {
    if (HE.canvas.refreshOverlays) HE.canvas.refreshOverlays();
  } catch { /* ignore */ }
  try {
    if (HE.panel && HE.panel.refresh) HE.panel.refresh();
  } catch { /* ignore */ }
}

// Restore all previews to saved state, returning a backup to re-apply after
// serialization (same pattern as the single-element simulation above).
function stashTabPreviews() {
  const backup = [...tabPreviews];
  for (const [r, entry] of backup) {
    restoreTabEntry(r, entry);
  }
  tabPreviews.clear();
  return backup;
}

function unstashTabPreviews(backup) {
  for (const [r, entry] of backup || []) {
    try {
      if (!r || !r.isConnected || (doc && !doc.contains(r))) continue;
      // Re-store originals, then re-apply the previewed index.
      tabPreviews.set(r, entry);
      applyTabIndex(entry, entry.previewIndex);
    } catch { /* ignore */ }
  }
}

// ---------- preview-only open/close toggles (Edit mode) ----------
// Same contract as tabs, for accordion / dropdown / mobile nav: page scripts
// are neutralized in Edit, so these buttons would otherwise do nothing but
// select. Preview-flip the open state (aria-expanded + .is-open + hidden)
// WITHOUT running handlers and WITHOUT marking dirty. Originals are restored
// around serializeDoc, on mode switch and on page load.
let togglePreviews = new Map(); // rootEl -> {kind, btn, panel, btnAria, panelHidden, rootOpen, open}

function detectToggleControl(btn) {
  if (!btn || !btn.matches) return null;
  try {
    if (btn.matches('.accordion-btn')) {
      const root = btn.closest('.accordion');
      if (!root) return null;
      return { kind: 'accordion', root, btn, panel: root.querySelector('.accordion-panel') };
    }
    if (btn.matches('.dropdown-btn')) {
      const root = btn.closest('.dropdown');
      if (!root) return null;
      return { kind: 'dropdown', root, btn, panel: root.querySelector('.dropdown-menu') };
    }
    if (btn.matches('.nav-toggle')) {
      const header = btn.closest('.site-header');
      const nav = header
        ? header.querySelector('.site-nav')
        : (doc && doc.querySelector ? doc.querySelector('.site-nav') : null);
      if (!nav) return null;
      return { kind: 'nav', root: nav, btn, panel: nav };
    }
  } catch { /* ignore */ }
  return null;
}

function detectToggleRoot(root) {
  if (!root || !root.matches) return null;
  try {
    if (root.matches('.accordion')) {
      return { kind: 'accordion', root, btn: root.querySelector('.accordion-btn'), panel: root.querySelector('.accordion-panel') };
    }
    if (root.matches('.dropdown')) {
      return { kind: 'dropdown', root, btn: root.querySelector('.dropdown-btn'), panel: root.querySelector('.dropdown-menu') };
    }
    if (root.matches('.site-nav')) {
      const header = root.closest('.site-header');
      const scope = header || doc;
      const btn = scope && scope.querySelector ? scope.querySelector('.nav-toggle') : null;
      return { kind: 'nav', root, btn, panel: root };
    }
  } catch { /* ignore */ }
  return null;
}

function toggleLiveOpen(found) {
  if (!found) return false;
  try {
    if (found.panel && found.panel !== found.root && found.panel.hasAttribute && !found.panel.hasAttribute('hidden')) {
      return true;
    }
    if (found.root && found.root.classList && found.root.classList.contains('is-open')) return true;
  } catch { /* ignore */ }
  return false;
}

function applyToggle(entry, open) {
  entry.open = !!open;
  try {
    if (entry.btn) entry.btn.setAttribute('aria-expanded', String(!!open));
  } catch { /* ignore */ }
  try {
    if (entry.root && entry.root.classList) entry.root.classList.toggle('is-open', !!open);
  } catch { /* ignore */ }
  try {
    if (entry.panel && entry.panel !== entry.root) {
      if (open) entry.panel.removeAttribute('hidden');
      else entry.panel.setAttribute('hidden', '');
    }
  } catch { /* ignore */ }
}

function restoreToggleEntry(entry) {
  try {
    if (entry.btn) {
      if (entry.btnAria === null || entry.btnAria === undefined) entry.btn.removeAttribute('aria-expanded');
      else entry.btn.setAttribute('aria-expanded', entry.btnAria);
    }
  } catch { /* ignore */ }
  try {
    if (entry.root && entry.root.classList) entry.root.classList.toggle('is-open', !!entry.rootOpen);
  } catch { /* ignore */ }
  try {
    if (entry.panel && entry.panel !== entry.root) {
      if (entry.panelHidden) entry.panel.setAttribute('hidden', '');
      else entry.panel.removeAttribute('hidden');
    }
  } catch { /* ignore */ }
}

function clearTogglePreview(root) {
  if (root) {
    const entry = togglePreviews.get(root);
    if (!entry) return;
    restoreToggleEntry(entry);
    togglePreviews.delete(root);
  } else {
    for (const entry of [...togglePreviews.values()]) {
      restoreToggleEntry(entry);
    }
    togglePreviews.clear();
  }
  try {
    if (HE.canvas.refreshOverlays) HE.canvas.refreshOverlays();
  } catch { /* ignore */ }
  try {
    if (HE.panel && HE.panel.refresh) HE.panel.refresh();
  } catch { /* ignore */ }
}

function stashTogglePreviews() {
  const backup = [...togglePreviews];
  for (const [, entry] of backup) {
    restoreToggleEntry(entry);
  }
  togglePreviews.clear();
  return backup;
}

function unstashTogglePreviews(backup) {
  for (const [r, entry] of backup || []) {
    try {
      if (!r || !r.isConnected || (doc && !doc.contains(r))) continue;
      togglePreviews.set(r, entry);
      applyToggle(entry, entry.open);
    } catch { /* ignore */ }
  }
}

// ---------- preview → edit state carry-over ----------
// Answers: "I arranged the state in Preview (open accordion, active tab,
// scrolled carousel) — can Edit resume there?" Yes, with a strict whitelist.
// The preview DOM itself is still throwaway and never flows back: only plain
// state numbers (active tab index, open true/false, scroll offsets) are read
// from the live Preview document, matched by document order to the same
// components in the fresh Edit document, and re-applied through the unsaved
// preview systems above. Content, structure, and everything scripts did
// stays behind. Deliberately NOT carried: dialog open state (its `open`
// attribute would serialize into the file), theme flips (that would be a
// real, saved change to the authored default), form validation, reveal and
// scroll-spy classes (runtime artifacts, meaningless to save).
function capturePreviewState(pdoc) {
  const out = { tabs: [], toggles: [], carousels: [] };
  try {
    const troots = pdoc && pdoc.querySelectorAll ? [...pdoc.querySelectorAll('.tabs')] : [];
    for (const r of troots) {
      try {
        const panels = [...r.querySelectorAll('.tab-panel, [role="tabpanel"]')]
          .filter((p) => p.closest && p.closest('.tabs') === r);
        const btns = [...r.querySelectorAll('.tab-btn, [role="tab"]')]
          .filter((b) => b.closest && b.closest('.tabs') === r);
        if (!panels.length) continue;
        let idx = panels.findIndex((p) => !p.hasAttribute('hidden'));
        if (idx < 0) idx = btns.findIndex((b) => b.getAttribute('aria-selected') === 'true');
        out.tabs.push(idx < 0 ? 0 : idx);
      } catch { out.tabs.push(0); }
    }
  } catch { /* ignore */ }
  try {
    const groots = pdoc && pdoc.querySelectorAll
      ? [...pdoc.querySelectorAll('.accordion, .dropdown, .site-nav')]
      : [];
    for (const r of groots) {
      let open = false;
      try {
        if (r.matches && r.matches('.site-nav')) {
          open = r.classList.contains('is-open');
        } else {
          const panel = r.querySelector('.accordion-panel, .dropdown-menu');
          if (panel) open = !panel.hasAttribute('hidden');
          else open = r.classList.contains('is-open');
        }
      } catch { /* ignore */ }
      out.toggles.push({ open });
    }
  } catch { /* ignore */ }
  try {
    const tracks = pdoc && pdoc.querySelectorAll ? [...pdoc.querySelectorAll('.carousel-track')] : [];
    for (const t of tracks) {
      let x = 0;
      try { x = t.scrollLeft || 0; } catch { /* ignore */ }
      out.carousels.push(x);
    }
  } catch { /* ignore */ }
  return out;
}

function applyPreviewState(state) {
  if (!state || !doc) return;
  // Tabs: re-apply the Preview-active index as an unsaved Edit preview.
  try {
    const troots = [...doc.querySelectorAll('.tabs')];
    for (let i = 0; i < troots.length && i < (state.tabs || []).length; i++) {
      try {
        const groups = tabsInRoot(troots[i]);
        if (!groups) continue;
        const authored = groups.panels.findIndex((p) => !p.hasAttribute('hidden'));
        const idx = Math.max(0, Number(state.tabs[i]) || 0);
        if (idx !== (authored < 0 ? 0 : authored) && HE.canvas.previewTab) {
          HE.canvas.previewTab(troots[i], idx, { quiet: true });
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  // Toggles: open/close to match Preview, only where it differs.
  try {
    const groots = [...doc.querySelectorAll('.accordion, .dropdown, .site-nav')];
    for (let i = 0; i < groots.length && i < (state.toggles || []).length; i++) {
      try {
        const found = detectToggleRoot(groots[i]);
        if (!found) continue;
        const want = !!(state.toggles[i] && state.toggles[i].open);
        if (want !== toggleLiveOpen(found) && HE.canvas.setToggleOpen) {
          HE.canvas.setToggleOpen(groots[i], want, { quiet: true });
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  // Carousel scroll offsets are view-only (never serialized) — restore directly.
  try {
    const tracks = [...doc.querySelectorAll('.carousel-track')];
    for (let i = 0; i < tracks.length && i < (state.carousels || []).length; i++) {
      try { tracks[i].scrollLeft = Math.max(0, Number(state.carousels[i]) || 0); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try {
    if (HE.canvas.refreshOverlays) HE.canvas.refreshOverlays();
  } catch { /* ignore */ }
  try {
    if (HE.panel && HE.panel.refresh) HE.panel.refresh();
  } catch { /* ignore */ }
}

function el(name, styles) {
  const d = doc.createElement(name);
  Object.assign(d.style, styles);
  return d;
}

function buildOverlays() {
  overlayRoot = el('div', { position: 'absolute', top: '0', left: '0', width: '0', height: '0', zIndex: '2147483647' });
  overlayRoot.id = 'he-overlay-root';

  hoverBox = el('div', {
    position: 'absolute', display: 'none',
    outline: '1px solid #26a7ff', outlineOffset: '-1px',
    background: 'rgba(38,167,255,0.06)',
  });
  selectBox = el('div', {
    position: 'absolute', display: 'none',
    outline: '2px solid #4f8cff', outlineOffset: '-2px',
  });
  selectLabel = el('div', {
    position: 'absolute', top: '-22px', left: '-2px',
    background: '#4f8cff', color: '#fff',
    font: '11px -apple-system, sans-serif',
    padding: '2px 7px', borderRadius: '3px 3px 3px 0',
    whiteSpace: 'nowrap',
  });
  selectBox.appendChild(selectLabel);

  dropLine = el('div', {
    position: 'absolute', display: 'none', height: '0',
    borderTop: '2px solid #4f8cff',
  });

  overlayRoot.appendChild(hoverBox);
  overlayRoot.appendChild(selectBox);
  overlayRoot.appendChild(dropLine);
  doc.body.appendChild(overlayRoot);
}

function rectOf(elm) {
  const r = elm.getBoundingClientRect();
  return {
    top: r.top + doc.defaultView.scrollY,
    left: r.left + doc.defaultView.scrollX,
    width: r.width,
    height: r.height,
  };
}

function place(box, r) {
  box.style.top = r.top + 'px';
  box.style.left = r.left + 'px';
  box.style.width = r.width + 'px';
  box.style.height = r.height + 'px';
}

function inOverlay(t) {
  return t && t.closest && !!t.closest('#he-overlay-root');
}

// ---------- neutralize / restore scripts for edit mode ----------

// Inline and external scripts are rewritten so they do not execute in edit mode.
// They are restored on serialize and run normally in preview mode.
//
// The neutralizer is a small quote-aware scanner, NOT a regex, so it copes with:
// - '>' inside quoted attribute values   (<script data-cond="a > b">)
// - the literal text '<script' inside inline script bodies (raw text in HTML)
// - <script> inside HTML comments / CDATA sections (never executed by the parser)
function neutralizeScripts(htmlText) {
  const src = String(htmlText);
  const lower = src.toLowerCase();
  let out = '';
  let i = 0;

  // index of the next '>' at/after `from`, ignoring quoted attribute values
  const tagEnd = (from) => {
    let quote = null;
    for (let j = from; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        return j;
      }
    }
    return -1;
  };

  // per HTML spec, script text runs until a matching '</script' close tag
  const scriptClose = (from) => {
    let idx = lower.indexOf('</script', from);
    while (idx !== -1 && !/[\s/>]/.test(src[idx + 8] || '')) {
      idx = lower.indexOf('</script', idx + 1);
    }
    return idx;
  };

  const neutralizeOpenTag = (openTag) => {
    // openTag: complete '<script ...>' text (quote-aware, so attrs are intact)
    const attrs = openTag.slice(7, -1);
    if (/\btype\s*=\s*["']text\/he-script["']/i.test(attrs)) return openTag;
    const typeMatch = attrs.match(/\btype\s*=\s*(["'])([^"']*)\1/i);
    const origType = typeMatch ? typeMatch[2] : '';
    // strip existing type
    let next = attrs.replace(/\s*\btype\s*=\s*(["'])[^"']*\1/i, '');
    next += ` type="text/he-script" data-he-script-type="${escapeAttr(origType)}"`;
    return `<script${next}>`;
  };

  while (i < src.length) {
    // comments and CDATA: copy verbatim — scripts inside never execute
    if (lower.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const stop = end === -1 ? src.length : end + 3;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }
    if (lower.startsWith('<![cdata[', i)) {
      const end = src.indexOf(']]>', i + 9);
      const stop = end === -1 ? src.length : end + 3;
      out += src.slice(i, stop);
      i = stop;
      continue;
    }
    const isScriptOpen =
      src[i] === '<' &&
      lower.startsWith('script', i + 1) &&
      /[\s/>]/.test(src[i + 7] || '');
    if (!isScriptOpen) {
      out += src[i];
      i++;
      continue;
    }
    const end = tagEnd(i + 7);
    if (end === -1) {
      out += src.slice(i);
      break;
    }
    const openTag = src.slice(i, end + 1);
    out += neutralizeOpenTag(openTag);
    i = end + 1;
    if (/\/\s*>$/.test(openTag)) continue; // self-closing: no body
    // script body is raw text — copy it without scanning for '<script'
    const close = scriptClose(i);
    if (close === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, close);
    const closeEnd = tagEnd(close + 2);
    if (closeEnd === -1) {
      out += src.slice(close);
      break;
    }
    out += src.slice(close, closeEnd + 1);
    i = closeEnd + 1;
  }
  return out;
}

// DOM-level inverse of restoreNeutralizedHandlers: after serialization
// restored executable attributes for the saved string, rename them back so
// the live Edit document stays inert. Values are already entity-decoded by
// the parser, so a light scheme check suffices here.
function reneutralizeLiveHandlers(liveDoc) {
  if (!liveDoc || !liveDoc.querySelectorAll) return;
  const els = liveDoc.querySelectorAll('*');
  for (const el of els) {
    if (!el.attributes) continue;
    for (const attr of [...el.attributes]) {
      const lower = attr.name.toLowerCase();
      if (/^on[a-z]+$/.test(lower)) {
        try {
          el.setAttribute('data-he-' + lower, attr.value);
        } catch { /* keep best-effort */ }
        try {
          el.removeAttribute(attr.name);
        } catch { /* keep best-effort */ }
        continue;
      }
      if (lower === 'srcdoc') {
        try {
          el.setAttribute('data-he-srcdoc', attr.value);
        } catch { /* keep best-effort */ }
        try {
          el.removeAttribute(attr.name);
        } catch { /* keep best-effort */ }
        continue;
      }
      if (lower === 'http-equiv' && el.tagName === 'META' && attr.value.trim().toLowerCase() === 'refresh') {
        try {
          el.setAttribute('data-he-http-equiv', attr.value);
        } catch { /* keep best-effort */ }
        try {
          el.removeAttribute(attr.name);
        } catch { /* keep best-effort */ }
        continue;
      }
      const isUrlAttr =
        lower === 'href' || lower === 'src' || lower === 'action' || lower === 'formaction' ||
        lower === 'xlink:href' ||
        (lower === 'data' && (el.tagName === 'OBJECT' || el.tagName === 'EMBED'));
      if (isUrlAttr && String(attr.value).replace(/[\x00-\x20]+/g, '').toLowerCase().startsWith('javascript:')) {
        try {
          el.setAttribute('data-he-' + lower.replace(':', '-'), attr.value);
        } catch { /* keep best-effort */ }
        try {
          el.removeAttribute(attr.name);
        } catch { /* keep best-effort */ }
      }
    }
  }
}
// Rename Edit-mode neutralized attributes back before serialization so the
// saved file is byte-identical to what the author wrote (see
// neutralizeEditHtml in util.js). data-he-script-type is handled separately.
function restoreNeutralizedHandlers(liveDoc) {
  if (!liveDoc || !liveDoc.querySelectorAll) return;
  const urlBack = {
    'data-he-href': 'href',
    'data-he-src': 'src',
    'data-he-action': 'action',
    'data-he-formaction': 'formaction',
    'data-he-xlink-href': 'xlink:href',
    'data-he-data': 'data',
  };
  const els = liveDoc.querySelectorAll('*');
  for (const el of els) {
    if (!el.attributes) continue;
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      let back = null;
      if (n.startsWith('data-he-on')) back = n.slice('data-he-'.length);
      else if (n === 'data-he-srcdoc') back = 'srcdoc';
      else if (n === 'data-he-http-equiv') back = 'http-equiv';
      else if (urlBack[n]) back = urlBack[n];
      if (!back) continue;
      try {
        el.setAttribute(back, attr.value);
      } catch { /* keep best-effort */ }
      try {
        el.removeAttribute(attr.name);
      } catch { /* keep best-effort */ }
    }
  }
}

function collectGoogleFonts(htmlText, cssText) {
  loadedGoogleFonts.clear();
  refreshLocalFonts(cssText);
  const fromHtml = fonts.detectGoogleFontLinks(htmlText) || [];
  const fromCss = fonts.detectGoogleFontsInCss(cssText) || [];
  for (const fam of fromHtml) if (!isLocalFont(fam)) loadedGoogleFonts.add(fam);
  for (const fam of fromCss) if (!isLocalFont(fam)) loadedGoogleFonts.add(fam);
}

function googleFontLinkTags() {
  if (!loadedGoogleFonts.size) return '';
  return [...loadedGoogleFonts]
    .map(
      (fam) =>
        `<link rel="stylesheet" href="${fonts.googleFontUrl(fam)}" data-he-gfont="${fam}">`
    )
    .join('');
}

// Page scripts run in a same-origin srcdoc frame, so they could reach
// window.parent.he (IPC bridge) or the editor DOM. Shadow parent/top/frameElement
// with non-configurable own properties BEFORE any page script runs. The main
// process additionally rejects IPC from subframes (defense in depth).
// The guard is injected in BOTH modes: in Edit it backstops the string-level
// handler neutralization below, so any missed vector still cannot see the
// editor. window.open is neutered (popup-blocker semantics) so page scripts
// cannot spawn OS windows through the host.
const PREVIEW_GUARD =
  '<script data-he-guard>try{' +
  'Object.defineProperty(window,"parent",{value:window,configurable:false});' +
  'Object.defineProperty(window,"top",{value:window,configurable:false});' +
  'Object.defineProperty(window,"frameElement",{value:null,configurable:false});' +
  'window.open=function(){return null;};' +
  '}catch(e){}</scr' + 'ipt>';

// Keep runtime failures inside the Preview frame so the editor can explain a
// broken interaction without executing or rewriting project source in Edit.
const PREVIEW_DIAGNOSTICS =
  '<script data-he-runtime>try{' +
  'window.__heRuntime={errors:[],resources:[]};' +
  'window.addEventListener("error",function(e){try{' +
  'var t=e&&e.target;' +
  'if(t&&t!==window){window.__heRuntime.resources.push({url:String(t.currentSrc||t.src||t.href||""),tag:String(t.tagName||"")});}' +
  'else{window.__heRuntime.errors.push({message:String((e&&e.message)||"Script error"),source:String((e&&e.filename)||""),line:Number((e&&e.lineno)||0),column:Number((e&&e.colno)||0)});}' +
  '}catch(_){}} ,true);' +
  'window.addEventListener("unhandledrejection",function(e){try{' +
  'var r=e&&e.reason;window.__heRuntime.errors.push({message:String((r&&r.message)||r||"Unhandled promise rejection"),source:"",line:0,column:0});' +
  '}catch(_){}});' +
  '}catch(e){}</scr' + 'ipt>';

// NOTE: this never auto-links a fallback stylesheet. Author <link>
// tags are preserved as-is so a missing project-CSS link stays missing
// (main.js surfaces it with a warning + explicit Link action). The live
// style[data-he-live] applied on load is only the in-memory fallback for
// editing; the <base> tag near the start of <head> keeps author-relative hrefs
// (including a newly inserted shared-stylesheet link) resolving via hesite://
// in Preview before the browser starts fetching them.
function injectBaseAndStyles(htmlText, cssText, runScripts) {
  collectGoogleFonts(htmlText, cssText);

  let src = htmlText;
  if (!runScripts) src = neutralizeEditHtml(neutralizeScripts(src));

  // Drop only managed Google Font <link>s — unknown families stay as authored
  // and we re-inject a clean set from CSS + HTML for the known ones.
  src = fonts.stripManagedGoogleFontLinks(src);

  // Base URL so relative assets resolve to project files via hesite://
  let baseHref = baseUrl || '';
  if (baseHref && pageRel) {
    const dir = pageRel.includes('/') ? pageRel.replace(/\/[^/]+$/, '/') : '';
    baseHref = baseUrl + dir;
  }

  const baseTag = baseHref ? `<base href="${baseHref}">` : '';
  // Live CSS is applied after load via DOM (more reliable CSSOM than srcdoc injection).
  // Editor chrome CSS + Google font links go in the head string.
  // The guard runs in both modes (Edit scripts are neutralized, but inline
  // handlers are renamed by neutralizeEditHtml — the guard backstops both).
  const injection =
    PREVIEW_GUARD +
    (runScripts ? PREVIEW_DIAGNOSTICS : '') +
    baseTag +
    googleFontLinkTags() +
    `<style data-he-editor>${EDITOR_CSS}</style>`;

  if (/<head(\s[^>]*)?>/i.test(src)) {
    src = src.replace(/<head(\s[^>]*)?>/i, (m) => m + injection);
  } else if (/<\/head>/i.test(src)) {
    src = src.replace(/<\/head>/i, injection + '</head>');
  } else {
    src = injection + src;
  }

  // mode marker on html for CSS
  if (/<html(\s[^>]*)?>/i.test(src)) {
    src = src.replace(/<html(\s[^>]*)?>/i, (m) => {
      if (/data-he-mode=/.test(m)) return m.replace(/data-he-mode="[^"]*"/, `data-he-mode="${mode}"`);
      return m.replace(/<html/i, `<html data-he-mode="${mode}"`);
    });
  }

  return src;
}

// ---------- events ----------

function onMouseMove(e) {
  if (mode !== 'edit') return;
  const t = e.target;
  if (!t || t === doc.documentElement || inOverlay(t) || t === doc.body) {
    hoverBox.style.display = 'none';
    hoverEl = null;
    return;
  }
  if (t === HE.canvas.selected) {
    hoverBox.style.display = 'none';
    hoverEl = t;
    return;
  }
  hoverEl = t;
  place(hoverBox, rectOf(t));
  hoverBox.style.display = 'block';
}

function onClick(e) {
  if (mode !== 'edit') return;
  e.preventDefault();
  e.stopPropagation();
  if (HE.canvas.editing) return;
  const t = e.target;
  if (!t || inOverlay(t)) return;
  // Edit-mode tab affordance: scripts are neutralized, so a tab button click
  // would otherwise do nothing. Preview-switch to that tab's panel (not
  // saved, not dirty) so its text can be selected + edited on the next click.
  try {
    const btn = t.closest ? t.closest('.tab-btn, [role="tab"]') : null;
    if (btn && doc && doc.contains(btn)) {
      const root = findTabsRoot(btn);
      const groups = root ? tabsInRoot(root) : null;
      if (root && groups) {
        const idx = groups.btns.indexOf(btn);
        if (idx >= 0 && HE.canvas.previewTab) {
          HE.canvas.previewTab(root, idx, { quiet: true });
        }
      }
    }
  } catch { /* tab preview is best-effort */ }
  // Same contract for open/close controls (accordion, dropdown, mobile nav):
  // mirror the Preview toggle as an unsaved preview, then select as usual.
  try {
    const tgl = t.closest ? t.closest('.accordion-btn, .dropdown-btn, .nav-toggle') : null;
    if (tgl && doc && doc.contains(tgl) && HE.canvas.previewToggle) {
      HE.canvas.previewToggle(tgl, { quiet: true });
    }
  } catch { /* toggle preview is best-effort */ }
  // Carousel arrows only scroll the track — scroll position is never part of
  // the saved file, so mirroring Preview here is inherently safe.
  try {
    const cbtn = t.closest ? t.closest('.carousel-btn[data-scroll]') : null;
    if (cbtn && doc && doc.contains(cbtn) && HE.canvas.scrollCarousel) {
      const croot = cbtn.closest('.carousel');
      if (croot) HE.canvas.scrollCarousel(croot, cbtn.getAttribute('data-scroll'));
    }
  } catch { /* carousel mirror is best-effort */ }
  HE.canvas.select(t === doc.documentElement ? doc.body : t);
}

function onDblClick(e) {
  if (mode !== 'edit') return;
  e.preventDefault();
  const t = e.target;
  if (!t || inOverlay(t) || t === doc.body || t === doc.documentElement) return;
  if (['IMG', 'INPUT', 'SELECT', 'TEXTAREA', 'VIDEO', 'IFRAME'].includes(t.tagName)) return;
  HE.canvas.select(t);
  HE.canvas.startTextEdit(t);
}

function findInsertion(e) {
  let t = e.target;
  if (!t || inOverlay(t)) return null;
  if (t === doc.documentElement) t = doc.body;

  const r = t.getBoundingClientRect();
  const relY = r.height ? (e.clientY - r.top) / r.height : 0.5;

  if (CONTAINER_TAGS.has(t.tagName) && (relY > 0.3 && relY < 0.7 || t.children.length === 0)) {
    return { target: t, pos: 'append', rect: rectOf(t) };
  }
  if (t.parentElement && t.tagName !== 'BODY') {
    const pos = relY < 0.5 ? 'before' : 'after';
    return { target: t, pos, rect: rectOf(t) };
  }
  return { target: doc.body, pos: 'append', rect: rectOf(doc.body) };
}

function onDragOver(e) {
  if (mode !== 'edit' || !HE.draggingTag) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const ins = findInsertion(e);
  if (!ins) return;
  if (ins.pos === 'append') {
    dropLine.style.borderTop = 'none';
    dropLine.style.outline = '2px solid #4f8cff';
    dropLine.style.height = ins.rect.height + 'px';
    place(dropLine, ins.rect);
  } else {
    dropLine.style.outline = 'none';
    dropLine.style.borderTop = '2px solid #4f8cff';
    dropLine.style.height = '0';
    dropLine.style.width = ins.rect.width + 'px';
    dropLine.style.left = ins.rect.left + 'px';
    dropLine.style.top = (ins.pos === 'before' ? ins.rect.top : ins.rect.top + ins.rect.height) + 'px';
  }
  dropLine.style.display = 'block';
}

function onDrop(e) {
  if (mode !== 'edit' || !HE.draggingTag) return;
  e.preventDefault();
  dropLine.style.display = 'none';
  const ins = findInsertion(e);
  if (ins) HE.canvas.insertElement(HE.draggingTag, ins.target, ins.pos);
  HE.draggingTag = null;
}

function notifyRuntimeDiagnostics() {
  setTimeout(() => {
    try {
      if (mode === 'preview' && typeof HE.onRuntimeDiagnostics === 'function') HE.onRuntimeDiagnostics();
    } catch { /* diagnostics are best-effort */ }
  }, 0);
}

// In preview, intercept in-site navigation so we stay inside the editor
function onPreviewClick(e) {
  if (mode !== 'preview') return;
  notifyRuntimeDiagnostics();
  const a = e.target && e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
    return;
  }
  // external
  if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
    e.preventDefault();
    return;
  }
  // relative page navigation → ask app to load that page
  e.preventDefault();
  let next = href.split('#')[0].split('?')[0];
  if (!next) return;
  if (HE.onPreviewNavigate) HE.onPreviewNavigate(next);
}

function canvasLoadingBackground() {
  const fallback = '#fff';
  try {
    const view = doc && doc.defaultView;
    if (!view || !doc) return fallback;
    for (const elm of [doc.body, doc.documentElement]) {
      if (!elm) continue;
      const color = view.getComputedStyle(elm).backgroundColor;
      if (color && color !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)$/i.test(color)) return color;
    }
  } catch { /* keep the neutral canvas background */ }
  return fallback;
}

function beginCanvasLoad() {
  try {
    const frame = iframe && iframe.parentElement;
    if (!frame) return;
    frame.style.setProperty('--he-loading-bg', canvasLoadingBackground());
    frame.classList.add('is-loading');
  } catch { /* transition is best-effort */ }
}

function finishCanvasLoad() {
  try {
    const frame = iframe && iframe.parentElement;
    if (!frame) return;
    let finished = false;
    const removeLoadingState = () => {
      if (finished) return;
      finished = true;
      frame.classList.remove('is-loading');
      setTimeout(() => frame.style.removeProperty('--he-loading-bg'), 220);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(removeLoadingState);
    // Hidden or throttled windows may not service rAF promptly; loading must
    // still finish once the iframe itself has reported that it is ready.
    setTimeout(removeLoadingState, 100);
  } catch { /* transition is best-effort */ }
}

function bindEvents() {
  doc.addEventListener('mousemove', onMouseMove, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('click', onPreviewClick, true);
  doc.addEventListener('dblclick', onDblClick, true);
  doc.addEventListener('dragover', onDragOver, true);
  doc.addEventListener('drop', onDrop, true);
  doc.addEventListener('submit', (e) => {
    if (mode === 'edit') e.preventDefault();
  }, true);
  doc.addEventListener('keydown', (e) => {
    if (mode === 'edit' && HE.onKeydown) HE.onKeydown(e);
  });
  doc.defaultView.addEventListener('scroll', () => HE.canvas.refreshOverlays(), true);
  doc.defaultView.addEventListener('resize', () => HE.canvas.refreshOverlays());
  doc.defaultView.addEventListener('error', notifyRuntimeDiagnostics, true);
  doc.defaultView.addEventListener('unhandledrejection', notifyRuntimeDiagnostics, true);
}

function applyModeToChrome() {
  if (!doc) return;
  doc.documentElement.setAttribute('data-he-mode', mode);
  if (overlayRoot) {
    overlayRoot.style.display = mode === 'edit' ? '' : 'none';
  }
  if (iframe) {
    iframe.classList.toggle('is-preview', mode === 'preview');
  }
}

function scrollPosition(targetDoc) {
  try {
    const view = targetDoc && targetDoc.defaultView;
    return { x: view ? view.scrollX || 0 : 0, y: view ? view.scrollY || 0 : 0 };
  } catch {
    return { x: 0, y: 0 };
  }
}

// Compare only state that can be carried safely between the throwaway Preview
// document and the authored Edit document. Runtime DOM/content mutations never
// enter this object.
function previewStateChanges(before, after, beforeScroll, afterScroll) {
  const previous = before || { tabs: [], toggles: [], carousels: [] };
  const current = after || { tabs: [], toggles: [], carousels: [] };
  const changed = { tabs: [], toggles: [], carousels: [], scroll: false };
  const tabCount = Math.max(previous.tabs.length, current.tabs.length);
  for (let i = 0; i < tabCount; i++) {
    if ((previous.tabs[i] ?? 0) !== (current.tabs[i] ?? 0)) changed.tabs.push(i);
  }
  const toggleCount = Math.max(previous.toggles.length, current.toggles.length);
  for (let i = 0; i < toggleCount; i++) {
    const beforeOpen = !!(previous.toggles[i] && previous.toggles[i].open);
    const afterOpen = !!(current.toggles[i] && current.toggles[i].open);
    if (beforeOpen !== afterOpen) changed.toggles.push(i);
  }
  const carouselCount = Math.max(previous.carousels.length, current.carousels.length);
  for (let i = 0; i < carouselCount; i++) {
    if (Math.abs((Number(previous.carousels[i]) || 0) - (Number(current.carousels[i]) || 0)) > 2) {
      changed.carousels.push(i);
    }
  }
  const bs = beforeScroll || { x: 0, y: 0 };
  const as = afterScroll || { x: 0, y: 0 };
  changed.scroll = Math.abs((bs.x || 0) - (as.x || 0)) > 2 || Math.abs((bs.y || 0) - (as.y || 0)) > 2;
  changed.any = !!(changed.tabs.length || changed.toggles.length || changed.carousels.length || changed.scroll);
  return changed;
}

function previewStateSummary(pdoc, state, changes) {
  const items = [];
  const current = state || { tabs: [], toggles: [], carousels: [] };
  try {
    const roots = pdoc && pdoc.querySelectorAll ? [...pdoc.querySelectorAll('.tabs')] : [];
    for (const index of changes.tabs || []) {
      const root = roots[index];
      const groups = root ? tabsInRoot(root) : null;
      const tab = groups && groups.btns[(Number(current.tabs[index]) || 0)];
      const label = tab ? (tab.textContent || '').trim().replace(/\s+/g, ' ') : `Tab ${Number(current.tabs[index]) + 1}`;
      items.push(`Tab: ${label || 'Selected'}`);
    }
  } catch { /* summary is best-effort */ }
  try {
    const roots = pdoc && pdoc.querySelectorAll
      ? [...pdoc.querySelectorAll('.accordion, .dropdown, .site-nav')]
      : [];
    for (const index of changes.toggles || []) {
      const root = roots[index];
      let kind = 'Menu';
      if (root && root.matches) {
        if (root.matches('.accordion')) kind = 'Accordion';
        else if (root.matches('.dropdown')) kind = 'Dropdown';
      }
      const open = !!(current.toggles[index] && current.toggles[index].open);
      items.push(`${kind}: ${open ? 'Open' : 'Closed'}`);
    }
  } catch { /* summary is best-effort */ }
  if ((changes.carousels || []).length) items.push('Carousel position');
  if (changes.scroll) items.push('Page position');
  return {
    items,
    text: items.join(' · '),
    canCommit: !!((changes.tabs || []).length || (changes.toggles || []).length),
  };
}

function rememberPreviewState(pdoc, state, scroll, baseline, baselineScroll) {
  const changes = previewStateChanges(baseline, state, baselineScroll, scroll);
  if (!changes.any) {
    retainedPreviewState = null;
    return;
  }
  retainedPreviewState = {
    state,
    scroll,
    changes,
    summary: previewStateSummary(pdoc, state, changes),
  };
}

// ---------- public API ----------

HE.canvas = {
  selected: null,
  editing: false,

  get doc() {
    return doc;
  },

  getRuntimeDiagnostics() {
    try {
      const raw = doc && doc.defaultView && doc.defaultView.__heRuntime;
      if (!raw) return { errors: [], resources: [] };
      const errors = Array.isArray(raw.errors) ? raw.errors.slice(0, 20).map((item) => ({
        message: String((item && item.message) || 'Script error'),
        source: String((item && item.source) || ''),
        line: Number((item && item.line) || 0),
        column: Number((item && item.column) || 0),
      })) : [];
      const resources = Array.isArray(raw.resources) ? raw.resources.slice(0, 20).map((item) => ({
        url: String((item && item.url) || ''),
        tag: String((item && item.tag) || ''),
      })) : [];
      return { errors, resources };
    } catch {
      return { errors: [], resources: [] };
    }
  },

  get mode() {
    return mode;
  },

  getRetainedPreviewState() {
    if (!retainedPreviewState) return null;
    return {
      summary: {
        items: [...(retainedPreviewState.summary.items || [])],
        text: retainedPreviewState.summary.text,
        canCommit: retainedPreviewState.summary.canCommit,
      },
      changes: {
        tabs: [...(retainedPreviewState.changes.tabs || [])],
        toggles: [...(retainedPreviewState.changes.toggles || [])],
        carousels: [...(retainedPreviewState.changes.carousels || [])],
        scroll: !!retainedPreviewState.changes.scroll,
      },
    };
  },

  clearRetainedPreviewState() {
    retainedPreviewState = null;
    previewBaselineState = null;
    previewBaselineScroll = null;
  },

  async resetPreviewState() {
    if (mode !== 'edit' || !retainedPreviewState) return false;
    // Serialize the authored version first. serializeDoc temporarily removes
    // all carried state, so resetting does not discard edits made in Edit.
    const snap = this.editSnapshot();
    retainedPreviewState = null;
    previewBaselineState = null;
    previewBaselineScroll = null;
    await this.loadPage(snap.html, snap.css);
    if (typeof HE.onModeChange === 'function') HE.onModeChange(mode);
    return true;
  },

  makePreviewStateDefault() {
    if (mode !== 'edit' || !retainedPreviewState) return false;
    const changes = retainedPreviewState.changes || {};
    const canCommit = !!((changes.tabs || []).length || (changes.toggles || []).length);
    if (!canCommit) return false;
    if (HE.commit) HE.commit();

    // The current DOM already contains the Preview state. Drop the temporary
    // restore bookkeeping so serialization keeps it as authored HTML.
    for (const [root, entry] of [...tabPreviews]) {
      try {
        entry.btnAria = (entry.btns || []).map((b) => b.getAttribute('aria-selected'));
        entry.panelHidden = (entry.panels || []).map((p) => p.hasAttribute('hidden'));
      } catch { /* keep best-effort */ }
      tabPreviews.delete(root);
    }
    for (const [root, entry] of [...togglePreviews]) {
      try {
        entry.btnAria = entry.btn ? entry.btn.getAttribute('aria-expanded') : null;
        entry.rootOpen = !!(entry.root && entry.root.classList && entry.root.classList.contains('is-open'));
        entry.panelHidden = entry.panel && entry.panel !== entry.root
          ? entry.panel.hasAttribute('hidden')
          : null;
      } catch { /* keep best-effort */ }
      togglePreviews.delete(root);
    }
    if (simElm) {
      simElm = null;
      simClasses.clear();
      simAttrs.clear();
    }
    retainedPreviewState = null;
    previewBaselineState = null;
    previewBaselineScroll = null;
    if (HE.afterDomChange) HE.afterDomChange();
    if (typeof HE.onModeChange === 'function') HE.onModeChange(mode);
    return true;
  },

  setBaseUrl(url) {
    baseUrl = url;
  },

  setPageRel(rel) {
    pageRel = rel;
  },

  async setMode(next) {
    if (next !== 'edit' && next !== 'preview') return;
    if (next === mode) return;
    // Capture the DOM only when leaving EDIT mode. The preview document
    // itself is throwaway: script mutations there never flow back into the
    // editable document or the saved file. The one exception is whitelisted
    // UI state (active tab, open/closed, carousel scroll): on the way back
    // to Edit it is re-applied as unsaved previews, so Edit resumes where
    // Preview left off. Preview-only simulation never leaks: serializeDoc
    // strips it, then we clear it so Preview starts from clean author state.
    if (mode === 'edit' && doc && HE.sheet) {
      lastHtml = this.serializeDoc();
      lastCss = HE.sheet.serialize();
    }
    // Leaving Preview for Edit: snapshot plain UI state from the live
    // Preview DOM *before* it is replaced (see capturePreviewState).
    let carriedState = null;
    if (mode === 'preview' && next === 'edit' && doc) {
      try {
        carriedState = capturePreviewState(doc);
      } catch { carriedState = null; }
    }
    // Remember the viewport so the switch keeps showing the same part of
    // the page — frame reloads otherwise drop scroll back to the top.
    // Scroll offsets are view-only and never touch the save.
    let carriedScroll = null;
    try {
      if (doc && doc.defaultView) {
        carriedScroll = {
          x: doc.defaultView.scrollX || 0,
          y: doc.defaultView.scrollY || 0,
        };
      }
    } catch { carriedScroll = null; }
    clearSimulation();
    clearTabPreview();
    clearTogglePreview();
    if (mode === 'edit' && next === 'preview' && doc) {
      // Capture the authored baseline after edit-only previews have been
      // cleared. Preview state is compared against this baseline on return.
      previewBaselineState = capturePreviewState(doc);
      previewBaselineScroll = scrollPosition(doc);
      retainedPreviewState = null;
    }
    if (mode === 'preview' && next === 'edit' && carriedState) {
      rememberPreviewState(
        doc,
        carriedState,
        carriedScroll || { x: 0, y: 0 },
        previewBaselineState,
        previewBaselineScroll
      );
      previewBaselineState = null;
      previewBaselineScroll = null;
    }
    mode = next;
    applyModeToChrome();
    if (lastHtml) {
      await this.loadPage(lastHtml, lastCss || '');
    }
    if (carriedScroll) {
      try {
        const w = doc && doc.defaultView;
        if (w && w.scrollTo) {
          // An authored `html { scroll-behavior: smooth }` also governs
          // programmatic scrolls, so a plain scrollTo would animate this
          // restore and make the mode switch look like it scrolls to the
          // position. Restore instantly regardless of author CSS: an explicit
          // `behavior: 'instant'` overrides `scroll-behavior`, and the inline
          // `scroll-behavior: auto` backstop covers engines that ignore it.
          // Both are transient — the authored value is put back immediately so
          // Preview keeps its smooth anchor scrolling.
          const rootEl = doc.documentElement;
          const prevBehavior = rootEl ? rootEl.style.scrollBehavior : '';
          if (rootEl) rootEl.style.scrollBehavior = 'auto';
          try {
            w.scrollTo({ left: carriedScroll.x, top: carriedScroll.y, behavior: 'instant' });
          } catch {
            w.scrollTo(carriedScroll.x, carriedScroll.y);
          }
          if (rootEl) rootEl.style.scrollBehavior = prevBehavior;
        }
      } catch { /* scroll restore is best-effort */ }
    }
    if (carriedState && next === 'edit') {
      try {
        applyPreviewState(carriedState);
      } catch { /* state carry-over is best-effort */ }
    }
    if (typeof HE.onModeChange === 'function') HE.onModeChange(mode);
  },

  loadPage(htmlText, cssText) {
    beginCanvasLoad();
    return new Promise((resolve) => {
      clearSimulation();
      tabPreviews.clear();
      togglePreviews.clear();
      lastHtml = htmlText;
      lastCss = cssText;
      const runScripts = mode === 'preview';
      const src = injectBaseAndStyles(htmlText, cssText, runScripts);

      iframe.onload = () => {
        doc = iframe.contentDocument;
        // Preview hijack recovery: a page script navigated or reloaded the
        // frame (srcdoc documents don't survive that). Our injected marker
        // is missing then — re-render the last edit snapshot, but only once
        // so a pathological page can't loop forever.
        const hijacked =
          mode === 'preview' &&
          lastHtml &&
          !(doc && doc.querySelector('style[data-he-editor]'));
        if (hijacked) {
          if (recoveryAttempts < 1) {
            recoveryAttempts++;
            HE.canvas.loadPage(lastHtml, lastCss).then(resolve);
          } else {
            recoveryAttempts = 0;
            resolve();
          }
          return;
        }
        recoveryAttempts = 0;
        if (!doc || !doc.body) {
          finishCanvasLoad();
          resolve();
          return;
        }
        buildOverlays();
        bindEvents();
        applyModeToChrome();

        // Create / refresh live stylesheet through the DOM so CSSOM is available
        let live = doc.querySelector('style[data-he-live]');
        if (live) live.remove();
        live = doc.createElement('style');
        live.setAttribute('data-he-live', '');
        (doc.head || doc.documentElement).appendChild(live);
        live.textContent = cssText || '';

          HE.sheet = new Sheet(live);
        if (HE.canvas.syncGoogleFontsFromSheet) HE.canvas.syncGoogleFontsFromSheet();
        HE.canvas.selected = null;
        HE.canvas.editing = false;
        if (HE.tree) HE.tree.rebuild();
        if (HE.panel) HE.panel.onSelect(null);
        finishCanvasLoad();
        resolve();
        if (runScripts) {
          const loadedDoc = doc;
          setTimeout(() => {
            if (mode === 'preview' && doc === loadedDoc && typeof HE.onRuntimeDiagnostics === 'function') {
              HE.onRuntimeDiagnostics();
            }
          }, 150);
        }
      };
      iframe.srcdoc = src;
    });
  },

    loadGoogleFont(family) {
      if (!family) return;
      const meta = fonts.findGoogleFont(family);
      const name = meta ? meta.family : family;
      if (isLocalFont(name)) return; // folder copy wins — no Google request
      if (loadedGoogleFonts.has(name)) {
        // still ensure link exists in live doc (e.g. after serialize shuffle)
        if (doc && doc.head && !doc.querySelector(`link[data-he-gfont="${name}"]`)) {
          const link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.href = fonts.googleFontUrl(name);
          link.setAttribute('data-he-gfont', name);
          doc.head.appendChild(link);
        }
        return;
      }
      loadedGoogleFonts.add(name);
      if (!doc || !doc.head) return;
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = fonts.googleFontUrl(name);
      link.setAttribute('data-he-gfont', name);
      doc.head.appendChild(link);
    },

    /** Keep Google font links in sync with font-family usage in the live sheet. */
    syncGoogleFontsFromSheet() {
      if (!HE.sheet) return;
      let css = '';
      try { css = HE.sheet.serialize(); } catch { css = ''; }
      refreshLocalFonts(css);
      // A family vendored since load must lose its Google link again.
      for (const fam of [...loadedGoogleFonts]) {
        if (isLocalFont(fam)) loadedGoogleFonts.delete(fam);
      }
      const used = fonts.detectGoogleFontsInCss(css);
      for (const fam of used) this.loadGoogleFont(fam);
    },

    /** Folder-served font families (local @font-face) — for panels/pickers. */
    localFonts() {
      return [...localFontFamilies];
    },

  select(elm) {
    if (mode !== 'edit') return;
    if (elm !== simElm) clearSimulation();
    this.selected = elm;
    if (!elm || !selectBox) {
      if (selectBox) selectBox.style.display = 'none';
    } else {
      const r = rectOf(elm);
      place(selectBox, r);
      const cls = [...elm.classList].map((c) => ' .' + c).join('');
      selectLabel.textContent = elm.tagName.toLowerCase() + cls;
      selectBox.style.display = 'block';
    }
    if (HE.panel) HE.panel.onSelect(elm);
    if (HE.tree) HE.tree.highlight(elm);
  },

  deselect() {
    this.select(null);
  },

  refreshOverlays() {
    if (mode !== 'edit') return;
    if (this.selected && selectBox) place(selectBox, rectOf(this.selected));
    if (hoverEl && hoverEl !== this.selected && doc && doc.contains(hoverEl)) {
      place(hoverBox, rectOf(hoverEl));
    } else if (hoverBox) {
      hoverBox.style.display = 'none';
    }
  },

  startTextEdit(elm) {
    if (mode !== 'edit') return;
    this.editing = true;
    elm.contentEditable = 'true';
    elm.focus();
    const finish = () => {
      elm.removeEventListener('blur', finish);
      elm.removeAttribute('contenteditable');
      this.editing = false;
      HE.afterDomChange();
    };
    elm.addEventListener('blur', finish);
  },

  insertElement(tag, target, pos) {
    if (mode !== 'edit') return;
    HE.commit();
    const def = DEFAULTS[tag] || {};
    let elm;
    if (tag === 'svg') {
      // createElement('svg') yields an HTMLUnknownElement with no SVG
      // namespace. Parse through a <template> so the node is real SVG and
      // survives outerHTML serialization.
      const tpl = doc.createElement('template');
      tpl.innerHTML = def.html || SVG_ICON;
      elm = tpl.content.firstElementChild;
      if (!elm) return;
    } else {
      elm = doc.createElement(tag);
      if (def.text) elm.textContent = def.text;
      if (def.html) elm.innerHTML = def.html;
      if (def.attrs) for (const [k, v] of Object.entries(def.attrs)) elm.setAttribute(k, v);
    }

    if (pos === 'append') target.appendChild(elm);
    else if (pos === 'before') target.parentElement.insertBefore(elm, target);
    else target.parentElement.insertBefore(elm, target.nextSibling);

    HE.afterDomChange();
    this.select(elm);
    elm.scrollIntoView({ block: 'nearest' });
  },

  deleteSelected(opts) {
    if (mode !== 'edit') return false;
    const elm = this.selected;
    if (!elm || elm === doc.body) return false;
    const names = subtreeClassNames(elm);
    const usages = names.length ? jsUsagesFor(names) : [];
    if (usages.length && !(opts && opts.skipJsCheck)) {
      return confirmImpact('delete', names, usages).then((res) => {
        if (!res || !res.proceed) return false;
        doDeleteSelected.call(this, elm);
        return true;
      });
    }
    doDeleteSelected.call(this, elm);
    return true;
  },

  duplicateSelected(opts) {
    if (mode !== 'edit') return null;
    const elm = this.selected;
    if (!elm || elm === doc.body) return null;
    const names = subtreeClassNames(elm);
    const usages = names.length ? jsUsagesFor(names) : [];
    if (usages.length && !(opts && opts.skipJsCheck)) {
      return confirmImpact('duplicate', names, usages).then((res) => {
        if (!res || !res.proceed) return null;
        return doDuplicateSelected.call(this, elm);
      });
    }
    return doDuplicateSelected.call(this, elm);
  },

  canContainChildren(elm) {
    return mode === 'edit' && !!elm && CONTAINER_TAGS.has(elm.tagName);
  },

  moveElement(elm, target, pos) {
    if (mode !== 'edit' || !elm || !target || elm === target) return false;
    if (elm === doc.body || target === doc.body || elm.contains(target)) return false;

    if (pos === 'inside') {
      if (!this.canContainChildren(target)) return false;
      // Only the current parent is a meaningful "inside" target; a deeper
      // ancestor is a no-op reposition and not offered by the navigator.
      if (target.contains(elm) && target !== elm.parentElement) return false;
      if (elm.parentElement === target && target.lastElementChild === elm) return false;

      HE.commit();
      target.appendChild(elm);
      HE.afterDomChange();
      this.select(elm);
      return true;
    }

    if (elm.parentElement !== target.parentElement) return false;

    const parent = target.parentElement;
    const reference = pos === 'before' ? target : target.nextElementSibling;
    if (reference === elm) return false;

    HE.commit();
    parent.insertBefore(elm, reference);
    HE.afterDomChange();
    this.select(elm);
    return true;
  },

  copySelected() {
    if (mode !== 'edit') return;
    const elm = this.selected;
    if (!elm || elm === doc.body) return;
    copiedNode = elm.cloneNode(true);
    stripIds(copiedNode);
  },

  canPaste() {
    return mode === 'edit' && !!copiedNode;
  },

  pasteCopied() {
    if (!this.canPaste()) return null;
    const target = this.selected;
    if (!target) return null;
    const names = subtreeClassNames(copiedNode);
    const usages = names.length ? jsUsagesFor(names) : [];
    if (usages.length) {
      return confirmImpact('duplicate', names, usages).then((res) => {
        if (!res || !res.proceed) return null;
        return doPasteCopied.call(this, target);
      });
    }
    return doPasteCopied.call(this, target);
  },

  // The page as the user authored it in edit mode: HTML + CSS with all
  // editor artifacts stripped. In preview mode the live DOM may contain
  // page-script mutations, so return the snapshot taken when leaving edit.
  editSnapshot() {
    if (mode === 'preview') return { html: lastHtml, css: lastCss };
    return {
      html: this.serializeDoc(),
      css: HE.sheet ? HE.sheet.serialize() : lastCss,
    };
  },

  // Serialize the document without any editor artifacts
  // (and without preview-only simulated classes/attrs).
  serializeDoc() {
    if (!doc) return lastHtml || '';
    // Temporarily restore simulation originals so they never leak into output.
    // Re-applied afterwards so the live Edit view keeps its preview.
    // Tab previews are restored the same way (saved default tab is kept).
    let tabBackup = null;
    try {
      if (tabPreviews.size) tabBackup = stashTabPreviews();
    } catch { tabBackup = null; }
    let toggleBackup = null;
    try {
      if (togglePreviews.size) toggleBackup = stashTogglePreviews();
    } catch { toggleBackup = null; }
    let simBackup = null;
    if (simElm && doc.contains && doc.contains(simElm) && (simClasses.size || simAttrs.size)) {
      simBackup = {
        elm: simElm,
        classes: new Map(simClasses),
        attrs: new Map(simAttrs),
      };
      try {
        for (const [cls, had] of simClasses) {
          if (had) simElm.classList.add(cls);
          else simElm.classList.remove(cls);
        }
        for (const [name, orig] of simAttrs) {
          if (orig === null) simElm.removeAttribute(name);
          else simElm.setAttribute(name, orig);
        }
      } catch { /* ignore */ }
    } else if (simElm && !(doc.contains && doc.contains(simElm))) {
      simElm = null;
      simClasses.clear();
      simAttrs.clear();
    }
    // Nodes detached for serialization MUST be restored even if the code
    // below throws — otherwise the live <style> stays out of the document,
    // the canvas goes white and every sheet access dies. Restored in finally.
    const removed = [];
    const take = (node) => {
      if (!node) return;
      removed.push({ node, parent: node.parentElement, next: node.nextSibling });
      node.remove();
    };
    const restoreRemoved = () => {
      for (const { node, parent, next } of removed.splice(0).reverse()) {
        try {
          if (!parent) continue;
          // `next` may itself have been detached; fall back to append.
          if (next && next.parentElement !== parent) parent.appendChild(node);
          else parent.insertBefore(node, next);
        } catch { /* best-effort: never leave the doc half-restored */ }
      }
    };
    try {
    const editorStyle = doc.querySelector('style[data-he-editor]');
    const liveStyle = doc.querySelector('style[data-he-live]');
    const baseEl = doc.querySelector('base');

    // Snapshot CSS + fonts BEFORE detaching nodes (CSSOM dies when <style> is removed)
    let cssSnapshot = '';
    try {
      if (HE.sheet) cssSnapshot = HE.sheet.serialize();
      else if (liveStyle) cssSnapshot = liveStyle.textContent || '';
    } catch {
      cssSnapshot = (liveStyle && liveStyle.textContent) || lastCss || '';
    }
    if (liveStyle) liveStyle.textContent = cssSnapshot;

      if (cssSnapshot) {
        refreshLocalFonts(cssSnapshot);
        for (const fam of fonts.detectGoogleFontsInCss(cssSnapshot)) {
          if (!isLocalFont(fam)) loadedGoogleFonts.add(fam);
        }
        // Vendored families must not keep a stale Google link into the save.
        for (const fam of [...loadedGoogleFonts]) {
          if (isLocalFont(fam)) loadedGoogleFonts.delete(fam);
        }
      }

      take(editorStyle);
      take(overlayRoot);
      take(liveStyle);
      take(baseEl);
      take(doc.querySelector('script[data-he-guard]'));
      take(doc.querySelector('script[data-he-runtime]'));

    // strip mode marker
    if (doc.documentElement.hasAttribute('data-he-mode')) {
      doc.documentElement.removeAttribute('data-he-mode');
    }

    // restore neutralized scripts in the live DOM for serialization
    const inertScripts = [...doc.querySelectorAll('script[type="text/he-script"]')];
    for (const s of inertScripts) {
      const orig = s.getAttribute('data-he-script-type') || '';
      s.removeAttribute('data-he-script-type');
      if (orig) s.setAttribute('type', orig);
      else s.removeAttribute('type');
    }

    // restore neutralized handlers/URLs so saved HTML matches the author source
    restoreNeutralizedHandlers(doc);

    const editable = doc.querySelector('[contenteditable]');
    if (editable) editable.removeAttribute('contenteditable');

    // drop editor-injected google font links (re-added cleanly below)
    const gfontLinks = [...doc.querySelectorAll('link[data-he-gfont]')];
    for (const l of gfontLinks) l.remove();

    let html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;

    // Remove only managed Google Font links (editor-injected ones were already
    // detached above); unrecognized families stay exactly as authored, then we
    // re-add the fonts actually used from CSS.
    html = fonts.stripManagedGoogleFontLinks(html);

      if (loadedGoogleFonts.size > 0) {
        const fontLinks = [...loadedGoogleFonts]
          .map((fam) => `<link rel="stylesheet" href="${fonts.googleFontUrl(fam)}">`)
          .join('\n');
      if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, fontLinks + '\n</head>');
      } else {
        html = fontLinks + '\n' + html;
      }
    }

    // Put inert scripts back to neutralized form in the live DOM
    for (const s of inertScripts) {
      const t = s.getAttribute('type') || '';
      s.setAttribute('data-he-script-type', t);
      s.setAttribute('type', 'text/he-script');
    }

    // Re-neutralize handlers in the live DOM (serializeDoc restored them
    // above for the saved string — without this they would stay live).
    reneutralizeLiveHandlers(doc);

    // restore removed editor nodes
    restoreRemoved();
    if (doc.documentElement && mode) {
      doc.documentElement.setAttribute('data-he-mode', mode);
    }
    // re-add gfont links that were live
    for (const l of gfontLinks) {
      if (doc.head) doc.head.appendChild(l);
    }

    return html;
    } finally {
      // Detached nodes first (canvas styling + sheet access depend on them),
      // then re-apply simulation so the Edit view keeps its preview.
      try { restoreRemoved(); } catch { /* ignore */ }
      try { if (tabBackup) unstashTabPreviews(tabBackup); } catch { /* ignore */ }
      try { if (toggleBackup) unstashTogglePreviews(toggleBackup); } catch { /* ignore */ }
      // Strip phase restored originals (had ? add : remove); preview is inverse.
      if (simBackup && simBackup.elm && doc.contains && doc.contains(simBackup.elm)) {
        try {
          for (const [cls, had] of simBackup.classes) {
            if (!simClasses.has(cls)) continue;
            if (had) simBackup.elm.classList.remove(cls);
            else simBackup.elm.classList.add(cls);
          }
          for (const [name, orig] of simBackup.attrs) {
            if (!simAttrs.has(name)) continue;
            if (name === 'hidden') {
              if (orig === null) simBackup.elm.setAttribute(name, '');
              else simBackup.elm.removeAttribute(name);
            } else if (/^aria-/i.test(name)) {
              simBackup.elm.setAttribute(name, orig === 'true' ? 'false' : 'true');
            } else {
              // generic boolean-ish attr (e.g. open): toggle presence
              if (orig === null) simBackup.elm.setAttribute(name, '');
              else simBackup.elm.removeAttribute(name);
            }
          }
        } catch { /* ignore */ }
      }
    }
  },

  // ---------- preview-only simulation API (Edit mode, never dirty) ----------

  simulateToggleClass(cls) {
    if (mode !== 'edit') return null;
    const elm = this.selected;
    const name = String(cls || '').trim().replace(/^\./, '');
    if (!elm || !name || !/^[-_a-zA-Z][-\w]*$/.test(name)) return null;
    ensureSimElm(elm);
    if (simClasses.has(name)) {
      const had = simClasses.get(name);
      try {
        if (had) elm.classList.add(name);
        else elm.classList.remove(name);
      } catch { /* ignore */ }
      simClasses.delete(name);
      if (!simClasses.size && !simAttrs.size) simElm = null;
    } else {
      const had = elm.classList.contains(name);
      simClasses.set(name, had);
      try {
        if (had) elm.classList.remove(name);
        else elm.classList.add(name);
      } catch { /* ignore */ }
    }
    updateSelectLabel(elm);
    this.refreshOverlays();
    if (HE.panel && HE.panel.refresh) {
      try { HE.panel.refresh(); } catch { /* ignore */ }
    }
    return { simulated: simClasses.has(name), on: elm.classList.contains(name) };
  },

  simulateToggleAttr(attrName) {
    if (mode !== 'edit') return null;
    const elm = this.selected;
    const name = String(attrName || '').trim();
    if (!elm || !name || !/^[a-zA-Z][\w:.-]*$/.test(name)) return null;
    // Tab/toggle-managed attrs live in their previews, not single-element
    // sim — restore that root first so the systems never double-bookkeep.
    try {
      if (name === 'hidden' || /^aria-(selected|expanded)$/i.test(name)) {
        if (tabPreviews.size) {
          const root = findTabsRoot(elm);
          if (root && tabPreviews.has(root)) clearTabPreview(root);
        }
        if (togglePreviews.size) {
          const f = detectToggleControl(elm);
          const r = (f && f.root) || (elm.closest ? elm.closest('.accordion, .dropdown, .site-nav') : null);
          if (r && togglePreviews.has(r)) clearTogglePreview(r);
        }
      }
    } catch { /* ignore */ }
    ensureSimElm(elm);
    if (simAttrs.has(name)) {
      const orig = simAttrs.get(name);
      try {
        if (orig === null) elm.removeAttribute(name);
        else elm.setAttribute(name, orig);
      } catch { /* ignore */ }
      simAttrs.delete(name);
      if (!simClasses.size && !simAttrs.size) simElm = null;
    } else {
      const orig = elm.getAttribute(name);
      simAttrs.set(name, orig);
      try {
        if (name === 'hidden') {
          if (elm.hasAttribute('hidden')) elm.removeAttribute('hidden');
          else elm.setAttribute('hidden', '');
        } else if (/^aria-/i.test(name)) {
          elm.setAttribute(name, orig === 'true' ? 'false' : 'true');
        } else {
          // e.g. <dialog open>: toggle presence
          if (elm.hasAttribute(name)) elm.removeAttribute(name);
          else elm.setAttribute(name, '');
        }
      } catch { /* ignore */ }
    }
    this.refreshOverlays();
    if (HE.panel && HE.panel.refresh) {
      try { HE.panel.refresh(); } catch { /* ignore */ }
    }
    return { simulated: simAttrs.has(name), value: elm.getAttribute(name) };
  },

  getSimulation() {
    return {
      elm: simElm,
      classes: [...simClasses.keys()],
      attrs: [...simAttrs.keys()],
    };
  },

  isSimulatingClass(cls) {
    return !!simElm && this.selected === simElm && simClasses.has(cls);
  },

  isSimulatingAttr(name) {
    return !!simElm && this.selected === simElm && simAttrs.has(name);
  },

  // User really attached/detached via chips (or edited attr for real):
  // adopt the value so serialize keeps it.
  noteRealClass(cls) {
    const name = String(cls || '').trim().replace(/^\./, '');
    if (name && simClasses.has(name)) {
      simClasses.delete(name);
      if (!simClasses.size && !simAttrs.size) simElm = null;
    }
    // Hand-editing a preview-managed state class means manual control now:
    // drop (don't restore) the stale preview bookkeeping for that root.
    try {
      if (name === 'is-open' && togglePreviews.size) {
        const sel = HE.canvas.selected;
        const r = sel && sel.closest ? sel.closest('.accordion, .dropdown, .site-nav') : null;
        if (r && togglePreviews.has(r)) togglePreviews.delete(r);
      }
    } catch { /* ignore */ }
  },

  noteRealAttr(name) {
    const key = String(name || '').trim();
    if (key && simAttrs.has(key)) {
      simAttrs.delete(key);
      if (!simClasses.size && !simAttrs.size) simElm = null;
    }
    // Same for preview-managed attrs (hidden / aria-selected / aria-expanded):
    // a real edit takes over, so discard the stale preview entry instead of
    // restoring over the user's edit on the next save.
    try {
      if ((key === 'hidden' || /^aria-(selected|expanded)$/i.test(key))) {
        const sel = HE.canvas.selected;
        if (sel) {
          if (tabPreviews.size) {
            const tr = findTabsRoot(sel);
            if (tr && tabPreviews.has(tr)) tabPreviews.delete(tr);
          }
          if (togglePreviews.size) {
            const f = detectToggleControl(sel);
            const gr = (f && f.root) || (sel.closest ? sel.closest('.accordion, .dropdown, .site-nav') : null);
            if (gr && togglePreviews.has(gr)) togglePreviews.delete(gr);
          }
        }
      }
    } catch { /* ignore */ }
  },

  clearSimulation() {
    clearSimulation();
    if (HE.panel && HE.panel.refresh) {
      try { HE.panel.refresh(); } catch { /* ignore */ }
    }
  },

  // ---------- preview-only tab switching API (Edit mode, never dirty) ----------

  getTabContext(elm) {
    // Inspection is allowed in any mode so the panel can explain tab state;
    // preview switching itself (previewTab) is edit-only.
    const target = elm || this.selected;
    if (!target || !doc || !doc.contains(target)) return null;
    const root = findTabsRoot(target);
    if (!root || !doc.contains(root)) return null;
    const groups = tabsInRoot(root);
    if (!groups) return null;
    const { btns, panels } = groups;
    let activeIndex = panels.findIndex((p) => !p.hasAttribute('hidden'));
    if (activeIndex < 0) {
      activeIndex = btns.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    }
    if (activeIndex < 0) activeIndex = 0;
    // If a preview is active for this root, report the previewed index.
    try {
      const prev = tabPreviews.get(root);
      if (prev && typeof prev.previewIndex === 'number') activeIndex = prev.previewIndex;
    } catch { /* ignore */ }
    return { root, btns, panels, activeIndex };
  },

  getTabPreview(root) {
    try {
      if (!root) return null;
      return tabPreviews.get(root) || null;
    } catch { return null; }
  },

  previewTab(root, index, opts) {
    if (mode !== 'edit' || !root || !doc || !doc.contains(root)) return null;
    // A single-element hidden/aria simulation on anything inside this tabs
    // root would double-bookkeep against the tab preview (stale originals on
    // save). Silently drop sim inside this root first so tab originals are
    // the true saved state. Outer clearSimulation touches overlays only.
    try {
      if (simElm && (simClasses.size || simAttrs.size) && root.contains && root.contains(simElm)) {
        clearSimulation();
      }
    } catch { /* ignore */ }
    const groups = tabsInRoot(root);
    if (!groups) return null;
    const { btns, panels } = groups;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= Math.max(btns.length, panels.length)) return null;
    // Clamp to panels (buttons/panels are parallel by convention).
    const clamped = Math.min(i, panels.length - 1, btns.length - 1);
    let entry = tabPreviews.get(root);
    if (!entry) {
      entry = {
        btns,
        panels,
        btnAria: btns.map((b) => b.getAttribute('aria-selected')),
        panelHidden: panels.map((p) => p.hasAttribute('hidden')),
        previewIndex: clamped,
      };
      tabPreviews.set(root, entry);
    } else {
      // Refresh node lists in case the DOM changed since the preview started.
      entry.btns = btns;
      entry.panels = panels;
    }
    applyTabIndex(entry, clamped);
    this.refreshOverlays();
    if (!(opts && opts.quiet)) {
      if (HE.panel && HE.panel.refresh) {
        try { HE.panel.refresh(); } catch { /* ignore */ }
      }
    } else {
      // Even when quiet (canvas click path calls select() right after, which
      // refreshes the panel), overlays must move immediately.
    }
    return { index: clamped };
  },

  clearTabPreview(root) {
    clearTabPreview(root);
  },

  // ---------- preview-only toggle API (accordion / dropdown / nav) ----------

  getToggleContext(elm) {
    const target = elm || this.selected;
    if (!target || !doc || !doc.contains(target)) return null;
    let found = null;
    try {
      found = detectToggleControl(target);
      if (!found && target.closest) {
        const root = target.closest('.accordion, .dropdown, .site-nav');
        if (root && doc.contains(root)) found = detectToggleRoot(root);
      }
    } catch { found = null; }
    if (!found || !found.root || !doc.contains(found.root)) return null;
    let open = false;
    try {
      const prev = togglePreviews.get(found.root);
      open = prev && typeof prev.open === 'boolean' ? prev.open : toggleLiveOpen(found);
    } catch { /* ignore */ }
    return { kind: found.kind, root: found.root, btn: found.btn, panel: found.panel, open: !!open };
  },

  getTogglePreview(root) {
    try {
      if (!root) return null;
      return togglePreviews.get(root) || null;
    } catch { return null; }
  },

  // Flip the control's open state as an unsaved preview (canvas-click path).
  previewToggle(btn, opts) {
    if (mode !== 'edit' || !btn || !doc || !doc.contains(btn)) return null;
    const found = detectToggleControl(btn);
    if (!found || !found.root || !doc.contains(found.root)) return null;
    try {
      if (simElm && (simClasses.size || simAttrs.size) && found.root.contains && found.root.contains(simElm)) {
        clearSimulation();
      }
    } catch { /* ignore */ }
    let entry = togglePreviews.get(found.root);
    if (!entry) {
      entry = {
        kind: found.kind,
        root: found.root,
        btn: found.btn,
        panel: found.panel,
        btnAria: found.btn ? found.btn.getAttribute('aria-expanded') : null,
        panelHidden: found.panel && found.panel !== found.root ? found.panel.hasAttribute('hidden') : null,
        rootOpen: found.root.classList ? found.root.classList.contains('is-open') : false,
        open: false,
      };
      togglePreviews.set(found.root, entry);
    } else {
      entry.btn = found.btn;
      entry.panel = found.panel;
    }
    const next = !toggleLiveOpen(entry);
    applyToggle(entry, next);
    this.refreshOverlays();
    if (!(opts && opts.quiet)) {
      if (HE.panel && HE.panel.refresh) {
        try { HE.panel.refresh(); } catch { /* ignore */ }
      }
    }
    return { open: next };
  },

  // Set an explicit open state as an unsaved preview (panel + carry-over path).
  setToggleOpen(root, open, opts) {
    if (mode !== 'edit' || !root || !doc || !doc.contains(root)) return null;
    const found = detectToggleRoot(root);
    if (!found || !found.root) return null;
    try {
      if (simElm && (simClasses.size || simAttrs.size) && found.root.contains && found.root.contains(simElm)) {
        clearSimulation();
      }
    } catch { /* ignore */ }
    let entry = togglePreviews.get(found.root);
    if (!entry) {
      entry = {
        kind: found.kind,
        root: found.root,
        btn: found.btn,
        panel: found.panel,
        btnAria: found.btn ? found.btn.getAttribute('aria-expanded') : null,
        panelHidden: found.panel && found.panel !== found.root ? found.panel.hasAttribute('hidden') : null,
        rootOpen: found.root.classList ? found.root.classList.contains('is-open') : false,
        open: false,
      };
      togglePreviews.set(found.root, entry);
    } else {
      entry.btn = found.btn;
      entry.panel = found.panel;
    }
    applyToggle(entry, !!open);
    this.refreshOverlays();
    if (!(opts && opts.quiet)) {
      if (HE.panel && HE.panel.refresh) {
        try { HE.panel.refresh(); } catch { /* ignore */ }
      }
    }
    return { open: !!open };
  },

  clearTogglePreview(root) {
    clearTogglePreview(root);
  },

  // ---------- carousel scroll mirror (inherently unsaved) ----------

  getCarouselContext(elm) {
    const target = elm || this.selected;
    if (!target || !doc || !doc.contains(target) || !target.closest) return null;
    try {
      const root = target.classList && target.classList.contains('carousel')
        ? target
        : target.closest('.carousel');
      if (!root || !doc.contains(root)) return null;
      return { root };
    } catch { return null; }
  },

  // Scroll the track like Preview would. Scroll offsets live outside the
  // document markup, so this can never leak into a save — no bookkeeping.
  scrollCarousel(root, dir) {
    if (!root || !doc || !doc.contains(root)) return null;
    let track = null;
    try {
      track = root.classList && root.classList.contains('carousel-track')
        ? root
        : root.querySelector('.carousel-track');
    } catch { track = null; }
    if (!track) return null;
    const d = Number(dir) || 1;
    try {
      const w = track.clientWidth || 300;
      track.scrollBy({ left: d * w * 0.8, behavior: 'auto' });
    } catch {
      try { track.scrollLeft += d * 200; } catch { /* ignore */ }
    }
    this.refreshOverlays();
    return { ok: true };
  },
};

window.addEventListener('DOMContentLoaded', () => {
  iframe = document.getElementById('canvas');
});
