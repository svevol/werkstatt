// Panel core — selection state, active selector resolution and cascade origin
// tracking shared by the panel controls and sections.

import { HE } from './he.js';
import { h } from './dom.js';
import { isValidClassToken, viewportMediaFor, viewportLabel } from './util.js';

export const state = {
  activeClass: null, // base class (e.g. 'btn')
  activeCombo: null, // combo class (e.g. 'large' -> selector '.btn.large'), visual-builder-style
  pseudo: '', // '', ':hover', ':focus', ':active', ':visited'
  pendingClass: null, // { elm, suggestion, styles: [{prop, value}] }
  // Matching-rules picker: when set, the panel edits this exact CSSRule
  // object (descendant/attribute/media/layer/nested) instead of a class scope.
  activeRule: null, // display selector
  activeRuleRule: null, // CSSStyleRule object
  activeRuleMedia: '', // enclosing @media condition ('' = top level)
  activeRuleElm: null, // selection the rule was picked for
};

export function activeRuleValid() {
  try {
    return !!(state.activeRule && state.activeRuleRule && activeSheet() &&
      state.activeRuleRule.parentStyleSheet === activeSheet().sheet);
  } catch {
    return false;
  }
}

// Leave the matching-rules picker (selection changed, rule deleted, renamed…).
export function clearRuleScope() {
  state.activeRule = null;
  state.activeRuleRule = null;
  state.activeRuleMedia = '';
  state.activeRuleElm = null;
}

export function activeBase() {
  return state.activeClass || null;
}

export function activeComboName() {
  return state.activeCombo || null;
}

// Compound combo selector without sim/pseudo, e.g. '.btn.large' or '.btn' or null.
export function comboSelector() {
  if (!state.activeClass) return null;
  if (state.activeCombo) return '.' + state.activeClass + '.' + state.activeCombo;
  return '.' + state.activeClass;
}

export function isComboActive() {
  return !!(state.activeClass && state.activeCombo);
}

export function activeEl() {
  return HE.canvas.selected;
}

export function activeSheet() {
  return HE.sheet;
}

export function simSuffix() {
  try {
    const elm = activeEl();
    if (!elm || !HE.canvas || !HE.canvas.getSimulation) return '';
    const sim = HE.canvas.getSimulation();
    if (!sim || !sim.elm || sim.elm !== elm) return '';
    let out = '';
    // Simulated classes currently present contribute to the compound selector,
    // e.g. .accordion + preview .is-open -> .accordion.is-open
    for (const cls of sim.classes || []) {
      try {
        if (!elm.classList.contains(cls)) continue;
        if (state.activeClass && cls === state.activeClass) continue;
        if (isValidClassToken(cls)) out += '.' + cls;
      } catch { /* ignore */ }
    }
    // Simulated visual attrs currently present, e.g. [aria-selected="true"]
    for (const name of sim.attrs || []) {
      try {
        if (!elm.hasAttribute || !elm.hasAttribute(name)) continue;
        const v = elm.getAttribute(name);
        if (name === 'hidden' || name === 'open') out += `[${name}]`;
        else out += `[${name}="${String(v == null ? '' : v).replace(/"/g, '&quot;')}"]`;
      } catch { /* ignore */ }
    }
    return out;
  } catch {
    return '';
  }
}

export function activeSelector() {
  if (state.activeRule) return state.activeRule + state.pseudo;
  const sim = simSuffix();
  if (state.activeClass && state.activeCombo) {
    return '.' + state.activeClass + '.' + state.activeCombo + sim + state.pseudo;
  }
  if (state.activeClass) return '.' + state.activeClass + sim + state.pseudo;
  // No base class but previewing a state (e.g. bare .is-open just added):
  // edit the simulated compound directly.
  if (sim) return sim + state.pseudo;
  return null;
}

// Base single-class selector for the current scope (combo falls back here).
export function activeBaseSelector() {
  if (state.activeRule) return null;
  if (!state.activeClass) return null;
  return '.' + state.activeClass + simSuffix() + state.pseudo;
}

export function scopeLabel() {
  if (state.activeRule) return state.activeRule;
  if (state.activeClass && state.activeCombo) return '.' + state.activeClass + '.' + state.activeCombo;
  if (state.activeClass) return '.' + state.activeClass;
  return '';
}

export function computed(prop) {
  const elm = activeEl();
  if (!elm || state.pseudo) return '';
  return HE.canvas.doc.defaultView.getComputedStyle(elm).getPropertyValue(prop);
}

export function viewportMedia() {
  try {
    if (HE.viewportMedia) return HE.viewportMedia() || '';
    return viewportMediaFor(HE.viewport);
  } catch {
    return '';
  }
}

export function displayValue(sel, prop) {
  if (!sel) return { declared: '', value: '', base: '', isOverride: false, media: viewportMedia() };
  // Picked matching rule: read declarations straight from the CSSRule object
  // (works for descendant/attribute/media/layer/nested rules alike).
  if (state.activeRule) {
    const baseRule = state.activeRuleRule;
    if (!activeRuleValid() || !baseRule) {
      return { declared: '', value: '', base: '', isOverride: false, media: '', rule: true };
    }
    let rule = baseRule;
    if (state.pseudo) {
      let variant = null;
      try { variant = activeSheet().ruleVariant(baseRule, state.pseudo); } catch { variant = null; }
      if (variant) rule = variant;
    }
    let declared = '';
    try { declared = activeSheet().declOn(rule, prop); } catch { declared = ''; }
    if (rule !== baseRule && !declared) {
      let base = '';
      try { base = activeSheet().declOn(baseRule, prop); } catch { base = ''; }
      return { declared: '', value: '', base, isOverride: false, media: state.activeRuleMedia || '', rule: true };
    }
    if (/var\(/i.test(declared)) {
      return {
        declared,
        value: computed(prop) || declared,
        base: declared,
        isOverride: false,
        media: state.activeRuleMedia || '',
        rule: true,
      };
    }
    return { declared, value: declared, base: declared, isOverride: false, media: state.activeRuleMedia || '', rule: true };
  }
  const media = viewportMedia();
  // Combo fallback: '.a.b' inherits from '.a' when the compound has no value.
  // Exposed as `base` so controls can show "from base" placeholders.
  const comboBaseFor = (s) => {
    const m = String(s || '').match(/^\.([A-Za-z_-][\w-]*)\.([A-Za-z_-][\w-]*)(.*)$/);
    if (!m) return '';
    return '.' + m[1] + (m[3] || '');
  };
  if (media && activeSheet() && typeof activeSheet().getMedia === 'function') {
    let override = '';
    try { override = activeSheet().getMedia(sel, prop, media); } catch { override = ''; }
    let base = '';
    try { base = activeSheet().get(sel, prop); } catch { base = ''; }
    // No desktop value on the compound itself -> fall back to the base class.
    if (!base) {
      const cb = comboBaseFor(sel);
      if (cb) { try { base = activeSheet().get(cb, prop); } catch { /* ignore */ } }
    }
    const declared = override;
    if (/var\(/i.test(declared)) {
      return { declared, value: computed(prop) || declared, base, isOverride: true, media };
    }
    // Empty override inherits base; value shown is override, placeholder uses base.
    return { declared, value: declared, base, isOverride: true, media };
  }
  const declared = activeSheet() ? (() => { try { return activeSheet().get(sel, prop); } catch { return ''; } })() : '';
  if (/var\(/i.test(declared)) {
    return { declared, value: computed(prop) || declared, base: declared, isOverride: false, media: '' };
  }
  if (!declared) {
    const cb = comboBaseFor(sel);
    if (cb && activeSheet()) {
      let baseVal = '';
      try { baseVal = activeSheet().get(cb, prop); } catch { baseVal = ''; }
      if (baseVal) return { declared: '', value: '', base: baseVal, isOverride: false, media: '', comboBase: cb };
    }
  }
  return { declared, value: declared, base: declared, isOverride: false, media: '' };
}

export function computedRaw(prop) {
  const elm = activeEl();
  if (!elm) return '';
  try {
    return elm.ownerDocument.defaultView.getComputedStyle(elm).getPropertyValue(prop);
  } catch {
    return '';
  }
}

// Which single-class selector on the element provides `prop`?
// Uses HE.sheet.get for each class in elm.classList (stylesheet-last wins
// via sheet.originFor). Unresolved values stay unlabelled because computed
// styles do not identify whether a value came from a global rule or a browser
// default, and neither is an active class change.
// The active base + combo are excluded — they are handled by cascadeOrigin.
export function otherClassOrigin(prop, pseudo) {
  const elm = activeEl();
  if (!elm) return '';
  const names = [...elm.classList].filter((c) => c !== state.activeClass && c !== state.activeCombo);
  if (!names.length) return '';
  const media = viewportMedia();
  if (media && activeSheet() && typeof activeSheet().getMedia === 'function') {
    // Viewport override wins over base: last override in stylesheet order.
    let winner = '';
    try {
      if (typeof activeSheet().originForMedia === 'function') {
        const w = activeSheet().originForMedia(names, prop, pseudo || '', media);
        if (w) return w;
      }
    } catch { /* fallback below */ }
    for (const name of names) {
      try {
        const sel = `.${name}${pseudo || ''}`;
        if (activeSheet().getMedia(sel, prop, media)) winner = sel;
      } catch { /* ignore */ }
    }
    if (winner) return winner;
    // No override — fall through to base below via callers.
    return '';
  }
  if (activeSheet() && typeof activeSheet().originFor === 'function') {
    try {
      return activeSheet().originFor(names, prop, pseudo || '') || '';
    } catch {
      return '';
    }
  }
  for (const name of names) {
    try {
      if (activeSheet().get(`.${name}${pseudo || ''}`, prop)) return `.${name}${pseudo || ''}`;
    } catch {
      /* ignore */
    }
  }
  return '';
}

export function baseOrigin(prop) {
  const elm = activeEl();
  if (!elm) return { origin: '', kind: 'none' };
  const baseSel = state.activeClass ? `.${state.activeClass}` : null;
  if (baseSel) {
    let declared = '';
    try {
      declared = displayValue(baseSel, prop).declared;
    } catch {
      declared = '';
    }
    if (declared) return { origin: baseSel, kind: 'active' };
  }
  const other = otherClassOrigin(prop, '');
  if (other) return { origin: other, kind: 'other' };
  return { origin: '', kind: 'none' };
}

export function cascadeOrigin(prop) {
  const elm = activeEl();
  if (!elm) return { origin: '', kind: 'none' };
  // Picked matching rule: declare/quiet only — no cross-selector claims.
  if (state.activeRule) {
    let declared = '';
    try { declared = displayValue(activeSelector(), prop).declared; } catch { declared = ''; }
    if (declared) {
      const suffix = state.activeRuleMedia ? ` @${viewportLabel(state.activeRuleMedia)}` : '';
      return { origin: state.activeRule + suffix, kind: 'active' };
    }
    return { origin: '', kind: 'none' };
  }
  const pseudo = state.pseudo || '';
  const comboSel = (state.activeClass && state.activeCombo)
    ? '.' + state.activeClass + '.' + state.activeCombo : null;
  const baseSel = state.activeClass ? '.' + state.activeClass : null;
  const getVal = (sel) => {
    try { return activeSheet() ? activeSheet().get(sel, prop) : ''; }
    catch { return ''; }
  };
  if (pseudo) {
    // 1. most specific: combo + pseudo, then base + pseudo
    if (comboSel) {
      const cp = comboSel + pseudo;
      if (getVal(cp)) return { origin: cp, kind: 'active-pseudo' };
    }
    if (baseSel) {
      const bp = baseSel + pseudo;
      if (getVal(bp)) {
        // Editing a combo but the value comes from the base pseudo rule.
        if (comboSel) return { origin: bp, kind: 'active-base', base: true };
        return { origin: bp, kind: 'active-pseudo' };
      }
    }
    const otherPseudo = otherClassOrigin(prop, pseudo);
    if (otherPseudo) return { origin: otherPseudo, kind: 'other-pseudo' };
    // 2. fall back to non-pseudo base/compound so the label reads "(base)".
    if (comboSel && getVal(comboSel)) return { origin: comboSel, kind: 'active-base', base: true };
    const base = baseOrigin(prop);
    if (base.origin) return { origin: base.origin, kind: `${base.kind}-base`, base: true };
    return { origin: '', kind: 'none' };
  }
  const sel = activeSelector();
  let declared = '';
  try {
    declared = displayValue(sel, prop).declared;
  } catch {
    declared = '';
  }
  if (declared) return { origin: sel, kind: 'active' };
  // Editing a combo with no override: the base rule provides the value.
  if (comboSel && baseSel) {
    if (getVal(baseSel)) return { origin: baseSel, kind: 'active-base', base: true };
    // Also consider base + sim suffix (e.g. .btn.is-open provides for .btn.large.is-open).
    try {
      const baseSim = activeBaseSelector();
      if (baseSim && baseSim !== sel && activeSheet().get(baseSim, prop)) {
        return { origin: baseSim, kind: 'active-base', base: true };
      }
    } catch { /* ignore */ }
  }
  const other = otherClassOrigin(prop, '');
  if (other) return { origin: other, kind: 'other' };
  return { origin: '', kind: 'none' };
}

export function originLabelText(prop) {
  if (state.activeRule) {
    const info = cascadeOrigin(prop);
    return info.origin || '—';
  }
  const media = viewportMedia();
  const info = cascadeOrigin(prop);
  const suffix = (media && HE.viewport && HE.viewport !== 'desktop') ? ` @${viewportLabel(HE.viewport)}` : '';
  // Combo scope is a diff view: only what the variant itself declares gets
  // a label. Missing declarations stay quiet in every scope; actual class
  // origins remain available where they are useful.
  if (state.activeClass && state.activeCombo) {
    if (info.kind === 'active' || info.kind === 'active-pseudo') return info.origin + suffix;
    return '—';
  }
  if (!info.origin) {
    if (media && HE.viewport !== 'desktop') return `no override — inherits desktop`;
    return state.pseudo ? `not set for ${state.pseudo}` : '—';
  }
  if (info.kind === 'active') return info.origin + suffix;
  if (info.kind === 'other') return `← ${info.origin}${suffix}`;
  if (info.kind === 'active-pseudo') return info.origin + suffix;
  if (info.kind === 'other-pseudo') return `← ${info.origin}${suffix}`;
  if (info.base) {
    if (info.kind === 'active-base') return `← ${info.origin} (base)`;
    if (info.kind === 'other-base') return `← ${info.origin} (base)`;
  }
  return info.origin + suffix;
}

export function originEl(prop) {
  const info = cascadeOrigin(prop);
  const label = h('div', { class: 'origin-label', 'data-origin-kind': info.kind || 'none' });
  label.textContent = originLabelText(prop);
  if (state.activeRule) {
    label.title = info.origin
      ? `Declared by ${info.origin}`
      : `Not set on ${state.activeRule}${state.pseudo || ''} — typing writes it here`;
    return label;
  }
  const comboSel = (state.activeClass && state.activeCombo)
    ? '.' + state.activeClass + '.' + state.activeCombo : null;
  if (comboSel && label.textContent === '—') {
    // Quiet dash in combo scope: explain where the value comes from.
    if (info.origin) {
      label.title = `Not set on ${comboSel}${state.pseudo || ''} — ${info.origin} applies; typing overrides it on the variant`;
    } else {
      const raw = (() => { try { return (computedRaw(prop) || '').trim(); } catch { return ''; } })();
      label.title = raw
        ? `Not set on ${comboSel}${state.pseudo || ''} (browser default: ${raw}); typing creates the variant override`
        : `Not set on ${comboSel}${state.pseudo || ''}; typing creates the variant override`;
    }
    return label;
  }
  if (info.origin) {
    label.title = `Provided by ${info.origin}`;
  } else {
    label.title = state.pseudo
      ? `No ${state.pseudo} rule sets this — editing creates one on ${activeSelector() || 'a new class'}`
      : 'No class sets this yet';
  }
  return label;
}

export function withOrigin(prop, control) {
  const wrap = h('div', { class: 'prow-field' });
  wrap.append(control, originEl(prop));
  return wrap;
}

export function classUseCount(cls) {
  try {
    const doc = HE.canvas && HE.canvas.doc;
    if (!doc || !doc.querySelectorAll) return 0;
    return doc.querySelectorAll(`.${CSS.escape(cls)}`).length;
  } catch {
    try {
      const doc = HE.canvas && HE.canvas.doc;
      return doc.querySelectorAll('.' + cls).length;
    } catch { return 0; }
  }
}

// Elements carrying ALL classes of a compound selector, e.g. '.btn.large'.
// Returns 0 when the selector is not a plain class compound.
export function compoundUseCount(selector) {
  try {
    const doc = HE.canvas && HE.canvas.doc;
    if (!doc || !doc.querySelectorAll || !selector) return 0;
    if (!/^\.[A-Za-z_-][\w-]*(\.[A-Za-z_-][\w-]*)+$/.test(String(selector).trim())) return 0;
    return doc.querySelectorAll(String(selector).trim()).length;
  } catch { return 0; }
}
