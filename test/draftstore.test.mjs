import test from 'node:test';
import assert from 'node:assert/strict';

import draftstore from '../src/draftstore.js';

const { DRAFT_MAX_AGE_MS, draftFileName, draftPageFromFile, isStaleDraft } = draftstore;

test('draft file names round-trip page paths with slashes and unicode', () => {
  for (const page of ['index.html', 'docs/about.html', 'über/seite.html', 'a b/c+d.html']) {
    const name = draftFileName(page);
    assert.ok(!name.includes('/'), 'encoded name must not contain slashes');
    assert.equal(draftPageFromFile(name), page);
  }
});

test('draftPageFromFile rejects crafted names', () => {
  assert.equal(draftPageFromFile('index.html'), null);
  assert.equal(draftPageFromFile('nope.txt'), null);
  assert.equal(draftPageFromFile('.json'), null);
  assert.equal(draftPageFromFile('!!!.json'), null);
  assert.equal(draftPageFromFile(''), null);
  assert.equal(draftPageFromFile(null), null);
});

test('stale drafts: bad timestamps, old age, unknown pages', () => {
  const now = Date.now();
  assert.ok(isStaleDraft(null, now));
  assert.ok(isStaleDraft({ page: 'a.html' }, now));
  assert.ok(isStaleDraft({ page: 'a.html', capturedAt: -5 }, now));
  assert.ok(isStaleDraft({ page: 'a.html', capturedAt: now - DRAFT_MAX_AGE_MS - 1 }, now));
  assert.ok(!isStaleDraft({ page: 'a.html', capturedAt: now - 1000 }, now));
  assert.ok(isStaleDraft({ page: 'gone.html', capturedAt: now - 1000 }, now, ['index.html']));
  assert.ok(!isStaleDraft({ page: 'index.html', capturedAt: now - 1000 }, now, ['index.html']));
  assert.ok(!isStaleDraft({ page: 'index.html', capturedAt: now - 1000 }, now));
});
