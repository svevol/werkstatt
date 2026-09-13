import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stripActiveState,
  looseSignature,
} from '../src/renderer/js/components.js';

test('stripActiveState removes active classes and current-page attributes', () => {
  const a = '<a class="nav-link is-active" aria-current="page" href="about.html">About</a>';
  const b = '<a class="nav-link active" data-active href="about.html">About</a>';
  assert.equal(stripActiveState(a), '<a class="nav-link" href="about.html">About</a>');
  assert.equal(stripActiveState(b), '<a class="nav-link" href="about.html">About</a>');
});

test('stripActiveState keeps unrelated classes and attributes', () => {
  const html = '<a class="nav-link btn-primary" aria-label="Home" aria-current="false">Home</a>';
  assert.equal(
    stripActiveState(html),
    '<a class="nav-link btn-primary" aria-label="Home">Home</a>'
  );
});

test('looseSignature matches pages that differ only by active state', () => {
  const pageA = '<header class="site-header"><nav><a class="nav-link is-active" aria-current="page">Home</a><a class="nav-link">Shop</a></nav></header>';
  const pageB = '<header class="site-header"><nav><a class="nav-link">Home</a><a class="nav-link is-active">Shop</a></nav></header>';
  assert.equal(looseSignature(pageA), looseSignature(pageB));
  assert.notEqual(looseSignature(pageA), looseSignature('<header class="other-header"><nav><a class="nav-link">Home</a></nav></header>'));
});

test('looseSignature is whitespace-insensitive like normalizeHtml', () => {
  assert.equal(
    looseSignature('<div class="a">\n  <span class="b">x</span>\n</div>'),
    looseSignature('<div class="a"> <span class="b">x</span> </div>')
  );
});
