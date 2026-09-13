// Panel — visual-builder-style right sidebar: selector/classes area, section shell
// with filter + persisted collapse state. Controls live in panel-controls.js,
// section builders in panel-sections.js, selector/origin logic in panel-core.js.

import { HE } from './he.js';
import { h } from './dom.js';
import { isValidClassToken, viewportLabel } from './util.js';
import { state, activeEl, activeSelector, classUseCount, compoundUseCount, viewportMedia, clearRuleScope } from './panel-core.js';
import {
  buildElementSection, buildSeoSection, buildContentSection,
  buildSharedSection, buildClassesSection, buildSiteTools, buildGlobalsSection,
  buildBehavior, buildAccessibility, buildSpacing, buildLayout, buildSize,
  buildPosition, buildTypography, buildBackground, buildBorder, buildEffects,
  buildCustomSection, buildRulesSection, buildSiteCheck, buildChangesSection,
} from './panel-sections.js';

const PANEL_OPEN_KEY = 'he-panel-open';
let panelOpen = {};
try { panelOpen = JSON.parse(localStorage.getItem(PANEL_OPEN_KEY) || '{}') || {}; } catch { panelOpen = {}; }
function persistPanelOpen() {
  try { localStorage.setItem(PANEL_OPEN_KEY, JSON.stringify(panelOpen)); } catch { /* ignore */ }
}
function sectionDefaultOpen(id) {
  return id === 'element';
}

function section(id, title, build) {
  const stored = (id in panelOpen) ? !!panelOpen[id] : sectionDefaultOpen(id);
  const det = h('details', { class: 'pset', 'data-sec': id });
  if (stored) det.setAttribute('open', '');
  det.append(h('summary', null, title));
  const body = h('div', { class: 'pset-body' });
  build(body);
  det.append(body);
  det.addEventListener('toggle', () => {
    panelOpen[id] = det.open;
    persistPanelOpen();
  });
  return det;
}

function applyPanelFilter(host, query) {
  const q = String(query || '').trim().toLowerCase();
  let shown = 0;
  for (const det of host.querySelectorAll('.pset')) {
    if (!q) { det.style.display = ''; shown++; continue; }
    const text = (det.textContent || '').toLowerCase();
    const match = text.includes(q);
    det.style.display = match ? '' : 'none';
    if (match) { det.setAttribute('open', ''); shown++; }
    // Inner disclosures (e.g. Outline inside Border) default closed —
    // open the ones holding the match so filtered controls are visible.
    // Never auto-close: an explicitly opened disclosure stays as the user left it.
    if (match) {
      for (const inner of det.querySelectorAll('details')) {
        if ((inner.textContent || '').toLowerCase().includes(q)) inner.setAttribute('open', '');
      }
    }
  }
  let hint = host.querySelector('.panel-filter-count');
  if (hint) hint.textContent = q ? `${shown} section${shown === 1 ? '' : 's'}` : '';
}

function buildPanelFilter(host) {
  const wrap = h('div', { class: 'panel-filter' });
  const input = h('input', { type: 'text', spellcheck: 'false', placeholder: 'Filter styles (e.g. shadow)…', 'aria-label': 'Filter panel sections' });
  const count = h('span', { class: 'panel-filter-count muted' });
  input.addEventListener('input', () => applyPanelFilter(host, input.value));
  input.addEventListener('keydown', (e) => e.stopPropagation());
  wrap.append(input, count);
  return wrap;
}

// ---------- class-name prompt ----------

function promptForClassName(elm, suggestion, prop, value) {
  if (!elm || !suggestion) return false;
  if (!HE.canvas || HE.canvas.mode !== 'edit') return false;
  if (state.pendingClass && state.pendingClass.elm === elm) {
    state.pendingClass.styles.push({ prop, value });
    renderPanel();
    focusPromptInput();
    return true;
  }
  // If a prompt is open for another element, flush it with its suggestion first.
  if (state.pendingClass) flushPendingWithSuggestion();
  state.pendingClass = { elm, suggestion, styles: [{ prop, value }] };
  renderPanel();
  focusPromptInput();
  return true;
}

function focusPromptInput() {
  const input = document.getElementById('panel')?.querySelector('.class-prompt-input');
  if (input) {
    input.focus();
    input.select();
  }
}

function flushPendingWithSuggestion() {
  const p = state.pendingClass;
  if (!p) return;
  state.pendingClass = null;
  try {
    if (p.elm && p.elm.isConnected !== false) {
      // Background flush: must not steal selection from the newly clicked element.
      HE.actions.createClassWithStyles(p.elm, p.suggestion, p.styles, { select: false });
    }
  } catch {
    /* auto path must not throw */
  }
}

function confirmClassPrompt(name) {
  const p = state.pendingClass;
  if (!p) return false;
  const host = document.getElementById('panel');
  const raw = typeof name === 'string' ? name : (host?.querySelector('.class-prompt-input') || {}).value || '';
  const checked = HE.actions.validateClassName(raw);
  if (!checked.ok) return false;
  state.pendingClass = null;
  HE.actions.createClassWithStyles(p.elm, checked.value, p.styles);
  return true;
}

function dismissClassPrompt() {
  const p = state.pendingClass;
  if (!p) return false;
  state.pendingClass = null;
  try {
    HE.actions.createClassWithStyles(p.elm, p.suggestion, p.styles);
  } catch {
    /* auto path must not throw */
  }
  return true;
}

function buildClassPrompt(area, pending) {
  const tag = (pending.elm.tagName || 'div').toLowerCase();
  const box = h('div', { class: 'class-prompt' });
  box.append(h('div', { class: 'class-prompt-title' }, `Name a class for <${tag}>`));
  const input = h('input', {
    type: 'text', spellcheck: 'false',
    class: 'class-prompt-input',
    'aria-label': 'New class name',
  });
  input.value = pending.suggestion;
  const error = h('div', { class: 'class-prompt-error', hidden: '' });
  const hint = h('div', { class: 'class-prompt-hint muted' }, 'kebab-case only · BEM: block__element--modifier allowed, no camelCase');
  const rowBtns = h('div', { class: 'selector-row' });
  const createBtn = h('button', { type: 'button', class: 'class-prompt-create' }, 'Create');
  const cancelBtn = h('button', { type: 'button', class: 'class-prompt-cancel', title: 'Dismiss and use suggestion' }, 'Cancel');
  const showError = (msg) => {
    if (!msg) error.hidden = true;
    else {
      error.textContent = msg;
      error.hidden = false;
    }
  };
  input.addEventListener('input', () => {
    const r = HE.actions.validateClassName(input.value);
    showError(r.ok ? '' : r.error);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = HE.actions.validateClassName(input.value);
      if (!confirmClassPrompt(input.value)) showError(r.error || 'Invalid name.');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismissClassPrompt();
    }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => {
    // Keep the prompt open on blur so tests and keyboard users can confirm;
    // dismissal is explicit via Cancel/Escape.
  });
  createBtn.addEventListener('click', () => {
    const r = HE.actions.validateClassName(input.value);
    if (!confirmClassPrompt(input.value)) {
      showError(r.error || 'Invalid name.');
      input.focus();
    }
  });
  cancelBtn.addEventListener('click', () => dismissClassPrompt());
  rowBtns.append(createBtn, cancelBtn);
  box.append(input, error, hint, rowBtns);
  area.append(box);
}

// ---------- selector area ----------

function buildSelectorArea(host) {
  const elm = activeEl();
  const area = h('div', { class: 'selector-area' });

  const pending = state.pendingClass;
  if (pending && pending.elm === elm) buildClassPrompt(area, pending);

  const chips = h('div', { class: 'class-chips' });
  let simSet = new Set();
  try {
    const sim = HE.canvas && HE.canvas.getSimulation ? HE.canvas.getSimulation() : null;
    if (sim && sim.elm === elm) simSet = new Set(sim.classes || []);
  } catch { /* ignore */ }
  for (const cls of elm.classList) {
    const isSim = simSet.has(cls);
    const isBase = cls === state.activeClass;
    const isCombo = cls === state.activeCombo;
    const chip = h('span', { class: 'chip' + (isBase ? ' on' : '') + (isCombo ? ' combo-on' : '') + (isSim ? ' sim' : ''), tabindex: '0', role: 'button', 'aria-pressed': (isBase || isCombo) ? 'true' : 'false', 'aria-label': `Edit class ${cls}` }, cls);
    const count = classUseCount(cls);
    chip.title = isSim
      ? `Preview-only .${cls} (not saved). Click chip to keep it for real, × to drop preview. Used on ${count} element${count === 1 ? '' : 's'}.`
      : `Click: edit as base · Double-click: rename · Used on ${count} element${count === 1 ? '' : 's'} (this page)`;
    const activateChip = () => {
      // Clicking a preview-only chip adopts it as a real class.
      if (isSim && HE.canvas && HE.canvas.noteRealClass) {
        try { HE.canvas.noteRealClass(cls); } catch { /* ignore */ }
      }
      state.activeClass = cls;
      if (state.activeCombo === cls) state.activeCombo = null;
      renderPanel();
    };
    chip.addEventListener('click', activateChip);
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateChip(); }
    });
    chip.addEventListener('dblclick', () => renameChip(chip, cls));
    const x = h('button', { type: 'button', class: 'x', title: `Remove ${cls} from element`, 'aria-label': `Remove ${cls} from element` }, '×');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      HE.actions.detachClass(cls);
    });
    chip.append(x);
    chips.append(chip);
  }
  area.append(chips);

  // Picked matching rule: concrete rule editing (descendant/attribute/media).
  if (state.activeRule) {
    const banner = h('div', { class: 'scope-banner rule' });
    const name = h('span', { class: 'rule-name', title: state.activeRule }, state.activeRule);
    const media = state.activeRuleMedia ? ` @ ${state.activeRuleMedia}` : '';
    banner.append(
      h('span', null, 'Editing rule '),
      name,
      h('span', { class: 'muted' }, `${media} — declarations go to this exact rule.`)
    );
    const back = h('button', { type: 'button', class: 'scope-del' }, 'Back to class scope');
    back.addEventListener('click', () => HE.actions.setRuleScope(null));
    banner.append(back);
    area.append(banner);
  }

  // ---------- editing scope: base vs combo (visual-builder-style) ----------
  // "Where am I": .btn edits everywhere, .btn.large edits only this variant.
  try {
    const base = state.activeClass;
    const combo = state.activeCombo;
    const others = [...elm.classList].filter((c) => c !== base);
    if (base) {
      const baseCount = classUseCount(base);
      const scopeWrap = h('div', { class: 'scope-wrap' });
      const seg = h('div', { class: 'seg scope-seg', role: 'group', 'aria-label': 'Editing scope' });
      const baseBtn = h('button', { type: 'button', class: !combo ? 'on' : '', title: `Edit .${base} — affects all ${baseCount} element(s) with this class` }, `.${base}`);
      baseBtn.addEventListener('click', () => HE.actions.setScope('base'));
      seg.append(baseBtn);
      if (combo) {
        const comboSel = `.${base}.${combo}`;
        const comboCount = compoundUseCount(comboSel);
        const comboBtn = h('button', { type: 'button', class: 'on', title: `Edit ${comboSel} — affects only the ${comboCount} element(s) with both classes` }, comboSel);
        comboBtn.addEventListener('click', () => HE.actions.setScope('combo'));
        seg.append(comboBtn);
      } else if (others.length) {
        // Quick-pick: turn another class on this element into the combo.
        const pick = h('select', { class: 'scope-pick', title: 'Edit a combo with another class on this element', 'aria-label': 'Edit combo variant' });
        pick.append(h('option', { value: '' }, '+ combo…'));
        for (const c of others) {
          const o = h('option', { value: c }, `.${base}.${c}`);
          pick.append(o);
        }
        pick.addEventListener('change', () => {
          if (pick.value) HE.actions.setScope('combo', pick.value);
        });
        seg.append(pick);
      }
      scopeWrap.append(seg);
      // Where-am-I banner.
      if (combo) {
        const comboSel = `.${base}.${combo}`;
        const n = compoundUseCount(comboSel);
        const banner = h('div', { class: 'scope-banner combo' },
          `Editing ${comboSel} — variant only (${n} element${n === 1 ? '' : 's'} with both classes). Only what you change here is listed below.`);
        const delCombo = h('button', { type: 'button', class: 'scope-del', title: `Delete only ${comboSel} styles (keep classes + base styles)` }, 'Delete variant styles');
        delCombo.addEventListener('click', () => {
          if (confirm(`Delete only ${comboSel} styles? .${base} stays.`)) HE.actions.deleteComboStyles();
        });
        banner.append(delCombo);
        scopeWrap.append(banner);
      } else {
        scopeWrap.append(h('div', { class: 'scope-banner base muted' },
          `Editing .${base} — base class (${baseCount} element${baseCount === 1 ? '' : 's'}). Add a variant below to change only this element.`));
      }
      area.append(scopeWrap);
      // Add-variant row: second class that only matters together with the base.
      const vRow = h('div', { class: 'selector-row variant-row' });
      const vInput = h('input', { type: 'text', spellcheck: 'false', placeholder: 'Variant name, e.g. large…', 'aria-label': 'New variant (combo) class name' });
      const vBtn = h('button', { type: 'button', title: 'Add a combo class: keeps .base, edits .base.variant' }, 'Add variant');
      const vErr = h('div', { class: 'class-picker-status muted' });
      const addVariant = () => {
        const raw = vInput.value.trim().replace(/^\./, '');
        if (!raw) return;
        const r = HE.actions.attachComboClass(raw);
        if (r && !r.ok) {
          vErr.textContent = r.error || 'Invalid name.';
          vErr.classList.add('is-error');
        }
      };
      vBtn.addEventListener('click', addVariant);
      vInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addVariant();
        e.stopPropagation();
      });
      vRow.append(vInput, vBtn);
      area.append(vRow, vErr);
    }
  } catch { /* scope UI is best-effort */ }

  // attach / create class
  const classNames = HE.sheet.classNames();
  const addInput = h('input', {
    type: 'text', spellcheck: 'false',
    placeholder: 'Search existing or type new class…',
    'aria-label': 'Search existing or type a new class',
  });
  const suggestions = h('div', { class: 'class-suggestions', hidden: '' });
  const status = h('div', { class: 'class-picker-status muted' }, 'Choose an existing class or create a new one.');
  const addBtn = h('button', { type: 'button' }, 'Create');
  const renderSuggestions = () => {
    const query = addInput.value.trim().replace(/^\./, '').toLowerCase();
    suggestions.innerHTML = '';
    const matches = classNames.filter((name) => !query || name.toLowerCase().includes(query)).slice(0, 20);
    for (const name of matches) {
      const option = h('button', { type: 'button', class: 'class-suggestion' }, `.${name}`);
      option.addEventListener('mousedown', (e) => e.preventDefault());
      option.addEventListener('click', () => {
        addInput.value = name;
        HE.actions.attachClass(name);
      });
      suggestions.append(option);
    }
    suggestions.hidden = !matches.length;
    const exact = classNames.includes(query);
    addBtn.textContent = exact ? 'Use existing' : 'Create';
    status.textContent = exact
      ? 'Existing class selected.'
      : query
        ? 'No exact match. Create will add a new class.'
        : 'Choose an existing class or create a new one.';
  };
  const attach = () => {
    const name = addInput.value.trim().replace(/^\./, '');
    if (!name || !isValidClassToken(name)) return;
    HE.actions.attachClass(name);
  };
  addBtn.addEventListener('click', attach);
  addInput.addEventListener('focus', renderSuggestions);
  addInput.addEventListener('input', renderSuggestions);
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attach();
    e.stopPropagation();
  });

  const trash = h('button', { type: 'button', title: 'Delete class from stylesheet' }, 'Delete');
  trash.addEventListener('click', () => {
    if (state.activeClass && confirm(`Delete class .${state.activeClass} and its rules?`)) {
      HE.actions.deleteClass(state.activeClass);
    }
  });

  area.append(h('div', { class: 'selector-row' }, addInput, addBtn, trash), status, suggestions);

  // Target: which stylesheet new rules land in. Breakpoint is driven only
  // by the topbar viewport switch (single source of truth) and mirrored here.
  try {
    const files = (HE.project && HE.project.stylesheets) || [];
    const trow = h('div', { class: 'prow prow-mt' }, h('label', null, 'Target'));
    const twrap = h('div', { class: 'target-row' });
    const cssSel = h('select', { class: 'target-css', title: 'Stylesheet new rules are written to' });
    for (const f of files) {
      const o = h('option', { value: f }, f.split('/').pop() || f);
      o.title = f;
      if (f === HE.cssFile) o.selected = true;
      cssSel.append(o);
    }
    if (!files.length) {
      const o = h('option', { value: '' }, '— none —');
      cssSel.append(o);
    }
    cssSel.disabled = !files.length;
    cssSel.addEventListener('change', () => {
      if (HE.switchStylesheet) HE.switchStylesheet(cssSel.value);
    });
    twrap.append(cssSel);
    const vpName = viewportLabel(HE.viewport || 'desktop');
    twrap.append(h('span', { class: 'muted target-vp', title: 'Breakpoint follows the topbar viewport switch' }, `@${vpName}`));
    trow.append(twrap);
    area.append(trow);
    const media = viewportMedia();
    if (media) area.append(h('div', { class: 'muted' }, `New styles save inside @media ${media} (topbar viewport: ${vpName}).`));
    else if (files.length > 1) area.append(h('div', { class: 'muted' }, `New rules go to ${HE.cssFile || 'the linked stylesheet'}.`));
  } catch { /* target row is best-effort */ }

  // state switch
  const states = ['', ':hover', ':focus', ':focus-visible', ':active', ':visited'];
  const seg = h('div', { class: 'seg' });
  for (const st of states) {
    const b = h('button', { type: 'button', class: st === state.pseudo ? 'on' : '' }, st || 'none');
    b.addEventListener('click', () => {
      state.pseudo = st;
      renderPanel();
    });
    seg.append(b);
  }
  area.append(h('div', { class: 'prow prow-mt' }, h('label', null, 'State'), seg));

  host.append(area);
}

function renameChip(chip, cls) {
  const input = h('input', { type: 'text', spellcheck: 'false' });
  input.value = cls;
  input.style.width = Math.max(60, cls.length * 8) + 'px';
  chip.replaceWith(input);
  input.focus();
  input.select();
  const done = (ok) => {
    const name = input.value.trim().replace(/^\./, '');
    if (ok && name && name !== cls && isValidClassToken(name)) {
      HE.actions.renameClass(cls, name);
    } else {
      renderPanel();
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => done(true));
}

// ---------- rendering ----------

const panelHost = () => document.getElementById('panel');
const emptyHost = () => document.getElementById('panel-empty');

function renderPanel() {
  const host = panelHost();
  const right = document.getElementById('right');
  const rightScrollTop = right ? right.scrollTop : 0;
  const rightScrollLeft = right ? right.scrollLeft : 0;
  const restoreRightScroll = () => {
    if (!right) return;
    right.scrollTop = rightScrollTop;
    right.scrollLeft = rightScrollLeft;
  };
  host.innerHTML = '';
  // Sidebar tokens ride along every panel refresh, so page loads, undo,
  // versions and token add/delete all stay fresh with one call site.
  try { if (HE.renderTokens) HE.renderTokens(); } catch { /* best-effort */ }

  // Site scope: whole-site concerns (classes, fonts, globals). Needs no
  // element selection, so it renders before the "select an element" guard.
  if (HE.scope === 'site') {
    host.hidden = false;
    emptyHost().hidden = true;
    host.append(buildPanelFilter(host));
    host.append(section('globals', 'Globals', buildGlobalsSection));
    host.append(section('classes', 'Classes', buildClassesSection));
    host.append(section('tools', 'Fonts & privacy', buildSiteTools));
    host.append(section('check', 'Site check', buildSiteCheck));
    host.append(section('changes', 'Handoff note', buildChangesSection));
    restoreRightScroll();
    return;
  }

  const elm = activeEl();
  if (!elm) {
    clearRuleScope();
    host.hidden = true;
    emptyHost().hidden = false;
    restoreRightScroll();
    return;
  }
  host.hidden = false;
  emptyHost().hidden = true;

  if (state.activeClass && !elm.classList.contains(state.activeClass)) {
    state.activeClass = null;
    state.activeCombo = null;
  }
  // A picked rule belongs to one selection and one stylesheet generation.
  if (state.activeRule) {
    let ruleOk = state.activeRuleElm === elm;
    if (ruleOk) {
      try { ruleOk = elm.matches(state.activeRule); } catch { ruleOk = false; }
    }
    if (!ruleOk) clearRuleScope();
  }
  if (state.activeCombo && (!elm.classList.contains(state.activeCombo) || state.activeCombo === state.activeClass)) {
    state.activeCombo = null;
  }
  if (!state.activeClass && elm.classList.length) {
    // Don't auto-pick a preview-only simulated class as the base —
    // the compound selector is built via simSuffix() instead.
    let first = elm.classList[0];
    try {
      const sim = HE.canvas && HE.canvas.getSimulation ? HE.canvas.getSimulation() : null;
      if (sim && sim.elm === elm && sim.classes && sim.classes.length) {
        const real = [...elm.classList].find((c) => !sim.classes.includes(c));
        first = real || null;
        // Bare simulated class only (no real base): leave activeClass null
        // so activeSelector() returns the simulated compound (e.g. .is-open).
        if (!first) state.activeClass = null;
        else state.activeClass = first;
      } else {
        state.activeClass = first;
      }
    } catch {
      state.activeClass = first;
    }
  }

  host.append(buildPanelFilter(host));
  // Design-first order: selector → states → style properties → Accessibility.
  // Site-wide tools (Classes, fonts, globals) live in the Site scope; Element
  // attributes + Page/SEO live only in Content mode (no duplication).
  // Content Mode: text/images/links + attributes + SEO, same files. Skip class/CSS sections.
  if (HE.contentMode) {
    host.append(section('element', 'Element', buildElementSection));
    host.append(section('page', 'Page / SEO', buildSeoSection));
    host.append(section('content', 'Content', buildContentSection));
    restoreRightScroll();
    return;
  }
  buildSelectorArea(host);
  if (!state.activeClass) {
    host.append(h('p', { class: 'muted panel-note' },
      'The first style edit creates a class for this element. Styles live on classes in your stylesheet — not inline.'));
  }
  try {
    const shared = elm && HE.sharedEntryFor ? HE.sharedEntryFor(elm) : null;
    if (shared) host.append(section('shared', 'Shared component', (body) => buildSharedSection(body, shared)));
  } catch { /* shared section is best-effort */ }
  try {
    const hasHooks = HE.hooks && HE.hooks.hooksFor && HE.hooks.hooksFor(elm).length;
    let hasPreview = false;
    try {
      const pv = HE.hooks && HE.hooks.statePreviews ? HE.hooks.statePreviews(elm) : null;
      hasPreview = !!(pv && ((pv.classes && pv.classes.length) || (pv.attrs && pv.attrs.length)));
    } catch { /* ignore */ }
    if (hasHooks || hasPreview) {
      host.append(section('behavior', 'JS Behavior', buildBehavior));
    }
  } catch {
    /* hooks section is best-effort */
  }
  try {
    host.append(section('rules', 'Matching rules', buildRulesSection));
  } catch { /* rules section is best-effort */ }
  // Breakpoint override banner: viewport-scoped edits save inside @media.
  try {
    const media = viewportMedia();
    if (media && HE.viewport && HE.viewport !== 'desktop') {
      const banner = h('div', { class: 'viewport-banner' },
        h('span', null, `Editing ${viewportLabel(HE.viewport)} override ${media} — empty fields show desktop values.`));
      const back = h('button', { type: 'button', class: 'viewport-back' }, 'Back to desktop');
      back.addEventListener('click', () => {
        if (HE.setViewport) HE.setViewport('desktop');
        else { HE.viewport = 'desktop'; renderPanel(); }
      });
      banner.append(back);
      host.append(banner);
    }
  } catch { /* best-effort */ }
  host.append(section('layout', 'Layout', buildLayout));
  host.append(section('spacing', 'Spacing', buildSpacing));
  host.append(section('size', 'Size', buildSize));
  host.append(section('position', 'Position', buildPosition));
  host.append(section('typography', 'Typography', buildTypography));
  host.append(section('background', 'Background', buildBackground));
  host.append(section('border', 'Border', buildBorder));
  host.append(section('effects', 'Effects', buildEffects));
  host.append(section('custom', 'Custom CSS', buildCustomSection));
  host.append(section('accessibility', 'Accessibility', buildAccessibility));
  restoreRightScroll();
}

HE.panel = {
  state,
  onSelect(elm) {
    if (state.pendingClass && elm !== state.pendingClass.elm) flushPendingWithSuggestion();
    if (!elm) { state.activeClass = null; state.activeCombo = null; }
    renderPanel();
  },
  refresh: renderPanel,
};

// Kept on the registry surface for tests/tooling.
HE.panel.activeSelector = activeSelector;
HE.panel.promptForClassName = promptForClassName;
HE.panel.confirmClassPrompt = confirmClassPrompt;
HE.panel.dismissClassPrompt = dismissClassPrompt;
