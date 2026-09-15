// Shorthand → logical-longhand registry + var-aware value helpers.
//
// The browser refuses to expand a shorthand that contains var() into its
// longhands (CSSOM stores a pending-substitution value and every longhand
// reads empty). The editor therefore cannot learn e.g. `border-width` from
// `border: var(--border) solid var(--ink)` through CSSOM alone, and setting
// one of those longhands destroys the shorthand. These helpers let the sheet
// recover and unfold an authored var-shorthand without hand-writing a grammar
// per shorthand: the browser expands the var-resolved value, and var() tokens
// are mapped back onto the longhand they produced.
//
// The registry lists only the logical longhands the panel reads/writes. The
// physical/reset longhands a shorthand also touches (border-image-*,
// background-origin/clip, font-variant-*, …) are not panel-editable and keep
// their defaults once the shorthand is removed.
import { parseColor } from './color.js';

export const SHORTHAND_LONGHANDS = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  gap: ['row-gap', 'column-gap'],
  'border-radius': [
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius',
  ],
  border: ['border-width', 'border-style', 'border-color'],
  'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
  outline: ['outline-width', 'outline-style', 'outline-color'],
  background: [
    'background-color', 'background-image', 'background-position',
    'background-size', 'background-repeat', 'background-attachment',
  ],
  font: ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family'],
  transition: [
    'transition-property', 'transition-duration',
    'transition-timing-function', 'transition-delay',
  ],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
};

const LONGHAND_SHORTHANDS = (() => {
  const map = new Map();
  for (const [shorthand, longhands] of Object.entries(SHORTHAND_LONGHANDS)) {
    for (const longhand of longhands) {
      if (!map.has(longhand)) map.set(longhand, []);
      map.get(longhand).push(shorthand);
    }
  }
  return map;
})();

// Shorthands that can provide `longhand` (empty when it is not registered).
export function shorthandsFor(longhand) {
  return LONGHAND_SHORTHANDS.get(longhand) || [];
}

export function isShorthand(name) {
  return Object.prototype.hasOwnProperty.call(SHORTHAND_LONGHANDS, name);
}

// Whitespace-separated CSS value tokens, respecting functions and strings so
// `var(--x, a b)` and `rgb(1 2 3 / .5)` stay one token.
export function splitTopLevel(value) {
  return splitTokens(value, /\s/);
}

// Comma-separated CSS value tokens at the top level (layers, font stacks).
export function splitTopLevelCommas(value) {
  return splitTokens(value, /,/);
}

function splitTokens(value, separator) {
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
    } else if (depth === 0 && separator.test(ch)) {
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

// { name, fallback } when the token is a whole var() reference, else null.
// Only the outer reference is recognised; nested fallbacks stay opaque.
export function varToken(token) {
  const match = /^var\(\s*(--[A-Za-z0-9-_]+)\s*(?:,\s*([\s\S]*))?\)$/i.exec(String(token || '').trim());
  return match ? { name: match[1], fallback: (match[2] || '').trim() } : null;
}

// Replace every var(--name[, fallback]) with its resolved value. Unresolved
// references keep their authored text so callers can detect that the value is
// still opaque and bail instead of corrupting the declaration.
export function substituteVars(value, resolveVar, passes = 4) {
  let out = String(value == null ? '' : value);
  for (let i = 0; i < passes; i++) {
    if (out.indexOf('var(') === -1) break;
    const next = out.replace(
      /var\(\s*(--[A-Za-z0-9-_]+)\s*(?:,\s*([\s\S]*?))?\s*\)/gi,
      (match, name, fallback) => {
        const resolved = resolveVar ? resolveVar(name) : '';
        if (resolved) return resolved;
        return fallback || match;
      },
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

function normalizeValue(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .replace(/,\s*/g, ',')
    .trim()
    .toLowerCase();
}

function parseLength(value) {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(String(value || '').trim());
  return match ? { number: parseFloat(match[1]), unit: match[2].toLowerCase() } : null;
}

// Loose equality for mapping a resolved var() value back to the longhand the
// browser produced from it: #150520 equals rgb(21, 5, 32), 0 equals 0px.
export function sameCssValue(a, b) {
  const na = normalizeValue(a);
  const nb = normalizeValue(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ca = parseColor(na);
  const cb = parseColor(nb);
  if (ca && cb) {
    return Math.abs(ca.r - cb.r) < 1e-3 && Math.abs(ca.g - cb.g) < 1e-3 &&
      Math.abs(ca.b - cb.b) < 1e-3 && Math.abs(ca.a - cb.a) < 1e-3;
  }
  const la = parseLength(na);
  const lb = parseLength(nb);
  if (la && lb) {
    if (la.unit === lb.unit) return Math.abs(la.number - lb.number) < 1e-6;
    // A unitless zero equals a zero in any unit (0 == 0px).
    if (la.number === 0 && lb.number === 0) return true;
  }
  return false;
}

// Give each longhand back the authored var() token that resolved to its value,
// so unfolding keeps the token link instead of freezing the resolved literal.
// Tokens are consumed once, in order.
export function restoreVarTokens(values, raw, resolveVar) {
  const candidates = splitTopLevel(raw)
    .map((token, index) => ({ token, index, ref: varToken(token) }))
    .filter((entry) => entry.ref);
  const used = new Set();
  const out = {};
  for (const [longhand, value] of Object.entries(values)) {
    let chosen = '';
    for (const entry of candidates) {
      if (used.has(entry.index)) continue;
      const resolved = (resolveVar && resolveVar(entry.ref.name)) || entry.ref.fallback;
      if (resolved && sameCssValue(resolved, value)) { chosen = entry; break; }
    }
    if (chosen) { used.add(chosen.index); out[longhand] = chosen.token; } else out[longhand] = value;
  }
  return out;
}
