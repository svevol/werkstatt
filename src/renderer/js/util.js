// Pure helpers shared across modules (Node-testable, no DOM).

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Shape check for CSS class tokens (simulation, hooks previews, chip
// attach/rename). New-class creation additionally enforces kebab-case via
// HE.actions.validateClassName.
export const CLASS_TOKEN_RE = /^[-_a-zA-Z][-\w]*$/;

export function isValidClassToken(name) {
  return CLASS_TOKEN_RE.test(String(name || ''));
}

// Split a comma-separated CSS selector list at top level only, so commas
// inside :is()/:not()/attribute values stay attached to their selector.
export function splitSelectorList(selectorText) {
  const text = String(selectorText || '');
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Remove every selector that references `.className` as a class token from a
// comma-separated selector list. `matched` reports whether anything changed;
// `remaining` is the surviving selector text ('' when nothing is left). Pure:
// callers decide whether to rewrite the rule or delete it.
export function removeClassFromSelectorList(selectorText, className) {
  const testRx = new RegExp(`(^|[^\\-\\w])\\.${escapeRegExp(className)}(?![-\\w])`);
  const selectors = splitSelectorList(selectorText);
  const kept = selectors.filter((sel) => !testRx.test(sel));
  return { matched: kept.length !== selectors.length, remaining: kept.join(', ') };
}

export const VIEWPORT_MEDIA = {
  desktop: '',
  tablet: '(max-width: 768px)',
  mobile: '(max-width: 375px)',
};

export function viewportMediaFor(viewport) {
  return VIEWPORT_MEDIA[viewport] || '';
}

// Pixel width of a `(max-width: Npx)` media condition, or null.
export function mediaMaxWidthPx(mediaText) {
  const m = String(mediaText || '').match(/\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/i);
  return m ? parseFloat(m[1]) : null;
}

// Short human label for a viewport key or a raw media condition (custom
// breakpoints detected in the stylesheet), e.g. 'tablet' or '≤1024px'.
export function viewportLabel(viewport) {
  const vp = String(viewport || 'desktop');
  if (vp === 'desktop' || vp === 'tablet' || vp === 'mobile') return vp;
  const px = mediaMaxWidthPx(vp);
  return px != null ? `≤${px}px` : vp;
}

// Approximate CSS specificity as one comparable score. IDs dominate, then
// classes/attributes/pseudo-classes, then type/universal-less element names:
// a*10000 + b*100 + c. Functional pseudos are approximated by their text.
// Used only to order the panel's matching-rule list, never to claim a winner.
export function selectorSpecificity(selector) {
  let s = String(selector || '');
  // Attribute selectors may contain brackets/quotes — blank them first.
  s = s.replace(/\[[^\]]*\]/g, ' []');
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+|\[\]|::?[\w-]+(?:\([^)]*\))?/g) || []).length;
  const rest = s.replace(/\.[\w-]+|\[\]|::?[\w-]+(?:\([^)]*\))?/g, ' ');
  const c = (rest.match(/(?:^|[\s>+~,])\s*[a-zA-Z][\w-]*/g) || []).length;
  return a * 10000 + b * 100 + c;
}

// Edit-mode HTML neutralization (pure, Node-testable).
//
// neutralizeScripts (canvas.js) rewrites <script> tags only; inline handlers
// and javascript: URLs would still execute in the same-origin Edit iframe —
// e.g. <img src=x onerror=...> fires on load with full parent-DOM access.
// This renames the rest of the executable surface so Edit stays inert:
// - event handler attributes: on* -> data-he-on* (any element)
// - javascript: URLs in href/src/action/formaction/xlink:href (and data on
//   object/embed) -> data-he-* — control chars/whitespace (even embedded in
//   the scheme) and numeric entities are folded before the scheme check
// - <iframe srcdoc> -> data-he-srcdoc (a nested document could run scripts)
// - <meta http-equiv="refresh"> -> data-he-http-equiv (auto-navigation)
// Round-trips via serializeDoc, which renames them back before saving.
// Comments, CDATA, and script/style/textarea/title/noscript bodies are raw
// text and copied verbatim so author source is never corrupted.

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title', 'noscript']);

const JS_URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);

function decodeNumericEntities(s) {
  return String(s).replace(/&#(x[0-9a-fA-F]+|[0-9]+);?/g, (m, num) => {
    const code = num[0] === 'x' || num[0] === 'X' ? parseInt(num.slice(1), 16) : parseInt(num, 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
    try {
      return String.fromCodePoint(code);
    } catch {
      return m;
    }
  });
}

function isJavaScriptUrl(value) {
  // Browsers strip ASCII whitespace/controls around and inside the scheme.
  const folded = decodeNumericEntities(String(value)).replace(/[\x00-\x20]+/g, '').toLowerCase();
  return folded.startsWith('javascript:');
}

// Index of the next '>' at/after `from`, ignoring quoted attribute values.
function editTagEnd(src, from) {
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
}

// Per HTML spec, raw-text bodies run until a matching close tag.
function editRawClose(src, lower, from, tag) {
  let idx = lower.indexOf('</' + tag, from);
  while (idx !== -1) {
    const after = src[idx + 2 + tag.length] || '';
    if (/[\s/>]/.test(after)) return idx;
    idx = lower.indexOf('</' + tag, idx + 1);
  }
  return -1;
}

function editTagName(tagText) {
  const m = /^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(tagText);
  return m ? m[1].toLowerCase() : '';
}

// Rename executable attributes inside one tag; everything else is
// byte-identical so save output round-trips.
function neutralizeTagAttrs(tagText, tagName) {
  const m = /^<\s*\/?\s*[a-zA-Z][a-zA-Z0-9-]*/.exec(tagText);
  if (!m) return tagText;
  let i = m[0].length;
  const edits = [];
  const isUrlAttr = (name) =>
    JS_URL_ATTRS.has(name) || ((tagName === 'object' || tagName === 'embed') && name === 'data');
  while (i < tagText.length) {
    while (i < tagText.length && /[\s]/.test(tagText[i])) i++;
    if (i >= tagText.length || tagText[i] === '>' || (tagText[i] === '/' && tagText[i + 1] === '>')) break;
    const ch = tagText[i];
    if (ch === '"' || ch === "'" || ch === '=') {
      i++; // stray punctuation — never a name start, skip without corrupting
      continue;
    }
    const nameStart = i;
    while (i < tagText.length && /[^\s=/>]/.test(tagText[i]) && tagText[i] !== '"' && tagText[i] !== "'") i++;
    if (i === nameStart) {
      i++;
      continue;
    }
    const name = tagText.slice(nameStart, i);
    const lowerName = name.toLowerCase();
    let value = null;
    let j = i;
    while (j < tagText.length && /[\s]/.test(tagText[j])) j++;
    if (tagText[j] === '=') {
      j++;
      while (j < tagText.length && /[\s]/.test(tagText[j])) j++;
      const q = tagText[j];
      if (q === '"' || q === "'") {
        const close = tagText.indexOf(q, j + 1);
        if (close === -1) break; // unterminated — leave the tag alone
        value = tagText.slice(j + 1, close);
        i = close + 1;
      } else {
        const valueStart = j;
        while (j < tagText.length && !/[\s>]/.test(tagText[j])) j++;
        value = tagText.slice(valueStart, j);
        i = j;
      }
    }
    let replacement = null;
    if (/^on[a-z]+$/i.test(name)) {
      replacement = 'data-he-' + lowerName;
    } else if (lowerName === 'srcdoc') {
      replacement = 'data-he-srcdoc';
    } else if (lowerName === 'http-equiv' && value != null && value.trim().toLowerCase() === 'refresh') {
      replacement = 'data-he-http-equiv';
    } else if (value != null && isUrlAttr(lowerName) && isJavaScriptUrl(value)) {
      replacement = 'data-he-' + lowerName.replace(':', '-');
    }
    if (replacement) edits.push({ nameStart, nameEnd: nameStart + name.length, replacement });
  }
  for (let k = edits.length - 1; k >= 0; k--) {
    const e = edits[k];
    tagText = tagText.slice(0, e.nameStart) + e.replacement + tagText.slice(e.nameEnd);
  }
  return tagText;
}

export function neutralizeEditHtml(htmlText) {
  const src = String(htmlText);
  const lower = src.toLowerCase();
  let out = '';
  let i = 0;
  while (i < src.length) {
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
    if (src[i] === '<' && i + 1 < src.length && /[a-zA-Z/!?]/.test(src[i + 1])) {
      const end = editTagEnd(src, i + 1);
      if (end === -1) {
        out += src.slice(i);
        break;
      }
      const tagText = src.slice(i, end + 1);
      if (/^<\s*[!?]/.test(tagText)) {
        out += tagText; // doctype, PI — no attributes to neutralize
        i = end + 1;
        continue;
      }
      const name = editTagName(tagText);
      const isClose = /^<\s*\//.test(tagText);
      if (!name || isClose) {
        out += tagText;
        i = end + 1;
        continue;
      }
      if (RAW_TEXT_TAGS.has(name)) {
        out += neutralizeTagAttrs(tagText, name);
        i = end + 1;
        if (tagText.endsWith('/>')) continue; // self-closing: no body
        // Body is raw text (may contain '<script' strings) — copy verbatim.
        const close = editRawClose(src, lower, i, name);
        if (close === -1) {
          out += src.slice(i);
          break;
        }
        const closeEnd = editTagEnd(src, close + 2);
        if (closeEnd === -1) {
          out += src.slice(i);
          break;
        }
        out += src.slice(i, close);
        out += src.slice(close, closeEnd + 1);
        i = closeEnd + 1;
        continue;
      }
      out += neutralizeTagAttrs(tagText, name);
      i = end + 1;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}
