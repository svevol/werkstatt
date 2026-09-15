import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHORTHAND_LONGHANDS, shorthandsFor, isShorthand,
  splitTopLevel, splitTopLevelCommas,
  varToken, substituteVars, sameCssValue, restoreVarTokens,
} from '../src/renderer/js/shorthands.js';

test('every registered longhand resolves back to its shorthand', () => {
  for (const [shorthand, longhands] of Object.entries(SHORTHAND_LONGHANDS)) {
    for (const longhand of longhands) {
      assert.ok(shorthandsFor(longhand).includes(shorthand), `${longhand} -> ${shorthand}`);
    }
  }
  assert.deepEqual(shorthandsFor('border-width'), ['border']);
  assert.deepEqual(shorthandsFor('padding-left'), ['padding']);
  assert.deepEqual(shorthandsFor('color'), []);
  assert.ok(isShorthand('border'));
  assert.ok(!isShorthand('border-width'));
});

test('splitTopLevel keeps functions and quoted strings whole', () => {
  assert.deepEqual(splitTopLevel('var(--border) solid var(--ink)'), ['var(--border)', 'solid', 'var(--ink)']);
  assert.deepEqual(splitTopLevel('rgb(1 2 3 / 0.5) 4px'), ['rgb(1 2 3 / 0.5)', '4px']);
  assert.deepEqual(splitTopLevel('"An a b" 12px'), ['"An a b"', '12px']);
  assert.deepEqual(splitTopLevelCommas('transform var(--d) ease, box-shadow var(--d) ease'),
    ['transform var(--d) ease', 'box-shadow var(--d) ease']);
  assert.deepEqual(splitTopLevel(''), []);
});

test('varToken recognises a whole var() reference only', () => {
  assert.deepEqual(varToken('var(--ink)'), { name: '--ink', fallback: '' });
  assert.deepEqual(varToken('var(--ink, red)'), { name: '--ink', fallback: 'red' });
  assert.equal(varToken('var(--a) solid'), null);
  assert.equal(varToken('solid'), null);
});

test('substituteVars resolves tokens, fallbacks and nested references', () => {
  const vars = { '--border': '3px', '--ink': '#150520', '--alias': 'var(--border)' };
  assert.equal(substituteVars('var(--border) solid var(--ink)', (n) => vars[n]), '3px solid #150520');
  assert.equal(substituteVars('var(--missing, 1px)', (n) => vars[n]), '1px');
  assert.equal(substituteVars('var(--alias) solid', (n) => vars[n]), '3px solid');
  // Unresolved without a fallback keeps the authored reference so callers bail.
  assert.equal(substituteVars('var(--nope)', (n) => vars[n]), 'var(--nope)');
});

test('sameCssValue compares colours and lengths, not just text', () => {
  assert.ok(sameCssValue('#150520', 'rgb(21, 5, 32)'));
  assert.ok(sameCssValue('0', '0px'));
  assert.ok(sameCssValue('1.5rem', '1.5rem'));
  assert.ok(sameCssValue('no-repeat', 'NO-REPEAT'));
  assert.ok(!sameCssValue('3px', '4px'));
  assert.ok(!sameCssValue('solid', 'dashed'));
  assert.ok(!sameCssValue('', '3px'));
});

test('restoreVarTokens gives each longhand back its authored token', () => {
  const vars = { '--border': '3px', '--ink': '#150520' };
  const resolve = (n) => vars[n];
  const raw = 'var(--border) solid var(--ink)';
  const restored = restoreVarTokens(
    { 'border-width': '3px', 'border-style': 'solid', 'border-color': 'rgb(21, 5, 32)' },
    raw, resolve,
  );
  assert.deepEqual(restored, {
    'border-width': 'var(--border)',
    'border-style': 'solid',
    'border-color': 'var(--ink)',
  });
});

test('restoreVarTokens never reuses one token for two longhands', () => {
  const restored = restoreVarTokens(
    { 'padding-top': '2px', 'padding-bottom': '2px' },
    'var(--gap) 0 var(--gap) 0',
    (n) => (n === '--gap' ? '2px' : ''),
  );
  assert.equal(restored['padding-top'], 'var(--gap)');
  assert.equal(restored['padding-bottom'], 'var(--gap)');
});
