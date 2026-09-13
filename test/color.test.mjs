import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseColor, formatColor, colorFormat, toHex, contrastRatio,
} from '../src/renderer/js/color.js';

const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

test('parseColor handles hex (3, 6, 8 digit)', () => {
  const red = parseColor('#ff0000');
  assert.ok(close(red.r, 1) && close(red.g, 0) && close(red.b, 0) && close(red.a, 1));
  const short = parseColor('#f00');
  assert.ok(close(short.r, 1) && close(short.g, 0) && close(short.b, 0));
  const alpha = parseColor('#ff000080');
  assert.ok(close(alpha.a, 128 / 255));
});

test('parseColor treats transparent as a zero-alpha color', () => {
  const transparent = parseColor('transparent');
  assert.ok(transparent && close(transparent.r, 0) && close(transparent.g, 0) &&
    close(transparent.b, 0) && close(transparent.a, 0));
  assert.equal(colorFormat('transparent'), 'rgb');
});

test('parseColor handles rgb()/rgba() with commas, spaces and slash alpha', () => {
  const a = parseColor('rgb(255, 0, 0)');
  const b = parseColor('rgb(255 0 0)');
  const c = parseColor('rgb(255 0 0 / 0.5)');
  assert.ok(close(a.r, 1) && close(b.r, 1));
  assert.ok(close(c.a, 0.5));
});

test('parseColor handles hsl()', () => {
  const red = parseColor('hsl(0 100% 50%)');
  assert.ok(close(red.r, 1) && close(red.g, 0) && close(red.b, 0));
  const gray = parseColor('hsl(120 0% 50%)');
  assert.ok(close(gray.r, 0.5) && close(gray.g, 0.5) && close(gray.b, 0.5));
});

test('parseColor handles oklch() and oklab()', () => {
  const white = parseColor('oklch(1 0 0)');
  assert.ok(close(white.r, 1, 1e-2) && close(white.g, 1, 1e-2) && close(white.b, 1, 1e-2));
  const black = parseColor('oklab(0 0 0)');
  assert.ok(close(black.r, 0) && close(black.g, 0) && close(black.b, 0));
});

test('parseColor rejects garbage', () => {
  assert.equal(parseColor('notacolor'), null);
  assert.equal(parseColor('rgb(255 0)'), null);
  assert.equal(parseColor(''), null);
});

test('formatColor round-trips through hex', () => {
  const parsed = parseColor('#3366cc');
  assert.equal(formatColor(parsed, 'hex'), '#3366cc');
});

test('colorFormat detects the source format', () => {
  assert.equal(colorFormat('#fff'), 'hex');
  assert.equal(colorFormat('rgb(1 2 3)'), 'rgb');
  assert.equal(colorFormat('hsl(0 0% 0%)'), 'hsl');
  assert.equal(colorFormat('oklch(0.5 0.1 20)'), 'oklch');
  assert.equal(colorFormat('oklab(0.5 0 0)'), 'oklab');
});

test('toHex converts any parseable color', () => {
  assert.equal(toHex('rgb(255 0 0)'), '#ff0000');
  assert.equal(toHex('garbage'), null);
});

test('contrastRatio is 21:1 for black on white', () => {
  const ratio = contrastRatio(parseColor('#000000'), parseColor('#ffffff'));
  assert.ok(close(ratio, 21, 0.01));
});

test('contrastRatio handles alpha blending', () => {
  const ratio = contrastRatio(parseColor('rgb(0 0 0 / 0)'), parseColor('#ffffff'));
  assert.ok(ratio >= 1);
});
