// localfonts — pure helpers for self-hosting Google Fonts (no DOM, Node-testable).
//
// Flow: the editor detects Google families in use (fonts.js), the main process
// downloads their woff2 files into project `fonts/`, and the renderer writes
// local `@font-face` rules pointing at those files. Afterwards the canvas no
// longer needs any `fonts.googleapis.com` link for the vendored families.
//
// The Google css2 response is a series of `@font-face` blocks, one per
// (family, weight, style, unicode-range subset). Every subset needs its own
// file — dropping subsets would break e.g. latin-ext characters.

function slugFamily(family) {
  return String(family || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'font';
}

// Stable file name per subset block: inter-400-1.woff2, inter-700italic-2.woff2.
// `index` is the 1-based position of the block within its (weight, style) group
// so repeat runs produce identical names (idempotent re-clicks).
function fontFileName(family, weight, style, index) {
  const slug = slugFamily(family);
  const w = String(weight || '400').trim() || '400';
  const suffix = String(style || 'normal').toLowerCase() === 'italic' ? 'italic' : '';
  const n = Math.max(1, Number(index) || 1);
  return `${slug}-${w}${suffix}-${n}.woff2`;
}

function unquote(s) {
  return String(s || '').trim().replace(/^['"]|['"]$/g, '');
}

// Parse Google css2 `@font-face` blocks into entries:
// [{ family, weight, style, urls: [...], unicodeRange }]
// Only woff2 urls are kept (the request UA negotiates woff2; anything else
// would be a fallback format we do not vendor).
function parseGoogleCss(cssText) {
  const out = [];
  if (!cssText) return out;
  const blocks = String(cssText).match(/@font-face\s*\{[^}]*\}/gi) || [];
  for (const block of blocks) {
    const family = unquote((block.match(/font-family\s*:\s*([^;]+);/i) || [])[1] || '');
    if (!family) continue;
    const style = ((block.match(/font-style\s*:\s*([^;]+);/i) || [])[1] || 'normal').trim().toLowerCase();
    const weight = ((block.match(/font-weight\s*:\s*([^;]+);/i) || [])[1] || '400').trim();
    const urls = [];
    const src = (block.match(/src\s*:\s*([^;]+);/i) || [])[1] || '';
    const urlRx = /url\(\s*(['"]?)(https:\/\/[^)'"]+\.woff2[^)'"]*)\1\s*\)\s*format\(\s*(['"]?)woff2\3\s*\)/gi;
    let m;
    while ((m = urlRx.exec(src)) !== null) urls.push(m[2]);
    if (!urls.length) continue;
    const unicodeRange = ((block.match(/unicode-range\s*:\s*([^;]+);/i) || [])[1] || '').trim();
    out.push({ family, weight, style, urls, unicodeRange });
  }
  return out;
}

// Build local `@font-face` CSS from vendored entries:
// [{ family, weight, style, file, unicodeRange }]
// `font-display: swap` keeps text visible while the local file loads.
function buildFontFaceCss(entries) {
  const blocks = [];
  for (const e of entries || []) {
    if (!e || !e.family || !e.file) continue;
    const lines = [
      '@font-face {',
      `  font-family: '${e.family}';`,
      `  font-style: ${e.style || 'normal'};`,
      `  font-weight: ${e.weight || '400'};`,
      '  font-display: swap;',
      `  src: url("${e.file}") format("woff2");`,
    ];
    if (e.unicodeRange) lines.push(`  unicode-range: ${e.unicodeRange};`);
    lines.push('}');
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function isLocalSrc(src) {
  const s = String(src || '').trim();
  if (!s) return false;
  if (/^(https?:)?\/\//i.test(s)) return false; // remote (incl. protocol-relative)
  if (/^data:/i.test(s)) return false; // embedded — not a folder font
  return /\.(woff2?|ttf|otf)(\?|#|$)/i.test(s);
}

// All `@font-face` families in CSS with at least one folder-relative src:
// [{ family, files: [urls] }]
function detectLocalFontFaces(cssText) {
  const out = [];
  if (!cssText) return out;
  const blocks = String(cssText).match(/@font-face\s*\{[^}]*\}/gi) || [];
  for (const block of blocks) {
    const family = unquote((block.match(/font-family\s*:\s*([^;]+);/i) || [])[1] || '');
    if (!family) continue;
    const src = (block.match(/src\s*:\s*([^;]+);/i) || [])[1] || '';
    const files = [];
    const urlRx = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi;
    let m;
    while ((m = urlRx.exec(src)) !== null) {
      if (isLocalSrc(m[2])) files.push(m[2]);
    }
    if (files.length) out.push({ family, files });
  }
  return out;
}

function localFamilies(cssText) {
  const seen = new Set();
  const out = [];
  for (const f of detectLocalFontFaces(cssText)) {
    const key = f.family.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f.family);
    }
  }
  return out;
}

// Google families still needing a local copy = used families minus vendored.
function familiesNeedingLocal(googleFamilies, cssText) {
  const local = new Set(localFamilies(cssText).map((f) => f.toLowerCase()));
  const out = [];
  for (const fam of googleFamilies || []) {
    if (!fam) continue;
    if (!local.has(String(fam).toLowerCase()) && !out.includes(fam)) out.push(fam);
  }
  return out;
}

export {
  slugFamily,
  fontFileName,
  parseGoogleCss,
  buildFontFaceCss,
  isLocalSrc,
  detectLocalFontFaces,
  localFamilies,
  familiesNeedingLocal,
};
