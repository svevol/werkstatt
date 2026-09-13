import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeRegExp, escapeHtml, escapeAttr,
  isValidClassToken, viewportMediaFor, VIEWPORT_MEDIA,
  mediaMaxWidthPx, viewportLabel, selectorSpecificity,
  splitSelectorList, removeClassFromSelectorList,
  neutralizeEditHtml,
} from '../src/renderer/js/util.js';

test('escapeRegExp escapes regex metacharacters', () => {
  const raw = 'a.b*c?d[e]f(g)h{i}j$k^l|m\\n';
  const re = new RegExp('^' + escapeRegExp(raw) + '$');
  assert.ok(re.test(raw));
  assert.ok(!re.test('axb'));
});

test('escapeHtml escapes the four HTML specials', () => {
  assert.equal(escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('escapeAttr escapes attribute specials', () => {
  assert.equal(escapeAttr('a"b<c&d'), 'a&quot;b&lt;c&amp;d');
});

test('isValidClassToken accepts kebab/BEM tokens, rejects bad shapes', () => {
  assert.ok(isValidClassToken('hero'));
  assert.ok(isValidClassToken('hero__title--large'));
  assert.ok(isValidClassToken('-private'));
  assert.ok(isValidClassToken('Hero')); // shape-valid; kebab policy enforced elsewhere
  assert.ok(!isValidClassToken(''));
  assert.ok(!isValidClassToken('1abc'));
  assert.ok(!isValidClassToken('a b'));
  assert.ok(!isValidClassToken(null));
});

test('viewportMediaFor maps viewports to media queries', () => {
  assert.equal(viewportMediaFor('desktop'), '');
  assert.equal(viewportMediaFor('tablet'), '(max-width: 768px)');
  assert.equal(viewportMediaFor('mobile'), '(max-width: 375px)');
  assert.equal(viewportMediaFor('unknown'), '');
  assert.equal(VIEWPORT_MEDIA.tablet, '(max-width: 768px)');
});

test('mediaMaxWidthPx reads custom breakpoint widths', () => {
  assert.equal(mediaMaxWidthPx('(max-width: 1024px)'), 1024);
  assert.equal(mediaMaxWidthPx('( max-width : 640.5px )'), 640.5);
  assert.equal(mediaMaxWidthPx('screen and (max-width: 992px)'), 992);
  assert.equal(mediaMaxWidthPx('(min-width: 768px)'), null);
  assert.equal(mediaMaxWidthPx('(prefers-reduced-motion: reduce)'), null);
  assert.equal(mediaMaxWidthPx(''), null);
});

test('viewportLabel names presets and custom conditions', () => {
  assert.equal(viewportLabel('desktop'), 'desktop');
  assert.equal(viewportLabel('tablet'), 'tablet');
  assert.equal(viewportLabel('(max-width: 1024px)'), '≤1024px');
  assert.equal(viewportLabel('weird'), 'weird');
});

test('selectorSpecificity ranks ids over classes over elements', () => {
  assert.ok(selectorSpecificity('#x') > selectorSpecificity('.a.b'));
  assert.ok(selectorSpecificity('.a.b') > selectorSpecificity('.a'));
  assert.ok(selectorSpecificity('.a') > selectorSpecificity('div'));
  assert.ok(selectorSpecificity('div .a') > selectorSpecificity('div'));
  assert.equal(selectorSpecificity('.a .b'), selectorSpecificity('.b .a'));
  assert.equal(selectorSpecificity('[data-x="1"]'), selectorSpecificity('.a'));
});

test('neutralizeEditHtml renames event handler attributes', () => {
  const out = neutralizeEditHtml('<img src="x.png" onerror="alert(1)"><div ONCLICK="go()">t</div>');
  assert.ok(out.includes('data-he-onerror="alert(1)"'));
  assert.ok(out.includes('data-he-onclick="go()"'));
  assert.ok(!/(^|[\s<])on(error|click)=/i.test(out.replace(/data-he-on/g, '')));
  assert.ok(out.includes('src="x.png"'));
});

test('neutralizeEditHtml neutralizes javascript: URLs incl. case, entities, embedded controls', () => {
  assert.ok(neutralizeEditHtml('<a href="javascript:alert(1)">x</a>').includes('data-he-href="javascript:alert(1)"'));
  assert.ok(neutralizeEditHtml('<a HREF="JaVaScRiPt:alert(1)">x</a>').includes('data-he-href='));
  assert.ok(neutralizeEditHtml('<a href="java\tscript:alert(1)">x</a>').includes('data-he-href='));
  assert.ok(neutralizeEditHtml('<a href="&#106;avascript:alert(1)">x</a>').includes('data-he-href='));
  assert.ok(neutralizeEditHtml('<form action="javascript:alert(1)">').includes('data-he-action='));
  // ordinary URLs are untouched
  const ok = neutralizeEditHtml('<a href="page.html">x</a><img src="a/b.png">');
  assert.ok(ok.includes('href="page.html"') && ok.includes('src="a/b.png"'));
  assert.ok(!ok.includes('data-he-'));
});

test('neutralizeEditHtml handles srcdoc, meta refresh, unquoted values', () => {
  assert.ok(neutralizeEditHtml('<iframe srcdoc="<p>hi</p>">').includes('data-he-srcdoc="<p>hi</p>"'));
  assert.ok(neutralizeEditHtml('<meta http-equiv="refresh" content="0;url=/">').includes('data-he-http-equiv="refresh"'));
  assert.ok(neutralizeEditHtml('<a href=javascript:alert(1)>x</a>').includes('data-he-href=javascript:alert(1)'));
  assert.ok(neutralizeEditHtml('<div title="turn it on">x</div>').includes('title="turn it on"'));
});

test('neutralizeEditHtml leaves raw-text bodies and comments byte-identical', () => {
  const tricky = '<script>var s = "<img onerror=alert(1)>";</script>' +
    '<style>.a{content:"onload=x"}</style>' +
    '<textarea><div onclick="x"></div></textarea>' +
    '<!-- <div onclick="ghost"> -->';
  assert.equal(neutralizeEditHtml(tricky), tricky);
  const quoted = '<div data-cond="a>b" title=\'c>d\'>x</div>';
  assert.equal(neutralizeEditHtml(quoted), quoted);
});

test('splitSelectorList splits only top-level commas', () => {
  assert.deepEqual(splitSelectorList('.a, .b:hover'), ['.a', '.b:hover']);
  assert.deepEqual(splitSelectorList('.a:is(.b, .c), .d'), ['.a:is(.b, .c)', '.d']);
  assert.deepEqual(splitSelectorList('[data-x="a,b"] .c'), ['[data-x="a,b"] .c']);
  assert.deepEqual(splitSelectorList(''), []);
});

test('removeClassFromSelectorList keeps sibling selectors', () => {
  const grouped = removeClassFromSelectorList('.a, .b:hover', 'a');
  assert.equal(grouped.matched, true);
  assert.equal(grouped.remaining, '.b:hover');

  const all = removeClassFromSelectorList('.a, .a:hover', 'a');
  assert.equal(all.matched, true);
  assert.equal(all.remaining, '');

  const untouched = removeClassFromSelectorList('.other, .also', 'a');
  assert.equal(untouched.matched, false);
  assert.equal(untouched.remaining, '.other, .also');

  // Substrings are not false positives.
  assert.equal(removeClassFromSelectorList('.about', 'a').matched, false);
  // The leading class of a compound is removed; the second class belongs to
  // the combo tools under the existing class-token semantics.
  assert.equal(removeClassFromSelectorList('.btn.large', 'btn').remaining, '');
  assert.equal(removeClassFromSelectorList('.btn.large', 'large').matched, false);
  assert.equal(removeClassFromSelectorList('.btn.large', 'large').remaining, '.btn.large');
  // Commas inside functional pseudos stay attached to their selector.
  assert.equal(removeClassFromSelectorList('.a:is(.x, .y), .b', 'a').remaining, '.b');
});
