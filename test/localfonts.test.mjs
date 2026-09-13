import test from 'node:test';
import assert from 'node:assert/strict';

import {
  slugFamily,
  fontFileName,
  parseGoogleCss,
  buildFontFaceCss,
  isLocalSrc,
  detectLocalFontFaces,
  localFamilies,
  familiesNeedingLocal,
} from '../src/renderer/js/localfonts.js';

const GOOGLE_SAMPLE = `
/* latin-ext */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYAZ9hiJ-Ek-_EeA.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuFuYAZ9hiJ-Ek-_EeA.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`;

test('slugFamily normalizes names for file paths', () => {
  assert.equal(slugFamily('Playfair Display'), 'playfair-display');
  assert.equal(slugFamily('Source Sans 3'), 'source-sans-3');
  assert.equal(slugFamily('  Inter  '), 'inter');
});

test('fontFileName is stable per subset index', () => {
  assert.equal(fontFileName('Inter', '400', 'normal', 1), 'inter-400-1.woff2');
  assert.equal(fontFileName('Inter', '700', 'normal', 2), 'inter-700-2.woff2');
  assert.equal(fontFileName('Inter', '400', 'italic', 1), 'inter-400italic-1.woff2');
});

test('parseGoogleCss keeps every unicode-range subset', () => {
  const entries = parseGoogleCss(GOOGLE_SAMPLE);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].family, 'Inter');
  assert.equal(entries[0].weight, '400');
  assert.ok(entries[0].urls[0].endsWith('.woff2'));
  assert.match(entries[0].unicodeRange, /U\+0100/);
  assert.match(entries[1].unicodeRange, /U\+0000/);
});

test('buildFontFaceCss points at local files with swap + ranges', () => {
  const css = buildFontFaceCss([
    { family: 'Inter', weight: '400', style: 'normal', file: 'fonts/inter-400-1.woff2', unicodeRange: 'U+0000-00FF' },
  ]);
  assert.match(css, /font-family: 'Inter'/);
  assert.match(css, /url\("fonts\/inter-400-1\.woff2"\) format\("woff2"\)/);
  assert.match(css, /font-display: swap/);
  assert.match(css, /unicode-range: U\+0000-00FF/);
});

test('isLocalSrc accepts folder files, rejects remote/embedded', () => {
  assert.equal(isLocalSrc('fonts/inter-400-1.woff2'), true);
  assert.equal(isLocalSrc('../fonts/x.woff2'), true);
  assert.equal(isLocalSrc('https://fonts.gstatic.com/x.woff2'), false);
  assert.equal(isLocalSrc('//fonts.gstatic.com/x.woff2'), false);
  assert.equal(isLocalSrc('data:font/woff2;base64,AAA'), false);
});

test('detectLocalFontFaces finds vendored families only', () => {
  const css = `
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url("fonts/inter-400-1.woff2") format("woff2"); }
@font-face { font-family: 'Remote'; src: url(https://example.com/r.woff2) format('woff2'); }
.body { color: red; }`;
  const found = detectLocalFontFaces(css);
  assert.equal(found.length, 1);
  assert.equal(found[0].family, 'Inter');
  assert.deepEqual(localFamilies(css), ['Inter']);
});

test('familiesNeedingLocal subtracts vendored families', () => {
  const css = `@font-face { font-family: 'Inter'; src: url("fonts/inter-400-1.woff2") format("woff2"); }`;
  assert.deepEqual(familiesNeedingLocal(['Inter', 'Playfair Display'], css), ['Playfair Display']);
  assert.deepEqual(familiesNeedingLocal(['Inter'], ''), ['Inter']);
});
