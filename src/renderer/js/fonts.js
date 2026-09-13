// Google Fonts — curated font catalog, search, URL generation, friendly names.

import { HE } from './he.js';
import {
  detectLocalFontFaces, localFamilies, familiesNeedingLocal,
} from './localfonts.js';

// label = what users see; css = what we write to the stylesheet
const SYSTEM_FONTS = [
  { label: 'System UI', css: 'system-ui, sans-serif', stack: 'system-ui, sans-serif' },
  { label: 'San Francisco', css: '-apple-system, BlinkMacSystemFont, sans-serif', stack: '-apple-system, BlinkMacSystemFont, sans-serif' },
  { label: 'Arial', css: 'Arial, sans-serif', stack: 'Arial, sans-serif' },
  { label: 'Helvetica', css: 'Helvetica, sans-serif', stack: 'Helvetica, sans-serif' },
  { label: 'Verdana', css: 'Verdana, sans-serif', stack: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', css: 'Trebuchet MS, sans-serif', stack: '"Trebuchet MS", sans-serif' },
  { label: 'Georgia', css: 'Georgia, serif', stack: 'Georgia, serif' },
  { label: 'Times New Roman', css: 'Times New Roman, serif', stack: '"Times New Roman", serif' },
  { label: 'Courier New', css: 'Courier New, monospace', stack: '"Courier New", monospace' },
  { label: 'Impact', css: 'Impact, sans-serif', stack: 'Impact, sans-serif' },
];

const GOOGLE_FONTS = [
  { family: 'Roboto', category: 'sans-serif' },
  { family: 'Open Sans', category: 'sans-serif' },
  { family: 'Lato', category: 'sans-serif' },
  { family: 'Montserrat', category: 'sans-serif' },
  { family: 'Oswald', category: 'sans-serif' },
  { family: 'Source Sans 3', category: 'sans-serif' },
  { family: 'Raleway', category: 'sans-serif' },
  { family: 'Poppins', category: 'sans-serif' },
  { family: 'Nunito', category: 'sans-serif' },
  { family: 'Ubuntu', category: 'sans-serif' },
  { family: 'Noto Sans', category: 'sans-serif' },
  { family: 'PT Sans', category: 'sans-serif' },
  { family: 'Fira Sans', category: 'sans-serif' },
  { family: 'Barlow', category: 'sans-serif' },
  { family: 'Inter', category: 'sans-serif' },
  { family: 'Work Sans', category: 'sans-serif' },
  { family: 'Quicksand', category: 'sans-serif' },
  { family: 'Josefin Sans', category: 'sans-serif' },
  { family: 'Karla', category: 'sans-serif' },
  { family: 'Rubik', category: 'sans-serif' },
  { family: 'Mukta', category: 'sans-serif' },
  { family: 'DM Sans', category: 'sans-serif' },
  { family: 'Manrope', category: 'sans-serif' },
  { family: 'Plus Jakarta Sans', category: 'sans-serif' },
  { family: 'Outfit', category: 'sans-serif' },
  { family: 'Space Grotesk', category: 'sans-serif' },
  { family: 'Cabin', category: 'sans-serif' },
  { family: 'Rajdhani', category: 'sans-serif' },
  { family: 'Exo 2', category: 'sans-serif' },
  { family: 'Titillium Web', category: 'sans-serif' },
  { family: 'Archivo', category: 'sans-serif' },
  { family: 'Mulish', category: 'sans-serif' },
  { family: 'Jost', category: 'sans-serif' },
  { family: 'Kanit', category: 'sans-serif' },
  { family: 'Teko', category: 'sans-serif' },
  { family: 'Prompt', category: 'sans-serif' },
  { family: 'Heebo', category: 'sans-serif' },
  { family: 'Assistant', category: 'sans-serif' },
  { family: 'ABeeZee', category: 'sans-serif' },
  { family: 'Catamaran', category: 'sans-serif' },

  { family: 'Merriweather', category: 'serif' },
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'PT Serif', category: 'serif' },
  { family: 'Source Serif 4', category: 'serif' },
  { family: 'Noto Serif', category: 'serif' },
  { family: 'Crimson Text', category: 'serif' },
  { family: 'Libre Baskerville', category: 'serif' },
  { family: 'EB Garamond', category: 'serif' },
  { family: 'Cormorant Garamond', category: 'serif' },
  { family: 'DM Serif Display', category: 'serif' },
  { family: 'Spectral', category: 'serif' },
  { family: 'Cardo', category: 'serif' },
  { family: 'Vollkorn', category: 'serif' },
  { family: 'Libre Caslon Text', category: 'serif' },
  { family: 'Bitter', category: 'serif' },
  { family: 'Inria Serif', category: 'serif' },
  { family: 'Zilla Slab', category: 'serif' },
  { family: 'Alegreya', category: 'serif' },
  { family: 'Arvo', category: 'serif' },
  { family: 'Slabo 27px', category: 'serif' },
  { family: 'Old Standard TT', category: 'serif' },
  { family: 'Cormorant', category: 'serif' },
  { family: 'Frank Ruhl Libre', category: 'serif' },

  { family: 'Fira Code', category: 'monospace' },
  { family: 'Source Code Pro', category: 'monospace' },
  { family: 'JetBrains Mono', category: 'monospace' },
  { family: 'IBM Plex Mono', category: 'monospace' },
  { family: 'Space Mono', category: 'monospace' },
  { family: 'Inconsolata', category: 'monospace' },
  { family: 'Roboto Mono', category: 'monospace' },
  { family: 'Courier Prime', category: 'monospace' },
  { family: 'Ubuntu Mono', category: 'monospace' },
  { family: 'PT Mono', category: 'monospace' },
  { family: 'Red Hat Mono', category: 'monospace' },

  { family: 'Bebas Neue', category: 'display' },
  { family: 'Anton', category: 'display' },
  { family: 'Righteous', category: 'display' },
  { family: 'Alfa Slab One', category: 'display' },
  { family: 'Bungee', category: 'display' },
  { family: 'Passion One', category: 'display' },
  { family: 'Permanent Marker', category: 'display' },
  { family: 'Bangers', category: 'display' },
  { family: 'Abril Fatface', category: 'display' },
  { family: 'Lobster', category: 'display' },
  { family: 'Fredoka', category: 'display' },
  { family: 'Shrikhand', category: 'display' },
  { family: 'Archivo Black', category: 'display' },
  { family: 'Russo One', category: 'display' },
  { family: 'Black Ops One', category: 'display' },
  { family: 'Concert One', category: 'display' },
  { family: 'Bowlby One SC', category: 'display' },
  { family: 'Almarai', category: 'display' },

  { family: 'Pacifico', category: 'handwriting' },
  { family: 'Dancing Script', category: 'handwriting' },
  { family: 'Caveat', category: 'handwriting' },
  { family: 'Great Vibes', category: 'handwriting' },
  { family: 'Satisfy', category: 'handwriting' },
  { family: 'Cookie', category: 'handwriting' },
  { family: 'Sacramento', category: 'handwriting' },
  { family: 'Amatic SC', category: 'handwriting' },
  { family: 'Patrick Hand', category: 'handwriting' },
  { family: 'Kalam', category: 'handwriting' },
  { family: 'Indie Flower', category: 'handwriting' },
  { family: 'Shadows Into Light', category: 'handwriting' },
  { family: 'Architects Daughter', category: 'handwriting' },
  { family: 'Gloria Hallelujah', category: 'handwriting' },
  { family: 'Handlee', category: 'handwriting' },
  { family: 'Yellowtail', category: 'handwriting' },
  { family: 'Courgette', category: 'handwriting' },
  { family: 'Bad Script', category: 'handwriting' },
  { family: 'Itim', category: 'handwriting' },
];

const seen = new Set();
const UNIQUE_GOOGLE_FONTS = [];
for (const f of GOOGLE_FONTS) {
  if (!seen.has(f.family)) {
    seen.add(f.family);
    UNIQUE_GOOGLE_FONTS.push(f);
  }
}

const googleByLower = new Map(
  UNIQUE_GOOGLE_FONTS.map((f) => [f.family.toLowerCase(), f])
);

function googleFontUrl(family) {
  const encoded = family.replace(/ /g, '+');
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@300;400;500;600;700&display=swap`;
}

function fontFamilyValue(family, category) {
  const fallback = category || 'sans-serif';
  return `'${family}', ${fallback}`;
}

/** First family token from a CSS font-family value, unquoted. */
function firstFamily(fontFamilyCss) {
  if (!fontFamilyCss) return '';
  const first = fontFamilyCss.split(',')[0].trim();
  return first.replace(/^['"]|['"]$/g, '');
}

function findGoogleFont(family) {
  if (!family) return null;
  return googleByLower.get(String(family).toLowerCase()) || null;
}

/** Friendly name for UI (input, list). Falls back to first family token. */
function displayName(fontFamilyCss) {
  if (!fontFamilyCss) return '';
  const trimmed = fontFamilyCss.trim();
  if (!trimmed) return '';

  for (const s of SYSTEM_FONTS) {
    if (normCss(s.css) === normCss(trimmed) || normCss(s.stack) === normCss(trimmed)) {
      return s.label;
    }
  }

  const first = firstFamily(trimmed);
  const g = findGoogleFont(first);
  if (g) return g.family;

  // Match system by first token
  for (const s of SYSTEM_FONTS) {
    if (firstFamily(s.css).toLowerCase() === first.toLowerCase()) return s.label;
  }

  return first || trimmed;
}

function normCss(s) {
  return s.replace(/['"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseFamilyName(fontFamilyCss) {
  const first = firstFamily(fontFamilyCss);
  const g = findGoogleFont(first);
  return g ? g.family : null;
}

/** All Google families referenced in CSS text (font-family declarations). */
function detectGoogleFontsInCss(cssText) {
  if (!cssText) return [];
  const found = [];
  const rx = /font-family\s*:\s*([^;!}]+)/gi;
  let m;
  while ((m = rx.exec(cssText)) !== null) {
    const name = parseFamilyName(m[1]);
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

function searchFonts(query) {
  if (!query) return UNIQUE_GOOGLE_FONTS.slice();
  const lower = query.toLowerCase();
  return UNIQUE_GOOGLE_FONTS.filter(
    (f) =>
      f.family.toLowerCase().includes(lower) ||
      f.category.toLowerCase().includes(lower)
  );
}

function searchSystem(query) {
  if (!query) return SYSTEM_FONTS.slice();
  const lower = query.toLowerCase();
  return SYSTEM_FONTS.filter(
    (f) =>
      f.label.toLowerCase().includes(lower) ||
      f.css.toLowerCase().includes(lower)
  );
}

function detectGoogleFontLinks(html) {
  const found = [];
  const rx = /fonts\.googleapis\.com\/css2\?family=([^&"'<\s]+)/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    const family = decodeURIComponent(m[1].replace(/\+/g, ' ')).replace(/:.*$/, '');
    const match = findGoogleFont(family);
    if (match && !found.includes(match.family)) found.push(match.family);
  }
  return found;
}

// A whole Google Font <link> tag, leading whitespace included so stripping it
// leaves no blank line behind.
const GOOGLE_FONT_LINK_RE = /\s*<link\b[^>]*fonts\.googleapis\.com\/css2[^>]*>/gi;

function googleFamiliesInUrl(url) {
  const out = [];
  const query = String(url || '').replace(/^[^?]*\?/, '');
  for (const pair of query.split('&')) {
    if (!/^family=/i.test(pair)) continue;
    const raw = pair.replace(/^family=/i, '');
    const name = decodeURIComponent(raw.replace(/\+/g, ' ')).replace(/:.*$/, '').trim();
    if (name) out.push(name);
  }
  return out;
}

// Catalog-managed link: every requested family is one the editor knows.
// Anything else (unknown family, multiple stacks mixing known + unknown,
// unparseable URL) stays as authored so Preview and Save never drop it.
export function isManagedGoogleFontLink(tag) {
  const urls = String(tag || '').match(/fonts\.googleapis\.com\/css2\?[^"'<>]*/gi) || [];
  const families = urls.flatMap(googleFamiliesInUrl);
  return families.length > 0 && families.every((f) => !!findGoogleFont(f));
}

// Remove only editable Google Font <link>s. Unrecognized families are
// preserved verbatim (Task 93) — the editor can manage what it knows, but
// must not delete a font it cannot re-add.
export function stripManagedGoogleFontLinks(html) {
  return String(html || '').replace(GOOGLE_FONT_LINK_RE, (tag) =>
    isManagedGoogleFontLink(tag) ? '' : tag
  );
}

// Load a Google font into the editor chrome (for picker previews)
const uiLoaded = new Set();
function ensureUiGoogleFont(family) {
  if (!family || uiLoaded.has(family)) return;
  uiLoaded.add(family);
  if (typeof document === 'undefined') return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = googleFontUrl(family);
  link.setAttribute('data-he-ui-gfont', family);
  document.head.appendChild(link);
}

function preloadPickerFonts(limit) {
  const n = limit == null ? 40 : limit;
  UNIQUE_GOOGLE_FONTS.slice(0, n).forEach((f) => ensureUiGoogleFont(f.family));
}

const fonts = {
  system: SYSTEM_FONTS,
  googleFontUrl,
  fontFamilyValue,
  firstFamily,
  displayName,
  parseFamilyName,
  searchFonts,
  searchSystem,
  detectGoogleFontLinks,
  detectGoogleFontsInCss,
  isManagedGoogleFontLink,
  stripManagedGoogleFontLinks,
  findGoogleFont,
  ensureUiGoogleFont,
  preloadPickerFonts,
  // Folder fonts (Task 72): @font-face rules pointing at project files.
  detectLocalFontFaces,
  localFamilies,
  familiesNeedingLocal,
};

HE.fonts = fonts;

export { fonts };
