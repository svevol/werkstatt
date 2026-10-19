import test from 'node:test';
import assert from 'node:assert/strict';

import { patchCssText } from '../src/renderer/js/sheetpatch.js';

// Faithful CSSOM stand-ins, mirroring what Chromium actually reports
// (verified with an Electron probe against the bundled Chromium):
// - indexed style access EXPANDS shorthands into longhands;
// - var() shorthands report EMPTY longhand values when indexed;
// - style.cssText keeps the authored shape (shorthands, var() intact);
// - CSSMediaRule exposes conditionText + media.mediaText, NOT .mediaText;
// - keyframe children serialize from/to as 0%/100% via keyText.
// The indexed entries below are traps: the implementation must read cssText
// only. Under the old iterate-the-style approach every one of these tests
// fails (exploded shorthands, emptied var() values, @media fallback).
function stubStyle(cssText, indexed) {
  const style = { cssText };
  const items = (indexed || []).map(([prop, value, pri]) => ({
    prop,
    value: value == null ? '' : value,
    pri: pri || '',
  }));
  Object.defineProperty(style, 'length', { get: () => items.length });
  items.forEach((entry, i) => Object.defineProperty(style, i, { get: () => entry.prop }));
  style.item = (i) => (items[i] ? items[i].prop : null);
  const find = (p) => items.find((e) => e.prop.toLowerCase() === String(p).toLowerCase());
  style.getPropertyValue = (p) => {
    const e = find(p);
    return e ? e.value : '';
  };
  style.getPropertyPriority = (p) => {
    const e = find(p);
    return e && e.pri ? e.pri : '';
  };
  return style;
}

function stubRule(selector, cssText, indexed) {
  return { selectorText: selector, style: stubStyle(cssText, indexed) };
}

function expandedShorthand() {
  return [
    ['margin-top', '0px'],
    ['margin-right', 'auto'],
    ['margin-bottom', '0px'],
    ['margin-left', 'auto'],
    ['color', 'red'],
  ];
}

test('patchCssText keeps untouched formatting byte for byte', () => {
  const original = [
    '/* brand header */',
    '.hero {',
    '   padding: 0;',
    '',
    '   margin: 0 auto;',
    '   color: red; /* keep me */',
    '}',
    '',
    '.sub {',
    '\tfont-size: 22px;',
    '}',
    '',
  ].join('\n');
  const cssom = {
    cssRules: [
      stubRule('.hero', 'padding: 0px; margin: 0px auto; color: red;', [
        ['padding-top', '0px'],
        ['padding-right', '0px'],
        ['padding-bottom', '0px'],
        ['padding-left', '0px'],
        ...expandedShorthand(),
      ]),
      stubRule('.sub', 'font-size: 22px;', [['font-size', '22px']]),
    ],
  };
  const patched = patchCssText(original, cssom);
  assert.equal(patched, original, 'untouched stylesheet stays byte-identical');
});

test('patchCssText rewrites only the changed block, keeps shorthands and neighbors', () => {
  const original = [
    '/* brand header */',
    '.hero {',
    '   margin: 0 auto;',
    '   color: red;',
    '}',
    '',
    '/* about section */',
    '.sub {',
    '\tfont-size: 22px;',
    '}',
  ].join('\n');
  const cssom = {
    cssRules: [
      stubRule('.hero', 'margin: 1.5rem auto; color: red;', [
        ['margin-top', '1.5rem'],
        ['margin-right', 'auto'],
        ['margin-bottom', '1.5rem'],
        ['margin-left', 'auto'],
        ['color', 'red'],
      ]),
      stubRule('.sub', 'font-size: 22px;', [['font-size', '22px']]),
    ],
  };
  const patched = patchCssText(original, cssom);
  assert.match(patched, /\/\* brand header \*\//);
  assert.match(patched, /\/\* about section \*\//);
  assert.equal(patched.split('\n').filter((l) => l.includes('font-size: 22px;')).length, 1);
  // The changed block re-emitted with its shorthand intact (never exploded
  // into margin-top/… longhands) and its own 3-space indent.
  assert.match(patched, /\.hero \{\n {3}margin: 1\.5rem auto;\n {3}color: red;\n\}/);
  assert.ok(!patched.includes('margin-top'), 'shorthand must not explode into longhands');
  assert.ok(!patched.includes('padding'), 'no stray declarations');
  // No blank-line drift: one splice must not grow the gaps around it.
  assert.ok(!patched.includes('\n\n\n'), 'rewritten block added a blank line');
  assert.ok(patched.endsWith('}'), 'file ending preserved');
  const diffCount = patched.split('\n').filter((line, i) => line !== original.split('\n')[i]).length;
  assert.ok(diffCount <= 6, 'diff stays small: ' + diffCount);
});

test('patchCssText preserves var() shorthands instead of emptying them', () => {
  const original = '.b {\n  margin: var(--m);\n  color: var(--c, blue);\n}';
  const cssom = {
    // Indexed access reports the expansion with EMPTY values (pending
    // substitution) — cssText keeps the authored tokens.
    cssRules: [
      stubRule('.b', 'margin: var(--m); color: var(--c, blue);', [
        ['margin-top', ''],
        ['margin-right', ''],
        ['margin-bottom', ''],
        ['margin-left', ''],
        ['color', 'var(--c, blue)'],
      ]),
    ],
  };
  const patched = patchCssText(original, cssom);
  assert.equal(patched, original, 'var() shorthand must survive byte-identical');
});

test('patchCssText preserves nested media blocks and their siblings', () => {
  const original = [
    '.wrap { padding: 0 1rem; }',
    '',
    '@media (max-width: 768px) {',
    '  .wrap {',
    '    padding: 0;',
    '  }',
    '}',
  ].join('\n');
  const cssom = {
    cssRules: [
      stubRule('.wrap', 'padding: 0px 1rem;', [
        ['padding-top', '0px'],
        ['padding-right', '1rem'],
        ['padding-bottom', '0px'],
        ['padding-left', '1rem'],
      ]),
      {
        // Faithful shape: conditionText + media.mediaText, no .mediaText.
        constructor: { name: 'CSSMediaRule' },
        conditionText: '(max-width: 768px)',
        media: { mediaText: '(max-width: 768px)' },
        cssRules: [stubRule('.wrap', 'padding: 0px; color: #111;', [
          ['padding-top', '0px'],
          ['padding-right', '0px'],
          ['padding-bottom', '0px'],
          ['padding-left', '0px'],
          ['color', 'rgb(17, 17, 17)'],
        ])],
      },
    ],
  };
  const patched = patchCssText(original, cssom);
  assert.match(patched, /\.wrap \{ padding: 0 1rem; \}/, 'untouched top rule preserved with its own spacing');
  assert.match(patched, /padding: 0px;\n {4}color: #111;/, 'changed nested block re-emitted');
  assert.match(patched, /@media \(max-width: 768px\) \{/);
  assert.match(patched, /\n {2}\}\n\}/, 'nested closing brace keeps its indent');
});

test('patchCssText aligns from/to keyframes with 0%/100%', () => {
  const original = '@keyframes spin {\n  from {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}';
  const cssom = {
    cssRules: [
      {
        constructor: { name: 'CSSKeyframesRule' },
        name: 'spin',
        cssRules: [
          { constructor: { name: 'CSSKeyframeRule' }, keyText: '0%', style: stubStyle('opacity: 0;', [['opacity', '0']]) },
          { constructor: { name: 'CSSKeyframeRule' }, keyText: '100%', style: stubStyle('opacity: 1;', [['opacity', '1']]) },
        ],
      },
    ],
  };
  assert.equal(patchCssText(original, cssom), original);
});

test('patchCssText falls back to null (wholesale) when the rule trees diverge', () => {
  const original = '.a { color: red; }';
  const cssom = {
    cssRules: [
      stubRule('.a', 'color: red;', [['color', 'red']]),
      stubRule('.b-new', 'color: blue;', [['color', 'blue']]),
    ],
  };
  assert.equal(patchCssText(original, cssom), null);
});

test('patchCssText carries leading at-rules without blocks verbatim', () => {
  const original = '@import "fonts.css";\n.a { color: red; }';
  const cssom = {
    cssRules: [stubRule('.a', 'color: red;', [['color', 'red']])],
  };
  // The @import line rides in the first block's prelude, which is re-emitted
  // verbatim — nothing to splice, so the text stays byte-identical.
  assert.equal(patchCssText(original, cssom), original);
  const changed = {
    cssRules: [stubRule('.a', 'color: blue;', [['color', 'blue']])],
  };
  const patched = patchCssText(original, changed);
  assert.match(patched, /^@import "fonts\.css";\n\.a \{\n color: blue;\n\}$/);
});

test('patchCssText treats zeroed lengths as equal so untouched blocks stay', () => {
  const original = '.hero {\n  margin: 0;\n  padding: 0 4rem;\n  width: .5em;\n}';
  const cssom = {
    cssRules: [
      stubRule('.hero', 'margin: 0px; padding: 0px 4rem; width: 0.5em;', [
        ['margin-top', '0px'],
        ['margin-right', '0px'],
        ['margin-bottom', '0px'],
        ['margin-left', '0px'],
        ['padding-top', '0px'],
        ['padding-right', '4rem'],
        ['padding-bottom', '0px'],
        ['padding-left', '4rem'],
        ['width', '0.5em'],
      ]),
    ],
  };
  assert.equal(patchCssText(original, cssom), original);
});
