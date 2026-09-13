import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGradient, serializeGradient, gradientAngle, formatGradientAngle,
  parseRadialPosition, formatRadialPosition, stopPercent, sampleGradientColor,
} from '../src/renderer/js/gradient.js';

test('parseGradient reads a linear gradient angle and stops', () => {
  assert.deepEqual(parseGradient('linear-gradient(135deg, red 0%, blue 100%)'), {
    repeating: false,
    type: 'linear',
    direction: '135deg',
    shape: '',
    extent: '',
    position: '',
    stops: [
      { color: 'red', position: '0%' },
      { color: 'blue', position: '100%' },
    ],
  });
});

test('parseGradient reads direction keywords and position-less stops', () => {
  const model = parseGradient('linear-gradient(to bottom right, red, blue)');
  assert.equal(model.direction, 'to bottom right');
  assert.deepEqual(model.stops, [
    { color: 'red', position: '' },
    { color: 'blue', position: '' },
  ]);
});

test('parseGradient reads radial shape and position', () => {
  const model = parseGradient('radial-gradient(circle at top, oklch(85% 0.16 200) 0%, oklch(28% 0.08 260) 75%)');
  assert.equal(model.type, 'radial');
  assert.equal(model.shape, 'circle');
  assert.equal(model.position, 'at top');
  assert.equal(model.stops.length, 2);
});

test('parseGradient rejects conic gradients and non-gradients', () => {
  assert.equal(parseGradient('conic-gradient(red, blue)'), null);
  assert.equal(parseGradient('url(hero.svg)'), null);
  assert.equal(parseGradient('linear-gradient(red)').stops.length, 1);
  assert.equal(parseGradient(''), null);
});

test('serializeGradient round-trips parsed gradients', () => {
  for (const css of [
    'linear-gradient(135deg, red 0%, blue 100%)',
    'linear-gradient(to right, red, blue)',
    'linear-gradient(red, blue)',
    'radial-gradient(circle at top, red 0%, blue 75%)',
    'repeating-linear-gradient(45deg, red 0%, blue 10%)',
  ]) {
    const model = parseGradient(css);
    assert.ok(model, css);
    assert.equal(serializeGradient(model), css);
  }
});

test('serializeGradient keeps repeating and radial headers', () => {
  assert.equal(
    serializeGradient({ repeating: true, type: 'radial', shape: 'ellipse', extent: 'farthest-corner', position: 'at center', stops: [{ color: 'red', position: '' }, { color: 'blue', position: '' }] }),
    'repeating-radial-gradient(ellipse farthest-corner at center, red, blue)',
  );
  assert.equal(serializeGradient(null), '');
});

test('gradientAngle maps keywords and units to degrees', () => {
  assert.equal(gradientAngle('to top'), 0);
  assert.equal(gradientAngle('to right'), 90);
  assert.equal(gradientAngle('to bottom'), 180);
  assert.equal(gradientAngle('to top left'), 315);
  assert.equal(gradientAngle('135deg'), 135);
  assert.equal(gradientAngle('0.5turn'), 180);
  assert.equal(gradientAngle(''), 180);
  assert.equal(formatGradientAngle(370), '10deg');
  assert.equal(formatGradientAngle(-90), '270deg');
});

test('parseRadialPosition normalises keyword positions', () => {
  assert.deepEqual(parseRadialPosition('at center'), { x: 'center', y: 'center', custom: false });
  assert.deepEqual(parseRadialPosition('at top'), { x: 'center', y: 'top', custom: false });
  assert.deepEqual(parseRadialPosition('at left top'), { x: 'left', y: 'top', custom: false });
  assert.deepEqual(parseRadialPosition('at top right'), { x: 'right', y: 'top', custom: false });
  const custom = parseRadialPosition('at 20% 30%');
  assert.equal(custom.custom, true);
  assert.equal(custom.x, '20%');
  assert.equal(custom.y, '30%');
});

test('formatRadialPosition round-trips pad positions', () => {
  assert.equal(formatRadialPosition({ x: 'center', y: 'center' }), 'at center');
  assert.equal(formatRadialPosition({ x: 'center', y: 'top' }), 'at top');
  assert.equal(formatRadialPosition({ x: 'left', y: 'top' }), 'at left top');
  assert.equal(formatRadialPosition({ x: '20%', y: '30%' }), 'at 20% 30%');
});

test('stopPercent spreads position-less stops and clamps percentages', () => {
  assert.equal(stopPercent({ position: '40%' }, 0, 3), 40);
  assert.equal(stopPercent({ position: '200%' }, 0, 3), 100);
  assert.equal(stopPercent({ position: '' }, 1, 3), 50);
  assert.equal(stopPercent({ position: '12px' }, 2, 3), 100);
});

test('sampleGradientColor interpolates between stops', () => {
  const stops = [{ color: '#ff0000', position: '0%' }, { color: 'rgb(0, 0, 255)', position: '100%' }];
  assert.equal(sampleGradientColor(stops, 0), '#ff0000');
  assert.equal(sampleGradientColor(stops, 100), '#0000ff');
  assert.equal(sampleGradientColor(stops, 50), '#800080');
  assert.equal(sampleGradientColor([], 50), '');
});
