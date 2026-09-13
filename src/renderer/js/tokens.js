// Design-token parsing and property capability rules. This module stays
// browser-independent so token filtering can be tested without Electron.

import { parseColor } from './color.js';

const COLOR_FUNCTION_RE = /^(?:rgb|rgba|hsl|hsla|oklab|oklch|lab|lch|color|color-mix)\(/i;
const COLOR_NAME_HINT_RE = /(^|[-_])(color|colour|bg|background|border|accent|brand|ink|paper|surface|text|fill|stroke)([-_]|$)/i;
const FONT_NAME_HINT_RE = /(^|[-_])(font|type|family|face)([-_]|$)/i;
const SHADOW_NAME_HINT_RE = /(^|[-_])(shadow|elevation)([-_]|$)/i;
const TIME_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:ms|s)$/i;
const LENGTH_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|rem|em|%|vw|svw|lvw|dvw|vh|svh|lvh|vmin|vmax|ch|ex|cap|ic|lh|rlh|cm|mm|in|pt|pc|fr)$/i;
const NUMBER_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
const MATH_LENGTH_RE = /^(?:calc|min|max|clamp)\(.*(?:%|px|rem|em|vw|vh|ch|var\()/i;
const GRADIENT_RE = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;
const IMAGE_RE = /^(?:url|image-set|cross-fade|paint)\(/i;
const GENERIC_FONT_RE = /\b(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded)\b/i;

// Parse a lone var() reference: var(--name) or var(--name, fallback).
export function parseVarRef(css) {
  const t = String(css || '').trim();
  if (!/^var\(/i.test(t) || !t.endsWith(')')) return null;
  const inner = t.slice(t.indexOf('(') + 1, -1);
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      const name = inner.slice(0, i).trim();
      const fallback = inner.slice(i + 1).trim();
      if (!/^--[A-Za-z0-9-_]+$/.test(name)) return null;
      return { name, fallback };
    }
  }
  const name = inner.trim();
  if (!/^--[A-Za-z0-9-_]+$/.test(name)) return null;
  return { name, fallback: '' };
}

export function tokenKindsForProperty(prop, options = {}) {
  if (options.tokenKinds) return [...new Set(options.tokenKinds)];
  const name = String(prop || '').toLowerCase();
  if (name === 'font-family') return ['font'];
  if (name === 'line-height') return ['length', 'number'];
  if (name === 'opacity' || name === 'z-index' || name === 'font-weight' ||
      name === 'order' || name === 'flex-grow' || name === 'flex-shrink') return ['number'];
  if (name === 'font-size' || name === 'letter-spacing' || name === 'gap' ||
      /^(?:margin|padding|inset|top|right|bottom|left|width|height|min-width|max-width|min-height|max-height|border(?:-top|-right|-bottom|-left)?-width|border(?:-top|-right|-bottom|-left)?-radius)$/.test(name)) {
    return ['length'];
  }
  if (name === 'transition-duration' || name === 'transition-delay' ||
      name === 'animation-duration' || name === 'animation-delay') return ['time'];
  if (name === 'box-shadow' || name === 'text-shadow') return ['shadow'];
  if (name === 'background-image' || name === 'mask-image' || name === 'border-image-source') {
    return ['gradient', 'image'];
  }
  if (name === 'color' || /(?:^|-)color$/.test(name) || name === 'fill' || name === 'stroke') {
    return ['color'];
  }
  return [];
}

export function tokenType(name, value) {
  const raw = String(value == null ? '' : value).trim();
  const key = String(name || '').toLowerCase();
  if (!raw) return 'unknown';
  if (parseColor(raw) || COLOR_FUNCTION_RE.test(raw) ||
      (COLOR_NAME_HINT_RE.test(key) && /^[a-z]+$/i.test(raw))) return 'color';
  if (GRADIENT_RE.test(raw)) return 'gradient';
  if (IMAGE_RE.test(raw)) return 'image';
  if (SHADOW_NAME_HINT_RE.test(key) || /\b(?:drop-shadow|inset)\b/i.test(raw)) return 'shadow';
  if (TIME_RE.test(raw)) return 'time';
  if (LENGTH_RE.test(raw) || MATH_LENGTH_RE.test(raw)) return 'length';
  if (NUMBER_RE.test(raw)) return 'number';
  if (FONT_NAME_HINT_RE.test(key) || GENERIC_FONT_RE.test(raw)) return 'font';
  return 'raw';
}

export function compatibleTokens(vars, kinds, currentName = '', predicate) {
  const wanted = new Set(kinds || []);
  return (vars || []).filter((token) => {
    if (token.name === currentName) return true;
    const kind = tokenType(token.name, token.value);
    return wanted.has(kind) || !!(predicate && predicate(token, kind));
  });
}
