import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compatibleTokens, tokenKindsForProperty, tokenType,
} from '../src/renderer/js/tokens.js';

test('tokenType classifies common design token values', () => {
  assert.equal(tokenType('--accent', '#ff3366'), 'color');
  assert.equal(tokenType('--space-lg', '2rem'), 'length');
  assert.equal(tokenType('--alpha', '0.7'), 'number');
  assert.equal(tokenType('--duration', '180ms'), 'time');
  assert.equal(tokenType('--font-body', "'Inter', sans-serif"), 'font');
  assert.equal(tokenType('--hero-gradient', 'linear-gradient(red, blue)'), 'gradient');
});

test('tokenKindsForProperty exposes only supported control types', () => {
  assert.deepEqual(tokenKindsForProperty('color'), ['color']);
  assert.deepEqual(tokenKindsForProperty('font-size'), ['length']);
  assert.deepEqual(tokenKindsForProperty('line-height'), ['length', 'number']);
  assert.deepEqual(tokenKindsForProperty('opacity'), ['number']);
  assert.deepEqual(tokenKindsForProperty('transition-duration'), ['time']);
  assert.deepEqual(tokenKindsForProperty('box-shadow'), ['shadow']);
});

test('compatibleTokens filters by kind but keeps the current linked token', () => {
  const vars = [
    { name: '--accent', value: '#ff3366' },
    { name: '--space-lg', value: '2rem' },
    { name: '--alpha', value: '0.7' },
  ];
  assert.deepEqual(
    compatibleTokens(vars, ['color']).map((token) => token.name),
    ['--accent'],
  );
  assert.deepEqual(
    compatibleTokens(vars, ['number']).map((token) => token.name),
    ['--alpha'],
  );
  assert.deepEqual(
    compatibleTokens(vars, ['number'], '--accent').map((token) => token.name),
    ['--accent', '--alpha'],
  );
});
