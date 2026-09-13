// Pure helpers for parsing and serializing CSS linear-/radial-gradients
// so the Background panel can offer a visual stop editor. Conic and other
// exotic gradients return null and stay raw-text editable.

import { splitCssList } from './background.js';
import { parseColor, formatColor } from './color.js';

const ANGLE_RE = /^-?\d+(?:\.\d+)?(?:deg|turn|rad|grad)$/i;
const TO_SIDE_RE = /^to\s+(top|bottom|left|right|top\s+left|top\s+right|bottom\s+left|bottom\s+right)$/i;
const STOP_POS_RE = /(\s-?(?:\d+(?:\.\d+)?|\.\d+)(?:%|px|em|rem|vw|vh|ch|ex|cm|mm|in|pt|pc)(\s+-?(?:\d+(?:\.\d+)?|\.\d+)(?:%|px|em|rem|vw|vh|ch|ex|cm|mm|in|pt|pc))?)$/;
const RADIAL_POS_RE = /^\s*at\s+/i;
const RADIAL_LENGTH_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:%|px|em|rem|vw|vh|ch|ex|cm|mm|in|pt|pc)?$/;

// Keyword angle equivalents. CSS 0deg points up; positive turns clockwise.
const TO_SIDE_ANGLES = {
  'to top': 0,
  'to top right': 45,
  'to right top': 45,
  'to right': 90,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom': 180,
  'to bottom left': 225,
  'to left bottom': 225,
  'to left': 270,
  'to top left': 315,
  'to left top': 315,
};

function splitStop(part) {
  const text = String(part || '').trim();
  if (!text) return null;
  const m = text.match(STOP_POS_RE);
  if (m) {
    return { color: text.slice(0, text.length - m[1].length).trim(), position: m[1].trim() };
  }
  return { color: text, position: '' };
}

// Parse a single `linear-gradient(...)` / `radial-gradient(...)` value
// (optionally `repeating-`). Returns null when the value is not a supported
// gradient — the panel then keeps raw-text editing.
export function parseGradient(value) {
  const text = String(value == null ? '' : value).trim();
  const m = text.match(/^(repeating-)?(linear|radial)-gradient\(\s*([\s\S]*?)\s*\)$/i);
  if (!m) return null;
  const parts = splitCssList(m[3]);
  if (!parts.length) return null;
  const model = {
    repeating: !!m[1],
    type: m[2].toLowerCase(),
    direction: '',
    shape: '',
    extent: '',
    position: '',
    stops: [],
  };
  let rest = parts;
  const first = parts[0].trim();
  if (model.type === 'linear') {
    if (ANGLE_RE.test(first) || TO_SIDE_RE.test(first)) {
      model.direction = first.replace(/\s+/g, ' ');
      rest = parts.slice(1);
    }
  } else {
    // Radial header: `[<ending-shape> || <size>]? [at <position>]?`.
    // Anything before `at` is shape and/or extent; keep unknown tokens in
    // extent so they round-trip instead of being dropped.
    const atIndex = first.search(/\bat\b/i);
    let head = first;
    if (atIndex >= 0) {
      model.position = first.slice(atIndex).replace(/\s+/g, ' ').trim();
      head = first.slice(0, atIndex).trim();
    }
    const tokens = head ? head.split(/\s+/) : [];
    const kept = [];
    for (const token of tokens) {
      const low = token.toLowerCase();
      if (!model.shape && (low === 'circle' || low === 'ellipse')) model.shape = low;
      else kept.push(token);
    }
    model.extent = kept.join(' ');
    rest = parts.slice(1);
  }
  for (const part of rest) {
    const stop = splitStop(part);
    if (stop && stop.color) model.stops.push(stop);
  }
  if (!model.stops.length) return null;
  return model;
}

export function serializeGradient(model) {
  if (!model || (model.type !== 'linear' && model.type !== 'radial')) return '';
  const head = [];
  if (model.type === 'linear') {
    if (model.direction && model.direction.trim()) head.push(model.direction.trim().replace(/\s+/g, ' '));
  } else {
    const radialHead = [model.shape, model.extent, model.position]
      .map((s) => String(s || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join(' ');
    if (radialHead) head.push(radialHead);
  }
  const stops = (model.stops || [])
    .map((stop) => {
      const color = String((stop && stop.color) || '').trim();
      if (!color) return '';
      const position = String((stop && stop.position) || '').trim().replace(/\s+/g, ' ');
      return position ? `${color} ${position}` : color;
    })
    .filter(Boolean);
  if (!stops.length) return '';
  return `${model.repeating ? 'repeating-' : ''}${model.type}-gradient(${[...head, ...stops].join(', ')})`;
}

// Linear direction -> degrees (0 = up, clockwise). Unknown values fall back
// to the CSS default `to bottom` (180deg).
export function gradientAngle(direction) {
  const text = String(direction || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!text) return 180;
  if (TO_SIDE_ANGLES[text] != null) return TO_SIDE_ANGLES[text];
  const m = text.match(/^(-?\d+(?:\.\d+)?)(deg|turn|rad|grad)$/);
  if (!m) return 180;
  const value = parseFloat(m[1]);
  const unit = m[2];
  const deg = unit === 'turn' ? value * 360
    : unit === 'rad' ? value * 180 / Math.PI
      : unit === 'grad' ? value * 0.9
        : value;
  return ((deg % 360) + 360) % 360;
}

export function formatGradientAngle(value) {
  const deg = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `${Math.round(((deg % 360) + 360) % 360)}deg`;
}

// Normalise an `at <position>` radial header into keyword x/y axes so a
// visual position pad can show which cell is active. Length/percentage
// values keep their raw text and mark the position as custom.
export function parseRadialPosition(position) {
  const text = String(position || '').replace(RADIAL_POS_RE, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const result = { x: 'center', y: 'center', custom: false };
  if (!text) return result;
  const tokens = text.split(' ');
  const xs = [];
  const ys = [];
  const lengths = [];
  let centers = 0;
  for (const token of tokens) {
    if (token === 'left' || token === 'right') xs.push(token);
    else if (token === 'top' || token === 'bottom') ys.push(token);
    else if (token === 'center') centers++;
    else if (RADIAL_LENGTH_RE.test(token)) lengths.push(token);
    else { lengths.push(token); result.custom = true; }
  }
  if (lengths.length) {
    result.x = lengths[0] || 'center';
    result.y = lengths[1] || 'center';
    result.custom = true;
  } else {
    if (xs.length) result.x = xs[0];
    if (ys.length) result.y = ys[0];
    result.custom = tokens.length > 2 || centers > 1;
  }
  return result;
}

export function formatRadialPosition(position) {
  const x = (position && position.x) || 'center';
  const y = (position && position.y) || 'center';
  if (x === 'center' && y === 'center') return 'at center';
  if (x === 'center') return `at ${y}`;
  if (y === 'center') return `at ${x}`;
  return `at ${x} ${y}`;
}

// Visual position of a stop on the track (0-100). Percentage positions are
// used as-is; position-less stops spread evenly; other units fall back to
// the even spread and become a percentage when dragged.
export function stopPercent(stop, index, total) {
  const position = String((stop && stop.position) || '').trim();
  const m = position.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/);
  if (m) return Math.min(100, Math.max(0, parseFloat(m[1])));
  if (total <= 1) return 0;
  return Math.min(100, Math.max(0, (index / (total - 1)) * 100));
}

// Interpolate the sRGB color of the gradient at `percent` so clicking the
// track can insert a stop that visually matches its neighbours.
export function sampleGradientColor(stops, percent) {
  const list = Array.isArray(stops) ? stops : [];
  if (!list.length) return '';
  const total = list.length;
  const points = list
    .map((stop, index) => ({ color: parseColor(stop.color), at: stopPercent(stop, index, total) }))
    .filter((point) => point.color);
  if (!points.length) return '';
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  if (pct <= points[0].at) return formatColor(points[0].color, 'hex');
  if (pct >= points[points.length - 1].at) return formatColor(points[points.length - 1].color, 'hex');
  for (let i = 0; i < points.length - 1; i++) {
    const left = points[i];
    const right = points[i + 1];
    if (pct >= left.at && pct <= right.at) {
      const span = right.at - left.at;
      const t = span ? (pct - left.at) / span : 0;
      return formatColor({
        r: left.color.r + (right.color.r - left.color.r) * t,
        g: left.color.g + (right.color.g - left.color.g) * t,
        b: left.color.b + (right.color.b - left.color.b) * t,
        a: left.color.a + (right.color.a - left.color.a) * t,
      }, 'hex');
    }
  }
  return formatColor(points[points.length - 1].color, 'hex');
}
