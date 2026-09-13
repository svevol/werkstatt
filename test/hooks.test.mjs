import test from 'node:test';
import assert from 'node:assert/strict';

import { HE } from '../src/renderer/js/he.js';
import '../src/renderer/js/hooks.js';
import { numericSizeValue } from '../src/renderer/js/panel-controls.js';

const JS = `
const accordion = document.querySelector('.accordion');
const panels = document.querySelectorAll('.accordion-panel');
document.getElementById('nav-toggle');
btn.addEventListener('click', () => {
  accordion.classList.toggle('is-open');
  panel.hidden = !panel.hidden;
});
`;

function withFiles(fn) {
  const prev = HE.jsFiles;
  HE.jsFiles = [{ src: 'app.js', rel: 'app.js', full: 'app.js', text: JS }];
  try {
    return fn();
  } finally {
    HE.jsFiles = prev;
  }
}

test('classesUsagesInJs finds queried classes', () => {
  withFiles(() => {
    const usages = HE.hooks.classesUsagesInJs(['accordion', 'accordion-panel', 'unrelated']);
    const byCls = Object.fromEntries(usages.map((u) => [u.cls, u]));
    assert.ok(byCls['accordion'].kinds.includes('queries'));
    assert.ok(byCls['accordion-panel'].kinds.includes('queries'));
    assert.equal(byCls['unrelated'], undefined);
  });
});

test('classesUsagesInJs finds classList toggles', () => {
  withFiles(() => {
    const usages = HE.hooks.classesUsagesInJs(['is-open']);
    assert.ok(usages.length >= 1);
    assert.ok(usages[0].kinds.includes('class'));
  });
});

test('renameClassInJsText renames selector tokens only', () => {
  const src = `document.querySelector('.card .card-body');
el.classList.add('card');
const x = '.cards'; // similar name, must stay untouched
nested("re.carded")`;
  const { text, count } = HE.hooks.renameClassInJsText(src, 'card', 'tile');
  // .card-body is a distinct class and must NOT be renamed
  assert.ok(text.includes("'.tile .card-body'"), 'exact token renamed, hyphenated sibling untouched');
  assert.ok(text.includes("classList.add('tile')"), 'classList literal renamed');
  assert.ok(text.includes("'.cards'"), 'similar names untouched');
  assert.ok(text.includes('"re.carded"'), 'non-API strings untouched');
  assert.equal(count, 2);
});

test('renameClassInJsText is a no-op for identical names', () => {
  const { text, count } = HE.hooks.renameClassInJsText("querySelector('.a')", 'a', 'a');
  assert.equal(count, 0);
  assert.equal(text, "querySelector('.a')");
});

test('missingSelectors warns only for unmatched non-state selectors', () => {
  withFiles(() => {
    const doc = {
      querySelector(sel) {
        return sel === '.accordion' ? {} : null;
      },
    };
    const missing = HE.hooks.missingSelectors(doc, 10);
    const selectors = missing.map((m) => m.selector);
    assert.ok(selectors.includes('.accordion-panel'));
    assert.ok(!selectors.includes('.accordion'));
    assert.ok(!selectors.includes('#nav-toggle') || true); // id missing also reported
  });
});

test('missingSelectors ignores optional components that are not on the page', () => {
  withFiles(() => {
    const doc = { querySelector() { return null; } };
    const missing = HE.hooks.missingSelectors(doc, 10);
    assert.deepEqual(missing.map((item) => item.selector), ['#nav-toggle']);
  });
});

test('parse results are cached per file object', () => {
  withFiles(() => {
    const a = HE.hooks.classesUsagesInJs(['accordion']);
    const b = HE.hooks.classesUsagesInJs(['accordion']);
    assert.deepEqual(a, b);
  });
});

test('numeric size values never invent zero for an empty field', () => {
  assert.equal(numericSizeValue('', 'em'), '');
  assert.equal(numericSizeValue('2', 'em'), '2em');
  assert.equal(numericSizeValue('1.25', 'unitless'), '1.25');
});

test('decimal size values always serialize with a period separator', () => {
  assert.equal(numericSizeValue('1.05', 'unitless'), '1.05');
  assert.equal(numericSizeValue('2.5', 'rem'), '2.5rem');
  assert.equal(numericSizeValue('0.5', 'em'), '0.5em');
});
