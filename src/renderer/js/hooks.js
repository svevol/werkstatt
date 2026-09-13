// Behavior analysis — read-only JS contract visibility for Edit mode.
//
// Purity: HTML is truth, JS only toggles classes/attrs. This module never
// executes project JS (regex parsing only; no dynamic code execution).
// It only parses cached JS *text* (loaded by main.js via window.he.readFile)
// with regexes and matches selectors against the selected element.
//
// Cached files live in HE.jsFiles: [{ src, rel, full, text }].
// Panel calls HE.hooks.hooksFor(elm) -> [{ kind, file, label, hint, full }].

import { HE } from './he.js';
import { escapeRegExp } from './util.js';

// ---------- parsing (regex only, never executed) ----------

function uniq(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function parseFile(text, fileName) {
  const src = String(text || '');
  const selectors = [];
  const classOps = []; // { op, cls }
  const attrs = []; // { kind: 'set'|'remove'|'hidden', name, value }
  const events = [];
  let m;

  const qRe = /querySelector(All)?\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((m = qRe.exec(src))) {
    if (m[2] && m[2].trim()) selectors.push(m[2].trim());
  }
  const idRe = /getElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((m = idRe.exec(src))) {
    if (m[1] && m[1].trim()) selectors.push('#' + m[1].trim());
  }
  const byClassRe = /getElementsByClassName\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((m = byClassRe.exec(src))) {
    if (m[1] && m[1].trim()) selectors.push('.' + m[1].trim().split(/\s+/)[0]);
  }
  const closestRe = /(?:closest|matches)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((m = closestRe.exec(src))) {
    if (m[1] && m[1].trim()) selectors.push(m[1].trim());
  }

  const classRe = /classList\s*\.\s*(toggle|add|remove)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = classRe.exec(src))) {
    if (m[2] && m[2].trim()) classOps.push({ op: m[1], cls: m[2].trim().split(/\s+/)[0] });
  }

  const setAttrRe = /setAttribute\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = setAttrRe.exec(src))) {
    if (m[1]) attrs.push({ kind: 'set', name: m[1].trim() });
  }
  const remAttrRe = /removeAttribute\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = remAttrRe.exec(src))) {
    if (m[1]) attrs.push({ kind: 'remove', name: m[1].trim() });
  }
  if (/(^|[^\w$])\.hidden\s*=/m.test(src)) attrs.push({ kind: 'hidden', name: 'hidden' });
  if (/\bhidden\b/.test(src) && /\.hidden|hidden\s*=|removeAttribute\(['"]hidden/.test(src)) {
    if (!attrs.some((a) => a.name === 'hidden')) attrs.push({ kind: 'hidden', name: 'hidden' });
  }

  const evRe = /addEventListener\s*\(\s*['"`]([\w-]+)['"`]/g;
  while ((m = evRe.exec(src))) {
    if (m[1]) events.push(m[1]);
  }

  return {
    file: fileName || '',
    selectors: uniq(selectors).slice(0, 20),
    classOps: classOps.slice(0, 20),
    attrs: attrs.slice(0, 20),
    events: uniq(events).slice(0, 10),
    hasDialog: /showModal|HTMLDialogElement|<dialog|["']dialog["']/.test(src),
    hasObserver: /IntersectionObserver/.test(src),
    hasWebgl: /no-webgl|WebGL|getContext\(['"]webgl/.test(src),
  };
}

// Parse results cached per HE.jsFiles entry (entries are replaced on page
// load, so a WeakMap keyed by the file object never goes stale). Panel
// refreshes used to re-parse every file several times per selection.
const parseCache = new WeakMap();

function parseCached(f) {
  let parsed = parseCache.get(f);
  if (!parsed) {
    parsed = parseFile(f.text, f.rel || f.src || '');
    parseCache.set(f, parsed);
  }
  return parsed;
}

// ---------- selector matching (safe, no throw) ----------

function selectorMatches(elm, selector) {
  try {
    return elm.matches(selector);
  } catch {
    // Fallback for selectors the editor iframe can't parse:
    // match on any .class token or #id token present on the element.
    const classes = String(selector).match(/\.([A-Za-z0-9_-]+)/g) || [];
    for (const c of classes) {
      try {
        if (elm.classList && elm.classList.contains(c.slice(1))) return true;
      } catch {
        /* ignore */
      }
    }
    const ids = String(selector).match(/#([A-Za-z0-9_-]+)/g) || [];
    for (const id of ids) {
      if (elm.id && elm.id === id.slice(1)) return true;
    }
    const tag = String(selector).trim().match(/^[a-zA-Z][a-zA-Z0-9-]*/);
    if (tag && elm.tagName && elm.tagName.toLowerCase() === tag[0].toLowerCase()) return true;
    return false;
  }
}

function containsSelector(elm, selector) {
  try {
    return !!elm.querySelector(selector);
  } catch {
    return false;
  }
}

function baseName(p) {
  return String(p || '').split(/[\\/]/).pop() || String(p || '');
}

// ---------- fallback conventions (AGENT_SITE_PROMPT.md) ----------

// Shown when the selection matches, even if project JS has no evidence yet.
// These are the documented component contracts agents are asked to follow.
const FALLBACKS = [
  {
    test: '.accordion',
    label: 'click .accordion-btn toggles .is-open on .accordion',
    hint: 'Style .is-open variant to change open state',
    previewClasses: ['is-open'],
    previewAttrs: ['aria-expanded'],
  },
  {
    test: '.accordion-btn',
    label: 'click .accordion-btn toggles .is-open on .accordion',
    hint: 'Style .accordion.is-open to change open state',
    previewClasses: ['is-open'],
    previewAttrs: ['aria-expanded'],
  },
  {
    test: '.accordion-panel',
    label: 'panel hidden toggled by accordion click (aria-expanded)',
    hint: 'Keep hidden as JS state; style .accordion-panel normally',
    previewClasses: [],
    previewAttrs: ['hidden'],
  },
  {
    test: '.tab, [role="tab"]',
    label: 'click tab switches panels (aria-selected)',
    hint: 'Style [aria-selected="true"] variant for the active tab',
    previewClasses: [],
    previewAttrs: ['aria-selected'],
  },
  {
    test: '.tab-panel, [role="tabpanel"]',
    label: 'tab script toggles hidden on panels',
    hint: 'Style the panel; hidden is JS state, not CSS display',
    previewClasses: [],
    previewAttrs: ['hidden'],
  },
  {
    test: 'dialog, .dialog, .modal',
    label: 'dialog.showModal() / close() controls open state',
    hint: 'Style dialog::backdrop for the open state',
    previewClasses: [],
    previewAttrs: ['open'],
  },
  {
    test: '.reveal',
    label: 'IntersectionObserver adds .is-visible to .reveal',
    hint: 'Style .reveal.is-visible to change appear state',
    previewClasses: ['is-visible'],
    previewAttrs: [],
  },
  {
    test: '.is-visible',
    label: 'IntersectionObserver adds .is-visible to .reveal',
    hint: 'Style .is-visible variant; initial state comes from JS, not CSS',
    previewClasses: ['is-visible'],
    previewAttrs: [],
  },
  {
    test: '.no-webgl',
    label: 'JS adds .no-webgl when WebGL is unavailable',
    hint: 'Style .no-webgl fallback variant for decorative canvas',
    previewClasses: ['no-webgl'],
    previewAttrs: [],
  },
];

function fallbackFor(elm) {
  const out = [];
  for (const fb of FALLBACKS) {
    const parts = String(fb.test).split(',').map((s) => s.trim()).filter(Boolean);
    let hit = null;
    for (const part of parts) {
      try {
        if (selectorMatches(elm, part)) {
          hit = part;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (hit) out.push({ kind: 'convention', file: '', label: fb.label, hint: fb.hint, full: null });
  }
  return out;
}

// ---------- parsed hooks ----------

function parsedFor(elm, files) {
  const out = [];
  for (const f of files || []) {
    if (!f || typeof f.text !== 'string') continue;
    let parsed;
    try {
      parsed = parseCached(f);
    } catch {
      continue;
    }
    if (!parsed.selectors.length && !parsed.hasDialog && !parsed.hasObserver && !parsed.hasWebgl) continue;
    const name = baseName(f.rel || f.src || 'app.js');
    const event = parsed.events.includes('click')
      ? 'click'
      : parsed.events[0] || (parsed.classOps.length || parsed.attrs.length ? 'updates' : 'queries');

    const matchedSelectors = parsed.selectors.filter((s) => {
      try {
        return selectorMatches(elm, s);
      } catch {
        return false;
      }
    });
    const childSelectors = parsed.selectors.filter((s) => {
      try {
        return !matchedSelectors.includes(s) && containsSelector(elm, s);
      } catch {
        return false;
      }
    });

    const classBits = parsed.classOps.slice(0, 3).map((c) => `${c.op} .${c.cls}`);
    const attrBits = parsed.attrs.slice(0, 3).map((a) =>
      a.kind === 'hidden' ? 'toggles hidden' : `${a.kind} ${a.name}`
    );
    const stateBit = [...classBits, ...attrBits].join(', ');

    for (const s of matchedSelectors) {
      let label;
      let hint;
      if (stateBit) {
        label = `${name}: ${event} ${s} → ${stateBit}`;
        const firstCls = parsed.classOps[0] && parsed.classOps[0].cls;
        hint = firstCls
          ? `Style .${firstCls} variant to change this state`
          : 'State lives in classes/attrs — style both states in CSS';
      } else {
        label = `${name}: ${event} ${s}`;
        hint = 'Read-only — JS queried this element; content stays in HTML';
      }
      out.push({ kind: 'parsed', file: name, label, hint, full: f.full || null });
    }
    for (const s of childSelectors.slice(0, 2)) {
      const label = stateBit
        ? `${name}: child ${s} inside this element drives ${stateBit}`
        : `${name}: child ${s} inside this element`;
      out.push({
        kind: 'parsed-child',
        file: name,
        label,
        hint: 'Parent holds the hook target; style state classes in CSS',
        full: f.full || null,
      });
    }

    // File-level patterns with no querySelector evidence (e.g. dialog,
    // observer, webgl guards that use getElementById or body classes).
    if (!matchedSelectors.length && !childSelectors.length) {
      const tag = (elm.tagName || '').toLowerCase();
      if (parsed.hasDialog && (tag === 'dialog' || (elm.classList && (elm.classList.contains('dialog') || elm.classList.contains('modal'))))) {
        out.push({
          kind: 'parsed', file: name,
          label: `${name}: controls this dialog (showModal / close)`,
          hint: 'Style dialog::backdrop for the open state',
          full: f.full || null,
        });
      }
      if (parsed.hasObserver && elm.classList && elm.classList.contains('reveal')) {
        out.push({
          kind: 'parsed', file: name,
          label: `${name}: observes .reveal (IntersectionObserver)`,
          hint: 'Style .reveal.is-visible to change appear state',
          full: f.full || null,
        });
      }
      if (parsed.hasWebgl && elm.classList && elm.classList.contains('no-webgl')) {
        out.push({
          kind: 'parsed', file: name,
          label: `${name}: adds .no-webgl fallback`,
          hint: 'Style .no-webgl fallback variant',
          full: f.full || null,
        });
      }
    }
  }
  return out;
}

function hooksFor(elm) {
  if (!elm || !elm.tagName) return [];
  if (elm.id === 'he-overlay-root' || (elm.closest && elm.closest('#he-overlay-root'))) return [];
  const files = HE.jsFiles || [];
  const parsed = parsedFor(elm, files);
  const conventions = fallbackFor(elm);
  // De-dupe: prefer parsed evidence, then add conventions not already covered.
  const seen = new Set(parsed.map((h) => h.label + '|' + h.hint));
  const out = [...parsed];
  for (const c of conventions) {
    const key = c.label + '|' + c.hint;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out.slice(0, 8);
}

// Preview-only toggles for the Behavior panel: classes (is-open/is-visible)
// and visual-only attrs (aria-expanded/hidden). Derived from parsed JS
// evidence (classOps/attrs on matching selectors) plus fallback contracts.
// Returns { classes: [...], attrs: [...] } — names only, no execution.
function statePreviews(elm) {
  if (!elm || !elm.tagName) return { classes: [], attrs: [] };
  try {
    if (elm.id === 'he-overlay-root' || (elm.closest && elm.closest('#he-overlay-root'))) {
      return { classes: [], attrs: [] };
    }
  } catch { /* ignore */ }
  const classes = [];
  const attrs = [];
  const pushCls = (name) => {
    const clean = String(name || '').trim().replace(/^\./, '').split(/\s+/)[0];
    if (!clean || !/^[-_a-zA-Z][-\w]*$/.test(clean)) return;
    if (!classes.includes(clean)) classes.push(clean);
  };
  const pushAttr = (name) => {
    const clean = String(name || '').trim();
    if (!clean || !/^[a-zA-Z][\w:.-]*$/.test(clean)) return;
    if (!attrs.includes(clean)) attrs.push(clean);
  };
  // Fallback contracts first (stable order for accordion etc.)
  try {
    for (const fb of FALLBACKS) {
      const parts = String(fb.test).split(',').map((s) => s.trim()).filter(Boolean);
      let hit = false;
      for (const part of parts) {
        try {
          if (selectorMatches(elm, part)) { hit = true; break; }
        } catch { /* ignore */ }
      }
      if (!hit) continue;
      for (const c of fb.previewClasses || []) pushCls(c);
      for (const a of fb.previewAttrs || []) pushAttr(a);
    }
  } catch { /* ignore */ }
  // Parsed evidence: only files where a selector matches this element
  // (child-only matches drive other elements — skip for preview).
  try {
    const files = HE.jsFiles || [];
    for (const f of files) {
      if (!f || typeof f.text !== 'string') continue;
      let parsed;
      try {
        parsed = parseCached(f);
      } catch { continue; }
      let matched = false;
      for (const s of parsed.selectors || []) {
        try {
          if (selectorMatches(elm, s)) { matched = true; break; }
        } catch { /* ignore */ }
      }
      // Dialog/observer guards without query evidence still count.
      if (!matched) {
        const tag = (elm.tagName || '').toLowerCase();
        if (parsed.hasDialog && (tag === 'dialog' || (elm.classList && (elm.classList.contains('dialog') || elm.classList.contains('modal'))))) matched = true;
        else if (parsed.hasObserver && elm.classList && elm.classList.contains('reveal')) matched = true;
        else if (parsed.hasWebgl && elm.classList && elm.classList.contains('no-webgl')) matched = true;
      }
      if (!matched) continue;
      for (const c of parsed.classOps || []) pushCls(c.cls);
      for (const a of parsed.attrs || []) {
        // Only visual state attrs get a preview button.
        if (/^(aria-expanded|aria-selected|aria-hidden|hidden|open)$/i.test(a.name)) pushAttr(a.name);
      }
      if (classes.length + attrs.length >= 7) break;
    }
  } catch { /* ignore */ }
  return { classes: classes.slice(0, 4), attrs: attrs.slice(0, 3) };
}

// Public surface is assigned at the bottom of the module. parseFile,
// selectorMatches, fallbackFor, FALLBACKS and classUsagesInJs stay
// module-private (used internally below).

// ---------- JS-impact guards (class actions + warnings) ----------

// State classes toggled by JS at runtime (is-open etc.) are expected to be
// absent from the static HTML — never treat them as missing hooks or
// breakage evidence on their own.
const STATE_CLASSES = new Set(['is-open', 'is-visible', 'no-webgl']);

// These contracts are progressive enhancements. An absent component is valid;
// only report a child hook when its component root is actually on the page.
const OPTIONAL_HOOKS = [
  { selectors: ['.site-header', '.site-nav', '.nav-toggle'], root: '.site-header' },
  { selectors: ['.dropdown', '.dropdown-btn', '.dropdown-menu'], root: '.dropdown' },
  { selectors: ['.accordion', '.accordion-btn', '.accordion-panel'], root: '.accordion' },
  { selectors: ['.tabs', '.tab-btn', '.tab-panel'], root: '.tabs' },
  { selectors: ['.carousel', '.carousel-track', '.carousel-btn[data-scroll]'], root: '.carousel' },
  { selectors: ['.hero-canvas'], root: null },
  { selectors: ['input[type="email"]'], root: '.cta-form, .modal-form' },
  {
    selectors: [
      '[data-open-dialog]', '[data-close-dialog]', '.theme-toggle', '[data-reveal]',
      '.nav-link[href^="#"]', '.cta-form, .modal-form', '.form-error', '.form-success',
      '.dialog', '.modal', 'dialog',
    ],
    root: null,
  },
];

// Allowlist entries may list alternatives as one comma-joined string
// ('.cta-form, .modal-form'); a JS query names a single selector, so compare
// against each trimmed part, not the raw entry. Exact string equality here is
// what previously made a `.cta-form` query warn on every page.
function optionalHookFor(selector) {
  const query = String(selector == null ? '' : selector).trim();
  if (!query) return null;
  for (const entry of OPTIONAL_HOOKS) {
    for (const list of entry.selectors) {
      for (const part of String(list).split(',')) {
        if (part.trim() === query) return entry;
      }
    }
  }
  return null;
}

function isAbsentOptionalHook(doc, selector) {
  const hook = optionalHookFor(selector);
  if (!hook) return false;
  if (!hook.root) return true;
  try {
    return !doc.querySelector(hook.root);
  } catch {
    return false;
  }
}

function baseNameOf(f) {
  return baseName((f && (f.rel || f.src)) || 'app.js');
}

function selectorReferencesClass(selector, cls) {
  try {
    const re = new RegExp('\\.' + escapeRegExp(cls) + '(?![-\\w])');
    return re.test(String(selector || ''));
  } catch {
    return false;
  }
}

// Which cached JS files reference `cls` (parsed selectors + class strings)?
// Returns [{ file, full, kinds: ['queries'|'class'] }] — sync, regex only.
function classUsagesInJs(cls) {
  const name = String(cls || '').trim().replace(/^\./, '');
  if (!name) return [];
  const out = [];
  for (const f of HE.jsFiles || []) {
    if (!f || typeof f.text !== 'string') continue;
    let parsed;
    try {
      parsed = parseCached(f);
    } catch {
      continue;
    }
    const kinds = new Set();
    for (const s of parsed.selectors || []) {
      if (selectorReferencesClass(s, name)) kinds.add('queries');
    }
    for (const c of parsed.classOps || []) {
      if (c.cls === name) kinds.add('class');
    }
    if (!kinds.size) {
      // Raw literal fallback: exact 'name' / "name" string in the file
      // (covers patterns the regex parser missed without executing JS).
      try {
        const re = new RegExp(`['"\`]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
        if (re.test(f.text)) kinds.add('string');
      } catch {
        /* ignore */
      }
    }
    if (kinds.size) {
      out.push({ file: baseNameOf(f), full: f.full || null, kinds: [...kinds] });
    }
  }
  return out;
}

function classesUsagesInJs(names) {
  // -> [{ cls, file, full, kinds }]
  const out = [];
  for (const n of names || []) {
    for (const u of classUsagesInJs(n)) {
      out.push({ cls: String(n).replace(/^\./, ''), file: u.file, full: u.full, kinds: u.kinds });
    }
  }
  return out;
}

// Per-page check: parsed JS selectors that match nothing in this doc.
// Selectors-only (classOps are writes like add('is-open') — expected absent).
// Returns [{ file, selector }] capped at `limit`.
function missingSelectors(doc, limit) {
  const cap = limit == null ? 5 : limit;
  const out = [];
  const seen = new Set();
  if (!doc || !doc.querySelector) return out;
  for (const f of HE.jsFiles || []) {
    if (!f || typeof f.text !== 'string') continue;
    let parsed;
    try {
      parsed = parseCached(f);
    } catch {
      continue;
    }
    for (const s of parsed.selectors || []) {
      if (!s || seen.has(s)) continue;
      seen.add(s);
      // Pure state-class selectors are runtime state — never warn.
      const tokens = String(s).match(/\.([A-Za-z0-9_-]+)/g) || [];
      if (tokens.length && tokens.every((t) => STATE_CLASSES.has(t.slice(1)))) continue;
      let matched = false;
      try {
        matched = !!doc.querySelector(s);
      } catch {
        continue; // unparseable selector — skip, don't warn
      }
      if (!matched) {
        if (isAbsentOptionalHook(doc, s)) continue;
        out.push({ file: baseNameOf(f), selector: s });
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}

// Safe string replace of '.old' class literals only. Operates on raw text
// with regexes — never reformats JS. Returns { text, count }.
// - querySelector(All)/closest/matches('... .old ...'): replace the exact
//   `.old` token inside the selector string, preserving quotes + rest.
// - classList.add/remove/toggle('old') and
//   getElementsByClassName('old'): replace only when the literal is exactly
//   `old` (or contains it as a whole whitespace-separated word).
function renameClassInJsText(text, oldName, newName) {
  const src = String(text == null ? '' : text);
  const old = String(oldName || '').trim().replace(/^\./, '');
  const next = String(newName || '').trim().replace(/^\./, '');
  if (!old || !next || old === next) return { text: src, count: 0 };
  const esc = escapeRegExp(old);
  let count = 0;
  let out = src;

  // 1) selector-string contexts: querySelector(All), closest, matches.
  // Replace exact `.old` tokens inside the quoted selector only.
  const selRe = /((?:querySelector(?:All)?|closest|matches)\s*\(\s*)(['"`])((?:(?!\2)[\s\S])*?)(\2\s*\))/g;
  out = out.replace(selRe, (m, pre, q, sel, post) => {
    const tokenRe = new RegExp('\\.' + esc + '(?![-\\w])', 'g');
    let n = 0;
    const sel2 = sel.replace(tokenRe, () => {
      n++;
      return '.' + next;
    });
    count += n;
    return pre + q + sel2 + post;
  });

  // 2) exact-literal contexts: classList.add/remove/toggle, getElementsByClassName.
  const litRe = /((?:classList\s*\.\s*(?:add|remove|toggle)|getElementsByClassName)\s*\(\s*)(['"`])([^'"`]*?)(\2\s*\))/g;
  out = out.replace(litRe, (m, pre, q, lit, post) => {
    const parts = String(lit).split(/(\s+)/);
    let n = 0;
    const lit2 = parts
      .map((p) => {
        if (/^\s+$/.test(p)) return p;
        if (p === old) {
          n++;
          return next;
        }
        return p;
      })
      .join('');
    count += n;
    return pre + q + lit2 + post;
  });

  return { text: out, count };
}

const hooks = {
  hooksFor,
  statePreviews,
  classesUsagesInJs,
  missingSelectors,
  renameClassInJsText,
};

HE.hooks = hooks;

export { hooks };
