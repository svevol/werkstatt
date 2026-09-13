// Color parsing / formatting / contrast math (pure, Node-testable).
// Supports hex, rgb(), hsl(), oklab(), oklch() — the formats the panel
// color control offers.

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function parseChannel(value, percentScale = 1) {
  const number = parseFloat(value);
  if (!Number.isFinite(number)) return null;
  return value.trim().endsWith('%') ? number / 100 * percentScale : number;
}

function parseAlpha(value) {
  return clamp(parseChannel(value, 1));
}

export function parseColor(value) {
  const color = (value || '').trim();
  if (/^transparent$/i.test(color)) return { r: 0, g: 0, b: 0, a: 0 };
  const hex = color.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = digits.split('').map((digit) => digit + digit).join('');
    return {
      r: parseInt(digits.slice(0, 2), 16) / 255,
      g: parseInt(digits.slice(2, 4), 16) / 255,
      b: parseInt(digits.slice(4, 6), 16) / 255,
      a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
    };
  }

  const functionMatch = color.match(/^([a-z]+)\((.*)\)$/i);
  if (!functionMatch) return null;
  const name = functionMatch[1].toLowerCase();
  const parts = functionMatch[2]
    .replace(/\s*\/\s*/, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;

  if (name === 'rgb' || name === 'rgba') {
    const r = parseChannel(parts[0], 1);
    const g = parseChannel(parts[1], 1);
    const b = parseChannel(parts[2], 1);
    if ([r, g, b].some((channel) => channel == null)) return null;
    return { r: clamp(r / 255), g: clamp(g / 255), b: clamp(b / 255), a: parts[3] ? parseAlpha(parts[3]) : 1 };
  }

  if (name === 'hsl' || name === 'hsla') {
    const hue = parseFloat(parts[0]);
    const saturation = parseChannel(parts[1], 1);
    const lightness = parseChannel(parts[2], 1);
    if (![hue, saturation, lightness].every(Number.isFinite)) return null;
    const h = ((hue % 360) + 360) % 360 / 360;
    const s = clamp(saturation);
    const l = clamp(lightness);
    const hueToRgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    if (!s) return { r: l, g: l, b: l, a: parts[3] ? parseAlpha(parts[3]) : 1 };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: hueToRgb(p, q, h + 1 / 3),
      g: hueToRgb(p, q, h),
      b: hueToRgb(p, q, h - 1 / 3),
      a: parts[3] ? parseAlpha(parts[3]) : 1,
    };
  }

  if (name === 'oklab' || name === 'oklch') {
    const lightness = parseChannel(parts[0], 1);
    if (lightness == null) return null;
    let a;
    let b;
    if (name === 'oklch') {
      const chroma = parseChannel(parts[1], 0.4);
      const hue = parseFloat(parts[2]);
      if (chroma == null || !Number.isFinite(hue)) return null;
      const radians = hue * Math.PI / 180;
      a = chroma * Math.cos(radians);
      b = chroma * Math.sin(radians);
    } else {
      a = parseChannel(parts[1], 0.4);
      b = parseChannel(parts[2], 0.4);
      if (a == null || b == null) return null;
    }
    return { ...oklabToRgb(lightness, a, b), a: parts[3] ? parseAlpha(parts[3]) : 1 };
  }
  return null;
}

export function rgbToOklab(color) {
  const toLinear = (value) => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb(L, a, b) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  const toSrgb = (value) => value <= 0.0031308
    ? 12.92 * value
    : 1.055 * Math.pow(Math.max(value, 0), 1 / 2.4) - 0.055;
  return {
    r: clamp(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  };
}

function numberString(value, digits = 3) {
  return Number(value.toFixed(digits)).toString();
}

export function formatColor(color, format) {
  if (!color) return '#000000';
  const r = Math.round(clamp(color.r) * 255);
  const g = Math.round(clamp(color.g) * 255);
  const b = Math.round(clamp(color.b) * 255);
  if (format === 'hex') return '#' + [r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('');
  const alpha = color.a < 0.999 ? ` / ${numberString(color.a, 3)}` : '';
  if (format === 'rgb') return `rgb(${r} ${g} ${b}${alpha})`;
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === color.r) hue = ((color.g - color.b) / delta) % 6;
    else if (max === color.g) hue = (color.b - color.r) / delta + 2;
    else hue = (color.r - color.g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const lightness = (max + min) / 2;
  const saturation = !delta ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (format === 'hsl') return `hsl(${numberString(hue)} ${numberString(saturation * 100)}% ${numberString(lightness * 100)}%${alpha})`;
  const lab = rgbToOklab(color);
  if (format === 'oklab') return `oklab(${numberString(lab.L)} ${numberString(lab.a, 4)} ${numberString(lab.b, 4)}${alpha})`;
  const chroma = Math.sqrt(lab.a ** 2 + lab.b ** 2);
  const hueAngle = (Math.atan2(lab.b, lab.a) * 180 / Math.PI + 360) % 360;
  return `oklch(${numberString(lab.L)} ${numberString(chroma, 4)} ${numberString(hueAngle)}${alpha})`;
}

export function colorFormat(value) {
  if (/^transparent$/i.test(value || '')) return 'rgb';
  if (/^oklch\(/i.test(value || '')) return 'oklch';
  if (/^oklab\(/i.test(value || '')) return 'oklab';
  if (/^hsla?\(/i.test(value || '')) return 'hsl';
  if (/^rgba?\(/i.test(value || '')) return 'rgb';
  return 'hex';
}

export function toHex(color) {
  const parsed = parseColor(color);
  if (!parsed) return null;
  return formatColor(parsed, 'hex');
}

function blendColors(top, bottom) {
  const alpha = top.a + bottom.a * (1 - top.a);
  if (!alpha) return { r: 1, g: 1, b: 1, a: 1 };
  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
    a: alpha,
  };
}

function relativeLuminance(color) {
  const linear = (value) => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

export function contrastRatio(foreground, background) {
  const white = { r: 1, g: 1, b: 1, a: 1 };
  const base = blendColors(background, white);
  const foregroundOnBase = blendColors(foreground, base);
  const light = Math.max(relativeLuminance(foregroundOnBase), relativeLuminance(base));
  const dark = Math.min(relativeLuminance(foregroundOnBase), relativeLuminance(base));
  return (light + 0.05) / (dark + 0.05);
}
