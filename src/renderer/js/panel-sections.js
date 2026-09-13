// Panel sections — Element, Page/SEO, Content, Tokens, Behavior,
// Accessibility and the CSS property sections (Layout..Effects).

import { HE } from './he.js';
import { h } from './dom.js';
import { fonts } from './fonts.js';
import {
  state, activeEl, activeSheet, activeSelector, simSuffix, classUseCount, compoundUseCount,
  originEl, withOrigin, computed, viewportMedia,
} from './panel-core.js';
import {
  row, sizeControl, sizeRow, selectRow, segRow, colorControl,
  selectControl, segControl, textControl, backgroundLayersControl, fontPickerControl,
  fontTokenPicker, opacityRow, presetRow, presetControl, stepperRow, tokenValueControl,
} from './panel-controls.js';
import { tokenType } from './tokens.js';
import { runSiteCheck, groupFindings } from './sitecheck.js';
import { findTextMatches, replaceTextMatches, revealMatch } from './textfind.js';

export function attrRow(label, attr) {
  const elm = activeEl();
  const input = h('input', { type: 'text', spellcheck: 'false' });
  input.value = elm.getAttribute(attr) || '';
  input.addEventListener('change', () => {
    HE.commit();
    if (input.value) elm.setAttribute(attr, input.value);
    else elm.removeAttribute(attr);
    // A real attr edit adopts any preview-only simulation for that attr.
    try {
      if (HE.canvas && HE.canvas.noteRealAttr) HE.canvas.noteRealAttr(attr);
    } catch { /* ignore */ }
    HE.afterDomChange();
  });
  return h('div', { class: 'prow' }, h('label', null, label), input);
}

function a11yNotice(message, kind, actionLabel, action) {
  const notice = h('div', { class: `a11y-notice ${kind || 'warning'}` }, h('span', null, message));
  if (action) {
    const button = h('button', { type: 'button', class: 'a11y-fix' }, actionLabel || 'Fix');
    button.addEventListener('click', action);
    notice.append(button);
  }
  return notice;
}

function accessibilityWarnings() {
  const elm = activeEl();
  const warnings = [];
  if (!elm) return warnings;
  const tag = elm.tagName.toLowerCase();
  const name = (elm.getAttribute('aria-label') || elm.textContent || '').trim();

  if (tag === 'img' && !elm.hasAttribute('alt')) {
    warnings.push({ message: 'Image needs alt text, or alt="" if it is decorative.', kind: 'warning' });
  } else if (tag === 'img' && !elm.getAttribute('alt')) {
    warnings.push({ message: 'Empty alt marks this image as decorative. Confirm that is intentional.', kind: 'info' });
  }
  if (tag === 'a' && !elm.getAttribute('href')) {
    warnings.push({ message: 'Link has no href and may not be keyboard-accessible.', kind: 'warning' });
  }
  if ((tag === 'a' || tag === 'button') && !name) {
    warnings.push({ message: `${tag} needs visible text or an ARIA label.`, kind: 'warning' });
  }
  const tabIndex = parseInt(elm.getAttribute('tabindex'), 10);
  if (tabIndex > 0) {
    warnings.push({ message: 'Positive tabindex values disrupt natural keyboard order. Prefer 0 or -1.', kind: 'warning' });
  }

  const sel = activeSelector();
  if (sel) {
    const fontSize = activeSheet().get(sel, 'font-size');
    const lineHeight = activeSheet().get(sel, 'line-height');
    const height = activeSheet().get(sel, 'height');
    const overflow = activeSheet().get(sel, 'overflow');
    const whiteSpace = activeSheet().get(sel, 'white-space');
    const px = (value) => value && value.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))px$/i);

    if (px(fontSize)) {
      const rem = Number(px(fontSize)[1]) / 16;
      warnings.push({
        message: 'Fixed px text may not scale cleanly at 200% zoom. Prefer rem or clamp().',
        kind: 'warning', actionLabel: 'Use rem',
        action: () => { HE.actions.setStyle('font-size', `${Number(rem.toFixed(3))}rem`); HE.panel.refresh(); },
      });
    }
    if (px(lineHeight)) {
      const computedSize = parseFloat(elm.ownerDocument.defaultView.getComputedStyle(elm).fontSize) || 16;
      const ratio = Number(px(lineHeight)[1]) / computedSize;
      warnings.push({
        message: 'Fixed px line-height can break when text is resized. Prefer a unitless value.',
        kind: 'warning', actionLabel: 'Use unitless',
        action: () => { HE.actions.setStyle('line-height', Number(ratio.toFixed(2)).toString()); HE.panel.refresh(); },
      });
    }
    if (px(height) && overflow === 'hidden') {
      warnings.push({ message: 'Fixed height plus overflow hidden can clip enlarged text.', kind: 'warning' });
    }
    if (whiteSpace === 'nowrap') {
      warnings.push({ message: 'nowrap can prevent text reflow on narrow screens or zoom.', kind: 'warning' });
    }
    if (!activeSheet().get(':focus-visible', 'outline')) {
      warnings.push({ message: 'Add a visible :focus-visible style for keyboard users.', kind: 'info' });
    }
  }
  if ((tag === 'a' || tag === 'button' || tag === 'input') && !state.pseudo) {
    const rect = elm.getBoundingClientRect();
    if (rect.width > 0 && (rect.width < 44 || rect.height < 44)) {
      warnings.push({ message: 'Touch target is smaller than the recommended 44px minimum.', kind: 'info' });
    }
  }
  if (['p', 'li', 'blockquote', 'figcaption'].includes(tag) && !state.pseudo) {
    const styles = elm.ownerDocument.defaultView.getComputedStyle(elm);
    const font = parseFloat(styles.fontSize) || 16;
    if (activeSelector() && elm.getBoundingClientRect().width / font > 75 && !activeSheet().get(activeSelector(), 'max-width')) {
      warnings.push({
        message: 'Long text lines are harder to read. Aim for a measure of about 60-75 characters.',
        kind: 'info', actionLabel: 'Use 65ch',
        action: () => { HE.actions.setStyle('max-width', '65ch'); HE.panel.refresh(); },
      });
    }
  }
  return warnings;
}

// visual-builder-style shared block: the selected element repeats identically on
// other pages. Sync pushes the current (edited) markup there on demand;
// the current page itself is untouched (it saves normally).
export function buildSharedSection(body, entry) {
  const targets = (entry.pages || []).filter((p) => p !== HE.page);
  body.append(h('p', { class: 'a11y-help' }, 'Shared component — edit here once, sync to the other pages on demand.'));
  body.append(h('div', { class: 'muted' },
    `${entry.label} · on ${targets.length + 1} pages (${[HE.page, ...targets].join(', ')})`));
  const btn = h('button', { type: 'button', class: 'a11y-defaults' },
    targets.length ? `Sync to ${targets.length} page${targets.length === 1 ? '' : 's'}` : 'In sync');
  btn.disabled = !targets.length;
  btn.title = 'Replace matching blocks on the other pages (changed pages are skipped, never overwritten)';
  btn.addEventListener('click', async () => {
    if (!targets.length || !HE.syncSharedComponent) return;
    const ok = confirm(
      `Sync <${entry.tag} class="${entry.cls}"> to ${targets.length} page(s)?\n` +
      targets.join('\n') +
      '\n\nPages changed since detection are skipped.'
    );
    if (!ok) return;
    btn.disabled = true;
    try {
      const res = await HE.syncSharedComponent(entry);
      const parts = [];
      if (res.synced.length) parts.push(`synced to ${res.synced.join(', ')}`);
      for (const s of res.skipped || []) parts.push(`${s.page}: ${s.reason}`);
      if (HE.toast) HE.toast(parts.join(' · ') || 'Nothing to sync.', res.synced.length ? 'success' : 'info');
    } catch (err) {
      if (HE.toast) HE.toast('Sync failed: ' + ((err && err.message) || err), 'error');
    } finally {
      btn.disabled = false;
      if (HE.refreshComponents) HE.refreshComponents();
      if (HE.panel && HE.panel.refresh) HE.panel.refresh();
    }
  });
  body.append(btn);
}

// Revealed-panel text quick-select, shared by the Tab and Toggle switchers:
// one click selects the heading/paragraph so it can be double-click edited
// on the canvas (or via Element → Edit text). Without this the text is
// visible but takes tree-drilling to reach.
function appendPanelTextRows(body, panel) {
  try {
    if (!panel || !HE.canvas || HE.canvas.mode !== 'edit') return;
    let texts = [];
    try {
      texts = [...panel.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,button')]
        .filter((n) => n && !(n.querySelector && n.querySelector('h1,h2,h3,h4,h5,h6,p,li')) && ((n.textContent || '').trim()))
        .slice(0, 6);
    } catch { texts = []; }
    if (!texts.length) return;
    body.append(h('div', { class: 'muted' }, 'Panel text:'));
    for (const te of texts) {
      const tag = (te.tagName || 'text').toLowerCase();
      const snippet = ((te.textContent || '').trim().replace(/\s+/g, ' ')).slice(0, 34);
      const pick = h('button', {
        type: 'button',
        class: 'sim-preview-btn',
        title: `Select this <${tag}> on the canvas, then double-click it (or Element → Edit text) to edit`,
      }, `${tag}: ${snippet}`);
      pick.addEventListener('click', () => {
        try {
          if (HE.canvas && HE.canvas.select) HE.canvas.select(te);
          try { te.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
        } catch { /* ignore */ }
      });
      body.append(pick);
    }
  } catch { /* panel-text rows are best-effort */ }
}

export function buildBehavior(body) {
  const elm = activeEl();
  let hooks = [];
  try {
    hooks = HE.hooks && HE.hooks.hooksFor ? HE.hooks.hooksFor(elm) : [];
  } catch {
    hooks = [];
  }
  body.append(h('p', { class: 'a11y-help' }, 'Behavior is source-backed. Scripts run only in Preview; state styling is editable here.'));
  // One contract for every script-driven element (tabs, accordion, dropdown,
  // nav, carousel): clicks select, and where Preview would visibly change
  // something, Edit mirrors it as an unsaved preview — never saved, cleared
  // on mode/page switch. Arrange state in Preview and Edit resumes it.
  const editMode = HE.canvas && HE.canvas.mode === 'edit';
  let tabCtx = null;
  let tglCtx = null;
  try { tabCtx = HE.canvas && HE.canvas.getTabContext ? HE.canvas.getTabContext(elm) : null; } catch { tabCtx = null; }
  try { tglCtx = HE.canvas && HE.canvas.getToggleContext ? HE.canvas.getToggleContext(elm) : null; } catch { tglCtx = null; }
  // Tabs: scripts are neutralized in Edit, so tab buttons can't switch panels.
  // This switcher preview-shows one panel at a time so its text can be edited.
  // Preview-only, never saved — the file keeps its default tab.
  try {
    if (tabCtx && tabCtx.btns.length && tabCtx.panels.length) {
      const editOnly = !editMode;
      const trow = h('div', { class: 'prow' }, h('label', null, 'Tab'));
      const seg = h('div', { class: 'seg' });
      tabCtx.btns.forEach((b, i) => {
        const raw = (b.textContent || '').trim().replace(/\s+/g, ' ');
        const label = (raw || `Tab ${i + 1}`).slice(0, 18);
        const btn = h('button', { type: 'button', class: i === tabCtx.activeIndex ? 'on' : '' }, label);
        btn.title = i === tabCtx.activeIndex
          ? `${raw || label} — shown now (Edit preview)`
          : `Show ${raw || label} panel for editing (Edit preview only, not saved)`;
        btn.disabled = editOnly || !elm;
        btn.setAttribute('aria-pressed', i === tabCtx.activeIndex ? 'true' : 'false');
        btn.addEventListener('click', () => {
          if (!HE.canvas || HE.canvas.mode !== 'edit') return;
          try { HE.canvas.previewTab(tabCtx.root, i); } catch { /* ignore */ }
          // Select the revealed panel so its text can be double-click edited.
          try {
            const p = tabCtx.panels[i];
            if (p && HE.canvas.select) {
              HE.canvas.select(p);
              try { p.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
            } else if (HE.panel && HE.panel.refresh) HE.panel.refresh();
          } catch { /* ignore */ }
        });
        seg.append(btn);
      });
      trow.append(seg);
      body.append(trow);
      let previewing = false;
      try {
        previewing = !!(HE.canvas.getTabPreview && HE.canvas.getTabPreview(tabCtx.root));
      } catch { previewing = false; }
      let activeName = '';
      try {
        activeName = ((tabCtx.btns[tabCtx.activeIndex] || {}).textContent || '').trim().replace(/\s+/g, ' ');
      } catch { activeName = ''; }
      if (previewing) {
        const reset = h('button', { type: 'button', class: 'sim-preview-btn', title: 'Restore the saved default tab (clears Edit preview)' }, 'Reset tabs');
        reset.disabled = editOnly;
        reset.addEventListener('click', () => {
          try { if (HE.canvas.clearTabPreview) HE.canvas.clearTabPreview(tabCtx.root); } catch { /* ignore */ }
          try { if (HE.canvas.select) HE.canvas.select(tabCtx.root); } catch { /* ignore */ }
        });
        body.append(reset);
        body.append(h('div', { class: 'muted' },
          `Previewing ${activeName || 'tab'} — text edits save, the shown tab itself does not. Pick text below, then double-click it on the canvas (or Element → Edit text) to type.`));
      } else {
        body.append(h('div', { class: 'muted' }, 'Pick a tab to preview its panel, then pick its text below — double-click on canvas (or Element → Edit text) to edit.'));
      }
      // Panel text quick-select: one click selects the revealed panel's
      // heading/paragraph (see appendPanelTextRows above).
      try {
        appendPanelTextRows(body, tabCtx.panels[tabCtx.activeIndex]);
      } catch { /* ignore */ }
    }
  } catch { /* tabs switcher is best-effort */ }
  // Open/close toggles (accordion, dropdown, mobile nav): same preview-only
  // contract as tabs. Clicking the control on the canvas flips it; this
  // switcher sets it explicitly; Preview-arranged state carries into Edit.
  try {
    if (tglCtx && tglCtx.root && !(tabCtx && tabCtx.root && tabCtx.root.contains(tglCtx.root))) {
      const editOnly = !editMode;
      const kindLabel = tglCtx.kind === 'nav' ? 'Menu' : tglCtx.kind === 'dropdown' ? 'Dropdown' : 'Accordion';
      const srow = h('div', { class: 'prow' }, h('label', null, 'State'));
      const sseg = h('div', { class: 'seg' });
      const mkState = (wantOpen, label, title) => {
        const b = h('button', { type: 'button', class: tglCtx.open === wantOpen ? 'on' : '' }, label);
        b.title = title;
        b.disabled = editOnly || !elm;
        b.setAttribute('aria-pressed', tglCtx.open === wantOpen ? 'true' : 'false');
        b.addEventListener('click', () => {
          if (!HE.canvas || HE.canvas.mode !== 'edit') return;
          try { HE.canvas.setToggleOpen(tglCtx.root, wantOpen); } catch { /* ignore */ }
          try {
            const target = wantOpen && tglCtx.panel && tglCtx.panel !== tglCtx.root ? tglCtx.panel : tglCtx.root;
            if (target && HE.canvas.select) {
              HE.canvas.select(target);
              try { target.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
            } else if (HE.panel && HE.panel.refresh) HE.panel.refresh();
          } catch { /* ignore */ }
        });
        sseg.append(b);
      };
      mkState(true, 'Open', `Show this ${kindLabel.toLowerCase()}'s hidden content for editing (Edit preview only, not saved)`);
      mkState(false, 'Closed', 'Restore the closed state (Edit preview only, not saved)');
      srow.append(sseg);
      body.append(srow);
      let tglPreviewing = false;
      try {
        tglPreviewing = !!(HE.canvas.getTogglePreview && HE.canvas.getTogglePreview(tglCtx.root));
      } catch { tglPreviewing = false; }
      if (tglCtx.open) {
        body.append(h('div', { class: 'muted' }, 'Open — preview only, the file keeps its authored state. Pick text below to edit it.'));
        try {
          if (tglCtx.panel && tglCtx.panel !== tglCtx.root) appendPanelTextRows(body, tglCtx.panel);
        } catch { /* ignore */ }
      } else if (tglPreviewing) {
        body.append(h('div', { class: 'muted' }, 'Closed preview — the file keeps its authored state.'));
      } else {
        body.append(h('div', { class: 'muted' }, 'Tip: click the control on the canvas in Edit to open it, or pick Open here.'));
      }
    }
  } catch { /* toggle switcher is best-effort */ }
  // Carousel: arrows scroll the track in Preview; in Edit the same scroll is
  // mirrored (scroll offsets are view-only and never save).
  try {
    const cctx = HE.canvas && HE.canvas.getCarouselContext ? HE.canvas.getCarouselContext(elm) : null;
    if (cctx && cctx.root && editMode) {
      const crow = h('div', { class: 'prow' }, h('label', null, 'Scroll'));
      const cseg = h('div', { class: 'seg' });
      for (const [label, dir, title] of [['← Prev', -1, 'Scroll the track back (view-only, never saved)'], ['Next →', 1, 'Scroll the track forward (view-only, never saved)']]) {
        const b = h('button', { type: 'button', title }, label);
        b.disabled = !elm;
        b.addEventListener('click', () => {
          if (!HE.canvas || HE.canvas.mode !== 'edit') return;
          try { HE.canvas.scrollCarousel(cctx.root, dir); } catch { /* ignore */ }
        });
        cseg.append(b);
      }
      crow.append(cseg);
      body.append(crow);
      body.append(h('div', { class: 'muted' }, 'Scroll is view-only — the ← → arrows on the canvas do the same.'));
    }
  } catch { /* carousel row is best-effort */ }
  // Variants dropdown: Default / Open / Hover. Open maps to the first
  // preview class (e.g. .is-open/.is-visible) via preview-only simulation;
  // Hover maps to :hover pseudo. No new JS logic, visual only + real CSS edits.
  try {
    let previews = { classes: [], attrs: [] };
    if (HE.hooks && HE.hooks.statePreviews) previews = HE.hooks.statePreviews(elm) || previews;
    const sim = (HE.canvas && HE.canvas.getSimulation) ? HE.canvas.getSimulation() : null;
    const simActive = !!(sim && sim.elm === elm && ((sim.classes && sim.classes.length) || (sim.attrs && sim.attrs.length)));
    const current = state.pseudo === ':hover' ? 'hover' : (simActive ? 'open' : 'default');
    const openCls = (previews.classes && previews.classes[0]) || 'is-open';
    const vrow = h('div', { class: 'prow' }, h('label', null, 'Variant'));
    const seg = h('div', { class: 'seg' });
    const mk = (key, label, title) => {
      const b = h('button', { type: 'button', class: current === key ? 'on' : '' }, label);
      b.title = title;
      b.disabled = !elm || HE.canvas.mode !== 'edit';
      if (key === 'open' && !(previews.classes && previews.classes.length) && !simActive) {
        b.title = `No state class detected — will preview .${openCls} (convention)`;
      }
      b.addEventListener('click', () => {
        if (HE.canvas.mode !== 'edit') return;
        if (key === 'default') {
          try { if (HE.canvas.clearSimulation) HE.canvas.clearSimulation(); } catch { /* ignore */ }
          state.pseudo = '';
        } else if (key === 'hover') {
          try { if (HE.canvas.clearSimulation) HE.canvas.clearSimulation(); } catch { /* ignore */ }
          state.pseudo = ':hover';
        } else {
          state.pseudo = '';
          try {
            const isSim = HE.canvas.isSimulatingClass ? HE.canvas.isSimulatingClass(openCls) : false;
            if (!isSim) HE.canvas.simulateToggleClass(openCls);
          } catch { /* ignore */ }
        }
        HE.panel.refresh();
      });
      seg.append(b);
    };
    mk('default', 'Default', 'Base styles, no state');
    mk('open', 'Open', `Preview .${openCls} via simulation (visual only, CSS edits save)`);
    mk('hover', 'Hover', 'Edit :hover rules');
    vrow.append(seg);
    body.append(vrow);
  } catch { /* variant row is best-effort */ }
  // Preview-only state simulation: toggles .is-open/.is-visible etc. via
  // classList for styling, without running handlers and without dirty.
  // Never saved unless the class was attached via chips.
  try {
    let previews = { classes: [], attrs: [] };
    if (HE.hooks && HE.hooks.statePreviews) previews = HE.hooks.statePreviews(elm) || previews;
    const hasPreview = (previews.classes && previews.classes.length) || (previews.attrs && previews.attrs.length);
    if (hasPreview && HE.canvas) {
      const editOnly = HE.canvas.mode !== 'edit';
      const wrap = h('div', { class: 'sim-preview-row' });
      for (const cls of previews.classes || []) {
        // Toggle-owned .is-open is driven by the State switcher above — a
        // single-element toggle here would fight the toggle preview.
        try {
          if (cls === 'is-open' && tglCtx && tglCtx.root) continue;
        } catch { /* fall through and render */ }
        const simulating = HE.canvas.isSimulatingClass ? HE.canvas.isSimulatingClass(cls) : false;
        const btn = h('button', {
          type: 'button',
          class: 'sim-preview-btn' + (simulating ? ' on' : ''),
          title: 'Preview-only: temporarily toggles .' + cls + ' via classList. No handlers run, not saved unless attached via chips.',
        }, `Preview .${cls}`);
        btn.disabled = editOnly || !elm;
        btn.setAttribute('aria-pressed', simulating ? 'true' : 'false');
        btn.addEventListener('click', () => {
          if (HE.canvas.mode !== 'edit') return;
          HE.canvas.simulateToggleClass(cls);
        });
        wrap.append(btn);
      }
      for (const attr of previews.attrs || []) {
        // Switcher-managed attrs (hidden / aria-selected on tabs, hidden /
        // aria-expanded on toggles) are driven above — a single-element
        // toggle here would double-bookkeep and desync the preview.
        try {
          const inTabs = elm && elm.closest && elm.closest('.tabs');
          if (inTabs) {
            const isPanel = elm.matches && elm.matches('.tab-panel, [role="tabpanel"]');
            const isBtn = elm.matches && elm.matches('.tab-btn, [role="tab"]');
            if ((attr === 'hidden' && isPanel) || (attr === 'aria-selected' && isBtn)) continue;
          }
          if (tglCtx && tglCtx.root) {
            const isTglPanel = tglCtx.panel && tglCtx.panel !== tglCtx.root && elm === tglCtx.panel;
            const isTglBtn = tglCtx.btn && elm === tglCtx.btn;
            if ((attr === 'hidden' && isTglPanel) || (/^aria-expanded$/i.test(attr) && isTglBtn)) continue;
          }
        } catch { /* fall through and render */ }
        const simulating = HE.canvas.isSimulatingAttr ? HE.canvas.isSimulatingAttr(attr) : false;
        const btn = h('button', {
          type: 'button',
          class: 'sim-preview-btn' + (simulating ? ' on' : ''),
          title: 'Preview-only visual toggle for ' + attr + '. No handlers run, not saved.',
        }, `Preview ${attr}`);
        btn.disabled = editOnly || !elm;
        btn.setAttribute('aria-pressed', simulating ? 'true' : 'false');
        btn.addEventListener('click', () => {
          if (HE.canvas.mode !== 'edit') return;
          HE.canvas.simulateToggleAttr(attr);
        });
        wrap.append(btn);
      }
      body.append(wrap);
      const sel = activeSelector();
      if (sel && simSuffix()) {
        body.append(h('div', { class: 'muted' }, `Editing ${sel} — preview-only state, CSS edits are real and do save.`));
      } else {
        body.append(h('div', { class: 'muted' }, 'Preview is visual-only and never saves the class/attr itself.'));
      }
    }
  } catch { /* preview row is best-effort */ }
  if (!hooks.length) {
    body.append(h('div', { class: 'muted' }, 'No JS hooks target this element.'));
    return;
  }
  for (const hook of hooks) {
    const kind = hook.kind === 'convention' ? 'info' : 'info';
    const item = h('div', { class: `a11y-notice ${kind}` });
    const label = h('span', null, hook.label);
    item.append(label);
    if (hook.hint) {
      item.append(h('div', { class: 'muted hook-hint' }, hook.hint));
    }
    if (hook.full && window.he && window.he.openFile) {
      const fileName = (hook.file || 'script').split('/').pop();
      const openBtn = h('button', { type: 'button', class: 'a11y-fix', title: 'Open the behavior source in your external editor' }, `Open ${fileName}`);
      openBtn.addEventListener('click', async () => {
        try {
          const err = await window.he.openFile(hook.full);
          if (err) HE.toast('Could not open ' + hook.file + ':\n' + err, 'error');
        } catch (e) {
          HE.toast('Could not open ' + hook.file, 'error');
        }
      });
      item.append(openBtn);
    } else if (hook.kind === 'convention') {
      const tag = h('div', { class: 'muted hook-tag' }, 'convention');
      tag.title = 'Documented JS contract from AGENT_SITE_PROMPT.md — no matching code found in project JS yet';
      item.append(tag);
    }
    body.append(item);
  }
}

// --- Site → Globals ---------------------------------------------------------
// Whole-site concerns that need no element selection: document metadata,
// global element rules and the opt-in accessibility safety nets.

const GLOBAL_RULE_SELECTORS = [
  'html', 'body', '*',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'figcaption',
  'code', 'pre', 'button', 'input', 'table', ':focus-visible', '::selection',
];
const GLOBAL_PROP_SUGGESTIONS = [
  'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color',
  'max-width', 'margin', 'padding', 'box-sizing', 'text-wrap', 'overflow-wrap',
  'scroll-behavior', '-webkit-font-smoothing', 'outline', 'outline-offset',
];
let globalEditSelector = 'body';

function faviconRows(body) {
  const doc = HE.canvas && HE.canvas.doc;
  if (!doc) return;
  const favGet = () => {
    const l = headEl('link[rel="icon"]') || headEl('link[rel="shortcut icon"]');
    return l ? (l.getAttribute('href') || '') : '';
  };
  const favSet = (v) => {
    let l = headEl('link[rel="icon"]');
    if (v) {
      if (!l) { l = doc.createElement('link'); l.setAttribute('rel', 'icon'); doc.head.appendChild(l); }
      l.setAttribute('href', v);
    } else if (l) l.remove();
  };
  body.append(seoRow('Favicon', favGet, favSet, 'favicon.ico'));
  const current = (favGet() || '').trim();
  let resolved = '';
  if (current && !/^(data:|https?:|blob:)/i.test(current)) {
    try { resolved = new URL(current, doc.baseURI).href; } catch { resolved = ''; }
  } else resolved = current;
  const preview = current
    ? h('img', { class: 'favicon-preview', alt: '' })
    : h('span', { class: 'muted' }, 'None');
  if (current && resolved && preview.tagName === 'IMG') {
    try { preview.src = resolved; } catch { /* preview is best-effort */ }
    preview.title = current;
  } else if (current) preview.title = current;
  const pick = h('input', { type: 'file', accept: '.ico,.svg,.png,.webp,.gif,image/*' });
  pick.setAttribute('aria-label', 'Pick a favicon file');
  pick.title = 'Pick an icon — it is copied into the project folder (images/)';
  pick.addEventListener('change', async () => {
    const f = pick.files && pick.files[0];
    if (!f) return;
    const srcAbs = (window.he && window.he.pathForFile && window.he.pathForFile(f)) || f.path;
    if (!srcAbs || !(window.he && window.he.copyInto)) {
      if (HE.toast) HE.toast('Could not read the picked file.', 'error');
      return;
    }
    try {
      const dot = f.name.lastIndexOf('.');
      const stem = dot > 0 ? f.name.slice(0, dot) : f.name;
      const ext = dot > 0 ? f.name.slice(dot) : '';
      let dest = 'images/' + f.name;
      let n = 1;
      while (window.he.exists && await window.he.exists(dest)) {
        n += 1;
        dest = `images/${stem}-${n}${ext}`;
      }
      await window.he.copyInto(srcAbs, dest);
      if (HE.commit) HE.commit();
      favSet(dest);
      if (HE.afterDomChange) HE.afterDomChange();
      if (HE.toast) HE.toast(`Favicon copied to ${dest}.`, 'success');
      HE.panel.refresh();
    } catch (err) {
      if (HE.toast) HE.toast('Could not copy favicon: ' + ((err && err.message) || err), 'error');
    }
  });
  const pickWrap = h('div', { class: 'favicon-pick' }, preview, pick);
  body.append(h('div', { class: 'prow favicon-prow' }, h('label', null, 'Icon'), pickWrap));
}

function renderGlobalDeclarations(editor, selector) {
  const decls = (() => { try { return activeSheet().declarations(selector); } catch { return []; } })();
  if (!decls.length) {
    editor.append(h('div', { class: 'muted' }, `No declarations on ${selector} yet — add one below.`));
  }
  for (const d of decls) {
    const rowEl = h('div', { class: 'global-prop-row' });
    rowEl.append(h('code', { class: 'global-prop-name', title: d.prop }, d.prop));
    const val = h('input', { type: 'text', spellcheck: 'false', class: 'global-prop-value' });
    val.value = d.value;
    val.title = `${d.prop} on ${selector}`;
    val.addEventListener('change', () => {
      HE.actions.setGlobal(selector, d.prop, val.value.trim());
      HE.panel.refresh();
    });
    const rm = h('button', { type: 'button', class: 'global-prop-del', title: `Remove ${d.prop} from ${selector}`, 'aria-label': `Remove ${d.prop}` }, '×');
    rm.addEventListener('click', () => {
      HE.actions.setGlobal(selector, d.prop, '', { now: true });
      HE.panel.refresh();
    });
    rowEl.append(val, rm);
    editor.append(rowEl);
  }
  const suggestions = h('datalist', { id: 'global-prop-suggestions' });
  for (const p of GLOBAL_PROP_SUGGESTIONS) suggestions.append(h('option', { value: p }));
  const addRow = h('div', { class: 'global-prop-row global-add-row' });
  const prop = h('input', { type: 'text', spellcheck: 'false', class: 'global-prop-name-input', placeholder: 'property', list: 'global-prop-suggestions' });
  const value = h('input', { type: 'text', spellcheck: 'false', class: 'global-prop-value', placeholder: 'value' });
  const add = h('button', { type: 'button', class: 'global-prop-add' }, 'Add');
  const addProp = () => {
    const p = prop.value.trim();
    const v = value.value.trim();
    if (!p || !v) return;
    HE.actions.setGlobal(selector, p, v, { now: true });
    HE.panel.refresh();
  };
  add.addEventListener('click', addProp);
  value.addEventListener('keydown', (e) => { if (e.key === 'Enter') addProp(); e.stopPropagation(); });
  prop.addEventListener('keydown', (e) => { if (e.key === 'Enter') value.focus(); e.stopPropagation(); });
  addRow.append(prop, value, add);
  editor.append(suggestions, addRow);
}

export function buildGlobalsSection(body) {
  body.append(h('p', { class: 'a11y-help' }, 'Site-wide settings — document metadata and base element rules that apply to every page, not the selected element.'));
  const doc = HE.canvas && HE.canvas.doc;
  if (!doc) { body.append(h('div', { class: 'muted' }, 'No page loaded.')); return; }

  // --- Site metadata ---
  body.append(h('div', { class: 'cm-sub' }, 'Site metadata'));
  {
    const langInput = h('input', { type: 'text', spellcheck: 'false', placeholder: 'en' });
    langInput.value = doc.documentElement.getAttribute('lang') || '';
    langInput.title = 'Document language for every page (html lang)';
    langInput.addEventListener('change', () => {
      if (HE.commit) HE.commit();
      const v = langInput.value.trim();
      if (v) doc.documentElement.setAttribute('lang', v);
      else doc.documentElement.removeAttribute('lang');
      if (HE.afterDomChange) HE.afterDomChange();
      HE.panel.refresh();
    });
    body.append(h('div', { class: 'prow' }, h('label', null, 'Language'), langInput));
  }
  const metaRow = (label, selector, attr, placeholder) => {
    const get = () => { const m = headEl(selector); return m ? (m.getAttribute(attr || 'content') || '') : ''; };
    const set = (v) => {
      const isProp = selector.includes('property');
      const key = isProp ? selector.match(/property="([^"]+)"/)[1] : selector.match(/name="([^"]+)"/)[1];
      let m = headEl(selector);
      if (v) {
        if (!m) {
          m = doc.createElement('meta');
          if (isProp) m.setAttribute('property', key); else m.setAttribute('name', key);
          doc.head.appendChild(m);
        }
        m.setAttribute('content', v);
      } else if (m) m.remove();
    };
    return seoRow(label, get, set, placeholder);
  };
  body.append(metaRow('Theme color', 'meta[name="theme-color"]', 'content', '#ffffff'));
  body.append(metaRow('Social image', 'meta[property="og:image"]', 'content', 'images/og.png'));
  faviconRows(body);

  // --- Global element rules ---
  body.append(h('div', { class: 'cm-sub' }, 'Global element rules'));
  body.append(h('p', { class: 'a11y-help' }, 'Base declarations for site-wide selectors, saved at the top level (desktop). Tokens such as var(--brand) work as values.'));
  let existing = [];
  try { existing = activeSheet() && activeSheet().globalSelectors ? activeSheet().globalSelectors() : []; } catch { existing = []; }
  const options = [...existing, ...GLOBAL_RULE_SELECTORS.filter((s) => !existing.includes(s))];
  if (!options.includes(globalEditSelector)) globalEditSelector = options[0] || 'body';
  const selSelect = h('select', { class: 'global-sel', 'aria-label': 'Global selector to edit' });
  for (const s of options) {
    const o = h('option', { value: s }, existing.includes(s) ? s : `${s} (new)`);
    if (s === globalEditSelector) o.selected = true;
    selSelect.append(o);
  }
  selSelect.addEventListener('change', () => { globalEditSelector = selSelect.value; HE.panel.refresh(); });
  body.append(h('div', { class: 'prow' }, h('label', null, 'Selector'), selSelect));
  const editor = h('div', { class: 'global-editor' });
  body.append(editor);
  renderGlobalDeclarations(editor, globalEditSelector);

  // --- Opt-in safety nets ---
  body.append(h('div', { class: 'cm-sub' }, 'Site defaults'));
  body.append(h('p', { class: 'a11y-help' }, 'Recommended defaults are opt-in. Skips existing values; Undo (Ctrl/⌘+Z) reverts them.'));
  const defaults = h('button', { type: 'button', class: 'a11y-defaults' }, 'Add safe global defaults');
  defaults.title = 'Adds box sizing, responsive media, focus-visible, and reduced-motion rules. Skips existing values; Undo reverts it.';
  defaults.addEventListener('click', () => { HE.actions.applyAccessibilityDefaults(); HE.panel.refresh(); });
  body.append(defaults);
  const explainer = h('details', { class: 'a11y-details border-advanced' });
  explainer.append(
    h('summary', { class: 'border-advanced-summary' }, 'What will this add?'),
    h('div', { class: 'a11y-help' }, 'Four small global safety nets. Skips anything you already set. Safe to try — Undo (Ctrl/⌘+Z) reverts it.'),
    h('ul', { class: 'a11y-list' },
      h('li', null, 'Sizing — border-box everywhere, so padding stays inside width.'),
      h('li', null, 'Media — images and video never overflow (max-width: 100%).'),
      h('li', null, 'Text + focus — wrapped paragraphs, visible focus ring for keyboard users.'),
      h('li', null, 'Motion — still layout for visitors who prefer reduced motion.'),
    ),
  );
  body.append(explainer);
}

export function buildSiteTools(body) {
  body.append(h('p', { class: 'a11y-help' }, 'One-click improvements for the whole site. Safe to try — Undo (Ctrl/⌘+Z) reverts them.'));
  let css = '';
  try { css = activeSheet() ? activeSheet().serialize() : ''; } catch { css = ''; }
  let docHtml = '';
  try {
    docHtml = (HE.canvas && HE.canvas.doc && HE.canvas.doc.documentElement.outerHTML) || '';
  } catch { docHtml = ''; }
  let used = [];
  try { used = fonts.detectGoogleFontsInCss(css); } catch { used = []; }
  let linked = [];
  try { linked = fonts.detectGoogleFontLinks(docHtml); } catch { linked = []; }
  const all = [...new Set([...used, ...linked])];
  let local = [];
  try { local = fonts.localFamilies(css); } catch { local = []; }
  let todo = [];
  try { todo = fonts.familiesNeedingLocal(all, css); } catch { todo = []; }

  let status;
  if (!all.length && !local.length) {
    status = 'No web fonts in use — nothing to do.';
  } else if (todo.length) {
    status = `${todo.join(', ')} load${todo.length === 1 ? 's' : ''} from Google on every visit.`;
  } else {
    status = `All fonts local (${local.join(', ')}) — your pages make no font requests.`;
  }
  body.append(h('div', { class: 'a11y-help site-tools-status' }, status));

  const btn = h('button', { type: 'button', class: 'a11y-defaults' }, 'Make fonts local (GDPR-safe)');
  btn.title = 'Download the used Google Fonts into project fonts/ and point @font-face at the local copies. The Google links drop out on save.';
  btn.disabled = !todo.length;
  const result = h('div', { class: 'a11y-help site-tools-result', 'aria-live': 'polite' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    result.textContent = 'Downloading fonts…';
    try {
      const r = await HE.actions.selfhostGoogleFonts();
      if (!r.ok) {
        result.textContent = '';
        if (HE.toast) HE.toast(r.error || 'Font download failed.', 'error');
      } else if (r.nothing) {
        result.textContent = 'Already local — nothing changed.';
      } else {
        result.textContent =
          `Done — ${r.vendored.join(', ')} now served from fonts/ (${r.files} file${r.files === 1 ? '' : 's'}). Save to write the pages.`;
        if (HE.toast) HE.toast('Fonts are local now — no Google requests.', 'success');
      }
    } catch (err) {
      result.textContent = '';
      if (HE.toast) HE.toast('Font download failed: ' + ((err && err.message) || err), 'error');
    } finally {
      if (HE.panel && HE.panel.refresh) HE.panel.refresh();
    }
  });
  body.append(btn);
  body.append(result);
  const explainer = h('details', { class: 'a11y-details border-advanced' });
  explainer.append(
    h('summary', { class: 'border-advanced-summary' }, 'Why keep fonts in the project folder?'),
    h('ul', { class: 'a11y-list' },
      h('li', null, 'Privacy (GDPR) — no visitor IP address is sent to Google, so no consent banner is needed for fonts.'),
      h('li', null, 'Faster + offline — fonts load with your pages; no third-party round-trip, and a Google outage cannot break your type.'),
      h('li', null, 'Stable — pinned files mean your design cannot change when Google updates a font.'),
      h('li', null, 'Works everywhere — strict ad-blockers and offline previews still show the right type.'),
    ),
  );
  body.append(explainer);
}

export function buildAccessibility(body) {
  body.append(h('p', { class: 'a11y-help' }, 'Accessibility checks for the selected element. Site-wide defaults live in the Site scope (Globals).'));
  body.append(h('p', { class: 'a11y-help' }, 'Below is a list of accessibility issues detected for the selected element (global defaults do not fix these).'));
  const warnings = accessibilityWarnings();
  if (!warnings.length) {
    body.append(a11yNotice('No common accessibility issues detected for this element.', 'pass'));
    return;
  }
  for (const warning of warnings) body.append(a11yNotice(warning.message, warning.kind, warning.actionLabel, warning.action));
}

export function buildElementSection(body) {
  const elm = activeEl();
  const tag = elm.tagName.toLowerCase();
  body.append(h('div', { class: 'prow' }, h('label', null, 'Tag'), h('span', { class: 'muted' }, tag)));
  // Deterministic text editing: canvas single-click only selects (and on tab
  // buttons it also preview-switches), double-click edits but is easy to miss.
  // This button is the explicit path — select, click, type, click elsewhere.
  if (!['img', 'input', 'select', 'textarea', 'video', 'iframe'].includes(tag)) {
    const editText = h('button', {
      type: 'button',
      class: 'a11y-defaults',
      title: 'Make this element editable on the canvas, then type. Click elsewhere or press Tab when done.',
    }, 'Edit text');
    editText.addEventListener('click', () => {
      if (HE.canvas && HE.canvas.startTextEdit) HE.canvas.startTextEdit(elm);
    });
    body.append(h('div', { class: 'prow' }, h('label', null, 'Text'), editText));
  }
  body.append(attrRow('id', 'id'));
  body.append(attrRow('ARIA label', 'aria-label'));
  body.append(attrRow('ARIA desc', 'aria-describedby'));
  body.append(attrRow('Role', 'role'));
  body.append(attrRow('Tab index', 'tabindex'));
  if (tag === 'img') {
    body.append(attrRow('src', 'src'));
    body.append(attrRow('alt', 'alt'));
  }
  if (tag === 'a') body.append(attrRow('href', 'href'));
}

function headEl(selector) {
  try {
    const doc = HE.canvas && HE.canvas.doc;
    return doc ? doc.head && doc.head.querySelector(selector) : null;
  } catch { return null; }
}

function seoRow(label, get, set, placeholder) {
  const input = h('input', { type: 'text', spellcheck: 'false' });
  try { input.value = get() || ''; } catch { input.value = ''; }
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener('change', () => {
    if (HE.commit) HE.commit();
    try { set(input.value.trim()); } catch { /* ignore */ }
    if (HE.afterDomChange) HE.afterDomChange();
    HE.panel.refresh();
  });
  return h('div', { class: 'prow' }, h('label', null, label), input);
}

export function buildSeoSection(body) {
  const doc = HE.canvas && HE.canvas.doc;
  if (!doc) { body.append(h('div', { class: 'muted' }, 'No page loaded.')); return; }
  body.append(seoRow('Title', () => {
    const t = doc.head && doc.head.querySelector('title');
    return t ? t.textContent : '';
  }, (v) => {
    let t = doc.head.querySelector('title');
    if (!t) { t = doc.createElement('title'); doc.head.appendChild(t); }
    t.textContent = v;
  }, 'Page title'));
  const meta = (sel, attr) => ({
    get: () => {
      const m = headEl(sel);
      return m ? (m.getAttribute(attr || 'content') || '') : '';
    },
    set: (v) => {
      if (sel.startsWith('meta')) {
        const isProp = sel.includes('property');
        const key = isProp ? sel.match(/property="([^"]+)"/)[1] : sel.match(/name="([^"]+)"/)[1];
        let m = headEl(sel);
        if (v) {
          if (!m) {
            m = doc.createElement('meta');
            if (isProp) m.setAttribute('property', key); else m.setAttribute('name', key);
            doc.head.appendChild(m);
          }
          m.setAttribute('content', v);
        } else if (m) m.remove();
      }
    },
  });
  const desc = meta('meta[name="description"]');
  body.append(seoRow('Descript.', desc.get, desc.set, 'Meta description'));
  const ogT = meta('meta[property="og:title"]');
  body.append(seoRow('OG title', ogT.get, ogT.set, 'Defaults to title'));
  const ogD = meta('meta[property="og:description"]');
  body.append(seoRow('OG descr.', ogD.get, ogD.set, 'Defaults to description'));
  const warns = [];
  try {
    if (!((doc.head.querySelector('title') || {}).textContent || '').trim()) warns.push('Missing <title>.');
    if (!headEl('meta[name="description"]')) warns.push('Missing meta description.');
  } catch { /* ignore */ }
  for (const w of warns) body.append(h('div', { class: 'a11y-notice warning' }, h('span', null, w)));
}

export function buildContentSection(body) {
  const elm = activeEl();
  const tag = elm.tagName.toLowerCase();
  body.append(h('p', { class: 'a11y-help' }, 'Content mode — text, images and links only. Same files, no class/CSS editing. Double-click text on the canvas to type.'));
  if (!['img', 'input', 'video', 'iframe'].includes(elm.tagName)) {
    const editBtn = h('button', { type: 'button', class: 'a11y-defaults' }, 'Edit text on canvas');
    editBtn.addEventListener('click', () => {
      if (HE.canvas && HE.canvas.startTextEdit) HE.canvas.startTextEdit(elm);
    });
    body.append(editBtn);
  }
  if (tag === 'img') {
    body.append(attrRow('Image src', 'src'));
    body.append(attrRow('Alt text', 'alt'));
    const pick = h('input', { type: 'file', accept: 'image/*' });
    pick.title = 'Pick an image — it is copied into the project folder (images/)';
    pick.addEventListener('change', async () => {
      const f = pick.files && pick.files[0];
      if (!f) return;
      const srcAbs = (window.he.pathForFile && window.he.pathForFile(f)) || f.path;
      if (!srcAbs || !window.he.copyInto) {
        if (HE.toast) HE.toast('Could not read the picked file.', 'error');
        return;
      }
      try {
        const dot = f.name.lastIndexOf('.');
        const stem = dot > 0 ? f.name.slice(0, dot) : f.name;
        const ext = dot > 0 ? f.name.slice(dot) : '';
        let dest = 'images/' + f.name;
        let n = 1;
        while (window.he.exists && await window.he.exists(dest)) {
          n += 1;
          dest = `images/${stem}-${n}${ext}`;
        }
        await window.he.copyInto(srcAbs, dest);
        if (HE.commit) HE.commit();
        elm.setAttribute('src', dest);
        if (HE.afterDomChange) HE.afterDomChange();
        if (HE.canvas && HE.canvas.select) HE.canvas.select(elm);
        if (HE.toast) HE.toast(`Image copied to ${dest}.`, 'success');
      } catch (err) {
        if (HE.toast) HE.toast('Could not copy image: ' + ((err && err.message) || err), 'error');
      }
    });
    body.append(h('div', { class: 'prow' }, h('label', null, 'Replace'), pick));
  }
  if (tag === 'a') {
    body.append(attrRow('Link href', 'href'));
    body.append(h('div', { class: 'muted' }, 'Use relative page paths (about.html) or full https:// URLs.'));
  }
  if (tag === 'input' || tag === 'textarea') {
    body.append(attrRow('Placeholder', 'placeholder'));
  }

  // Find & replace across this page's text — the "change a word" tweak.
  const findWrap = h('details', { class: 'find-replace' });
  findWrap.append(h('summary', null, 'Find & replace on this page'));
  const findInput = h('input', { type: 'text', id: 'find-query', spellcheck: 'false', placeholder: 'Find text…', 'aria-label': 'Find text on this page' });
  const replInput = h('input', { type: 'text', spellcheck: 'false', placeholder: 'Replace with…', 'aria-label': 'Replacement text' });
  const caseBox = h('input', { type: 'checkbox', id: 'find-case' });
  const findStatus = h('div', { class: 'muted find-status' });
  let matches = [];
  let current = -1;
  const refreshMatches = () => {
    matches = (HE.canvas && HE.canvas.doc)
      ? findTextMatches(HE.canvas.doc, findInput.value, { caseSensitive: caseBox.checked })
      : [];
    if (findInput.value) {
      findStatus.textContent = matches.length
        ? `${matches.length} match${matches.length === 1 ? '' : 'es'}`
        : 'No matches';
    } else {
      findStatus.textContent = '';
    }
    return matches;
  };
  const findNext = () => {
    const prev = current;
    refreshMatches();
    if (!matches.length) {
      current = -1;
      return;
    }
    current = (prev < 0 || prev >= matches.length) ? 0 : (prev + 1) % matches.length;
    revealMatch(matches[current]);
    findStatus.textContent = `${current + 1} of ${matches.length}`;
  };
  const replaceOne = () => {
    refreshMatches();
    if (!matches.length) return;
    const match = matches[0];
    if (!match.node || !match.node.nodeValue) return;
    HE.commit();
    const node = match.node;
    node.nodeValue = node.nodeValue.slice(0, match.start) + replInput.value + node.nodeValue.slice(match.end);
    HE.afterDomChange();
    findStatus.textContent = 'Replaced 1';
    current = -1;
    refreshMatches();
    if (matches.length) revealMatch(matches[0]);
  };
  const replaceAll = () => {
    refreshMatches();
    if (!matches.length) return;
    if (!window.confirm(`Replace ${matches.length} match${matches.length === 1 ? '' : 'es'} on this page?`)) return;
    HE.commit();
    const n = replaceTextMatches(HE.canvas.doc, findInput.value, replInput.value, { caseSensitive: caseBox.checked });
    HE.afterDomChange();
    findStatus.textContent = `${n} replaced`;
    current = -1;
    refreshMatches();
  };
  const findRow = h('div', { class: 'prow' }, h('label', null, 'Find'), findInput);
  const replRow = h('div', { class: 'prow' }, h('label', null, 'Replace'), replInput);
  const caseRow = h('label', { class: 'find-case' }, caseBox, ' Match case');
  const findButtons = h('div', { class: 'handoff-actions' });
  const nextBtn = h('button', { type: 'button' }, 'Find next');
  nextBtn.addEventListener('click', findNext);
  const oneBtn = h('button', { type: 'button' }, 'Replace');
  oneBtn.addEventListener('click', replaceOne);
  const allBtn = h('button', { type: 'button' }, 'Replace all');
  allBtn.addEventListener('click', replaceAll);
  findButtons.append(nextBtn, oneBtn, allBtn);
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findNext(); }
    e.stopPropagation();
  });
  findWrap.append(findRow, replRow, caseRow, findButtons, findStatus);
  body.append(findWrap);

  const back = h('button', { type: 'button' }, 'Back to Design mode');
  back.addEventListener('click', () => { if (HE.setContentMode) HE.setContentMode(false); });
  body.append(back);
}

function isColorValue(v) {
  const s = String(v || '').trim();
  return /^(#([0-9a-f]{3,8})|rgb\(|hsl\(|oklch\(|oklab\(|[a-z]+)$/i.test(s) && s.length < 60;
}

function isFontToken(name, value) {
  const key = String(name || '').toLowerCase();
  const raw = String(value || '').trim();
  if (!raw || /font[-_]?size|font[-_]?weight|line[-_]?height|letter[-_]?spacing/.test(key)) return false;
  if (/(^|[-_])(color|background|shadow)([-_]|$)/.test(key) && isColorValue(raw)) return false;
  if (/^[-+]?\d*\.?\d+(px|rem|em|%|vw|vh|ch|ex|lh|rlh)?$/i.test(raw)) return false;
  if (/(font|type|family)/.test(key)) return true;
  const first = fonts.firstFamily(raw);
  if (fonts.findGoogleFont(first)) return true;
  if (fonts.system.some((font) =>
    font.label.toLowerCase() === first.toLowerCase() ||
    fonts.firstFamily(font.css).toLowerCase() === first.toLowerCase())) return true;
  return /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded)(\s*,|$)/i.test(raw);
}

// A range is honest only for inherently bounded values. Anything else keeps
// the number + unit + scrub editor, where the unit sets the natural scale.
function tokenSliderSpec(name, kind) {
  const key = String(name || '').toLowerCase();
  if (kind === 'number' && /(alpha|opacity)/.test(key)) {
    return { min: 0, max: 1, step: 0.01, unit: '' };
  }
  return null;
}

// ---------- Token row actions (kebab menu) ----------
// A single fixed-position menu shared by every token row; opening another row
// closes the previous one. Keeps Rename/Delete out of the row itself.
let openTokenRowMenu = null;
let tokenRowMenuBound = false;

function closeTokenRowMenu() {
  if (!openTokenRowMenu) return;
  const anchor = openTokenRowMenu._anchor;
  openTokenRowMenu.remove();
  openTokenRowMenu = null;
  if (anchor && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'false');
}

function bindTokenRowMenuCloser() {
  if (tokenRowMenuBound) return;
  tokenRowMenuBound = true;
  document.addEventListener('pointerdown', (e) => {
    if (!openTokenRowMenu) return;
    const anchor = openTokenRowMenu._anchor;
    if (openTokenRowMenu.contains(e.target) || (anchor && anchor.contains(e.target))) return;
    closeTokenRowMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!openTokenRowMenu || e.key !== 'Escape') return;
    const anchor = openTokenRowMenu._anchor;
    closeTokenRowMenu();
    if (anchor && anchor.focus) anchor.focus();
  }, true);
  window.addEventListener('resize', closeTokenRowMenu);
  document.addEventListener('scroll', closeTokenRowMenu, true);
}

function showTokenRowMenu(anchor, items) {
  closeTokenRowMenu();
  bindTokenRowMenuCloser();
  const menu = h('div', { class: 'token-row-menu', role: 'menu' });
  for (const item of items) {
    const btn = h('button', {
      type: 'button', role: 'menuitem',
      class: 'token-row-menu-item' + (item.danger ? ' danger' : ''),
    }, item.label);
    btn.addEventListener('click', () => {
      closeTokenRowMenu();
      item.run();
    });
    menu.append(btn);
  }
  menu._anchor = anchor;
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  let top = r.bottom + 4;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  const left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  openTokenRowMenu = menu;
  const first = menu.querySelector('.token-row-menu-item');
  if (first) first.focus();
}

export function buildTokens(body) {
  let vars = [];
  try { vars = activeSheet() && activeSheet().rootVars ? activeSheet().rootVars() : []; } catch { vars = []; }
  let groups = [];
  try { groups = activeSheet() && activeSheet().themeVarGroups ? activeSheet().themeVarGroups() : []; } catch { groups = []; }
  const rootNames = new Set(vars.map((v) => v.name));
  body.append(h('p', { class: 'a11y-help' }, 'Named values reused across the site — like design tokens. Add a value here, then compatible style fields activate their Token menu. Change the value once to update every user.'));
  if (!vars.length && !groups.length) {
    body.append(h('div', { class: 'muted' }, 'No :root variables yet — add your first token below.'));
  }

  const writeValue = (scope, name, next) => {
    if (scope === ':root') {
      if (HE.actions && HE.actions.setRootVar) HE.actions.setRootVar(name, next);
    } else if (HE.actions && HE.actions.setThemeVar) {
      HE.actions.setThemeVar(scope, name, next);
    }
  };

  const renderRow = (v, scope, opts = {}) => {
    const theme = !!opts.theme;
    const nameLabel = h('label', null, v.name);
    if (theme) {
      nameLabel.title = `${v.name} in ${scope}${opts.baseMissing ? ' — declared only in this theme' : ''}`;
      nameLabel.classList.add('token-name-theme');
    } else {
      // The left list is the source of truth: click a name to copy var(--name).
      nameLabel.title = `Click to copy var(${v.name})`;
      nameLabel.classList.add('token-name-copy');
      nameLabel.addEventListener('click', async () => {
        const snippet = `var(${v.name})`;
        try {
          await navigator.clipboard.writeText(snippet);
          if (HE.toast) HE.toast(`Copied ${snippet}`, 'success');
        } catch {
          if (HE.toast) HE.toast(snippet, 'info');
        }
      });
    }
    const rowEl = h('div', { class: 'prow' });
    const wrap = h('div', { class: 'token-row' });
    let usage = { count: 0, selectors: [] };
    try { usage = activeSheet() && activeSheet().varUsages ? activeSheet().varUsages(v.name) : usage; } catch { /* ignore */ }
    const valueTitle = theme
      ? `${v.name} in ${scope} = ${v.value}${opts.baseMissing ? ' — no base :root value' : ''}`
      : usage.count
        ? `var(${v.name}) = ${v.value} — used in ${usage.count} place${usage.count === 1 ? '' : 's'} (${usage.selectors.join(', ')})`
        : `var(${v.name}) = ${v.value} — not used anywhere yet; compatible style fields will activate their Token menu`;
    const kind = tokenType(v.name, v.value);
    let text = null;
    let fontPicker = null;
    if (kind === 'length' || kind === 'time' || kind === 'number') {
      wrap.append(tokenValueControl({
        kind,
        value: v.value,
        label: v.name,
        placeholder: kind === 'time' ? '200ms' : kind === 'length' ? '1rem' : '0.7',
        title: valueTitle,
        slider: tokenSliderSpec(v.name, kind),
        enabled: !!activeEl() || !!HE.sheet,
        onChange: (next) => writeValue(scope, v.name, next),
      }));
    } else {
      text = h('input', { type: 'text', spellcheck: 'false' });
      text.value = v.value;
      text.title = valueTitle;
      text.disabled = !activeEl() && !HE.sheet;
      text.addEventListener('change', () => {
        writeValue(scope, v.name, text.value);
        if (fontPicker && fontPicker.updateValue) fontPicker.updateValue(text.value);
        if (HE.panel && HE.panel.refresh) HE.panel.refresh();
      });
      wrap.append(text);
    }
    if (text && isFontToken(v.name, v.value)) {
      fontPicker = fontTokenPicker(v.value, (next) => {
        text.value = next;
        text.classList.add('is-set');
        writeValue(scope, v.name, next);
      });
      wrap.append(fontPicker);
    }
    if (text && isColorValue(v.value)) {
      const pick = h('input', { type: 'color' });
      try {
        const tmp = document.createElement('div');
        tmp.style.color = v.value;
        document.body.append(tmp);
        const cs = getComputedStyle(tmp).color;
        document.body.removeChild(tmp);
        const m = cs.match(/\d+/g);
        if (m && m.length >= 3) {
          pick.value = '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
        } else pick.value = '#000000';
      } catch { pick.value = '#000000'; }
      pick.title = `Pick color for ${v.name}`;
      pick.addEventListener('input', () => {
        text.value = pick.value;
        writeValue(scope, v.name, pick.value);
      });
      pick.addEventListener('change', () => {
        if (HE.panel && HE.panel.refresh) HE.panel.refresh();
      });
      wrap.append(pick);
    }
    let moreBtn = null;
    if (theme) {
      moreBtn = h('button', {
        type: 'button', class: 'token-row-more',
        'aria-haspopup': 'menu', 'aria-expanded': 'false',
        'aria-label': `Actions for ${v.name} in ${scope}`,
        title: `Actions for ${v.name} in ${scope}`,
      }, '⋯');
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = moreBtn.getAttribute('aria-expanded') === 'true';
        closeTokenRowMenu();
        if (wasOpen) return;
        moreBtn.setAttribute('aria-expanded', 'true');
        showTokenRowMenu(moreBtn, [{
          label: 'Remove override', danger: true,
          run: () => { writeValue(scope, v.name, ''); HE.panel.refresh(); },
        }]);
      });
    } else {
      const doRename = () => {
        const labelEl = nameLabel.isConnected ? nameLabel : rowEl.querySelector('label');
        if (!labelEl || rowEl.querySelector('.token-rename-input')) return;
        const input = h('input', { type: 'text', spellcheck: 'false', class: 'token-rename-input' });
        input.value = v.name;
        input.setAttribute('aria-label', `Rename ${v.name}`);
        input.title = 'Enter commits · Esc cancels';
        labelEl.replaceWith(input);
        input.focus();
        input.select();
        let settled = false;
        const done = (ok) => {
          if (settled) return;
          settled = true;
          if (!ok) {
            if (HE.panel.refresh) HE.panel.refresh();
            return;
          }
          const r = HE.actions && HE.actions.renameRootVar
            ? HE.actions.renameRootVar(v.name, input.value)
            : { ok: false, error: 'Rename is unavailable.' };
          if (!r || !r.ok) {
            if (HE.toast) HE.toast((r && r.error) || 'Rename failed.', 'error');
            if (HE.panel.refresh) HE.panel.refresh();
          } else if (r.count) {
            if (HE.toast) HE.toast(`Renamed — ${r.count} usage${r.count === 1 ? '' : 's'} updated.`, 'success');
          }
          // Success with 0 usages still refreshes via the action.
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') done(true);
          else if (e.key === 'Escape') done(false);
          e.stopPropagation();
        });
        input.addEventListener('blur', () => done(true));
      };
      const doDelete = () => {
        if (usage.count) {
          const where = usage.selectors.length ? ` (${usage.selectors.join(', ')})` : '';
          if (!confirm(`${v.name} is used in ${usage.count} place${usage.count === 1 ? '' : 's'}${where}. Delete it? Those styles will fall back or break.`)) return;
        }
        if (HE.actions && HE.actions.setRootVar) HE.actions.setRootVar(v.name, '');
        HE.panel.refresh();
      };
      moreBtn = h('button', {
        type: 'button', class: 'token-row-more',
        'aria-haspopup': 'menu', 'aria-expanded': 'false',
        'aria-label': `Actions for ${v.name}`,
        title: `Actions for ${v.name}`,
      }, '⋯');
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = moreBtn.getAttribute('aria-expanded') === 'true';
        closeTokenRowMenu();
        if (wasOpen) return;
        moreBtn.setAttribute('aria-expanded', 'true');
        showTokenRowMenu(moreBtn, [
          { label: 'Rename', run: doRename },
          { label: 'Delete', danger: true, run: doDelete },
        ]);
      });
    }
    const head = h('div', { class: 'token-head' }, nameLabel);
    if (theme) {
      head.append(h('span', {
        class: 'token-theme-chip',
        title: `Only applies under ${scope}`,
      }, 'theme'));
    }
    const badge = usage.count
      ? h('span', {
          class: 'token-count',
          title: `Used in: ${usage.selectors.join(', ')}${usage.count > usage.selectors.length ? '…' : ''}`,
        }, `×${usage.count}`)
      : h('span', {
          class: 'token-count unused',
          title: 'Nothing uses this token yet — compatible style fields will activate their Token menu',
        }, 'unused');
    head.append(badge);
    if (moreBtn) head.append(moreBtn);
    rowEl.append(head, wrap);
    body.append(rowEl);
  };

  for (const v of vars) renderRow(v, ':root');

  const addRow = h('div', { class: 'prow' }, h('label', null, 'New'));
  const addWrap = h('div', { class: 'token-row' });
  const nameIn = h('input', { type: 'text', spellcheck: 'false' });
  nameIn.placeholder = '--brand';
  const valIn = h('input', { type: 'text', spellcheck: 'false' });
  valIn.placeholder = '#4f8cff';
  const addBtn = h('button', { type: 'button' }, 'Add');
  addBtn.addEventListener('click', () => {
    const n = nameIn.value.trim();
    if (!n) return;
    if (HE.actions && HE.actions.setRootVar) HE.actions.setRootVar(n, valIn.value.trim() || 'initial');
    HE.panel.refresh();
  });
  addWrap.append(nameIn, valIn, addBtn);
  addRow.append(addWrap);
  body.append(addRow);

  for (const g of groups) {
    body.append(h('div', { class: 'cm-sub' }, `Theme: ${g.label}`));
    body.append(h('div', { class: 'muted' }, `Overrides in ${g.selector} — they win when that theme is active.`));
    for (const v of g.vars) {
      renderRow(v, g.selector, { theme: true, baseMissing: !rootNames.has(v.name) });
    }
  }
}

// ---------- Matching rules (descendant/state/media rules you can edit) ----------

// Selector candidates derived from the element itself: its own class compound
// with attribute states, and ancestor contexts (state classes first).
function ruleCandidates(elm) {
  const out = [];
  if (!elm || !elm.classList || !elm.classList.length) return out;
  const clean = (name) => /^[-_a-zA-Z][-\w]*$/.test(name);
  const elClasses = [...elm.classList].filter(clean);
  if (!elClasses.length) return out;
  const elCompound = '.' + elClasses.join('.');
  const push = (sel) => { if (sel && !out.includes(sel)) out.push(sel); };

  for (const attr of ['aria-selected', 'aria-expanded', 'aria-hidden', 'aria-current']) {
    let v = null;
    try { v = elm.getAttribute(attr); } catch { v = null; }
    if (v == null) continue;
    push(`${elCompound}[${attr}="${v}"]`);
  }
  for (const attr of ['hidden', 'open']) {
    let has = false;
    try { has = elm.hasAttribute(attr); } catch { has = false; }
    if (has) push(`${elCompound}[${attr}]`);
  }

  const chain = [];
  let p = elm.parentElement;
  while (p && p !== elm.ownerDocument.documentElement && chain.length < 5) {
    const cls = [...p.classList].filter(clean);
    if (cls.length) chain.push({ compound: '.' + cls.join('.'), state: cls.some((c) => /^is-/.test(c)) });
    p = p.parentElement;
  }
  chain.sort((a, b) => Number(b.state) - Number(a.state));
  for (const anc of chain.slice(0, 4)) push(`${anc.compound} ${elCompound}`);
  return out.slice(0, 8);
}

export function buildRulesSection(body) {
  const elm = activeEl();
  body.append(h('p', { class: 'a11y-help' },
    'Every stylesheet rule that matches this element. Pick one to edit its declarations directly — including ancestor, state, attribute and breakpoint rules.'));

  let entries = [];
  try {
    entries = (activeSheet() && activeSheet().rulesFor) ? activeSheet().rulesFor(elm) : [];
  } catch { entries = []; }

  const list = h('div', { class: 'rules-list' });
  if (!entries.length) {
    list.append(h('div', { class: 'muted' }, 'No rules match this element yet — style it or add a contextual rule below.'));
  }
  for (const entry of entries.slice(0, 30)) {
    const active = state.activeRule === entry.selector;
    const rowEl = h('div', { class: 'rule-row' + (active ? ' on' : '') });
    const main = h('button', {
      type: 'button', class: 'rule-main',
      title: `${entry.selector}${entry.media ? ` @ ${entry.media}` : ''} — ${entry.decls} declaration${entry.decls === 1 ? '' : 's'}`,
    });
    main.append(h('span', { class: 'rule-sel' }, entry.selector));
    const meta = [];
    if (entry.media) meta.push(entry.media.replace(/^\(\s*max-width:\s*([\d.]+)px\s*\)$/i, '≤$1'));
    if (entry.decls) meta.push(`${entry.decls} decl`);
    if (meta.length) main.append(h('span', { class: 'rule-meta muted' }, meta.join(' · ')));
    main.setAttribute('aria-pressed', active ? 'true' : 'false');
    main.addEventListener('click', () => {
      if (active) HE.actions.setRuleScope(null);
      else HE.actions.setRuleScope(entry);
    });
    rowEl.append(main);
    list.append(rowEl);
  }
  body.append(list);

  const candidates = ruleCandidates(elm);
  if (candidates.length && HE.actions && HE.actions.addRuleScope) {
    const addWrap = h('div', { class: 'rule-add' });
    const addBtn = h('button', {
      type: 'button', class: 'rule-add-btn',
      'aria-haspopup': 'menu', 'aria-expanded': 'false',
      title: 'Create a contextual rule like .accordion.is-open .accordion-panel',
    }, 'Add rule from this element…');
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (addBtn.getAttribute('aria-expanded') === 'true') {
        closeTokenRowMenu();
        return;
      }
      addBtn.setAttribute('aria-expanded', 'true');
      showTokenRowMenu(addBtn, candidates.map((sel) => ({
        label: sel,
        run: () => {
          const r = HE.actions.addRuleScope(sel);
          if (r && !r.ok && HE.toast) HE.toast(r.error || 'Could not add rule.', 'error');
        },
      })));
    });
    addWrap.append(addBtn);
    body.append(addWrap);
  }
}

// ---------- Site check (post-agent-run review) ----------

function siteCheckSelect(item) {
  if (item.page && item.selector && HE.canvas && HE.canvas.doc) {
    let el = null;
    try { el = HE.canvas.doc.querySelector(item.selector); } catch { el = null; }
    if (el && HE.canvas.select) {
      HE.canvas.select(el);
      try { el.scrollIntoView({ block: 'center' }); } catch { /* ignore */ }
      return;
    }
  }
  if (item.file && window.he && window.he.openFile) window.he.openFile(item.file);
}

function siteCheckNavigate(item) {
  if (item.page && item.page !== HE.page && HE.loadPage) {
    HE.loadPage(item.page).then(() => siteCheckSelect(item)).catch(() => { /* ignore */ });
    return;
  }
  siteCheckSelect(item);
}

export function buildSiteCheck(body) {
  body.append(h('p', { class: 'a11y-help' },
    'Reads the saved project files and lists things worth a look after an agent run. Click Go to jump to the page or open the file.'));
  const status = h('div', { class: 'muted site-check-status' });
  const list = h('div', { class: 'site-check-list' });
  const runBtn = h('button', { type: 'button', class: 'site-check-run' }, 'Run check');
  const render = () => {
    list.textContent = '';
    const findings = HE.siteCheckResults;
    if (!Array.isArray(findings)) {
      status.textContent = 'Not run yet — the check reads the saved files.';
      return;
    }
    const when = HE.siteCheckAt
      ? new Date(HE.siteCheckAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    status.textContent = findings.length
      ? `${findings.length} item${findings.length === 1 ? '' : 's'} to review${when ? ` · ${when}` : ''}`
      : `No issues found${when ? ` · ${when}` : ''}`;
    for (const group of groupFindings(findings)) {
      list.append(h('div', { class: 'cm-sub' }, `${group.title} (${group.items.length})`));
      for (const item of group.items.slice(0, 12)) {
        const canGo = !!((item.page && item.selector) || item.file || item.page);
        list.append(a11yNotice(
          item.message,
          item.severity === 'warning' ? 'warning' : 'info',
          canGo ? 'Go' : null,
          canGo ? () => siteCheckNavigate(item) : null
        ));
      }
      if (group.items.length > 12) {
        list.append(h('div', { class: 'muted' }, `+${group.items.length - 12} more`));
      }
    }
  };
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    status.textContent = 'Checking saved files…';
    try {
      HE.siteCheckResults = await runSiteCheck({
        pages: (HE.project && HE.project.pages) || [],
        stylesheets: (HE.project && HE.project.stylesheets) || [],
        readFile: (p) => window.he.readFile(p),
        exists: (p) => window.he.exists(p),
        currentPage: HE.page,
      });
      HE.siteCheckAt = Date.now();
    } catch {
      HE.siteCheckResults = [];
      HE.siteCheckAt = Date.now();
      status.textContent = 'Check failed.';
    }
    runBtn.disabled = false;
    render();
  });
  body.append(runBtn, status, list);
  render();
}

// ---------- Agent handoff note ----------

export function buildChangesSection(body) {
  body.append(h('p', { class: 'a11y-help' },
    'A plain-language summary of your hand edits since the page was loaded or last saved. Copy it into the next agent prompt, or save it as AGENT_HANDOFF.md for the agent to read.'));
  const status = h('div', { class: 'muted site-check-status' });
  const preview = h('pre', { class: 'handoff-preview' });
  const refreshBtn = h('button', { type: 'button' }, 'Refresh');
  const copyBtn = h('button', { type: 'button' }, 'Copy note');
  const saveBtn = h('button', { type: 'button' }, 'Save AGENT_HANDOFF.md');
  const render = (force) => {
    if (force || HE.handoffNoteCache === null || HE.handoffNoteCache === undefined) {
      HE.handoffNoteCache = HE.buildHandoffNote ? HE.buildHandoffNote() : null;
    }
    const result = HE.handoffNoteCache;
    if (!result) {
      status.textContent = 'Open a page to compare it with its loaded baseline.';
      preview.hidden = true;
      return;
    }
    status.textContent = result.count
      ? `${result.count} change${result.count === 1 ? '' : 's'} since the last load/save`
      : 'No changes since the last load/save';
    preview.hidden = false;
    preview.textContent = result.note;
  };
  refreshBtn.addEventListener('click', () => render(true));
  copyBtn.addEventListener('click', () => { void HE.copyHandoffNote(); });
  saveBtn.addEventListener('click', () => { void HE.saveHandoffNote(); });
  body.append(h('div', { class: 'handoff-actions' }, refreshBtn, copyBtn, saveBtn), status, preview);
  render(false);
}

// ---------- Classes manager (B): every class, usage, combos, cleanup ----------
export function buildClassesSection(body) {
  const elm = activeEl();
  body.append(h('p', { class: 'a11y-help' }, 'Every class in the stylesheet with this-page usage. Edit base or combo scope from the Selector above; manage the system here.'));
  let names = [];
  let combos = [];
  try { names = activeSheet() && activeSheet().classNames ? activeSheet().classNames() : []; } catch { names = []; }
  try { combos = activeSheet() && activeSheet().comboSelectors ? activeSheet().comboSelectors() : []; } catch { combos = []; }

  const filter = h('input', { type: 'text', spellcheck: 'false', placeholder: 'Filter classes…', 'aria-label': 'Filter classes' });
  body.append(h('div', { class: 'prow' }, h('label', null, 'Filter'), filter));
  const list = h('div', { class: 'class-manager' });
  body.append(list);

  const renderList = () => {
    const q = filter.value.trim().toLowerCase();
    list.innerHTML = '';
    const shown = names.filter((n) => !q || n.toLowerCase().includes(q));
    if (!shown.length && !combos.length) {
      list.append(h('div', { class: 'muted' }, 'No classes yet — style an element to create one.'));
    }
    for (const name of shown.slice(0, 80)) {
      const count = classUseCount(name);
      const rowEl = h('div', { class: 'cm-row' });
      const label = h('span', { class: 'cm-name', title: `.${name} — ${count} use(s) this page` }, `.${name}`);
      const badge = h('span', { class: 'cm-count' + (count ? '' : ' unused'), title: count ? `${count} element(s) on this page` : 'Unused on this page' },
        count ? `×${count}` : 'unused');
      rowEl.append(label, badge);
      const onEl = !!(elm && elm.classList && elm.classList.contains(name));
      const isActive = state.activeClass === name && !state.activeCombo;
      const useBtn = h('button', { type: 'button', title: onEl ? `Editing .${name} (already on element)` : `Add .${name} to selected element` }, onEl ? (isActive ? 'Editing' : 'Edit') : 'Use');
      useBtn.disabled = !elm || (onEl && isActive);
      useBtn.addEventListener('click', () => {
        if (!elm) return;
        if (elm.classList.contains(name)) {
          state.activeClass = name;
          state.activeCombo = null;
          if (HE.panel.refresh) HE.panel.refresh();
        } else if (HE.actions.attachClass) HE.actions.attachClass(name);
      });
      const renBtn = h('button', { type: 'button', title: `Rename .${name} everywhere` }, 'Rename');
      renBtn.addEventListener('click', () => {
        const input = h('input', { type: 'text', spellcheck: 'false' });
        input.value = name;
        rowEl.replaceWith(input);
        input.focus();
        input.select();
        const done = (ok) => {
          const next = input.value.trim().replace(/^\./, '');
          if (ok && next && next !== name) {
            const v = HE.actions.validateClassName ? HE.actions.validateClassName(next) : { ok: true, value: next };
            if (v.ok && HE.actions.renameClass) HE.actions.renameClass(name, v.value);
            else if (HE.panel.refresh) HE.panel.refresh();
          } else if (HE.panel.refresh) HE.panel.refresh();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') done(true);
          if (e.key === 'Escape') done(false);
          e.stopPropagation();
        });
        input.addEventListener('blur', () => done(true));
      });
      const delBtn = h('button', { type: 'button', title: `Delete .${name} rules (incl. combos + @media)` }, 'Delete');
      delBtn.addEventListener('click', () => {
        if (confirm(`Delete .${name} and every rule containing it (combos, pseudos, @media)?`)) {
          if (HE.actions.deleteClass) HE.actions.deleteClass(name);
        }
      });
      rowEl.append(useBtn, renBtn, delBtn);
      list.append(rowEl);
    }
    if (shown.length > 80) list.append(h('div', { class: 'muted' }, `…and ${shown.length - 80} more — refine the filter.`));
    // Combos live below singles: compound selectors with their own counts.
    const shownCombos = combos.filter((s) => !q || s.toLowerCase().includes(q)).slice(0, 30);
    if (shownCombos.length) {
      list.append(h('div', { class: 'cm-sub' }, 'Combos'));
      for (const sel of shownCombos) {
        const n = compoundUseCount(sel);
        const rowEl = h('div', { class: 'cm-row combo' });
        rowEl.append(
          h('span', { class: 'cm-name', title: `${sel} — ${n} use(s) this page` }, sel),
          h('span', { class: 'cm-count' + (n ? '' : ' unused') }, n ? `×${n}` : 'unused'),
        );
        const parts = sel.split('.').filter(Boolean);
        const canEdit = !!(elm && parts.length === 2 && elm.classList.contains(parts[0]) && elm.classList.contains(parts[1]));
        const editBtn = h('button', { type: 'button', title: canEdit ? `Edit ${sel} on this element` : 'Select an element with both classes to edit' }, 'Edit');
        editBtn.disabled = !canEdit;
        editBtn.addEventListener('click', () => {
          state.activeClass = parts[0];
          state.activeCombo = parts[1];
          if (HE.panel.refresh) HE.panel.refresh();
        });
        const delBtn = h('button', { type: 'button', title: `Delete only ${sel} styles (keep single-class rules)` }, 'Delete styles');
        delBtn.addEventListener('click', () => {
          if (!confirm(`Delete only ${sel} styles? Singles stay.`)) return;
          try {
            if (HE.commit) HE.commit();
            activeSheet().deleteComboRule(sel);
            if (state.activeCombo && sel === '.' + state.activeClass + '.' + state.activeCombo) state.activeCombo = null;
            if (HE.afterDomChange) HE.afterDomChange();
            if (elm && HE.canvas.select) HE.canvas.select(elm);
            else if (HE.panel.refresh) HE.panel.refresh();
          } catch { /* ignore */ }
        });
        rowEl.append(editBtn, delBtn);
        list.append(rowEl);
      }
    }
  };
  filter.addEventListener('input', renderList);
  filter.addEventListener('keydown', (e) => e.stopPropagation());
  renderList();

  // Purity tools live here in Design (not in Element/Content):
  // promote inline styles to a class, merge identical class rules.
  try {
    const hasInline = !!(elm && elm.hasAttribute && elm.hasAttribute('style') && (elm.getAttribute('style') || '').trim());
    const promoteBtn = h('button', { type: 'button', class: 'purity-btn' }, 'Promote inline styles to class');
    promoteBtn.disabled = !hasInline;
    promoteBtn.title = hasInline
      ? 'Move style="" declarations onto a class via HE.sheet.set, then remove style'
      : 'Selected element has no inline styles';
    promoteBtn.addEventListener('click', () => {
      if (HE.actions && HE.actions.promoteInlineStyles) HE.actions.promoteInlineStyles();
    });
    body.append(h('div', { class: 'prow' }, h('label', null, 'Inline'), promoteBtn));
  } catch { /* best-effort */ }
  // Duplicates summary (merge lives here in Design).
  try {
    const groups = activeSheet() && activeSheet().findDuplicateRules ? activeSheet().findDuplicateRules() : [];
    const dupCount = groups.reduce((n, g) => n + g.classes.length - 1, 0);
    if (dupCount) {
      const mergeBtn = h('button', { type: 'button', class: 'purity-btn' }, `Merge duplicates (${dupCount})`);
      mergeBtn.title = groups.map((g) => g.selectors.join(' = ')).join('\n');
      mergeBtn.addEventListener('click', () => {
        if (HE.actions && HE.actions.mergeDuplicateClasses) HE.actions.mergeDuplicateClasses();
      });
      body.append(mergeBtn);
      body.append(h('div', { class: 'muted' }, groups.map((g) => g.selectors.join(' = ')).join(' · ')));
    } else {
      body.append(h('div', { class: 'muted' }, `${names.length} class${names.length === 1 ? '' : 'es'} · ${combos.length} combo${combos.length === 1 ? '' : 's'} · no duplicates.`));
    }
  } catch { /* best-effort */ }
}

// ---------- CSS sections ----------

export function buildSpacing(body) {
  const linked = { margin: false, padding: false };
  const groups = {
    margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
    padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  };
  const controls = { margin: [], padding: [] };
  // When a group is linked, one write fans out to every side and the sibling
  // fields refresh in place (no panel refresh, so typing focus is kept).
  const mirror = (group) => (next) => {
    if (!linked[group]) return;
    groups[group].forEach((p, index) => {
      HE.actions.setStyle(p, next);
      const sibling = controls[group][index];
      if (sibling && sibling.heSync) sibling.heSync(next);
    });
  };
  const margin = (prop) => {
    const control = sizeControl(prop, '0', {
      compact: true, tokenMenu: false, onValue: mirror('margin'),
    });
    controls.margin[groups.margin.indexOf(prop)] = control;
    return control;
  };
  const padding = (prop) => {
    const control = sizeControl(prop, '0', {
      compact: true,
      noNegative: true,
      tokenMenu: false,
      onValue: mirror('padding'),
    });
    controls.padding[groups.padding.indexOf(prop)] = control;
    return control;
  };
  const field = (label, prop, control) => h('label', { class: 'bm-field' },
    h('span', { class: 'bm-field-label' }, label),
    control,
    originEl(prop),
  );
  const linkToggle = (group) => {
    const button = h('button', {
      type: 'button',
      class: 'bm-link',
      'aria-pressed': 'false',
      'aria-label': `Link all ${group} sides`,
      title: `Link all ${group} sides — editing one sets all four`,
    }, '⛓');
    button.addEventListener('click', () => {
      linked[group] = !linked[group];
      button.classList.toggle('on', linked[group]);
      button.setAttribute('aria-pressed', String(linked[group]));
    });
    return button;
  };
  const layer = (label, className, fields, center = null, group = '') => h('div', { class: className },
    h('div', { class: 'bm-label' }, label, group ? linkToggle(group) : null),
    h('div', { class: 'bm-fields' }, ...fields, center),
  );
  const box = h('div', { class: 'boxmodel' },
    layer('Margin', 'bm-margin', [
      field('Top', 'margin-top', margin('margin-top')),
      field('Right', 'margin-right', margin('margin-right')),
      field('Bottom', 'margin-bottom', margin('margin-bottom')),
      field('Left', 'margin-left', margin('margin-left')),
    ], null, 'margin'),
    layer('Padding', 'bm-padding', [
      field('Top', 'padding-top', padding('padding-top')),
      field('Right', 'padding-right', padding('padding-right')),
      field('Bottom', 'padding-bottom', padding('padding-bottom')),
      field('Left', 'padding-left', padding('padding-left')),
    ], h('div', { class: 'bm-content' }, activeEl() ? activeEl().tagName.toLowerCase() : ''), 'padding'),
  );
  body.append(box);
}

export function buildLayout(body) {
  const sel = activeSelector();
  const display = (sel && activeSheet().get(sel, 'display')) || computed('display');
  body.append(segRow('Display', 'display', ['block', 'flex', 'inline-flex', 'grid', 'inline-block', 'inline', 'none']));
  if (display === 'flex' || display === 'inline-flex') {
    body.append(segRow('Direction', 'flex-direction', ['row', 'row-reverse', 'column', 'column-reverse']));
    body.append(selectRow('Justify', 'justify-content', ['normal', 'start', 'end', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly', 'stretch']));
    body.append(selectRow('Align', 'align-items', ['normal', 'stretch', 'start', 'end', 'flex-start', 'center', 'flex-end', 'baseline']));
    body.append(selectRow('Wrap', 'flex-wrap', ['nowrap', 'wrap', 'wrap-reverse']));
    body.append(sizeRow('Gap', 'gap', '0', { noNegative: true, allowClamp: true }));
  }
  if (display === 'grid') {
    body.append(row('Columns', 'grid-template-columns', 'e.g. 1fr 1fr 1fr'));
    body.append(row('Rows', 'grid-template-rows', 'auto'));
    body.append(selectRow('Align', 'align-items', ['normal', 'stretch', 'start', 'end', 'center', 'flex-start', 'flex-end', 'baseline']));
    body.append(selectRow('Justify', 'justify-items', ['normal', 'stretch', 'start', 'end', 'center', 'flex-start', 'flex-end', 'self-start', 'self-end']));
    body.append(sizeRow('Gap', 'gap', '0', { noNegative: true, allowClamp: true }));
  }
}

const ASPECT_RATIO_PRESETS = [
  ['auto', 'Auto'],
  ['1 / 1', 'Square · 1:1'],
  ['4 / 3', 'Classic · 4:3'],
  ['3 / 2', 'Photo · 3:2'],
  ['16 / 9', 'Widescreen · 16:9'],
  ['21 / 9', 'Ultrawide · 21:9'],
  ['3 / 4', 'Portrait · 3:4'],
  ['2 / 3', 'Portrait · 2:3'],
  ['9 / 16', 'Vertical · 9:16'],
];

export function buildSize(body) {
  const boxSizing = ['auto', 'min-content', 'max-content', 'fit-content'];
  body.append(sizeRow('Width', 'width', 'auto', { keywords: boxSizing, noNegative: true, allowClamp: true }));
  body.append(sizeRow('Height', 'height', 'auto', { keywords: boxSizing, noNegative: true, allowClamp: true }));
  body.append(sizeRow('Min W', 'min-width', 'auto', { keywords: boxSizing, noNegative: true, allowClamp: true }));
  body.append(sizeRow('Min H', 'min-height', 'auto', { keywords: boxSizing, noNegative: true, allowClamp: true }));
  body.append(sizeRow('Max W', 'max-width', 'none', { keywords: ['none', ...boxSizing], noNegative: true, allowClamp: true }));
  body.append(sizeRow('Max H', 'max-height', 'none', { keywords: ['none', ...boxSizing], noNegative: true, allowClamp: true }));
  body.append(selectRow('Overflow', 'overflow', ['visible', 'hidden', 'clip', 'auto', 'scroll']));
  body.append(selectRow('Box', 'box-sizing', ['content-box', 'border-box']));
  body.append(presetRow('Ratio', 'aspect-ratio', ASPECT_RATIO_PRESETS, 'e.g. 16 / 9'));
}

export function buildPosition(body) {
  body.append(segRow('Position', 'position', ['static', 'relative', 'absolute', 'fixed', 'sticky']));
  body.append(h('div', { class: 'prow2' },
    withOrigin('top', sizeControl('top', 'auto', { keywords: ['auto'] })),
    withOrigin('right', sizeControl('right', 'auto', { keywords: ['auto'] })),
  ));
  body.append(h('div', { class: 'prow2' },
    withOrigin('bottom', sizeControl('bottom', 'auto', { keywords: ['auto'] })),
    withOrigin('left', sizeControl('left', 'auto', { keywords: ['auto'] })),
  ));
  body.append(stepperRow('Z-index', 'z-index', {
    step: 1, placeholder: 'auto',
    title: 'Stacking order — higher numbers draw in front. Empty = auto.',
  }));
}

const FONT_WEIGHT_OPTIONS = [
  ['100', '100 — Thin'],
  ['200', '200 — Extra Light'],
  ['300', '300 — Light'],
  ['400', '400 — Regular'],
  ['500', '500 — Medium'],
  ['600', '600 — Semi Bold'],
  ['700', '700 — Bold'],
  ['800', '800 — Extra Bold'],
  ['900', '900 — Black'],
  ['normal', 'normal'],
  ['bold', 'bold'],
];

function typeContext() {
  const sel = activeSelector();
  const viewport = (HE && HE.viewport) || 'desktop';
  const pseudo = state.pseudo || '';
  if (!sel) {
    const note = h('div', { class: 'type-context muted' }, 'No class yet — the first edit creates one.');
    note.title = 'Typography edits write to a class rule, never inline.';
    return note;
  }
  let media = '';
  try { media = viewportMedia() || ''; } catch { media = ''; }
  const scope = state.activeClass && state.activeCombo ? 'variant' : 'base';
  const text = viewport === 'desktop'
    ? `Editing ${sel}${pseudo} — ${scope} class`
    : `Editing ${sel}${pseudo} @${viewport} — saves inside @media ${media || viewport}`;
  const note = h('div', { class: 'type-context muted' }, text);
  note.title = viewport === 'desktop'
    ? `Typography writes to ${sel}${pseudo || ''}. Empty fields show the current rendered value.`
    : `Breakpoint override: empty fields fall back to the desktop value; typing saves an @media override on ${sel}${pseudo || ''}.`;
  return note;
}

function typeSpecimen() {
  const wrap = h('div', { class: 'type-specimen', 'aria-label': 'Typography preview' });
  const elm = activeEl();
  if (!elm) {
    wrap.append(h('div', { class: 'type-specimen-text muted', 'aria-hidden': 'true' }, 'Ag'));
    return wrap;
  }
  const pick = (prop) => {
    try { return (computed(prop) || '').trim(); } catch { return ''; }
  };
  const family = pick('font-family');
  const weight = pick('font-weight');
  const style = pick('font-style');
  const size = pick('font-size');
  const height = pick('line-height');
  const spacing = pick('letter-spacing');
  const color = pick('color');
  const transform = pick('text-transform');
  const decoration = pick('text-decoration-line') || pick('text-decoration');
  const align = pick('text-align');
  const direction = pick('direction');
  const sample = h('div', { class: 'type-specimen-text', 'aria-hidden': 'true' }, 'Ag Aa 123');
  try {
    if (family) sample.style.fontFamily = family;
    if (weight) sample.style.fontWeight = weight;
    if (style) sample.style.fontStyle = style;
    if (size) sample.style.fontSize = size;
    if (height) sample.style.lineHeight = height;
    if (spacing) sample.style.letterSpacing = spacing;
    if (color) sample.style.color = color;
    if (transform && transform !== 'none') sample.style.textTransform = transform;
    if (decoration && decoration !== 'none') sample.style.textDecoration = decoration;
    if (align) sample.style.textAlign = align;
    if (direction) sample.style.direction = direction;
  } catch { /* preview is best-effort */ }
  const friendlyFamily = (fonts.displayName(family) || fonts.firstFamily(family) || 'System').slice(0, 24);
  const metaBits = [friendlyFamily, weight || '', size || ''].filter(Boolean);
  const meta = h('div', { class: 'type-specimen-meta muted' }, metaBits.join(' · '));
  meta.title = [family, weight && `weight ${weight}`, size && `size ${size}`,
    height && `line-height ${height}`, spacing && `tracking ${spacing}`].filter(Boolean).join(' · ');
  wrap.append(sample, meta);
  return wrap;
}

export function buildTypography(body) {
  const field = (label, prop, control, className = '') => h(
    'div',
    { class: `prow type-field${className ? ` ${className}` : ''}` },
    h('label', { class: 'type-field-label' }, label),
    withOrigin(prop, control),
  );
  const grid = (...fields) => h('div', { class: 'type-grid' }, ...fields);
  const hint = (text) => h('div', { class: 'type-hint muted' }, text);
  const group = (title, name, ...fields) => h(
    'fieldset',
    { class: `type-group type-group-${name}`, 'data-type-group': name },
    h('legend', { class: 'type-group-title' }, title),
    h('div', { class: 'type-group-fields' }, ...fields),
  );

  body.append(typeContext(), typeSpecimen());
  body.append(
    group('Font', 'font',
      field('Family', 'font-family', fontPickerControl(), 'type-field-wide'),
      grid(
        field('Weight', 'font-weight', selectControl('font-weight', FONT_WEIGHT_OPTIONS)),
        field('Style', 'font-style', selectControl('font-style', ['normal', 'italic'])),
      ),
    ),
    group('Sizing', 'sizing',
      field('Size', 'font-size', sizeControl('font-size', '16', { noNegative: true, allowClamp: true })),
      grid(
        field('Line height', 'line-height', sizeControl('line-height', '1.5', {
          keywords: ['normal'], allowUnitless: true, noNegative: true,
          unitMode: 'unitless', advanced: true,
          slider: { min: 0.8, max: 3, step: 0.05, unit: 'unitless' },
        })),
        field('Letter spacing', 'letter-spacing', sizeControl('letter-spacing', '0', {
          keywords: ['normal'], simpleUnits: ['px', 'em', 'rem'], advanced: true,
        })),
      ),
      hint('Line height: unitless 1.5 = × font size (fluid). Letter spacing needs a unit. More options under Advanced.'),
    ),
    group('Paragraph', 'paragraph',
      field('Alignment', 'text-align', segControl('text-align', ['left', 'center', 'right', 'justify'], {
        group: 'Text alignment', left: 'Left', center: 'Center', right: 'Right', justify: 'Justify',
      }), 'type-alignment'),
    ),
    group('Appearance', 'appearance',
      field('Color', 'color', colorControl('color'), 'type-field-wide type-color'),
      grid(
        field('Decoration', 'text-decoration', selectControl('text-decoration', ['none', 'underline', 'line-through'])),
        field('Transform', 'text-transform', selectControl('text-transform', ['none', 'uppercase', 'lowercase', 'capitalize'])),
      ),
    ),
  );
}

const BACKGROUND_SIZE_PRESETS = [
  ['auto', 'Auto'],
  ['cover', 'Cover — fill the box'],
  ['contain', 'Contain — fit inside'],
  ['100% 100%', 'Stretch 100% × 100%'],
  ['100% auto', 'Full width'],
  ['auto 100%', 'Full height'],
];

const BACKGROUND_POSITION_PRESETS = [
  ['center', 'Center'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['left top', 'Top left'],
  ['right top', 'Top right'],
  ['left bottom', 'Bottom left'],
  ['right bottom', 'Bottom right'],
];

const BACKGROUND_REPEAT_PRESETS = [
  ['no-repeat', 'No repeat'],
  ['repeat', 'Repeat (tile both ways)'],
  ['repeat-x', 'Repeat horizontally'],
  ['repeat-y', 'Repeat vertically'],
  ['space', 'Space evenly'],
  ['round', 'Round to fit'],
];

export function buildBackground(body) {
  const hint = (text) => h('div', { class: 'type-hint muted' }, text);
  const group = (title, name, ...fields) => h(
    'fieldset',
    { class: 'type-group type-group-bg', 'data-type-group': name },
    h('legend', { class: 'type-group-title' }, title),
    h('div', { class: 'type-group-fields' }, ...fields),
  );
  // Common cases are a preset dropdown; Custom keeps the raw text field for
  // the comma-separated per-layer syntax. One value per layer, in the same
  // top-to-bottom order as Layers. Keep any cascade tooltip textControl already
  // set; only fill in the per-layer explanation when there is none.
  const listField = (label, prop, placeholder, about, presets) => {
    const control = presets
      ? presetControl(prop, presets, placeholder)
      : textControl(prop, placeholder);
    const input = (control.querySelector && (control.querySelector('select') || control.querySelector('input'))) || control;
    if (input && !input.title) input.title = about;
    else if (input && input.title && !/per layer/i.test(input.title)) {
      input.title = `${input.title} — ${about.charAt(0).toLowerCase()}${about.slice(1)}`;
    }
    const lab = h('label', { title: prop }, label);
    return h('div', { class: 'prow' }, lab, withOrigin(prop, control));
  };

  const scrollControl = selectControl('background-attachment', [
    ['scroll', 'With the page'],
    ['local', 'With the box content'],
  ], 'With the page (default)');
  const scrollSelect = (scrollControl.querySelector && scrollControl.querySelector('select')) || scrollControl;
  if (scrollSelect) {
    scrollSelect.title = 'Who moves the background when you scroll. One value per layer, same order as Layers above; a single value covers every layer.';
  }
  const scrollRow = h('div', { class: 'prow' },
    h('label', { title: 'background-attachment' }, 'Scroll'), withOrigin('background-attachment', scrollControl));

  body.append(
    hint('Color is the back wall. Layers paint on top of it — layer 1 in front.'),
    group('Color · everywhere', 'color',
      h('div', { class: 'prow' }, h('label', { title: 'background-color' }, 'Color'), withOrigin('background-color', colorControl('background-color'))),
      hint('One color for the whole box, behind every layer. Shows only where layers are transparent or absent.'),
    ),
    group('Layers · stacked', 'layers',
      h('div', { class: 'prow background-layers-prow' }, h('label', { title: 'background-image' }, 'Layers'), withOrigin('background-image', backgroundLayersControl())),
      hint('Each layer is drawn as an image. Its size, placement and tiling are set below under Fit.'),
    ),
    group('Fit · how each layer is drawn', 'fit',
      hint('These describe each layer as an image. A gradient’s own direction, shape and center live in its editor above — not here.'),
      listField('Size', 'background-size', 'cover',
        'How each layer is scaled (cover, contain, 100% 50%). One value per layer, in the same order as Layers above; a single value applies to every layer.', BACKGROUND_SIZE_PRESETS),
      listField('Position', 'background-position', 'center',
        'Where each layer sits inside the box (center, top left, 50% 20%). Layer placement — not the gradient’s own center. One value per layer, in Layers order.', BACKGROUND_POSITION_PRESETS),
      listField('Repeat', 'background-repeat', 'no-repeat',
        'Whether each layer tiles (no-repeat, repeat, repeat-x). One value per layer, in the same order as Layers above; a single value applies to every layer.', BACKGROUND_REPEAT_PRESETS),
      hint('Pick a preset for the common cases, or Custom… to type one value per layer — comma-separated: first value → layer 1 (front), second → layer 2, and so on. A single value applies to all layers.'),
    ),
    group('Scroll · how layers move', 'scroll',
      scrollRow,
      hint('“With the page” moves on page scroll. “With the box content” moves when this box’s own content scrolls — only visible on scrollable boxes.'),
    ),
  );
}

export function buildBorder(body) {
  // Preview + name per option so the look (solid/dashed/dotted/none)
  // is visible directly in the native dropdown for both selects.
  const styleOptions = [
    ['none', '∅ none'],
    ['solid', '━━━ solid'],
    ['dashed', '╌╌╌ dashed'],
    ['dotted', '●●● dotted'],
  ];
  body.append(sizeRow('Width', 'border-width', '0', { noNegative: true }));
  body.append(selectRow('Style', 'border-style', styleOptions));
  body.append(h('div', { class: 'prow' }, h('label', null, 'Color'), withOrigin('border-color', colorControl('border-color'))));
  body.append(sizeRow('Radius', 'border-radius', '0', { noNegative: true }));
  // Outline is the rarely-needed sibling: same W/S/C idea, but drawn
  // outside the border without taking layout space (focus rings, not frames).
  const outline = h('details', { class: 'border-advanced' });
  outline.append(
    h('summary', { class: 'border-advanced-summary' }, 'Outline · advanced'),
    h('div', { class: 'type-hint muted' }, 'Outline draws outside the border and never moves layout — for focus rings, not permanent frames.'),
    sizeRow('Outline W', 'outline-width', '0', { noNegative: true }),
    selectRow('Outline S', 'outline-style', styleOptions),
    h('div', { class: 'prow' }, h('label', null, 'Outline C'), withOrigin('outline-color', colorControl('outline-color'))),
    sizeRow('Outline O', 'outline-offset', '0', {}),
  );
  body.append(outline);
}

const SHADOW_PRESETS = [
  ['none', 'None'],
  ['0 1px 2px rgba(0, 0, 0, 0.08)', 'Subtle'],
  ['0 2px 6px rgba(0, 0, 0, 0.12)', 'Small'],
  ['0 6px 16px rgba(0, 0, 0, 0.16)', 'Medium'],
  ['0 12px 32px rgba(0, 0, 0, 0.22)', 'Large'],
  ['0 0 0 3px rgba(79, 140, 255, 0.35)', 'Focus ring'],
  ['inset 0 1px 3px rgba(0, 0, 0, 0.15)', 'Inset'],
];

const TRANSITION_PRESETS = [
  ['none', 'None'],
  ['all 0.15s ease', 'Fast · 150ms'],
  ['all 0.2s ease', 'Base · 200ms'],
  ['all 0.3s ease-out', 'Slow · 300ms'],
  ['background-color 0.2s ease, color 0.2s ease', 'Colors'],
  ['transform 0.2s ease', 'Transform'],
  ['opacity 0.2s ease', 'Opacity'],
];

const TRANSFORM_PRESETS = [
  ['none', 'None'],
  ['scale(1.05)', 'Scale up'],
  ['scale(0.95)', 'Scale down'],
  ['translateY(-2px)', 'Lift'],
  ['rotate(3deg)', 'Rotate 3°'],
  ['translateX(-50%)', 'Center X'],
];

export function buildEffects(body) {
  body.append(opacityRow('Opacity', 'opacity'));
  body.append(presetRow('Shadow', 'box-shadow', SHADOW_PRESETS, 'e.g. 0 2px 6px rgba(0,0,0,.2)'));
  body.append(presetRow('Transition', 'transition', TRANSITION_PRESETS, 'e.g. opacity 0.2s ease'));
  body.append(presetRow('Transform', 'transform', TRANSFORM_PRESETS, 'e.g. rotate(3deg)'));
  body.append(selectRow('Cursor', 'cursor', [
    'auto', 'default', 'pointer', 'text', 'move', 'grab', 'grabbing',
    'crosshair', 'not-allowed', 'wait', 'help', 'zoom-in', 'zoom-out',
  ]));
}

// ---------- Custom CSS properties ----------

// Properties with a dedicated control elsewhere in the panel, mapped to the
// section that owns them. The Custom CSS section lists everything else so
// authors can reach properties the presets do not cover without duplicating
// preset rows; writing an owned property updates its control instead. Keep in
// sync with the section builders above.
const PRESET_STYLE_OWNERS = new Map([
  ['display', 'Layout'], ['flex-direction', 'Layout'], ['justify-content', 'Layout'],
  ['align-items', 'Layout'], ['flex-wrap', 'Layout'], ['gap', 'Layout'],
  ['grid-template-columns', 'Layout'], ['grid-template-rows', 'Layout'], ['justify-items', 'Layout'],
  ['width', 'Size'], ['height', 'Size'], ['min-width', 'Size'], ['min-height', 'Size'],
  ['max-width', 'Size'], ['max-height', 'Size'], ['overflow', 'Size'], ['box-sizing', 'Size'],
  ['aspect-ratio', 'Size'],
  ['position', 'Position'], ['top', 'Position'], ['right', 'Position'], ['bottom', 'Position'],
  ['left', 'Position'], ['z-index', 'Position'],
  ['margin-top', 'Spacing'], ['margin-right', 'Spacing'], ['margin-bottom', 'Spacing'], ['margin-left', 'Spacing'],
  ['padding-top', 'Spacing'], ['padding-right', 'Spacing'], ['padding-bottom', 'Spacing'], ['padding-left', 'Spacing'],
  ['font-family', 'Typography'], ['font-weight', 'Typography'], ['font-style', 'Typography'],
  ['font-size', 'Typography'], ['line-height', 'Typography'], ['letter-spacing', 'Typography'],
  ['text-align', 'Typography'], ['color', 'Typography'], ['text-decoration', 'Typography'], ['text-transform', 'Typography'],
  ['background-color', 'Background'], ['background-image', 'Background'], ['background-size', 'Background'],
  ['background-position', 'Background'], ['background-repeat', 'Background'], ['background-attachment', 'Background'],
  ['border-width', 'Border'], ['border-style', 'Border'], ['border-color', 'Border'], ['border-radius', 'Border'],
  ['outline-width', 'Border'], ['outline-style', 'Border'], ['outline-color', 'Border'], ['outline-offset', 'Border'],
  ['opacity', 'Effects'], ['box-shadow', 'Effects'], ['transition', 'Effects'],
  ['transform', 'Effects'], ['cursor', 'Effects'],
]);
const PRESET_STYLE_PROPERTIES = new Set(PRESET_STYLE_OWNERS.keys());

// Common properties the presets do not cover — datalist hints for the add row.
// Authors can still type anything else.
const CUSTOM_PROP_SUGGESTIONS = [
  'align-self', 'justify-self', 'place-items', 'place-content', 'order', 'flex',
  'flex-grow', 'flex-shrink', 'flex-basis', 'grid-column', 'grid-row',
  'grid-area', 'column-gap', 'row-gap', 'inset',
  'object-fit', 'object-position', 'float', 'clear', 'visibility',
  'pointer-events', 'user-select', 'overflow-x', 'overflow-y',
  'inline-size', 'block-size', 'min-inline-size', 'max-inline-size',
  'text-overflow', 'white-space', 'text-shadow', 'text-indent', 'text-wrap',
  'word-break', 'overflow-wrap', 'hyphens', 'vertical-align', 'writing-mode',
  'font-variant', 'text-decoration-thickness', 'text-underline-offset',
  'list-style', 'list-style-type', 'background-clip', 'background-origin',
  'mask-image', 'filter', 'backdrop-filter', 'mix-blend-mode', 'isolation',
  'will-change', 'scroll-behavior', 'scroll-margin-top', 'scroll-snap-type',
  'border-collapse', 'table-layout', 'accent-color', 'caret-color', 'resize',
];

const CSS_PROPERTY_RE = /^(?:--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)$/;

// Declarations authored on the active selector in the active scope (media,
// combo, pseudo and simulated-state suffix included). Preset controls write
// through the same set/setMedia path, so this reads exactly what they own.
function activeScopeDeclarations() {
  const sel = activeSelector();
  if (!sel || !activeSheet()) return [];
  const collect = (rule) => {
    const out = [];
    if (!rule || !rule.style) return out;
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style.item(i);
      const value = rule.style.getPropertyValue(prop);
      const priority = rule.style.getPropertyPriority(prop);
      out.push({ prop, value: priority ? `${value} !${priority}` : value });
    }
    return out;
  };
  try {
    const media = viewportMedia();
    if (media && typeof activeSheet().findRuleInMedia === 'function') {
      return collect(activeSheet().findRuleInMedia(media, sel));
    }
    return collect(activeSheet().findRule(sel));
  } catch {
    return [];
  }
}

export function buildCustomSection(body) {
  const sel = activeSelector();
  const viewport = (HE && HE.viewport) || 'desktop';
  body.append(h('p', { class: 'a11y-help' },
    'Write any CSS property the sections above do not cover. Values land on the active class — never inline.'));
  if (sel) {
    let media = '';
    try { media = viewportMedia() || ''; } catch { media = ''; }
    const scope = state.activeClass && state.activeCombo ? 'variant' : 'base';
    const note = viewport === 'desktop'
      ? `Writing to ${sel}${state.pseudo || ''} — ${scope} class.`
      : `Writing to ${sel}${state.pseudo || ''} @${viewport} — saves inside @media ${media || viewport}.`;
    body.append(h('div', { class: 'type-hint muted' }, note));
  } else {
    body.append(h('div', { class: 'type-hint muted' },
      'The first property you add creates a class for this element — no inline styles.'));
  }

  const list = h('div', { class: 'custom-props' });
  const renderList = () => {
    list.innerHTML = '';
    const decls = activeScopeDeclarations()
      .filter((d) => !PRESET_STYLE_PROPERTIES.has(d.prop.toLowerCase()));
    if (!decls.length) {
      list.append(h('div', { class: 'muted custom-props-empty' }, 'No custom properties yet — add one below.'));
      return;
    }
    for (const d of decls) {
      const rowEl = h('div', { class: 'custom-prop-row' });
      rowEl.append(h('code', { class: 'custom-prop-name', title: d.prop }, d.prop));
      const val = h('input', { type: 'text', spellcheck: 'false', class: 'custom-prop-value' });
      val.value = d.value;
      val.title = `${d.prop} on ${sel || 'the active selector'}`;
      val.addEventListener('change', () => {
        HE.actions.setStyle(d.prop, val.value.trim(), { now: true });
      });
      val.addEventListener('keydown', (e) => e.stopPropagation());
      const rm = h('button', {
        type: 'button', class: 'custom-prop-del',
        'aria-label': `Remove ${d.prop}`, title: `Remove ${d.prop}`,
      }, '×');
      rm.addEventListener('click', () => {
        HE.actions.setStyle(d.prop, '', { now: true });
        HE.panel.refresh();
      });
      rowEl.append(val, rm);
      list.append(rowEl);
    }
  };
  renderList();
  body.append(list);

  const suggestions = h('datalist', { id: 'custom-prop-suggestions' });
  for (const p of CUSTOM_PROP_SUGGESTIONS) suggestions.append(h('option', { value: p }));
  const propIn = h('input', {
    type: 'text', spellcheck: 'false', class: 'custom-prop-name-input',
    placeholder: 'property', list: 'custom-prop-suggestions',
    'aria-label': 'CSS property name',
  });
  const valIn = h('input', {
    type: 'text', spellcheck: 'false', class: 'custom-prop-value',
    placeholder: 'value', 'aria-label': 'CSS value',
  });
  const addBtn = h('button', { type: 'button', class: 'custom-prop-add' }, 'Add');
  const addProp = () => {
    const p = propIn.value.trim();
    const v = valIn.value.trim();
    if (!CSS_PROPERTY_RE.test(p) || !v) return;
    HE.actions.setStyle(p, v, { now: true });
    HE.panel.refresh();
    const owner = PRESET_STYLE_OWNERS.get(p.toLowerCase());
    if (owner && HE.toast) {
      HE.toast(`${p} is edited in ${owner} — the control above now shows it.`, 'info');
    }
  };
  addBtn.addEventListener('click', addProp);
  valIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addProp(); e.stopPropagation(); });
  propIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') valIn.focus(); e.stopPropagation(); });
  const addRow = h('div', { class: 'custom-prop-row custom-prop-add-row' }, propIn, valIn, addBtn);
  body.append(suggestions, addRow);
}
