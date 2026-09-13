import test from 'node:test';
import assert from 'node:assert/strict';

import { matchRanges } from '../src/renderer/js/textfind.js';

test('matchRanges finds every occurrence', () => {
  assert.deepEqual(matchRanges('Hello world, hello there.', 'hello'), [
    { start: 0, end: 5 },
    { start: 13, end: 18 },
  ]);
});

test('matchRanges honours case sensitivity', () => {
  assert.deepEqual(matchRanges('Hello hello', 'hello', true), [{ start: 6, end: 11 }]);
  assert.deepEqual(matchRanges('Hello hello', 'hello', false).length, 2);
});

test('matchRanges ignores empty queries and missing haystacks', () => {
  assert.deepEqual(matchRanges('abc', ''), []);
  assert.deepEqual(matchRanges('', 'a'), []);
  assert.deepEqual(matchRanges(null, 'a'), []);
});

test('matchRanges advances past each match (no overlap scan)', () => {
  assert.deepEqual(matchRanges('aaaa', 'aa'), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
});
