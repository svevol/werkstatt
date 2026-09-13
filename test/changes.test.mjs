import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeText,
  diffEntries,
  summarizeCounts,
  formatHandoffNote,
} from '../src/renderer/js/changes.js';

test('normalizeText collapses whitespace', () => {
  assert.equal(normalizeText('  a\n  b\t c '), 'a b c');
  assert.equal(normalizeText(null), '');
});

test('diffEntries reports changed, added and removed keys', () => {
  const before = new Map([['a', '1'], ['b', '2'], ['c', '3']]);
  const after = new Map([['a', '1'], ['b', '9'], ['d', '4']]);
  const diff = diffEntries(before, after);
  assert.deepEqual(diff.changed, [{ key: 'b', from: '2', to: '9' }]);
  assert.deepEqual(diff.added, [{ key: 'd', value: '4' }]);
  assert.deepEqual(diff.removed, [{ key: 'c', value: '3' }]);
  assert.equal(summarizeCounts({ text: diff, classes: { changed: [], added: [], removed: [] }, css: { changed: [], added: [], removed: [] } }), 3);
});

test('formatHandoffNote writes text, class and style sections', () => {
  const summary = {
    text: { changed: [{ key: 'body > h1[0] > text[0]', from: 'Old', to: 'New' }], added: [], removed: [] },
    classes: { changed: [{ key: 'body > div[1]', from: 'card', to: 'card is-open' }], added: [], removed: [] },
    css: { changed: [{ key: '.card { color }', from: '#111', to: '#222' }], added: [], removed: [] },
  };
  const note = formatHandoffNote(summary, { page: 'index.html', when: 0 });
  assert.match(note, /# Manual edits — index\.html/);
  assert.match(note, /## Text \(1\)/);
  assert.match(note, /“Old” → “New”/);
  assert.match(note, /## Classes \(1\)/);
  assert.match(note, /card → card is-open/);
  assert.match(note, /## Styles \(1\)/);
  assert.match(note, /#111 → #222/);
});

test('formatHandoffNote says when there is nothing to report', () => {
  const empty = { changed: [], added: [], removed: [] };
  const note = formatHandoffNote({ text: empty, classes: empty, css: empty }, { page: 'a.html', when: 0 });
  assert.match(note, /No differences found/);
});
