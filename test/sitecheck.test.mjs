import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isExternalRef,
  resolvePageRef,
  classTokensFromHtml,
  classTokensFromCss,
  groupFindings,
} from '../src/renderer/js/sitecheck.js';

test('isExternalRef separates remote refs from local/anchor refs', () => {
  assert.equal(isExternalRef('https://fonts.googleapis.com/css2?family=Inter'), true);
  assert.equal(isExternalRef('//cdn.example.com/x.js'), true);
  assert.equal(isExternalRef('mailto:hi@example.com'), true);
  assert.equal(isExternalRef('#pricing'), false);
  assert.equal(isExternalRef('images/hero.png'), false);
  assert.equal(isExternalRef('/styles.css'), false);
});

test('resolvePageRef resolves relative to the page folder', () => {
  assert.equal(resolvePageRef('about.html', 'index.html'), 'about.html');
  assert.equal(resolvePageRef('about.html', 'pages/contact.html'), 'pages/about.html');
  assert.equal(resolvePageRef('../styles.css', 'pages/contact.html'), 'styles.css');
  assert.equal(resolvePageRef('/images/x.png', 'pages/contact.html'), 'images/x.png');
  assert.equal(resolvePageRef('../../escape.css', 'pages/deep/x.html'), 'escape.css');
  assert.equal(resolvePageRef('#top', 'index.html'), null);
  assert.equal(resolvePageRef('https://x.com/a.html', 'index.html'), null);
  assert.equal(resolvePageRef('', 'index.html'), null);
});

test('classTokensFromHtml collects unique class tokens', () => {
  const html = '<div class="card is-open"><p class=\'card\'>x</p><span class="card  wide">y</span></div>';
  assert.deepEqual([...classTokensFromHtml(html)].sort(), ['card', 'is-open', 'wide']);
  assert.deepEqual([...classTokensFromHtml('')], []);
});

test('classTokensFromCss collects selector classes', () => {
  const css = '.card { color: red; }\n.card:hover, .btn.large { color: blue; }\n[data-x] .muted { opacity: 0 }';
  assert.deepEqual([...classTokensFromCss(css)].sort(), ['btn', 'card', 'large', 'muted']);
});

test('groupFindings groups known ids in a stable order', () => {
  const groups = groupFindings([
    { id: 'class-unused', message: 'u' },
    { id: 'duplicate-id', message: 'd' },
    { id: 'mystery', message: 'm' },
    { id: 'duplicate-id', message: 'd2' },
  ]);
  assert.deepEqual(groups.map((g) => g.id), ['duplicate-id', 'class-unused', 'other']);
  assert.equal(groups[0].items.length, 2);
  assert.deepEqual(groupFindings([]), []);
});
