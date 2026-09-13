import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isManagedGoogleFontLink,
  stripManagedGoogleFontLinks,
} from '../src/renderer/js/fonts.js';

const MANAGED =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap">';
const UNKNOWN =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..700&display=swap">';

test('isManagedGoogleFontLink accepts catalog families only', () => {
  assert.equal(isManagedGoogleFontLink(MANAGED), true);
  assert.equal(isManagedGoogleFontLink(UNKNOWN), false);
  assert.equal(isManagedGoogleFontLink('<link rel="stylesheet" href="styles.css">'), false);
  assert.equal(
    isManagedGoogleFontLink('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&family=Fraunces">'),
    false,
    'a link mixing known and unknown families is unmanaged'
  );
  assert.equal(
    isManagedGoogleFontLink('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?display=swap">'),
    false,
    'a link without a parseable family is unmanaged'
  );
});

test('stripManagedGoogleFontLinks removes only managed links', () => {
  const html = `<head>\n  ${MANAGED}\n  ${UNKNOWN}\n  <link rel="stylesheet" href="styles.css">\n</head>`;
  const out = stripManagedGoogleFontLinks(html);
  assert.equal(
    out,
    `<head>\n  ${UNKNOWN}\n  <link rel="stylesheet" href="styles.css">\n</head>`
  );
  assert.ok(!/family=Inter/.test(out));
});

test('stripManagedGoogleFontLinks leaves non-font markup untouched', () => {
  const html = '<link rel="stylesheet" href="styles.css"><link rel="icon" href="favicon.svg">';
  assert.equal(stripManagedGoogleFontLinks(html), html);
  assert.equal(stripManagedGoogleFontLinks(''), '');
  assert.equal(stripManagedGoogleFontLinks(null), '');
});
