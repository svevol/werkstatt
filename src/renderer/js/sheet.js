// Sheet — live model over the page's shared stylesheet.
// The stylesheet text lives in an overlay <style data-he-live> inside the canvas
// iframe, so all edits go through the browser's own CSSOM: what you see is
// exactly what the browser renders. Serialization formats it back to clean CSS.

import { HE } from './he.js';
import {
  escapeRegExp, removeClassFromSelectorList, splitSelectorList, selectorSpecificity,
} from './util.js';

function normSel(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// Normalized declaration key for duplicate detection: sorted
// `prop:value` pairs, whitespace-collapsed and lowercased so
// `color:red` and `COLOR:  red ` compare equal. Includes !important.
function normStyle(style) {
  const parts = [];
  for (let i = 0; i < style.length; i++) {
    const prop = style.item(i).toLowerCase().trim();
    let val = style.getPropertyValue(prop).replace(/\s+/g, ' ').trim().toLowerCase();
    const pri = style.getPropertyPriority(prop);
    if (pri) val += ' !' + pri.toLowerCase();
    parts.push(prop + ':' + val);
  }
  parts.sort();
  return parts.join(';');
}

// Split a declaration block text into individual declarations,
// respecting quotes and parentheses (semicolons can appear inside url()/strings).
function splitDecls(cssText) {
  const decls = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < cssText.length; i++) {
    const ch = cssText[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === ';' && depth === 0) {
      decls.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) decls.push(cur);
  return decls;
}

const BOX_SHORTHANDS = {
  'margin-top': { shorthand: 'margin', index: 0 },
  'margin-right': { shorthand: 'margin', index: 1 },
  'margin-bottom': { shorthand: 'margin', index: 2 },
  'margin-left': { shorthand: 'margin', index: 3 },
  'padding-top': { shorthand: 'padding', index: 0 },
  'padding-right': { shorthand: 'padding', index: 1 },
  'padding-bottom': { shorthand: 'padding', index: 2 },
  'padding-left': { shorthand: 'padding', index: 3 },
};

// CSS box shorthands are whitespace-separated, except inside functions and
// quoted strings where whitespace belongs to the value.
function splitCssValues(value) {
  const parts = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (const ch of String(value || '')) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (cur.trim()) {
        parts.push(cur.trim());
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function expandBoxShorthand(value) {
  const parts = splitCssValues(value);
  if (parts.length < 1 || parts.length > 4) return null;
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return parts;
}

function readStyleProperty(style, prop) {
  const direct = style.getPropertyValue(prop);
  if (direct) return direct;
  const info = BOX_SHORTHANDS[prop];
  if (!info) return '';
  const shorthand = style.getPropertyValue(info.shorthand);
  const expanded = expandBoxShorthand(shorthand);
  return expanded ? expanded[info.index] : '';
}

// A side edit must replace the shorthand first. Otherwise the new longhand
// would coexist with the old declaration, and clearing it would appear to do
// nothing because the shorthand would immediately become effective again.
function expandBoxShorthandForWrite(style, prop) {
  const info = BOX_SHORTHANDS[prop];
  if (!info || style.getPropertyValue(prop)) return;
  const shorthand = style.getPropertyValue(info.shorthand);
  const expanded = expandBoxShorthand(shorthand);
  if (!expanded) return;
  const priority = style.getPropertyPriority(info.shorthand);
  style.removeProperty(info.shorthand);
  const sides = Object.keys(BOX_SHORTHANDS)
    .filter((name) => BOX_SHORTHANDS[name].shorthand === info.shorthand)
    .sort((a, b) => BOX_SHORTHANDS[a].index - BOX_SHORTHANDS[b].index);
  for (const [index, side] of sides.entries()) {
    style.setProperty(side, expanded[index], priority);
  }
}

// Shared declaration writer: empty value removes, trailing !important maps
// to the CSSOM priority argument.
function writeStyle(style, prop, value) {
  value = (value || '').trim();
  expandBoxShorthandForWrite(style, prop);
  if (!value) {
    style.removeProperty(prop);
    return;
  }
  const important = /\s*!important\s*$/i.test(value);
  if (important) {
    style.setProperty(prop, value.replace(/\s*!important\s*$/i, '').trim(), 'important');
  } else {
    style.setProperty(prop, value);
  }
}

// Serialize from style.cssText, NOT by iterating properties: iterating expands
// shorthands into longhands, and shorthands containing var() come back with
// empty longhand values (pending substitution), which destroys the declaration.
function formatDecls(style, depth) {
  const ind = '  '.repeat(depth);
  let out = '';
  for (const decl of splitDecls(style.cssText || '')) {
    const t = decl.trim();
    if (!t) continue;
    out += `${ind}${t};\n`;
  }
  return out;
}

function formatRule(rule, depth) {
  const ind = '  '.repeat(depth);
  // CSSRule.STYLE_RULE = 1
  if (rule.type === 1) {
    // A style rule with CSS nesting: declarations alone would drop the
    // nested rules (and any declarations that follow them). The browser's
    // own serialization preserves order and content verbatim.
    let hasNested = false;
    try { hasNested = !!(rule.cssRules && rule.cssRules.length); } catch { hasNested = false; }
    if (hasNested) return ind + rule.cssText;
    const decls = formatDecls(rule.style, depth + 1);
    if (!decls) return `${ind}${rule.selectorText} {}`;
    return `${ind}${rule.selectorText} {\n${decls}${ind}}`;
  }
  // CSSRule.MEDIA_RULE = 4, SUPPORTS_RULE = 12
  if (rule.type === 4 || rule.type === 12) {
    const cond = rule.type === 4 ? rule.media.mediaText : rule.conditionText;
    const at = rule.type === 4 ? '@media' : '@supports';
    const inner = Array.from(rule.cssRules)
      .map((r) => formatRule(r, depth + 1))
      .join('\n\n');
    return `${ind}${at} ${cond} {\n\n${inner}\n\n${ind}}`;
  }
  // CSSRule.FONT_FACE_RULE = 5
  if (rule.type === 5) {
    return `${ind}@font-face {\n${formatDecls(rule.style, depth + 1)}${ind}}`;
  }
  // CSSRule.KEYFRAMES_RULE = 7
  if (rule.type === 7) {
    const inner = Array.from(rule.cssRules)
      .map((kf) => {
        const d = formatDecls(kf.style, depth + 2);
        return `${'  '.repeat(depth + 1)}${kf.keyText} {\n${d}${'  '.repeat(depth + 1)}}`;
      })
      .join('\n');
    return `${ind}@keyframes ${rule.name} {\n${inner}\n${ind}}`;
  }
  // IMPORT, CHARSET, NAMESPACE, anything else — keep as-is
  return ind + rule.cssText;
}

function normMedia(s) {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

class Sheet {
  constructor(styleEl) {
    this.styleEl = styleEl;
    // Force CSSOM association if the browser deferred it
    if (styleEl && !styleEl.sheet && styleEl.isConnected) {
      const text = styleEl.textContent;
      styleEl.textContent = text;
    }
  }

  get sheet() {
    let s = this.styleEl && this.styleEl.sheet;
    if (!s && this.styleEl && this.styleEl.isConnected) {
      // Chromium sometimes defers CSSOM association on (re)inserted
      // <style> elements — jiggle the text to force it back instead of
      // dying permanently with "Stylesheet is not available".
      try {
        const text = this.styleEl.textContent;
        this.styleEl.textContent = text;
        s = this.styleEl.sheet;
      } catch { /* fall through to throw */ }
    }
    if (!s) throw new Error('Stylesheet is not available');
    return s;
  }

  load(cssText) {
    this.styleEl.textContent = cssText;
  }

  // --- rule lookup (top-level rules only; media rules are preserved but not panel-edited) ---

  findRule(selector) {
    const target = normSel(selector);
    const sheet = this.sheet;
    for (const rule of sheet.cssRules) {
      if (rule.type === 1 && normSel(rule.selectorText) === target) return rule;
    }
    return null;
  }

  ensureRule(selector) {
    let rule = this.findRule(selector);
    if (!rule) {
      const sheet = this.sheet;
      const idx = sheet.cssRules.length;
      sheet.insertRule(`${selector} {}`, idx);
      rule = sheet.cssRules[idx];
    }
    return rule;
  }

  // --- media-query overrides (breakpoint editing) ---

  findMediaRule(mediaText) {
    const target = normMedia(mediaText);
    if (!target) return null;
    for (const rule of this.sheet.cssRules) {
      if (rule.type === 4 && normMedia(rule.conditionText || (rule.media && rule.media.mediaText)) === target) return rule;
    }
    return null;
  }

  ensureMediaRule(mediaText) {
    let m = this.findMediaRule(mediaText);
    if (m) return m;
    const idx = this.sheet.cssRules.length;
    this.sheet.insertRule(`@media ${mediaText} {}`, idx);
    return this.sheet.cssRules[idx];
  }

  findRuleInMedia(mediaText, selector) {
    const m = this.findMediaRule(mediaText);
    if (!m) return null;
    const target = normSel(selector);
    for (const rule of m.cssRules) {
      if (rule.type === 1 && normSel(rule.selectorText) === target) return rule;
    }
    return null;
  }

  ensureRuleInMedia(mediaText, selector) {
    const m = this.ensureMediaRule(mediaText);
    let rule = this.findRuleInMedia(mediaText, selector);
    if (!rule) {
      const idx = m.cssRules.length;
      m.insertRule(`${selector} {}`, idx);
      rule = m.cssRules[idx];
    }
    return rule;
  }

  // Every distinct @media condition in the sheet (top level and nested),
  // normalized and sorted. The topbar viewport switch offers author-defined
  // breakpoints in addition to its fixed tablet/mobile defaults.
  mediaConditions() {
    const out = new Set();
    const walk = (ruleList) => {
      for (const rule of ruleList) {
        const kids = Sheet._children(rule);
        if (kids) walk(kids);
        if (rule.type !== 4) continue;
        const cond = normMedia(rule.conditionText || (rule.media && rule.media.mediaText) || '');
        if (cond) out.add(cond);
      }
    };
    try { walk(this.sheet.cssRules); } catch { /* ignore */ }
    return [...out].sort();
  }

  getMedia(selector, prop, mediaText) {
    if (!mediaText) return this.get(selector, prop);
    const rule = this.findRuleInMedia(mediaText, selector);
    if (!rule) return '';
    return readStyleProperty(rule.style, prop);
  }

  setMedia(selector, prop, value, mediaText) {
    if (!mediaText) return this.set(selector, prop, value);
    const rule = this.ensureRuleInMedia(mediaText, selector);
    writeStyle(rule.style, prop, value);
  }

  // --- property access ---

  get(selector, prop) {
    const rule = this.findRule(selector);
    if (!rule) return '';
    return readStyleProperty(rule.style, prop);
  }

  set(selector, prop, value) {
    const rule = this.ensureRule(selector);
    writeStyle(rule.style, prop, value);
  }

  // --- rule-object editing (Matching-rules picker) ---
  // A picked rule is edited through its CSSRule object so descendant,
  // attribute, media, @layer and nested rules all write to the exact rule
  // the user chose — no selector-string lookup and no new rules created.

  declOn(rule, prop) {
    if (!rule || !rule.style) return '';
    return readStyleProperty(rule.style, prop);
  }

  setOnRule(rule, prop, value) {
    if (!rule || !rule.style) return;
    writeStyle(rule.style, prop, value);
  }

  // Existing `selector:pseudo` variant of a rule in the same rule list
  // (sheet, @media/@layer block or parent style rule), or null.
  ruleVariant(rule, pseudo) {
    if (!rule || !pseudo || !rule.selectorText) return null;
    const target = normSel(String(rule.selectorText) + pseudo);
    const list = (rule.parentRule && rule.parentRule.cssRules) ? rule.parentRule.cssRules : this.sheet.cssRules;
    for (const r of list) {
      if (r.type === 1 && r.selectorText && normSel(r.selectorText) === target) return r;
    }
    return null;
  }

  // Variant rule for `selector:pseudo`, creating it in the same context
  // (top level or inside the picked rule's @media/@layer/nested parent).
  ensureRuleVariant(rule, pseudo) {
    if (!rule || !pseudo) return rule;
    const existing = this.ruleVariant(rule, pseudo);
    if (existing) return existing;
    const sel = normSel(String(rule.selectorText || '')) + pseudo;
    const parent = rule.parentRule;
    if (parent && typeof parent.insertRule === 'function') {
      const idx = parent.cssRules.length;
      parent.insertRule(`${sel} {}`, idx);
      return parent.cssRules[idx];
    }
    return this.ensureRule(sel);
  }

  // Nested selectors keep `&`; compose them against the parent selector(s)
  // so `el.matches()` can test them. Comma-group parents are skipped.
  static _composedSelector(rule) {
    let sel = normSel(rule.selectorText);
    if (!sel) return '';
    let parent = rule.parentRule;
    let guard = 0;
    while (sel.indexOf('&') !== -1 && parent && parent.type === 1 && parent.selectorText && guard++ < 10) {
      const p = normSel(parent.selectorText);
      if (!p || p.indexOf(',') !== -1) return '';
      sel = sel.split('&').join(p);
      parent = parent.parentRule;
    }
    return sel.indexOf('&') === -1 ? sel : '';
  }

  // Every style rule whose selector matches `el`, including rules inside
  // @media/@supports/@layer/@container/@scope and CSS-nesting. Entries carry
  // the rule object (for direct declaration edits), the display selector,
  // the enclosing media condition, declaration count and source order.
  rulesFor(el) {
    const out = [];
    if (!el || typeof el.matches !== 'function') return out;
    let order = 0;
    const seen = new Set();
    const add = (rule, selector, media) => {
      if (!selector || /::/.test(selector) || seen.has(rule)) return;
      let matches = false;
      try { matches = el.matches(selector); } catch { matches = false; }
      if (!matches) return;
      seen.add(rule);
      let decls = 0;
      try { decls = rule.style.length; } catch { decls = 0; }
      out.push({
        rule,
        selector,
        media: media || '',
        decls,
        order,
        specificity: selectorSpecificity(selector),
      });
    };
    const walk = (ruleList, media) => {
      for (const rule of ruleList) {
        const kids = Sheet._children(rule);
        if (kids) {
          const inner = rule.type === 4
            ? normMedia(rule.conditionText || (rule.media && rule.media.mediaText) || '')
            : media;
          walk(kids, inner);
        }
        if (rule.type !== 1 || !rule.selectorText) continue;
        order++;
        add(rule, Sheet._composedSelector(rule), media);
      }
    };
    try { walk(this.sheet.cssRules, ''); } catch { /* ignore */ }
    return out.sort((a, b) => a.order - b.order);
  }

  addRule(cssText) {
    const text = (cssText || '').trim();
    if (!text) return;
    if (Array.from(this.sheet.cssRules).some((rule) => rule.cssText.trim() === text)) return;
    const media = text.match(/^@media\s+([^{}]+)\{/i);
    if (media && Array.from(this.sheet.cssRules).some(
      (rule) => rule.type === 4 && rule.conditionText.trim() === media[1].trim()
    )) return;
    this.sheet.insertRule(text, this.sheet.cssRules.length);
  }

  // Nested rule lists: @media/@supports/@layer/@container/@scope and (with
  // CSS nesting) style rules themselves. Returns null when a rule has no
  // children. NOTE: do not test `rule.cssRules` truthiness — in some
  // Chromium builds plain style rules also expose an (empty) cssRules list,
  // which would make the walk skip every real rule.
  static _children(rule) {
    try {
      if (rule && rule.cssRules && rule.cssRules.length) return rule.cssRules;
    } catch { /* ignore */ }
    return null;
  }

  // --- class-level operations ---

  // Delete every rule whose selector contains `.name` as a class token —
  // single `.name`, pseudos (`.name:hover`), compounds (`.btn.name`,
  // `.name.large`) and the same inside @media. Standalone `.other` rules
  // that merely share a compound elsewhere are untouched. In a comma-grouped
  // rule (`.name, .other`) only the matching selector is removed; the rule
  // survives while other selectors remain.
  deleteClassRules(className) {
    const sheet = this.sheet;
    const walk = (ruleList, container) => {
      for (let i = ruleList.length - 1; i >= 0; i--) {
        const rule = ruleList[i];
        const kids = Sheet._children(rule);
        if (kids) walk(kids, rule);
        if (rule.type !== 1 || !rule.selectorText) continue;
        const { matched, remaining } = removeClassFromSelectorList(rule.selectorText, className);
        if (!matched) continue;
        if (remaining) rule.selectorText = remaining;
        else container.deleteRule(i);
      }
    };
    walk(sheet.cssRules, sheet);
  }

  // Delete one exact compound selector plus its pseudo variants, e.g.
  // deleteComboRule('.btn.large') removes '.btn.large' + '.btn.large:hover'.
  // The single-class rules '.btn' / '.large' are kept.
  deleteComboRule(compoundSelector) {
    const base = normSel(compoundSelector).replace(/::?[a-z-]+(\([^)]*\))?$/i, '');
    const rx = new RegExp(`^${escapeRegExp(base)}(?::[a-z-]+(?:\\([^)]*\\))?)*$`, 'i');
    const sheet = this.sheet;
    const walk = (ruleList, container) => {
      for (let i = ruleList.length - 1; i >= 0; i--) {
        const rule = ruleList[i];
        const kids = Sheet._children(rule);
        if (kids) walk(kids, rule);
        if (rule.type === 1 && rx.test(normSel(rule.selectorText))) container.deleteRule(i);
      }
    };
    walk(sheet.cssRules, sheet);
  }

  // Every class-compound selector in the sheet, e.g. ['.btn.large'].
  // Used by the Classes manager to list combos separately from singles.
  comboSelectors() {
    const out = new Set();
    const walk = (ruleList) => {
      for (const rule of ruleList) {
        const kids = Sheet._children(rule);
        if (kids) walk(kids);
        if (rule.type !== 1 || !rule.selectorText) continue;
        // Split comma groups; keep groups that are pure class compounds.
        for (const part of String(rule.selectorText).split(',')) {
          const sel = normSel(part).replace(/::?[a-z-]+(\([^)]*\))?$/i, '');
          if (/^\.[A-Za-z_-][\w-]*(\.[A-Za-z_-][\w-]*)+$/.test(sel)) out.add(sel);
        }
      }
    };
    try { walk(this.sheet.cssRules); } catch { /* ignore */ }
    return [...out].sort();
  }

  // Rename a class everywhere it appears in any selector (incl. inside media
  // queries, @layer/@container and nested rules). Rewrites selectorText in
  // place so a renamed rule never loses its nested children.
  renameClass(oldName, newName) {
    const testRx = new RegExp(`(^|[^-\\w])\\.${escapeRegExp(oldName)}(?![-\\w])`);
    const replRx = new RegExp(`(^|[^-\\w])\\.${escapeRegExp(oldName)}(?![-\\w])`, 'g');
    const walk = (ruleList) => {
      for (const rule of ruleList) {
        const kids = Sheet._children(rule);
        if (kids) walk(kids);
        if (!rule.selectorText || !testRx.test(rule.selectorText)) continue;
        try {
          rule.selectorText = rule.selectorText.replace(replRx, `$1.${newName}`);
        } catch { /* unsupported selector — leave as-is */ }
      }
    };
    walk(this.sheet.cssRules);
  }

  // Index of a top-level style rule in source order (-1 when absent).
  // Used to resolve which single-class selector wins the cascade when an
  // element carries several classes with the same property.
  ruleIndex(selector) {
    const target = normSel(selector);
    const rules = this.sheet.cssRules;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule.type === 1 && normSel(rule.selectorText) === target) return i;
    }
    return -1;
  }

  // Last-defined (cascade-winning) single-class selector among `classNames`
  // that declares `prop`, including an optional pseudo suffix (e.g. ':hover').
  // Returns the selector string (e.g. '.btn-primary' or '.btn:hover') or ''.
  originFor(classNames, prop, pseudo) {
    const suffix = pseudo || '';
    let winner = '';
    let winnerIndex = -2;
    for (const name of classNames || []) {
      if (!name) continue;
      const sel = `.${name}${suffix}`;
      let declared = '';
      try {
        declared = this.get(sel, prop);
      } catch {
        declared = '';
      }
      if (declared) {
        const idx = this.ruleIndex(sel);
        if (idx >= winnerIndex) {
          winner = sel;
          winnerIndex = idx;
        }
      }
    }
    return winner;
  }

  originForMedia(classNames, prop, pseudo, mediaText) {
    const m = this.findMediaRule(mediaText);
    if (!m) return '';
    const suffix = pseudo || '';
    let winner = '';
    let winnerIndex = -2;
    const rules = m.cssRules;
    for (const name of classNames || []) {
      if (!name) continue;
      const sel = `.${name}${suffix}`;
      let declared = '';
      try {
        const r = this.findRuleInMedia(mediaText, sel);
        declared = r ? readStyleProperty(r.style, prop) : '';
      } catch { declared = ''; }
      if (declared) {
        let idx = -1;
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          if (rule.type === 1 && normSel(rule.selectorText) === normSel(sel)) idx = i;
        }
        if (idx >= winnerIndex) { winner = sel; winnerIndex = idx; }
      }
    }
    return winner;
  }

  // --- :root design tokens (CSS variables) ---

  rootVars() {
    const out = [];
    try {
      const rule = this.findRule(':root');
      if (!rule) return out;
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style.item(i);
        if (prop && prop.startsWith('--')) {
          out.push({ name: prop, value: rule.style.getPropertyValue(prop).trim() });
        }
      }
    } catch { /* ignore */ }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Where is `var(--name)` used? Walks all style rules incl. @media and
  // reports { count, selectors } — count is declarations, selectors are
  // the rules containing at least one (deduped, capped for tooltips).
  varUsages(name) {
    const clean = String(name || '').trim();
    if (!/^--[A-Za-z0-9-_]+$/.test(clean)) return { count: 0, selectors: [] };
    const rx = new RegExp(`var\\(\\s*${escapeRegExp(clean)}\\s*[,)]`, 'g');
    let count = 0;
    const sels = new Set();
    const walk = (ruleList) => {
      for (const rule of ruleList) {
        const kids = Sheet._children(rule);
        if (kids) walk(kids);
        if (rule.type !== 1 || !rule.selectorText || !rule.style) continue;
        let hits = 0;
        try { hits = (rule.style.cssText.match(rx) || []).length; } catch { hits = 0; }
        if (hits > 0) {
          count += hits;
          if (sels.size < 8) sels.add(String(rule.selectorText));
        }
      }
    };
    try { walk(this.sheet.cssRules); } catch { /* ignore */ }
    return { count, selectors: [...sels].sort() };
  }

  // Theme-scoped token overrides: custom properties declared on rules whose
  // selector targets [data-theme] (e.g. [data-theme="dark"] { --paper: … }).
  // Powers the Tokens sidebar's theme groups.
  themeVarGroups() {
    const groups = [];
    const seen = new Set();
    const walk = (ruleList) => {
      for (const rule of ruleList) {
        const kids = Sheet._children(rule);
        if (kids) walk(kids);
        if (rule.type !== 1 || !rule.selectorText || !rule.style) continue;
        const selector = normSel(rule.selectorText);
        if (!/\[data-theme/i.test(selector) || seen.has(selector)) continue;
        const vars = [];
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style.item(i);
          if (prop && prop.startsWith('--')) {
            vars.push({ name: prop, value: rule.style.getPropertyValue(prop).trim() });
          }
        }
        if (!vars.length) continue;
        seen.add(selector);
        const m = selector.match(/\[data-theme\s*[~^|*$]?=\s*["']?([^"'\]]+)/i);
        groups.push({
          selector,
          label: m ? m[1] : selector,
          vars: vars.sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
    };
    try { walk(this.sheet.cssRules); } catch { /* ignore */ }
    return groups;
  }

  // Rename a token everywhere: every declaration of `--old` (the :root one
  // and theme/scoped re-declarations) plus every var(--old) usage in any rule
  // (including @media, @layer and nested rules, and fallbacks like
  // var(--old, red)). Returns the number of declarations rewritten.
  // Token-boundary safe: renaming --brand does not touch --brand-2.
  renameVar(oldName, newName) {
    const o = String(oldName || '').trim();
    const n = String(newName || '').trim();
    if (!/^--[A-Za-z0-9-_]+$/.test(o) || !/^--[A-Za-z0-9-_]+$/.test(n) || o === n) return 0;
    let count = 0;
    const rx = new RegExp(`var\\(\\s*${escapeRegExp(o)}\\s*([,)])`, 'g');
    const walk = (ruleList) => {
      for (const rule of ruleList) {
        const kids = Sheet._children(rule);
        if (kids) walk(kids);
        if (rule.type !== 1 || !rule.style) continue;
        // 1) Rename declarations of the custom property itself (root, theme
        //    and scoped overrides). Custom properties are never expanded.
        const props = [];
        try {
          for (let i = 0; i < rule.style.length; i++) props.push(rule.style.item(i));
        } catch { continue; }
        for (const prop of props) {
          if (prop !== o) continue;
          try {
            const v = rule.style.getPropertyValue(o);
            const pri = rule.style.getPropertyPriority(o);
            rule.style.removeProperty(o);
            rule.style.setProperty(n, v, pri);
            count++;
          } catch { /* ignore single-property failures */ }
        }
        // 2) Rewrite var(--old) usages from the serialized declaration text.
        //    Iterating longhands cannot see shorthands containing var():
        //    Chromium expands them and returns empty pending-substitution
        //    values for every part.
        let text = '';
        try { text = rule.style.cssText || ''; } catch { continue; }
        if (!text || text.indexOf('var(') === -1) continue;
        const hits = text.match(rx);
        if (!hits) continue;
        const next = text.replace(rx, `var(${n}$1`);
        if (next !== text) {
          try {
            rule.style.cssText = next;
            count += hits.length;
          } catch { /* ignore single-rule failures */ }
        }
      }
    };
    try { walk(this.sheet.cssRules); } catch { /* ignore */ }
    return count;
  }

  // All class tokens defined in the sheet (for suggestions + manager).
  // Includes classes that only appear inside compounds: '.btn.large'
  // contributes both 'btn' and 'large'. Walks @media and other at-rules.
  classNames() {
    const names = new Set();
    const walk = (ruleList) => {
      for (const rule of ruleList) {
        const kids = Sheet._children(rule);
        if (kids) walk(kids);
        if (rule.type !== 1 || !rule.selectorText) continue;
        const re = /\.([A-Za-z_-][\w-]*)/g;
        let m;
        const sel = String(rule.selectorText);
        while ((m = re.exec(sel))) names.add(m[1]);
      }
    };
    try { walk(this.sheet.cssRules); } catch { /* ignore */ }
    return [...names].sort();
  }

  // Groups of plain single-class selectors with identical declarations.
  // Returns [{ key, selectors, classes }] where classes are bare names
  // (e.g. ['a','b'] for '.a' + '.b'). Empty rules are ignored.
  findDuplicateRules() {
    const groups = new Map();
    for (const rule of this.sheet.cssRules) {
      if (rule.type !== 1) continue;
      const sel = normSel(rule.selectorText);
      const m = sel.match(/^\.([-\w]+)$/);
      if (!m) continue;
      const key = normStyle(rule.style);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m[1]);
    }
    const out = [];
    for (const [key, classes] of groups) {
      if (classes.length > 1) {
        out.push({ key, classes: [...classes], selectors: classes.map((c) => '.' + c) });
      }
    }
    return out;
  }

  // Non-class selectors at the top level (html, body, tag rules, :root, …).
  // Feeds the Site → Globals element-rules editor. Class selectors and
  // @media-nested rules are excluded — those are owned by the Design panel.
  globalSelectors() {
    const out = new Set();
    try {
      for (const rule of this.sheet.cssRules) {
        if (rule.type !== 1 || !rule.selectorText) continue;
        for (const part of String(rule.selectorText).split(',')) {
          const sel = normSel(part);
          if (!sel || sel.includes('.')) continue;
          out.add(sel);
        }
      }
    } catch { /* ignore */ }
    return [...out];
  }

  // Declarations currently authored on a single rule, in source order.
  declarations(selector) {
    const rule = this.findRule(selector);
    if (!rule) return [];
    const out = [];
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style.item(i);
      const value = rule.style.getPropertyValue(prop);
      const important = rule.style.getPropertyPriority(prop);
      out.push({ prop, value: important ? `${value} !${important}` : value });
    }
    return out;
  }

  serialize() {
    return (
      Array.from(this.sheet.cssRules)
        .map((rule) => formatRule(rule, 0))
        .join('\n\n') + '\n'
    );
  }
}

HE.Sheet = Sheet;

export { Sheet };
