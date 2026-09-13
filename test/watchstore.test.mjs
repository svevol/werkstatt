import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRel,
  isIgnoredRel,
  stampOf,
  sameStamp,
  classifyStamp,
  isSelfWrite,
} from '../src/watchstore.js';

test('normalizeRel folds separators and leading noise', () => {
  assert.equal(normalizeRel('pages\\about.html'), 'pages/about.html');
  assert.equal(normalizeRel('./styles.css'), 'styles.css');
  assert.equal(normalizeRel('/index.html'), 'index.html');
  assert.equal(normalizeRel(null), '');
});

test('isIgnoredRel filters dot/temp/node_modules churn', () => {
  assert.equal(isIgnoredRel('.DS_Store'), true);
  assert.equal(isIgnoredRel('.git/index'), true);
  assert.equal(isIgnoredRel('node_modules/x/y.css'), true);
  assert.equal(isIgnoredRel('styles.css.swp'), true);
  assert.equal(isIgnoredRel('.#index.html'), true);
  assert.equal(isIgnoredRel('index.html~'), true);
  assert.equal(isIgnoredRel('styles.css.tmp'), true);
  assert.equal(isIgnoredRel('pages/.#lock'), true);
  assert.equal(isIgnoredRel('styles.css'), false);
  assert.equal(isIgnoredRel('pages/about.html'), false);
  assert.equal(isIgnoredRel('fonts/inter.woff2'), false);
});

test('stampOf and sameStamp compare mtime + size', () => {
  assert.deepEqual(stampOf({ mtimeMs: 123.5, size: 10 }), { mtimeMs: 123.5, size: 10 });
  assert.equal(stampOf(null), null);
  assert.equal(sameStamp({ mtimeMs: 1, size: 2 }, { mtimeMs: 1, size: 2 }), true);
  assert.equal(sameStamp({ mtimeMs: 1, size: 2 }, { mtimeMs: 1, size: 3 }), false);
  assert.equal(sameStamp(null, { mtimeMs: 1, size: 2 }), false);
});

test('classifyStamp reports add/change/unlink only', () => {
  const a = { mtimeMs: 1, size: 2 };
  const b = { mtimeMs: 2, size: 2 };
  assert.equal(classifyStamp(null, a), 'add');
  assert.equal(classifyStamp(a, a), null);
  assert.equal(classifyStamp(a, b), 'change');
  assert.equal(classifyStamp(a, null), 'unlink');
  assert.equal(classifyStamp(null, null), null);
});

test('isSelfWrite matches only recent identical stamps', () => {
  const writes = new Map([['styles.css', { stamp: { mtimeMs: 5, size: 9 }, at: 1000 }]]);
  assert.equal(isSelfWrite(writes, 'styles.css', { mtimeMs: 5, size: 9 }, 1500), true);
  assert.equal(isSelfWrite(writes, 'styles.css', { mtimeMs: 5, size: 9 }, 99999), false);
  assert.equal(isSelfWrite(writes, 'styles.css', { mtimeMs: 6, size: 9 }, 1500), false);
  assert.equal(isSelfWrite(writes, 'other.css', { mtimeMs: 5, size: 9 }, 1500), false);
  assert.equal(isSelfWrite(null, 'styles.css', { mtimeMs: 5, size: 9 }, 1500), false);
});
