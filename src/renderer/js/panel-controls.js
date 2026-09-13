// Panel controls — generic CSS control factories (text/size/select/segmented/
// color/gradient/font) used by the panel sections.

import { HE } from './he.js';
import { h } from './dom.js';
import { fonts } from './fonts.js';
import { parseColor, formatColor, colorFormat, toHex, contrastRatio } from './color.js';
import { compatibleTokens, parseVarRef, tokenKindsForProperty } from './tokens.js';
import {
  state, activeEl, activeSelector, computed, displayValue, originEl, withOrigin,
} from './panel-core.js';
import {
  parseBackgroundLayers, serializeBackgroundLayers, backgroundLayerKind,
  backgroundLayerLabel, reorderBackgroundLayers,
} from './background.js';
import {
  parseGradient, serializeGradient, gradientAngle, formatGradientAngle,
  parseRadialPosition, formatRadialPosition, stopPercent, sampleGradientColor,
} from './gradient.js';

function controlLabel(prop) {
  return String(prop || '').replace(/-/g, ' ');
}

// Round a scrub/slider number to the current step's decimal precision so
// 0.05 steps do not accumulate float noise (1.2000000000000002).
function roundToStep(value, step) {
  const s = Number(step) > 0 ? Number(step) : 0.1;
  const decimals = (String(s).split('.')[1] || '').length;
  return Number((Math.round(value / s) * s).toFixed(decimals));
}

// Drag-to-scrub: press and drag the number field horizontally to change the
// value, like a slider without the track. A click that does not move keeps the
// field's normal focus/typing behavior. Shift = finer, Alt = coarser.
function makeScrubbable(input, readStep) {
  let startX = 0;
  let startValue = 0;
  let active = false;
  let moved = false;
  input.classList.add('is-scrubbable');
  input.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || input.disabled) return;
    startX = event.clientX;
    startValue = Number(input.value) || 0;
    active = true;
    moved = false;
    try { input.setPointerCapture(event.pointerId); } catch { /* ignore */ }
  });
  input.addEventListener('pointermove', (event) => {
    if (!active) return;
    const dx = event.clientX - startX;
    if (!moved && Math.abs(dx) < 3) return;
    if (!moved) {
      moved = true;
      input.blur();
      input.classList.add('is-scrubbing');
    }
    const step = Number(readStep && readStep()) || 0.1;
    const scale = event.shiftKey ? 0.1 : event.altKey ? 10 : 1;
    const next = roundToStep(startValue + dx * step * scale, step);
    input.value = String(next);
    input.classList.toggle('is-set', true);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const finish = (event) => {
    if (!active) return;
    active = false;
    input.classList.remove('is-scrubbing');
    try { input.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  };
  input.addEventListener('pointerup', finish);
  input.addEventListener('pointercancel', finish);
}

export function textControl(prop, placeholder, options = {}) {
  const sel = activeSelector();
  const values = displayValue(sel, prop);
  // Combo scope never names inheritance: bare value as the grey hint.
  const comboScope = !!(state.activeClass && state.activeCombo);
  const input = h('input', { type: 'text', spellcheck: 'false' });
  input.value = values.value;
  if (values.isOverride && !values.value && values.base) input.placeholder = values.base + ' (desktop)';
  else if (!values.value && values.base && values.base !== values.value) input.placeholder = comboScope ? values.base : values.base + ' (base)';
  else input.placeholder = placeholder !== undefined ? placeholder : computed(prop);
  if (values.isOverride && values.value) input.title = `Tablet/mobile override of desktop ${values.base || ''}`.trim();
  else if (!values.value && values.base) input.title = comboScope
    ? `${values.base} applies here — typing overrides it on ${sel || 'class'}`
    : `Inherits ${values.base} from base — typing creates a combo override on ${sel || 'class'}`;
  else if (values.declared !== values.value) input.title = values.declared ? `Resolved from ${values.declared}` : '';
  else if (/var\(\s*(--[A-Za-z0-9-_]+)/i.test(values.value || '')) {
    const tn = values.value.match(/var\(\s*(--[A-Za-z0-9-_]+)/i)[1];
    input.title = `Uses var(${tn}) — edit it in the Tokens section to update everywhere`;
  }
  if (values.declared) input.classList.add('is-set');
  input.disabled = !activeEl();
  input.addEventListener('input', () => {
    HE.actions.setStyle(prop, input.value);
    input.classList.toggle('is-set', !!input.value.trim());
  });
  if (options.tokenMenu === false) return input;
  return withTokenMenu(input, prop, tokenKindsForProperty(prop));
}

export function row(label, prop, placeholder) {
  return h('div', { class: 'prow' }, h('label', null, label), withOrigin(prop, textControl(prop, placeholder)));
}

const SIZE_UNITS = [
  ['px', 'px', '1'],
  ['rem', 'rem', '0.05'],
  ['em', 'em', '0.05'],
  ['%', '%', '1'],
  ['vw', 'vw', '0.1'],
  ['svw', 'svw', '0.1'],
  ['lvw', 'lvw', '0.1'],
  ['dvw', 'dvw', '0.1'],
  ['vh', 'vh', '0.1'],
  ['svh', 'svh', '0.1'],
  ['lvh', 'lvh', '0.1'],
  ['dvh', 'dvh', '0.1'],
  ['vmin', 'vmin', '0.1'],
  ['vmax', 'vmax', '0.1'],
  ['ch', 'ch', '0.1'],
];

function parsedSize(value) {
  const match = (value || '').trim().match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))([a-z%]*)$/i);
  if (!match) return null;
  return { number: match[1], unit: match[2].toLowerCase() };
}

export function numericSizeValue(value, unit) {
  const number = String(value == null ? '' : value).trim();
  if (!number) return '';
  return unit === 'unitless' ? number : number + unit;
}

function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(str || '')) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  parts.push(cur);
  return parts.map((s) => s.trim());
}

// clamp(min, preferred, max) — returns [min, preferred, max] or null.
function parseClamp(value) {
  const t = String(value || '').trim();
  const m = t.match(/^clamp\(\s*([\s\S]+)\s*\)$/i);
  if (!m) return null;
  const parts = splitTopLevelCommas(m[1]);
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  return parts;
}

export function sizeControl(prop, placeholder, options = {}) {
  const sel = activeSelector();
  const values = displayValue(sel, prop);
  const raw = (values.value || '').trim();
  const keywords = options.keywords || [];
  const unitValues = new Set(SIZE_UNITS.map((unit) => unit[0]));
  const parsed = parsedSize(raw);
  const isUnitless = parsed && !parsed.unit;
  const isNumeric = parsed && (unitValues.has(parsed.unit) || (isUnitless && (options.allowUnitless || parsed.number === '0')));
  // Simple-first mode: everyday values stay in the primary row and the rest
  // (normal, unusual units, custom/clamp, tokens) folds into Advanced so a
  // unitless line-height reads like plain CSS.
  const advancedMode = !!options.advanced;
  const unitMode = options.unitMode === 'unitless' ? 'unitless' : 'units';
  const simpleUnitSet = Array.isArray(options.simpleUnits) ? new Set(options.simpleUnits) : null;
  let advancedDetails = null;
  let advancedOpen = false;
  let unitlessMark = null;
  const wrap = h('div', { class: 'size-control' + (options.compact ? ' compact' : '') });
  // Chromium localizes <input type="number"> display to the OS locale
  // (1.05 renders as 1,05 on comma-decimal systems) while text inputs and
  // the stylesheet always use periods. Pin to en-US so every size field
  // reads and writes the same standardized separator.
  const input = h('input', { type: 'number', class: 'size-number', spellcheck: 'false', lang: 'en-US' });
  const unit = h('select', { class: 'size-unit', 'aria-label': `${prop} unit`, title: 'Unit — choose custom for calc()/clamp()/var()' });
  const custom = h('input', { type: 'text', class: 'size-custom', spellcheck: 'false' });
  input.setAttribute('aria-label', `${controlLabel(prop)} value`);
  custom.setAttribute('aria-label', `${controlLabel(prop)} custom value`);
  const preset = options.allowClamp
    ? h('select', { class: 'size-preset', 'aria-label': `${prop} sizing mode`, title: 'Choose Fixed for one value or Clamp for Min / Preferred / Max' })
    : null;
  // Structured clamp() editor: Min / Preferred / Max as three separate fields
  // instead of one long unreadable string. Raw text stays available via toggle.
  const clampBox = h('div', { class: 'clamp-fields', hidden: '' });
  const minIn = h('input', { type: 'text', spellcheck: 'false', class: 'clamp-min', 'aria-label': `${prop} minimum`, placeholder: '12px' });
  const prefIn = h('input', { type: 'text', spellcheck: 'false', class: 'clamp-fluid', 'aria-label': `${prop} preferred fluid value`, placeholder: '1rem + 1vw' });
  const maxIn = h('input', { type: 'text', spellcheck: 'false', class: 'clamp-max', 'aria-label': `${prop} maximum`, placeholder: '18px' });
  const rawToggle = h('button', { type: 'button', class: 'clamp-raw-toggle', title: 'Show the raw clamp() text for copy/paste' }, 'raw');
  let clampMode = false; // structured 3-field view vs single raw text
  let rawMode = false;
  let tokenMenu = null;
  // Optional range for values with a natural, bounded range (line-height,
  // letter-spacing, gap, border-radius). It only appears when the number is
  // in the spec's unit; every other unit keeps the number/custom editor.
  const sliderSpec = options.slider || null;
  const slider = sliderSpec
    ? h('input', {
        type: 'range', class: 'size-slider',
        min: String(sliderSpec.min), max: String(sliderSpec.max), step: String(sliderSpec.step),
        'aria-label': `${controlLabel(prop)} slider`,
      })
    : null;

  // Single write path so link/mirror callbacks observe every authored change.
  const applyStyle = (next) => {
    HE.actions.setStyle(prop, next);
    if (typeof options.onValue === 'function') options.onValue(next);
  };

  for (const [value, label, step] of SIZE_UNITS) {
    const option = h('option', { value }, label);
    option.dataset.step = step;
    unit.append(option);
  }
  if (options.allowUnitless) unit.append(h('option', { value: 'unitless' }, 'unitless'));
  for (const keyword of keywords) unit.append(h('option', { value: keyword }, keyword));
  unit.append(h('option', { value: 'custom' }, 'custom'));
  if (preset) {
    preset.append(h('option', { value: 'fixed' }, 'Fixed'));
    preset.append(h('option', { value: 'clamp' }, 'Clamp'));
  }

  input.placeholder = placeholder !== undefined && parsedSize(String(placeholder)) ? placeholder : '0';
  const comboScope = !!(state.activeClass && state.activeCombo);
  if (!raw && values.base) {
    if (comboScope) {
      input.title = `${values.base} applies here — typing overrides it on ${sel || 'class'}`;
      custom.title = `${values.base} applies here — typing overrides it. Any valid CSS size, including calc() or clamp()`;
      if (advancedMode || !parsedSize(String(placeholder))) input.placeholder = String(values.base).slice(0, 24);
    } else {
      input.title = `Inherits ${values.base} from base — typing creates a combo override on ${sel || 'class'}`;
      custom.title = `Base is ${values.base} — typing creates a combo override. Any valid CSS size, including calc() or clamp()`;
      if (advancedMode || !parsedSize(String(placeholder))) input.placeholder = `${values.base} (base)`.slice(0, 24);
    }
  } else {
    input.title = values.declared !== values.value
      ? `Resolved from ${values.declared}`
      : options.compact
        ? 'Drag left/right or use ↑/↓ to adjust — or type a value'
        : 'Drag left/right or use ↑/↓ to adjust — or choose a CSS unit';
    custom.title = 'Any valid CSS size, including calc() or clamp()';
  }
  custom.placeholder = !raw && values.base ? (comboScope ? values.base : `${values.base} (base)`) : 'e.g. calc(100% - 2rem)';
  custom.value = raw;

  let selected = unitMode === 'unitless' ? 'unitless' : 'px';
  if (isNumeric) selected = isUnitless && options.allowUnitless ? 'unitless' : (parsed.unit || 'px');
  else if (keywords.includes(raw)) selected = raw;
  else if (!raw && keywords.includes(String(placeholder))) selected = String(placeholder);
  else if (raw) selected = 'custom';
  unit.value = selected;
  let lastUnit = selected;

  const isKeyword = () => keywords.includes(unit.value);
  const isCustom = () => unit.value === 'custom';
  const simpleOption = (value) => {
    if (unitMode === 'unitless') return value === 'unitless';
    if (!simpleUnitSet) return true;
    return simpleUnitSet.has(value);
  };
  const applySimpleOptions = () => {
    if (!advancedMode) return;
    for (const option of unit.options) {
      // Never hide the current selection or the select can look blank.
      option.hidden = !advancedOpen && !simpleOption(option.value) && option.value !== unit.value;
    }
  };
  const isSimpleValue = () => {
    if (!advancedMode) return true;
    if (!raw) return true;
    if (isKeyword()) return simpleOption(unit.value);
    if (isCustom()) return false;
    if (unitMode === 'unitless') return !!(isUnitless || (parsed && parsed.number === '0'));
    const p = parsedSize(raw);
    if (!p || !p.unit) return true;
    return simpleOption(p.unit);
  };
  const syncClampInputs = (parts) => {
    if (!parts) return;
    if (document.activeElement !== minIn) minIn.value = parts[0] || '';
    if (document.activeElement !== prefIn) prefIn.value = parts[1] || '';
    if (document.activeElement !== maxIn) maxIn.value = parts[2] || '';
  };
  const composeClamp = () => {
    const a = minIn.value.trim();
    const b = prefIn.value.trim();
    const c = maxIn.value.trim();
    if (!a && !b && !c) {
      applyStyle('');
      custom.value = '';
      return;
    }
    // Do not turn an unfinished form into clamp(0, 0, 0). Keep the last
    // valid CSS value until all three parts are present.
    if (!a || !b || !c) return;
    const next = `clamp(${a}, ${b}, ${c})`;
    custom.value = next;
    applyStyle(next);
    custom.classList.toggle('is-set', true);
    clampBox.classList.add('is-set');
  };
  const updateVisibility = () => {
    const numeric = !isKeyword() && !isCustom();
    input.hidden = !numeric;
    const showCustom = isCustom() && (!clampMode || rawMode);
    custom.hidden = !showCustom;
    // Clamp grid shows when custom + clampMode + not rawMode.
    clampBox.hidden = !(isCustom() && clampMode && !rawMode);
    rawToggle.hidden = !(isCustom() && clampMode);
    wrap.classList.toggle('has-clamp', isCustom() && clampMode);
    input.disabled = !activeEl() || !numeric;
    custom.disabled = !activeEl() || !showCustom;
    const clampDisabled = !activeEl();
    minIn.disabled = clampDisabled;
    prefIn.disabled = clampDisabled;
    maxIn.disabled = clampDisabled;
    rawToggle.disabled = !activeEl();
    unit.disabled = !activeEl();
    if (preset) preset.disabled = !activeEl();
    if (tokenMenu) tokenMenu.button.disabled = !activeEl();
    unit.title = `Unit: ${unit.value} — custom holds calc()/clamp()/var()`;
    input.classList.toggle('is-set', !!values.declared);
    custom.classList.toggle('is-set', !!values.declared);
    clampBox.classList.toggle('is-set', !!values.declared);
    if (numeric) {
      const selectedOption = unit.options[unit.selectedIndex];
      input.step = selectedOption && selectedOption.dataset.step || '0.1';
      input.min = options.noNegative ? '0' : '';
    }
    if (slider) {
      // Only offer the slider when the current value is a plain number in the
      // spec's unit — anything else (other unit, keyword, custom, clamp) keeps
      // the full numeric/custom editor and hides the track.
      const showSlider = numeric && !!input.value.trim() && (
        sliderSpec.unit === 'unitless' ? unit.value === 'unitless' : unit.value === sliderSpec.unit
      );
      slider.hidden = !showSlider;
      slider.disabled = !activeEl() || !showSlider;
      if (showSlider) slider.value = input.value;
    }
    if (advancedMode && advancedDetails) {
      // Keep Advanced open while the current value needs a unit/keyword that
      // the simple row cannot show (normal, %, vw, custom, ...).
      const showAdvanced = advancedOpen || !isSimpleValue();
      advancedOpen = showAdvanced;
      if (advancedDetails.open !== showAdvanced) advancedDetails.open = showAdvanced;
      // In unitless mode the unit select itself lives behind Advanced.
      unit.hidden = !(unitMode !== 'unitless' || showAdvanced);
      applySimpleOptions();
      if (unitlessMark) unitlessMark.hidden = !(numeric && unitMode === 'unitless' && !showAdvanced);
    }
    if (tokenMenu) tokenMenu.sync();
  };
  const setNumericValue = () => {
    const next = numericSizeValue(input.value, unit.value);
    if (!next) {
      applyStyle('');
      return;
    }
    applyStyle(next);
  };

  if (isNumeric) input.value = parsed.number;
  if (options.noNegative) input.min = '0';
  // Initialise clamp state: structured view when the value (or its base)
  // is a clamp(). Placeholders fall back to the base clamp's parts.
  const initialClamp = parseClamp(raw);
  const baseClamp = !raw && values.base ? parseClamp(values.base) : null;
  {
    if (initialClamp) {
      clampMode = true;
      syncClampInputs(initialClamp);
    } else if (baseClamp) {
      clampMode = true;
      unit.value = 'custom';
      lastUnit = 'custom';
      minIn.placeholder = `${baseClamp[0]} (base)`;
      prefIn.placeholder = `${baseClamp[1]} (base)`;
      maxIn.placeholder = `${baseClamp[2]} (base)`;
    }
    minIn.title = 'Minimum — never smaller than this, e.g. 2.5rem or var(--fs-min)';
    prefIn.title = 'Preferred fluid value — scales with the viewport, e.g. 1.5rem + 3vw';
    maxIn.title = 'Maximum — never larger than this, e.g. 4rem or var(--fs-max)';
  }
  if (preset) preset.value = initialClamp || baseClamp ? 'clamp' : 'fixed';
  input.addEventListener('input', () => {
    setNumericValue();
    input.classList.toggle('is-set', !!input.value.trim());
    if (slider) updateVisibility();
  });
  if (slider) {
    slider.addEventListener('input', () => {
      input.value = slider.value;
      setNumericValue();
      input.classList.toggle('is-set', !!input.value.trim());
    });
  }
  custom.addEventListener('input', () => {
    applyStyle(custom.value);
    custom.classList.toggle('is-set', !!custom.value.trim());
    const parts = parseClamp(custom.value);
    if (parts) {
      clampMode = true;
      rawMode = false;
      syncClampInputs(parts);
      if (preset) preset.value = 'clamp';
    } else if (custom.value.trim()) {
      // Left clamp territory (calc/var/plain) — keep raw single field.
      clampMode = false;
      if (preset) preset.value = 'fixed';
    } else {
      clampMode = false;
      rawMode = false;
      if (preset) preset.value = 'fixed';
    }
    updateVisibility();
  });
  for (const el of [minIn, prefIn, maxIn]) {
    el.addEventListener('input', () => {
      composeClamp();
    });
    el.addEventListener('keydown', (e) => e.stopPropagation());
  }
  rawToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    rawMode = !rawMode;
    rawToggle.textContent = rawMode ? 'fields' : 'raw';
    rawToggle.title = rawMode ? 'Back to Min/Preferred/Max fields' : 'Show the raw clamp() text for copy/paste';
    updateVisibility();
    (rawMode ? custom : minIn).focus();
  });
  const openClampMode = () => {
    const parts = parseClamp(custom.value);
    if (!parts) {
      custom.value = '';
      minIn.value = '';
      prefIn.value = '';
      maxIn.value = '';
    } else {
      syncClampInputs(parts);
    }
    unit.value = 'custom';
    lastUnit = 'custom';
    clampMode = true;
    rawMode = false;
    rawToggle.textContent = 'raw';
    if (preset) preset.value = 'clamp';
    updateVisibility();
    minIn.focus();
  };
  if (preset) {
    preset.addEventListener('change', () => {
      if (preset.value === 'clamp') {
        openClampMode();
        return;
      }
      clampMode = false;
      rawMode = false;
      rawToggle.textContent = 'raw';
      const computedValue = parsedSize(computed(prop));
      const computedUnit = computedValue && computedValue.unit;
      const computedIsNumeric = computedValue && (
        unitValues.has(computedUnit) ||
        (!computedUnit && (options.allowUnitless || computedValue.number === '0'))
      );
      if (computedIsNumeric && isCustom()) {
        input.value = computedValue.number;
        unit.value = computedUnit || 'unitless';
        lastUnit = unit.value;
        custom.value = '';
        applyStyle(computedValue.unit ? `${computedValue.number}${computedValue.unit}` : computedValue.number);
      }
      updateVisibility();
    });
  }
  unit.addEventListener('change', () => {
    const previousValue = lastUnit === 'custom'
      ? custom.value
      : keywords.includes(lastUnit)
        ? lastUnit
        : input.value && (lastUnit === 'unitless' ? input.value : input.value + lastUnit);
    if (isCustom()) {
      custom.value = previousValue || raw;
      const parts = parseClamp(custom.value);
      if (parts) {
        clampMode = true;
        rawMode = false;
        syncClampInputs(parts);
        if (preset) preset.value = 'clamp';
      } else if (preset && !custom.value) {
        // Fresh switch to custom with nothing set: start a clamp template
        // so Min/Preferred/Max are immediately usable.
        clampMode = true;
        rawMode = false;
        minIn.value = '';
        prefIn.value = '';
        maxIn.value = '';
        preset.value = 'clamp';
      } else {
        if (preset) preset.value = 'fixed';
      }
    } else {
      clampMode = false;
      rawMode = false;
      if (preset) preset.value = 'fixed';
      if (isKeyword()) {
        applyStyle(unit.value);
      } else if (input.value.trim()) {
        // An empty number means the user has not chosen a fixed value yet.
        // Do not manufacture 0px/0em when switching away from custom CSS.
        setNumericValue();
      }
    }
    lastUnit = unit.value;
    updateVisibility();
  });

  if (options.tokenMenu !== false) {
    tokenMenu = createTokenMenu(prop, options.allowUnitless ? ['length', 'number'] : ['length'], {
      refresh: false,
      onSelect: (token) => {
        custom.value = `var(${token.name})`;
        unit.value = 'custom';
        lastUnit = 'custom';
        clampMode = false;
        rawMode = false;
        if (preset) preset.value = 'fixed';
        applyStyle(custom.value);
        custom.classList.add('is-set');
        updateVisibility();
        custom.focus();
      },
    });
  }

  const minLab = h('label', { class: 'clamp-label' }, 'Min', minIn);
  const prefLab = h('label', { class: 'clamp-label' }, 'Preferred', prefIn);
  const maxLab = h('label', { class: 'clamp-label' }, 'Max', maxIn);
  clampBox.append(minLab, prefLab, maxLab, rawToggle);
  // Primary row: the everyday number, plus either a short unit list (units
  // mode) or a bare × marker (unitless mode). Everything else is advanced.
  if (unitMode === 'unitless') {
    unitlessMark = h('span', {
      class: 'size-unitless-mark',
      title: 'Unitless multiplier of the font size, e.g. 1.5',
    }, '×');
  }
  wrap.append(input);
  if (unitMode === 'unitless') wrap.append(unitlessMark);
  wrap.append(unit);
  if (preset) wrap.append(preset);
  if (tokenMenu) wrap.append(tokenMenu.button);
  if (slider) wrap.append(slider);
  if (advancedMode) {
    advancedDetails = h('details', { class: 'size-advanced' });
    advancedDetails.append(h('summary', {
      class: 'size-advanced-summary',
      title: 'All units, normal, custom/clamp values and tokens',
    }, options.advancedLabel || 'Advanced'));
    advancedDetails.append(custom, clampBox);
    advancedDetails.addEventListener('toggle', () => {
      advancedOpen = advancedDetails.open;
      updateVisibility();
    });
    wrap.append(advancedDetails);
  } else {
    wrap.append(custom, clampBox);
  }
  // The token menu stays outside the folded details so it can pop open over
  // the panel even while Advanced is collapsed.
  if (tokenMenu) wrap.append(tokenMenu.menu);
  if (options.scrub !== false) {
    makeScrubbable(input, () => {
      if (slider && !slider.hidden) return Number(sliderSpec.step) || 1;
      const selectedOption = unit.options[unit.selectedIndex];
      return Number(selectedOption && selectedOption.dataset.step) || 0.1;
    });
  }
  // External sync used by linked spacing groups: refresh the display for a
  // value authored elsewhere without writing CSS or firing input events.
  wrap.heSync = (next) => {
    const value = String(next == null ? '' : next).trim();
    const p = parsedSize(value);
    const numericNext = p && (unitValues.has(p.unit) || (!p.unit && (options.allowUnitless || p.number === '0')));
    if (numericNext) {
      if (document.activeElement !== input) input.value = p.number;
      unit.value = p.unit || (options.allowUnitless ? 'unitless' : 'px');
      lastUnit = unit.value;
      if (custom.value) custom.value = '';
      clampMode = false;
      rawMode = false;
      if (preset) preset.value = 'fixed';
    } else if (value) {
      if (document.activeElement !== custom) custom.value = value;
      unit.value = 'custom';
      lastUnit = 'custom';
      clampMode = false;
      rawMode = false;
      if (preset) preset.value = 'fixed';
    } else {
      if (document.activeElement !== input) input.value = '';
      if (document.activeElement !== custom) custom.value = '';
    }
    updateVisibility();
  };
  updateVisibility();
  return wrap;
}

export function sizeRow(label, prop, placeholder, options) {
  return h('div', { class: 'prow' }, h('label', null, label), withOrigin(prop, sizeControl(prop, placeholder, options)));
}

// The value a select renders right now when the class declares nothing.
// Computed styles can carry extra parts (e.g. "none solid rgb(0, 0, 0)" for
// text-decoration), so match the option values against the whole string and
// then its first token before giving up.
function effectiveSelectValue(prop, optionValues) {
  if (state.pseudo) return '';
  const match = (raw) => {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return '';
    for (const v of optionValues) {
      if (String(v).trim().toLowerCase() === value) return String(v);
    }
    const first = value.split(/\s+/)[0];
    for (const v of optionValues) {
      if (String(v).trim().toLowerCase() === first) return String(v);
    }
    return '';
  };
  let raw = '';
  try { raw = computed(prop) || ''; } catch { raw = ''; }
  const found = match(raw);
  if (found) return found;
  if (prop === 'text-decoration') {
    let line = '';
    try { line = computed('text-decoration-line') || ''; } catch { line = ''; }
    return match(line);
  }
  return '';
}

export function selectControl(prop, options, emptyLabel = '—') {
  const sel = activeSelector();
  const values = displayValue(sel, prop);
  const current = values.value;
  const select = h('select', { 'aria-label': controlLabel(prop) });
  const emptyOption = h('option', { value: '' }, emptyLabel);
  select.append(emptyOption);
  const optionValues = [];
  for (const opt of options) {
    // Options may be plain values ('bold') or [value, label] pairs
    // (['400', '400 — Regular']) so variant names stay human-readable
    // while the authored CSS value is unchanged.
    const value = Array.isArray(opt) ? opt[0] : opt;
    const label = Array.isArray(opt) ? opt[1] : opt;
    optionValues.push(value);
    const o = h('option', { value }, label);
    if (current === value) o.selected = true;
    select.append(o);
  }
  // Nothing authored on this class still answers "what is rendering now?":
  // the dash keeps meaning "not set here", and the effective value follows it
  // so a browser/global default is visible without being written to CSS.
  let effective = '';
  if (!current) {
    effective = effectiveSelectValue(prop, optionValues);
    if (effective) {
      emptyOption.textContent = `${emptyLabel} · ${effective}`;
      select.classList.add('is-empty');
    }
  }
  if (!current && values.base) {
    const comboScope = !!(state.activeClass && state.activeCombo);
    select.title = comboScope
      ? `${values.base} applies here — choosing overrides it on ${sel || 'class'}`
      : `Inherits ${values.base} from base — choosing creates a combo override on ${sel || 'class'}`;
  } else if (effective) {
    select.title = (state.activeClass && state.activeCombo)
      ? `${effective} applies here — choosing writes it on ${sel || 'class'}`
      : `Effective now: ${effective} (not set on ${sel || 'this element'}) — choosing writes it on ${sel || 'a new class'}`;
  }
  select.disabled = !activeEl();
  select.addEventListener('change', () => HE.actions.setStyle(prop, select.value));
  return withTokenMenu(select, prop, tokenKindsForProperty(prop));
}

export function selectRow(label, prop, options, emptyLabel) {
  return h('div', { class: 'prow' }, h('label', null, label), withOrigin(prop, selectControl(prop, options, emptyLabel)));
}

// Opacity is a plain 0–1 scalar, so a slider plus a compact number field
// replaces the full-width text box. Values the slider cannot show (calc(),
// var() targets, percentages outside range) stay editable in a text fallback.
function parseOpacityNumber(raw) {
  const t = String(raw == null ? '' : raw).trim();
  if (!t) return null;
  const m = t.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(%?)$/);
  if (!m) return null;
  const n = Number(m[1]) / (m[2] === '%' ? 100 : 1);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

function formatOpacityNumber(n) {
  return String(Number(Number(n).toFixed(3)));
}

export function opacityControl(prop) {
  const sel = activeSelector();
  const values = displayValue(sel, prop);
  const comboScope = !!(state.activeClass && state.activeCombo);
  const declared = (values.declared || '').trim();
  const declaredVar = parseVarRef(values.declared);
  const effective = ((values.value || values.base || '').trim()) || (computed(prop) || '').trim();
  const numeric = parseOpacityNumber(effective);
  const useNumeric = numeric != null;

  const wrap = h('div', { class: 'opacity-control' });
  const range = h('input', {
    type: 'range', min: '0', max: '1', step: '0.01',
    class: 'opacity-range', 'aria-label': `${controlLabel(prop)} slider`,
  });
  const number = h('input', {
    type: 'number', min: '0', max: '1', step: '0.01', lang: 'en-US',
    class: 'opacity-number', spellcheck: 'false', 'aria-label': `${controlLabel(prop)} value`,
  });
  const custom = h('input', {
    type: 'text', class: 'opacity-custom', spellcheck: 'false',
    'aria-label': `${controlLabel(prop)} custom value`,
    placeholder: 'e.g. calc(1 - 0.2)',
  });

  if (useNumeric) {
    range.value = formatOpacityNumber(numeric);
    number.value = formatOpacityNumber(numeric);
  } else {
    custom.value = values.value || values.base || '';
  }
  range.hidden = !useNumeric;
  number.hidden = !useNumeric;
  custom.hidden = useNumeric;
  number.classList.toggle('is-set', !!declared);
  custom.classList.toggle('is-set', !!declared);

  if (!declared && values.base) {
    const hint = comboScope
      ? `${values.base} applies here — typing overrides it on ${sel || 'class'}`
      : `Inherits ${values.base} from base — typing creates a combo override on ${sel || 'class'}`;
    number.title = hint;
    custom.title = hint;
  } else if (declaredVar) {
    const hint = `Uses ${declaredVar.name} — edit it in the Tokens section to update everywhere`;
    number.title = hint;
    custom.title = hint;
  } else {
    range.title = 'Drag to set opacity — 0 is invisible, 1 is fully opaque';
    number.title = 'Opacity from 0 (transparent) to 1 (opaque)';
    custom.title = 'Any valid CSS opacity, including calc() or var()';
  }

  const disabled = !activeEl();
  range.disabled = disabled || !useNumeric;
  number.disabled = disabled || !useNumeric;
  custom.disabled = disabled || useNumeric;

  const write = (next) => {
    HE.actions.setStyle(prop, next);
    number.classList.toggle('is-set', !!String(next).trim());
    custom.classList.toggle('is-set', !!String(next).trim());
  };
  range.addEventListener('input', () => {
    const next = formatOpacityNumber(range.value);
    number.value = next;
    write(next);
  });
  number.addEventListener('input', () => {
    if (!number.value.trim()) { write(''); return; }
    const n = parseOpacityNumber(number.value);
    if (n == null) return;
    range.value = formatOpacityNumber(n);
    write(formatOpacityNumber(n));
  });
  custom.addEventListener('input', () => write(custom.value));

  wrap.append(range, number, custom);
  return withTokenMenu(wrap, prop, tokenKindsForProperty(prop));
}

export function opacityRow(label, prop) {
  return h('div', { class: 'prow' }, h('label', null, label), withOrigin(prop, opacityControl(prop)));
}

// Preset + custom: named everyday values live in a dropdown; picking Custom
// reveals the free-text field for anything unusual, so no expressiveness is lost.
const PRESET_CUSTOM = '__custom__';

// The stylesheet reads values back through CSSOM, which canonicalizes shorthands
// (e.g. box-shadow color-first with px units). Normalize both sides through the
// same engine before comparing so a chosen preset still selects after refresh.
let presetProbe = null;
function normalizeCssValue(prop, value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  try {
    if (!presetProbe) presetProbe = document.createElement('div');
    presetProbe.removeAttribute('style');
    presetProbe.style.setProperty(prop, raw);
    const normalized = (presetProbe.style.getPropertyValue(prop) || '').trim();
    return normalized || raw.toLowerCase().replace(/\s+/g, ' ');
  } catch {
    return raw.toLowerCase().replace(/\s+/g, ' ');
  }
}

export function presetControl(prop, presets, placeholder) {
  const sel = activeSelector();
  const values = displayValue(sel, prop);
  const comboScope = !!(state.activeClass && state.activeCombo);
  const declared = (values.declared || '').trim();
  const presetValues = presets.map((p) => (Array.isArray(p) ? p[0] : p));
  const declaredNorm = declared ? normalizeCssValue(prop, declared) : '';
  const match = declared
    ? presetValues.find((v) => normalizeCssValue(prop, v) === declaredNorm)
    : '';
  let effectiveEntry = null;
  if (!declared) {
    const resolved = ((values.value || values.base || '').trim()) || (computed(prop) || '').trim();
    const resolvedNorm = resolved ? normalizeCssValue(prop, resolved) : '';
    effectiveEntry = resolvedNorm
      ? presets.find((p) => normalizeCssValue(prop, Array.isArray(p) ? p[0] : p) === resolvedNorm) || null
      : null;
  }
  const effectiveLabel = effectiveEntry ? (Array.isArray(effectiveEntry) ? effectiveEntry[1] : effectiveEntry) : '';

  const select = h('select', { class: 'preset-select', 'aria-label': controlLabel(prop) });
  const emptyOption = h('option', { value: '' }, effectiveLabel ? `— · ${effectiveLabel}` : '—');
  select.append(emptyOption);
  for (const p of presets) {
    const pv = Array.isArray(p) ? p[0] : p;
    const pl = Array.isArray(p) ? p[1] : p;
    select.append(h('option', { value: pv }, pl));
  }
  select.append(h('option', { value: PRESET_CUSTOM }, 'Custom…'));
  if (match) select.value = match;
  else if (declared) select.value = PRESET_CUSTOM;

  const custom = h('input', {
    type: 'text', class: 'preset-custom', spellcheck: 'false',
    'aria-label': `${controlLabel(prop)} custom value`,
    placeholder: placeholder || 'custom value',
  });
  if (declared && !match) custom.value = values.value || declared;
  custom.hidden = select.value !== PRESET_CUSTOM;
  if (declared) custom.classList.add('is-set');

  if (!declared && values.base) {
    select.title = comboScope
      ? `${values.base} applies here — choosing overrides it on ${sel || 'class'}`
      : `Inherits ${values.base} from base — choosing creates a combo override on ${sel || 'class'}`;
  } else if (effectiveLabel) {
    select.title = `Effective now: ${effectiveLabel} (not set on ${sel || 'this element'}) — choosing writes it on ${sel || 'a new class'}`;
  }
  select.classList.toggle('is-empty', !declared && !!effectiveLabel);

  const disabled = !activeEl();
  select.disabled = disabled;
  custom.disabled = disabled;

  select.addEventListener('change', () => {
    if (select.value === PRESET_CUSTOM) {
      if (!custom.value) custom.value = (values.value || '').trim();
      custom.hidden = false;
      custom.focus();
      return;
    }
    HE.actions.setStyle(prop, select.value);
    select.classList.remove('is-empty');
    custom.hidden = true;
    custom.value = '';
  });
  custom.addEventListener('input', () => {
    HE.actions.setStyle(prop, custom.value);
    custom.classList.toggle('is-set', !!custom.value.trim());
  });

  return withTokenMenu(h('div', { class: 'preset-control' }, select, custom), prop, tokenKindsForProperty(prop));
}

export function presetRow(label, prop, presets, placeholder) {
  return h('div', { class: 'prow' }, h('label', null, label), withOrigin(prop, presetControl(prop, presets, placeholder)));
}

// Small integer values (z-index, layer order) have no natural range, so a
// number field with − / + steppers beats both a slider and a bare text box.
export function stepperControl(prop, options = {}) {
  const sel = activeSelector();
  const values = displayValue(sel, prop);
  const step = Number(options.step) > 0 ? Number(options.step) : 1;
  const comboScope = !!(state.activeClass && state.activeCombo);
  const wrap = h('div', { class: 'stepper-control' });
  const dec = h('button', {
    type: 'button', class: 'stepper-btn stepper-dec', tabindex: '-1',
    'aria-label': `Decrease ${controlLabel(prop)}`, title: `−${step}`,
  }, '−');
  const input = h('input', {
    type: 'number', class: 'stepper-number', step: String(step), lang: 'en-US', spellcheck: 'false',
    'aria-label': controlLabel(prop),
  });
  const inc = h('button', {
    type: 'button', class: 'stepper-btn stepper-inc', tabindex: '-1',
    'aria-label': `Increase ${controlLabel(prop)}`, title: `+${step}`,
  }, '+');
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  input.value = values.value || '';
  if (!values.value && values.base) {
    input.placeholder = comboScope ? values.base : `${values.base} (base)`;
    input.title = comboScope
      ? `${values.base} applies here — typing overrides it on ${sel || 'class'}`
      : `Inherits ${values.base} from base — typing creates a combo override on ${sel || 'class'}`;
  } else {
    input.placeholder = options.placeholder || '';
    input.title = options.title || 'Type a number or use − / +. Empty unsets it.';
  }
  input.classList.toggle('is-set', !!values.declared);

  const write = (next) => {
    HE.actions.setStyle(prop, next);
    input.classList.toggle('is-set', !!String(next).trim());
  };
  const nudge = (direction) => {
    const base = Number(input.value);
    const current = Number.isFinite(base) ? base : 0;
    let next = current + direction * step;
    if (options.min !== undefined) next = Math.max(Number(options.min), next);
    if (options.max !== undefined) next = Math.min(Number(options.max), next);
    next = roundToStep(next, step);
    input.value = String(next);
    write(String(next));
    input.focus();
  };
  dec.addEventListener('click', () => nudge(-1));
  inc.addEventListener('click', () => nudge(1));
  input.addEventListener('input', () => write(input.value.trim()));
  input.addEventListener('keydown', (e) => e.stopPropagation());

  wrap.append(dec, input, inc);
  return withTokenMenu(wrap, prop, tokenKindsForProperty(prop));
}

export function stepperRow(label, prop, options) {
  return h('div', { class: 'prow' }, h('label', null, label), withOrigin(prop, stepperControl(prop, options)));
}

const TOKEN_LENGTH_UNITS = [
  ['', '—', '1'],
  ['px', 'px', '1'],
  ['rem', 'rem', '0.05'],
  ['em', 'em', '0.05'],
  ['%', '%', '1'],
  ['vw', 'vw', '0.1'],
  ['vh', 'vh', '0.1'],
  ['vmin', 'vmin', '0.1'],
  ['vmax', 'vmax', '0.1'],
  ['ch', 'ch', '0.1'],
  ['lh', 'lh', '0.05'],
];
const TOKEN_TIME_UNITS = [['ms', 'ms', '10'], ['s', 's', '0.05']];

function parseTokenScalar(raw, kind) {
  const text = String(raw == null ? '' : raw).trim();
  const match = text.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))([a-z%]*)$/i);
  if (!match) return null;
  const unit = match[2].toLowerCase();
  if (kind === 'number') return unit ? null : { number: match[1], unit: '' };
  if (!unit) return match[1] === '0' ? { number: match[1], unit: '' } : null;
  const units = kind === 'time' ? TOKEN_TIME_UNITS : TOKEN_LENGTH_UNITS;
  return units.some(([u]) => u === unit) ? { number: match[1], unit } : null;
}

// Typed value editor for `:root` tokens. Numbers scrub, lengths/times get a
// unit select, and anything custom (calc/var/clamp/unknown unit) falls back to
// a raw text field via the `custom` unit. Reports through `onChange` instead of
// writing CSS itself; `setValue` lets callers sync an external edit.
export function tokenValueControl(options = {}) {
  const kind = options.kind === 'length' || options.kind === 'time' ? options.kind : 'number';
  const units = kind === 'time' ? TOKEN_TIME_UNITS : kind === 'length' ? TOKEN_LENGTH_UNITS : null;
  const label = options.label || 'Token value';
  const wrap = h('div', { class: 'token-value' });
  const parsed = parseTokenScalar(options.value, kind);
  const input = h('input', { type: 'number', class: 'token-number', lang: 'en-US', spellcheck: 'false' });
  const custom = h('input', { type: 'text', class: 'token-custom', spellcheck: 'false' });
  const unit = units ? h('select', { class: 'token-unit', 'aria-label': `${label} unit` }) : null;
  if (unit) {
    for (const [value, text, step] of units) {
      const option = h('option', { value }, text);
      option.dataset.step = step;
      unit.append(option);
    }
    unit.append(h('option', { value: 'custom' }, 'custom'));
  }
  const slider = options.slider
    ? h('input', {
        type: 'range', class: 'token-slider',
        min: String(options.slider.min), max: String(options.slider.max), step: String(options.slider.step),
      })
    : null;
  input.setAttribute('aria-label', label);
  custom.setAttribute('aria-label', label);
  if (slider) slider.setAttribute('aria-label', `${label} slider`);
  if (options.title) {
    input.title = options.title;
    custom.title = options.title;
    if (unit) unit.title = options.title;
  }
  if (options.placeholder) {
    input.placeholder = options.placeholder;
    custom.placeholder = options.placeholder;
  }

  let numeric = parsed;
  let customUnit = !!(unit && !parsed);
  let activeUnit = unit ? (parsed ? (parsed.unit || '') : 'custom') : '';
  if (parsed) {
    input.value = parsed.number;
    if (unit) unit.value = parsed.unit || '';
  } else {
    custom.value = String(options.value == null ? '' : options.value).trim();
  }

  const compose = () => {
    if (unit) return customUnit ? custom.value : input.value + unit.value;
    return numeric ? input.value : custom.value;
  };
  const notify = () => { if (typeof options.onChange === 'function') options.onChange(compose()); };
  const sliderMatches = () => !!slider && !customUnit && !!input.value.trim() &&
    (!options.slider.unit || options.slider.unit === (unit ? unit.value : ''));
  const sync = () => {
    const showNumber = unit ? !customUnit : !!numeric;
    input.hidden = !showNumber;
    custom.hidden = !!showNumber;
    if (slider) {
      const show = sliderMatches();
      slider.hidden = !show;
      if (show) slider.value = input.value;
    }
    const on = options.enabled !== false;
    input.disabled = !on || !showNumber;
    custom.disabled = !on || !!showNumber;
    if (unit) unit.disabled = !on;
    if (slider) slider.disabled = !on || slider.hidden;
  };
  sync();

  input.addEventListener('input', () => { notify(); sync(); });
  input.addEventListener('keydown', (e) => e.stopPropagation());
  custom.addEventListener('input', () => { notify(); sync(); });
  custom.addEventListener('keydown', (e) => e.stopPropagation());
  if (unit) {
    unit.addEventListener('change', () => {
      if (unit.value === 'custom') {
        if (!customUnit) custom.value = input.value ? input.value + activeUnit : custom.value;
        customUnit = true;
      } else {
        const seeded = parseTokenScalar(custom.value, kind);
        if (seeded) input.value = seeded.number;
        customUnit = false;
        numeric = { number: input.value, unit: unit.value };
      }
      activeUnit = unit.value;
      notify();
      sync();
    });
  }
  if (slider) {
    slider.addEventListener('input', () => { input.value = slider.value; notify(); });
  }
  makeScrubbable(input, () => {
    if (slider && !slider.hidden) return Number(options.slider.step) || 1;
    const selected = unit && unit.options[unit.selectedIndex];
    return Number(selected && selected.dataset.step) || 0.1;
  });

  wrap.append(input);
  if (unit) wrap.append(unit);
  wrap.append(custom);
  if (slider) wrap.append(slider);
  wrap.setValue = (next) => {
    const p = parseTokenScalar(next, kind);
    if (p) {
      numeric = p;
      customUnit = false;
      input.value = p.number;
      if (unit) { unit.value = p.unit || ''; activeUnit = unit.value; }
      custom.value = '';
    } else {
      numeric = null;
      customUnit = !!unit;
      custom.value = String(next == null ? '' : next).trim();
      if (unit) { unit.value = 'custom'; activeUnit = 'custom'; }
    }
    sync();
  };
  return wrap;
}

export function segControl(prop, options, labels = {}) {
  const sel = activeSelector();
  const values = displayValue(sel, prop);
  let current = values.value;
  // Combo with no override: do NOT highlight the base value as active.
  // Only fall back
  // to computed for plain single-class editing.
  const comboActive = !!(state.activeCombo && state.activeClass);
  if (!current && !state.pseudo && !comboActive) current = computed(prop);
  const seg = h('div', {
    class: 'seg',
    role: 'group',
    'aria-label': labels.group || controlLabel(prop),
  });
  for (const opt of options) {
    const text = labels[opt] || opt;
    const b = h('button', {
      type: 'button',
      class: current === opt ? 'on' : '',
      'aria-label': text,
      'aria-pressed': current === opt ? 'true' : 'false',
      'data-value': opt,
    }, h('span', { class: 'seg-label' }, text));
    b.disabled = !activeEl();
    b.addEventListener('click', () => {
      HE.actions.setStyle(prop, current === opt ? '' : opt);
      HE.panel.refresh();
    });
    seg.append(b);
  }
  return seg;
}

export function segRow(label, prop, options, labels) {
  return h('div', { class: 'prow' }, h('label', null, label), withOrigin(prop, segControl(prop, options, labels)));
}

export function refreshContrastBadge(contrastEl) {
  const contrast = contrastEl || document.getElementById('panel')?.querySelector('.contrast-badge');
  if (!contrast) return;
  const text = contrast.closest('.color-row')?.querySelector('input[type="text"]');
  const sel = activeSelector();
  const foreground = parseColor(text?.value);
  const background = contrastBackground();
  if (!sel || !foreground || !background) {
    contrast.hidden = true;
    return;
  }
  const ratio = contrastRatio(foreground, background);
  const level = ratio >= 7 ? 'aaa' : ratio >= 4.5 ? 'aa' : ratio >= 3 ? 'large' : 'fail';
  contrast.hidden = false;
  contrast.className = `contrast-badge ${level}`;
  contrast.textContent = `${ratio.toFixed(2)}:1 ${level.toUpperCase()}`;
  contrast.title = 'WCAG contrast: AA normal text requires 4.5:1; large text requires 3:1';
}

function contrastBackground() {
  let node = activeEl();
  while (node) {
    const value = node.ownerDocument.defaultView.getComputedStyle(node).backgroundColor;
    const parsed = parseColor(value);
    if (parsed && parsed.a > 0) return parsed;
    node = node.parentElement;
  }
  return parseColor('#ffffff');
}

// Shared outside-click closer for color token menus. One document listener
// for all instances (registered once) instead of one per field per refresh.
let openTokenMenu = null;
let tokenMenuBound = false;
function bindTokenMenuCloser() {
  if (tokenMenuBound) return;
  tokenMenuBound = true;
  try {
    document.addEventListener('click', (e) => {
      if (openTokenMenu && !openTokenMenu.contains(e.target)) {
        openTokenMenu.hidden = true;
        openTokenMenu = null;
      }
    });
  } catch { /* ignore */ }
}

function createTokenMenu(prop, kinds, options = {}) {
  let vars = [];
  try { vars = (HE.sheet && HE.sheet.rootVars) ? HE.sheet.rootVars() : []; } catch { vars = []; }
  const initialValues = displayValue(activeSelector(), prop);
  const initialDeclared = parseVarRef(initialValues.declared);
  const initialInherited = initialDeclared ? null : parseVarRef(initialValues.base);
  const initialLinked = initialDeclared || initialInherited;
  const candidates = compatibleTokens(vars, kinds, initialLinked && initialLinked.name, options.predicate);
  if (!candidates.length && !initialLinked) return null;

  bindTokenMenuCloser();
  const button = h('button', {
    type: 'button', class: 't-menu-btn',
    'aria-label': `${prop} design token`, 'aria-haspopup': 'menu',
  }, initialLinked ? initialLinked.name : 'T');
  const menu = h('div', { class: 'token-menu', hidden: '', role: 'menu' });
  const rows = new Map();
  let unlink = null;
  let unlinkValue = '';

  const readState = () => {
    const values = displayValue(activeSelector(), prop);
    const declared = parseVarRef(values.declared);
    const inherited = declared ? null : parseVarRef(values.base);
    return { values, declared, linked: declared || inherited };
  };

  const updateButton = () => {
    const current = readState();
    const linked = current.linked;
    const inherited = !!(linked && !current.declared);
    button.textContent = linked ? linked.name : 'T';
    button.classList.toggle('is-linked', !!linked);
    button.classList.toggle('is-inherited', inherited);
    button.title = linked
      ? inherited
        ? `Inherits ${linked.name} — choose a token or unlink to create a local value here`
        : `Uses ${linked.name} — open to switch tokens or unlink while keeping the current value`
      : `Use a compatible token for ${prop}`;
    for (const [name, rowBtn] of rows) rowBtn.classList.toggle('on', !!linked && linked.name === name);
    if (unlink) {
      const resolved = options.resolveValue
        ? options.resolveValue(current.values, linked)
        : (current.values.value || computed(prop) || (linked && linked.fallback) || '');
      unlink.hidden = !linked;
      unlink.disabled = !linked || !resolved || !!parseVarRef(resolved);
      unlink.title = unlink.disabled
        ? `Cannot resolve ${linked ? linked.name : 'this token'} to a local value in this scope`
        : `Unlink ${linked.name} and keep the current rendered value`;
      unlinkValue = resolved;
    }
  };
  const close = () => {
    menu.hidden = true;
    if (openTokenMenu === menu) openTokenMenu = null;
  };

  unlink = h('button', {
    type: 'button', class: 'token-menu-action token-menu-unlink', role: 'menuitem',
  }, 'Unlink — keep current value');
  unlink.addEventListener('click', (e) => {
    e.stopPropagation();
    if (unlink.disabled || !unlinkValue) return;
    HE.actions.setStyle(prop, unlinkValue);
    close();
    if (HE.panel && HE.panel.refresh) HE.panel.refresh();
  });
  menu.append(unlink);
  if (!candidates.length) {
    menu.append(h('div', { class: 'token-menu-note muted' }, 'No compatible tokens. Manage this token in the Tokens sidebar.'));
  }
  for (const token of candidates) {
    const rowBtn = h('button', { type: 'button', class: 'token-menu-item', role: 'menuitem' });
    rowBtn.title = `${token.name} = ${token.value || '(empty)'}`;
    rowBtn.append(
      h('span', { class: 'token-name' }, token.name),
      h('span', { class: 'token-val muted' }, String(token.value || '(empty)').slice(0, 28)),
    );
    rowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (options.onSelect) options.onSelect(token);
      else HE.actions.setStyle(prop, `var(${token.name})`);
      close();
      if (options.refresh !== false && HE.panel && HE.panel.refresh) HE.panel.refresh();
    });
    rows.set(token.name, rowBtn);
    menu.append(rowBtn);
  }
  button.disabled = !activeEl();
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    if (openTokenMenu && openTokenMenu !== menu) openTokenMenu.hidden = true;
    openTokenMenu = willOpen ? menu : null;
    menu.hidden = !willOpen;
  });
  updateButton();
  return { button, menu, close, sync: updateButton };
}

function withTokenMenu(control, prop, kinds, options = {}) {
  const tokenMenu = createTokenMenu(prop, kinds, options);
  if (!tokenMenu) return control;
  control.addEventListener('input', tokenMenu.sync);
  control.addEventListener('change', tokenMenu.sync);
  return h('div', { class: 'tokenized-control' }, control, tokenMenu.button, tokenMenu.menu);
}

function cssColorHex(value) {
  const direct = toHex(value);
  if (direct) return direct;
  try {
    const probe = document.createElement('span');
    probe.style.color = String(value || '').trim();
    if (!probe.style.color) return null;
    document.body.append(probe);
    const resolved = probe.ownerDocument.defaultView.getComputedStyle(probe).color;
    probe.remove();
    return toHex(resolved);
  } catch { return null; }
}

function isColorTokenValue(value) {
  const raw = String(value == null ? '' : value).trim();
  return !raw || !!cssColorHex(raw);
}

export function colorControl(prop) {
  const wrap = h('div', { class: 'color-row' });
  const picker = h('input', { type: 'color', 'aria-label': `${prop} color picker` });
  const pickerShell = h('span', { class: 'color-picker-shell' }, picker);
  const format = h('select', { class: 'color-format', 'aria-label': `${prop} color format` });
  const text = textControl(prop, 'transparent', { tokenMenu: false });
  const contrast = prop === 'color'
    ? h('span', { class: 'contrast-badge', 'aria-live': 'polite' })
    : null;
  const affectsContrast = prop === 'color' || prop === 'background-color';

  for (const [value, label] of [['hex', 'HEX'], ['rgb', 'RGB'], ['hsl', 'HSL'], ['oklch', 'OKLCH'], ['oklab', 'OKLab']]) {
    format.append(h('option', { value }, label));
  }
  picker.disabled = !activeEl();
  format.disabled = !activeEl();

  const tokenRows = new Map();
  let tokBtn = null;
  let tokMenu = null;
  let unlinkAction = null;

  const readColorState = () => {
    const values = displayValue(activeSelector(), prop);
    const declaredVar = parseVarRef(values.declared);
    const inheritedVar = declaredVar ? null : parseVarRef(values.base);
    return {
      values,
      declaredVar,
      inheritedVar,
      linkedVar: declaredVar || inheritedVar,
      resolved: values.value || computed(prop),
    };
  };

  const parsedResolvedColor = (state) => {
    const candidates = [state.resolved, computed(prop), state.linkedVar && state.linkedVar.fallback];
    for (const candidate of candidates) {
      const parsed = parseColor(candidate);
      if (parsed) return { parsed, source: candidate };
    }
    return null;
  };

  const literalColor = () => {
    const state = readColorState();
    const resolved = parsedResolvedColor(state);
    if (!resolved) return '';
    return formatColor(resolved.parsed, format.value || colorFormat(resolved.source));
  };

  const closeTokenMenu = () => {
    if (tokMenu) tokMenu.hidden = true;
    if (openTokenMenu === tokMenu) openTokenMenu = null;
  };

  const updateTokenUi = (state) => {
    if (!tokBtn) return;
    const linked = state.linkedVar;
    const inherited = !!(linked && !state.declaredVar);
    tokBtn.textContent = linked ? linked.name : 'T';
    tokBtn.classList.toggle('is-linked', !!linked);
    tokBtn.classList.toggle('is-inherited', inherited);
    tokBtn.title = linked
      ? inherited
        ? `Inherits ${linked.name} — choose a token or unlink to create a local color here`
        : `Uses ${linked.name} — open to switch tokens or unlink while keeping the current color`
      : 'Use a color token, unlink a token, or create a new token from the current color';
    for (const [name, rowBtn] of tokenRows) {
      rowBtn.classList.toggle('on', !!linked && linked.name === name);
    }
    if (unlinkAction) {
      unlinkAction.hidden = !linked;
      unlinkAction.title = linked
        ? `Unlink ${linked.name} and keep the current rendered color`
        : 'This color is not linked to a token';
    }
    const declared = state.declaredVar;
    if (declared) {
      text.title = `Uses var(${declared.name}) — edit ${declared.name} in the Tokens section to update everywhere`;
    } else if (inherited) {
      text.title = `Inherits ${linked.name} — editing creates a local color override`;
    }
  };

  const syncColorUi = (writeText = true) => {
    const state = readColorState();
    const resolved = parsedResolvedColor(state);
    if (resolved) {
      picker.value = toHex(resolved.source) || picker.value;
      const alpha = resolved.parsed.a;
      format.value = alpha <= 0.001 ? 'rgb' : colorFormat(resolved.source);
      if (writeText) text.value = alpha <= 0.001 ? 'transparent' : state.resolved || resolved.source;
      pickerShell.classList.toggle('is-transparent', alpha <= 0.001);
      pickerShell.classList.toggle('has-alpha', alpha < 0.999);
      pickerShell.title = alpha <= 0.001
        ? 'Transparent (0% opacity) — the RGB value is not visible'
        : alpha < 0.999 ? `Color with ${Math.round(alpha * 100)}% opacity` : 'Choose a color';
      picker.setAttribute('aria-label', alpha <= 0.001
        ? `${prop} color picker, transparent`
        : `${prop} color picker`);
    } else if (writeText && state.resolved) {
      text.value = state.resolved;
      pickerShell.classList.remove('is-transparent', 'has-alpha');
      pickerShell.title = 'Choose a color';
    }
    text.classList.toggle('is-set', !!state.values.declared);
    updateTokenUi(state);
    if (affectsContrast) refreshContrastBadge(contrast);
  };

  const writeLiteral = (value) => {
    HE.actions.setStyle(prop, value);
    syncColorUi();
  };

  picker.addEventListener('input', () => {
    const next = formatColor(parseColor(picker.value), format.value);
    writeLiteral(next);
  });
  text.addEventListener('input', () => {
    const parsed = parseColor(text.value);
    updateTokenUi(readColorState());
    if (!parsed) return;
    picker.value = toHex(text.value) || picker.value;
    format.value = colorFormat(text.value);
    if (affectsContrast) refreshContrastBadge(contrast);
  });
  format.addEventListener('change', () => {
    const state = readColorState();
    const parsed = parseColor(text.value) || parsedResolvedColor(state)?.parsed;
    if (!parsed) return;
    const next = formatColor(parsed, format.value);
    writeLiteral(next);
  });
  wrap.append(pickerShell, format, text);

  // Token menu: the raw declaration determines linkage, while the controls
  // continue showing the resolved color. Every write synchronizes both views.
  bindTokenMenuCloser();
  try {
    const vars = (HE.sheet && HE.sheet.rootVars) ? HE.sheet.rootVars() : [];
    const initialState = readColorState();
    const colorVars = compatibleTokens(
      vars,
      ['color'],
      initialState.linkedVar && initialState.linkedVar.name,
      (v) => String(v.value || '').trim() && isColorTokenValue(v.value),
    );
    if (colorVars.length || initialState.linkedVar) {
      tokBtn = h('button', {
        type: 'button',
        class: 'token-menu-btn',
        'aria-label': `${prop} design token`,
        'aria-haspopup': 'menu',
      }, 'T');
      tokMenu = h('div', { class: 'token-menu', hidden: '', role: 'menu' });

      unlinkAction = h('button', {
        type: 'button', class: 'token-menu-action token-menu-unlink', role: 'menuitem',
      }, 'Unlink — keep current color');
      unlinkAction.addEventListener('click', (e) => {
        e.stopPropagation();
        const literal = literalColor();
        if (!literal) {
          if (HE.toast) HE.toast('This token does not currently resolve to a color.', 'error');
          return;
        }
        writeLiteral(literal);
        closeTokenMenu();
      });
      tokMenu.append(unlinkAction);

      for (const v of colorVars) {
        const hex = cssColorHex(v.value);
        const rowBtn = h('button', {
          type: 'button', class: 'token-menu-item', role: 'menuitem',
        });
        rowBtn.title = `${v.name} = ${v.value || '(empty)'}`;
        rowBtn.append(
          h('span', { class: 'token-swatch', style: hex ? `background: ${hex}` : '' }),
          h('span', { class: 'token-name' }, v.name),
          h('span', { class: 'token-val muted' }, String(v.value || '(empty)').slice(0, 28)),
        );
        rowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          HE.actions.setStyle(prop, `var(${v.name})`);
          syncColorUi();
          closeTokenMenu();
        });
        tokenRows.set(v.name, rowBtn);
        tokMenu.append(rowBtn);
      }
      tokBtn.disabled = !activeEl();
      tokBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = tokMenu.hidden;
        if (openTokenMenu && openTokenMenu !== tokMenu) openTokenMenu.hidden = true;
        openTokenMenu = willOpen ? tokMenu : null;
        tokMenu.hidden = !willOpen;
      });
      wrap.append(tokBtn, tokMenu);
      updateTokenUi(initialState);
    }
  } catch { /* token menu is best-effort */ }
  syncColorUi();
  if (contrast) {
    wrap.append(contrast);
    refreshContrastBadge(contrast);
  }
  return wrap;
}

const GRADIENT_PRESETS = [
  ['Violet', 'linear-gradient(135deg, oklch(62% 0.25 292) 0%, oklch(72% 0.22 350) 100%)'],
  ['Ocean', 'linear-gradient(135deg, oklab(52% 0.12 -0.18) 0%, oklab(76% -0.05 0.12) 100%)'],
  ['Aurora', 'radial-gradient(circle at top, oklch(85% 0.16 200) 0%, oklch(28% 0.08 260) 75%)'],
];

const BACKGROUND_LAYER_TYPES = [
  ['gradient', 'Gradient'],
  ['image', 'Image URL'],
  ['custom', 'CSS image'],
];

function backgroundLayerDefault(type) {
  if (type === 'image') return 'url("image.svg")';
  if (type === 'custom') return 'image-set(url("image.svg") 1x)';
  return GRADIENT_PRESETS[0][1];
}

export function backgroundLayersControl() {
  const sel = activeSelector();
  const values = displayValue(sel, 'background-image');
  const raw = (values.value || values.base || '').trim();
  const layers = parseBackgroundLayers(raw);
  const wrap = h('div', { class: 'background-layers' });
  const list = h('div', { class: 'background-layer-list' });
  const addType = h('select', {
    class: 'background-layer-add-type',
    'aria-label': 'New background layer type',
    title: 'Choose the kind of layer to add',
  });
  const add = h('button', { type: 'button', class: 'background-layer-add' }, '+ Add layer');
  const clear = h('button', { type: 'button', class: 'background-layer-clear' }, 'Clear');
  const toolbar = h('div', { class: 'background-layer-toolbar' });
  let hasLocalOverride = !!values.declared;
  const hint = h('div', { class: 'background-layers-hint muted' },
    !values.declared && values.base
      ? 'Showing the base value. Editing creates an override.'
      : 'Layer 1 paints on top, layer 2 behind it, and so on. Each row is one layer.');

  for (const [value, label] of BACKGROUND_LAYER_TYPES) {
    addType.append(h('option', { value }, label));
  }

  const updateClearState = () => {
    clear.disabled = !activeEl() || !hasLocalOverride;
    clear.title = hasLocalOverride
      ? 'Remove background-image from this rule'
      : 'There is no background-image override on this rule';
  };

  const writeLayers = (next, refresh) => {
    layers.splice(0, layers.length, ...next);
    const serialized = serializeBackgroundLayers(layers);
    hasLocalOverride = !!serialized;
    HE.actions.setStyle('background-image', serialized);
    updateClearState();
    if (refresh && HE.panel && HE.panel.refresh) HE.panel.refresh();
  };

  const updateLayerMeta = (input, kind, preview, value) => {
    const nextKind = backgroundLayerKind(value);
    kind.className = `background-layer-kind ${nextKind}`;
    kind.textContent = backgroundLayerLabel(value);
    input.placeholder = nextKind === 'gradient' ? 'linear-gradient(...)'
      : nextKind === 'image' ? 'url("image.svg")' : 'Any CSS image value';
    preview.style.backgroundImage = value || 'none';
  };

  const renderLayers = () => {
    list.replaceChildren();
    if (!layers.length) {
      list.append(h('div', { class: 'background-layers-empty' }, 'No layers yet — only the color below shows. Add a gradient or an image.'));
    }
    layers.forEach((value, index) => {
      const kind = h('span', { class: 'background-layer-kind' });
      const isGradientLayer = backgroundLayerKind(value) === 'gradient';
      const preview = isGradientLayer
        ? h('button', {
            type: 'button', class: 'background-layer-preview gradient-edit',
            title: 'Click to edit this gradient', 'aria-expanded': 'false',
            'aria-label': `Edit gradient for background layer ${index + 1}`,
          })
        : h('span', { class: 'background-layer-preview', 'aria-hidden': 'true' });
      const input = h('input', {
        type: 'text', spellcheck: 'false', class: 'background-layer-input',
        'aria-label': `Background layer ${index + 1}`,
      });
      const preset = h('select', {
        class: 'background-layer-preset',
        'aria-label': `Gradient preset for background layer ${index + 1}`,
      });
      const item = h('div', { class: 'background-layer' });
      const head = h('div', { class: 'background-layer-head' });
      const title = h('span', { class: 'background-layer-title' },
        `#${index + 1} ${index === 0 ? 'Front' : 'Behind'}`);
      const actions = h('div', { class: 'background-layer-actions' });
      const up = h('button', {
        type: 'button', class: 'background-layer-action',
        title: 'Move toward the front', 'aria-label': `Move layer ${index + 1} toward the front`,
      }, 'Up');
      const down = h('button', {
        type: 'button', class: 'background-layer-action',
        title: 'Move toward the back', 'aria-label': `Move layer ${index + 1} toward the back`,
      }, 'Down');
      const duplicate = h('button', {
        type: 'button', class: 'background-layer-action',
        title: 'Duplicate this layer', 'aria-label': `Duplicate background layer ${index + 1}`,
      }, 'Copy');
      const remove = h('button', {
        type: 'button', class: 'background-layer-action danger',
        title: 'Remove this layer', 'aria-label': `Remove background layer ${index + 1}`,
      }, 'Remove');

      // Visual gradient editor: a real track with draggable stop handles.
      // Linear gets an angle dial, radial gets a 3x3 position pad. The raw
      // text input stays the source of truth; every editor change rewrites
      // it and the layer value live (no panel refresh, so focus never
      // jumps). Unparseable gradients keep text editing.
      let gradientBox = null;
      let gradientEdit = null;
      const closeGradientEditor = () => {
        if (!gradientBox) return;
        gradientBox.hidden = true;
        gradientBox.replaceChildren();
        if (gradientEdit) {
          gradientEdit.setAttribute('aria-expanded', 'false');
          gradientEdit.classList.remove('on');
        }
      };
      const commitGradient = (model, fill) => {
        const css = serializeGradient(model);
        if (!css) return;
        layers[index] = css;
        input.value = css;
        input.classList.add('is-set');
        updateLayerMeta(input, kind, preview, css);
        if (fill) fill.style.backgroundImage = css;
        hasLocalOverride = true;
        HE.actions.setStyle('background-image', serializeBackgroundLayers(layers));
        updateClearState();
      };
      const buildGradientEditor = () => {
        if (!gradientBox || !gradientEdit) return;
        gradientBox.replaceChildren();
        gradientEdit.setAttribute('aria-expanded', 'true');
        gradientEdit.classList.add('on');
        gradientBox.hidden = false;
        const model = parseGradient(input.value);
        if (!model) {
          gradientBox.append(h('div', { class: 'gradient-note muted' },
            'Custom gradient — edit as text. Linear and radial gradients get a visual editor.'));
          return;
        }
        const disabled = !activeEl();
        let selected = 0;

        // --- Track: live gradient with one draggable handle per stop ---
        const track = h('div', { class: 'gradient-bar gradient-track' });
        const fill = h('div', { class: 'gradient-fill', 'aria-hidden': 'true' });
        const handles = h('div', { class: 'gradient-handles' });
        track.append(fill, handles);

        const inspector = h('div', { class: 'gradient-inspector' });
        const controls = h('div', { class: 'gradient-controls' });
        const addStop = h('button', { type: 'button', class: 'gradient-stop-add' }, '+ Add stop');
        addStop.disabled = disabled;
        addStop.title = 'Add a white stop at 100%';

        const syncFill = () => {
          fill.style.backgroundImage = serializeGradient(model) || 'none';
        };

        const renderInspector = () => {
          inspector.replaceChildren();
          const stop = model.stops[selected];
          if (!stop) return;
          inspector.append(h('span', { class: 'gradient-inspector-label' }, `Stop ${selected + 1}`));
          const swatch = h('input', {
            type: 'color', class: 'gradient-stop-swatch',
            'aria-label': `Color of gradient stop ${selected + 1}`, title: 'Pick a stop color',
          });
          swatch.value = toHex(stop.color) || '#000000';
          swatch.disabled = disabled;
          const color = h('input', {
            type: 'text', spellcheck: 'false', class: 'gradient-stop-color',
            'aria-label': `Color of gradient stop ${selected + 1}`,
            placeholder: 'Color', title: 'Any CSS color',
          });
          color.value = stop.color;
          color.disabled = disabled;
          const at = h('input', {
            type: 'text', spellcheck: 'false', class: 'gradient-stop-at',
            'aria-label': `Position of gradient stop ${selected + 1}`,
            placeholder: 'auto', title: 'Stop position, e.g. 40% (empty spreads evenly)',
          });
          at.value = stop.position || '';
          at.disabled = disabled;
          const del = h('button', {
            type: 'button', class: 'gradient-stop-del',
            title: 'Remove this stop', 'aria-label': `Remove gradient stop ${selected + 1}`,
          }, '×');
          del.disabled = disabled || model.stops.length < 2;
          swatch.addEventListener('input', () => {
            stop.color = swatch.value;
            color.value = swatch.value;
            commitGradient(model, fill);
            renderHandles();
          });
          color.addEventListener('input', () => {
            stop.color = color.value;
            const hex = toHex(color.value);
            if (hex) swatch.value = hex;
            commitGradient(model, fill);
            renderHandles();
          });
          at.addEventListener('input', () => {
            stop.position = at.value;
            commitGradient(model, fill);
            renderHandles();
          });
          for (const el of [color, at]) el.addEventListener('keydown', (e) => e.stopPropagation());
          del.addEventListener('click', () => {
            if (model.stops.length < 2) return;
            model.stops.splice(selected, 1);
            selected = Math.min(selected, model.stops.length - 1);
            commitGradient(model, fill);
            renderHandles();
            renderInspector();
          });
          inspector.append(swatch, color, at, del);
        };

        const selectStop = (nextIndex, rebuild = true) => {
          selected = Math.min(model.stops.length - 1, Math.max(0, nextIndex));
          if (rebuild) renderHandles();
          else {
            [...handles.children].forEach((el, i) => {
              el.classList.toggle('sel', i === selected);
              el.setAttribute('aria-pressed', i === selected ? 'true' : 'false');
            });
          }
          renderInspector();
        };

        const beginDrag = (event, stopIndex, handle) => {
          if (disabled) return;
          event.preventDefault();
          event.stopPropagation();
          selectStop(stopIndex, false);
          const rect = track.getBoundingClientRect();
          const move = (e) => {
            const pct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
            model.stops[stopIndex].position = `${Math.round(pct * 10) / 10}%`;
            handle.style.left = `${pct}%`;
            commitGradient(model, fill);
          };
          const end = (e) => {
            handle.releasePointerCapture?.(e.pointerId);
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', end);
            handle.removeEventListener('pointercancel', end);
            renderHandles();
          };
          handle.setPointerCapture?.(event.pointerId);
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', end);
          handle.addEventListener('pointercancel', end);
        };

        const renderHandles = () => {
          handles.replaceChildren();
          model.stops.forEach((stop, i) => {
            const pct = stopPercent(stop, i, model.stops.length);
            const handle = h('button', {
              type: 'button',
              class: 'gradient-handle' + (i === selected ? ' sel' : ''),
              'aria-label': `Gradient stop ${i + 1}, ${Math.round(pct)}%`,
              'aria-pressed': i === selected ? 'true' : 'false',
            });
            handle.style.left = `${pct}%`;
            handle.style.setProperty('--stop-color', toHex(stop.color) || '#000000');
            handle.disabled = disabled;
            handle.addEventListener('pointerdown', (e) => beginDrag(e, i, handle));
            handle.addEventListener('click', (e) => { e.stopPropagation(); selectStop(i); });
            handle.addEventListener('keydown', (e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowRight' ? 1 : -1);
              const next = Math.min(100, Math.max(0, stopPercent(stop, i, model.stops.length) + step));
              model.stops[i].position = `${Math.round(next)}%`;
              commitGradient(model, fill);
              renderHandles();
              const again = handles.children[i];
              if (again) again.focus();
            });
            handles.append(handle);
          });
        };

        // Click the empty track to add a stop whose color matches that spot.
        track.addEventListener('pointerdown', (e) => {
          if (disabled) return;
          if (e.target.closest('.gradient-handle')) return;
          const rect = track.getBoundingClientRect();
          const pct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
          const rounded = Math.round(pct);
          const color = sampleGradientColor(model.stops, rounded) || '#ffffff';
          let insertAt = model.stops.length;
          for (let i = 0; i < model.stops.length; i++) {
            if (stopPercent(model.stops[i], i, model.stops.length) > rounded) { insertAt = i; break; }
          }
          model.stops.splice(insertAt, 0, { color, position: `${rounded}%` });
          commitGradient(model, fill);
          selectStop(insertAt);
        });

        // --- Controls: type/repeat, angle dial, radial position pad ---
        const controlsRow = h('div', { class: 'gradient-controls-row' });
        const typeSel = h('select', { class: 'gradient-type', 'aria-label': `Gradient type for background layer ${index + 1}` });
        typeSel.append(h('option', { value: 'linear' }, 'Linear'), h('option', { value: 'radial' }, 'Radial'));
        typeSel.value = model.type;
        typeSel.disabled = disabled;
        const rep = h('input', { type: 'checkbox', class: 'gradient-repeating', 'aria-label': 'Repeating gradient' });
        rep.checked = !!model.repeating;
        rep.disabled = disabled;
        const repLab = h('label', { class: 'gradient-repeating-label', title: 'Repeating gradient' }, rep, 'Repeat');
        controlsRow.append(typeSel, repLab);
        const dirWrap = h('div', { class: 'gradient-dir' });
        const renderDir = () => {
          dirWrap.replaceChildren();
          if (model.type === 'linear') {
            const dial = h('button', {
              type: 'button', class: 'gradient-dial',
              'aria-label': `Angle for background layer ${index + 1}`, title: 'Drag or use arrow keys to set the angle',
            });
            const dot = h('span', { class: 'gradient-dial-dot', 'aria-hidden': 'true' });
            dial.append(h('span', { class: 'gradient-dial-ring', 'aria-hidden': 'true' }), dot);
            dial.disabled = disabled;
            const setDial = (deg) => {
              dot.style.transform = `rotate(${deg}deg)`;
              dial.setAttribute('aria-valuenow', String(Math.round(deg)));
            };
            setDial(gradientAngle(model.direction));
            const applyAngle = (deg) => {
              model.direction = formatGradientAngle(deg);
              commitGradient(model, fill);
              setDial(gradientAngle(model.direction));
              dir.value = model.direction;
            };
            const angleFromEvent = (e) => {
              const rect = dial.getBoundingClientRect();
              const dx = e.clientX - (rect.left + rect.width / 2);
              const dy = e.clientY - (rect.top + rect.height / 2);
              return (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
            };
            dial.addEventListener('pointerdown', (e) => {
              if (disabled) return;
              e.preventDefault();
              dial.setPointerCapture?.(e.pointerId);
              applyAngle(angleFromEvent(e));
              const move = (ev) => applyAngle(angleFromEvent(ev));
              const end = (ev) => {
                dial.releasePointerCapture?.(ev.pointerId);
                dial.removeEventListener('pointermove', move);
                dial.removeEventListener('pointerup', end);
                dial.removeEventListener('pointercancel', end);
              };
              dial.addEventListener('pointermove', move);
              dial.addEventListener('pointerup', end);
              dial.addEventListener('pointercancel', end);
            });
            dial.addEventListener('keydown', (e) => {
              if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
              e.preventDefault();
              const step = (e.shiftKey ? 15 : 1) * (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
              applyAngle(gradientAngle(model.direction) + step);
            });
            const dir = h('input', {
              type: 'text', spellcheck: 'false', class: 'gradient-direction',
              'aria-label': `Gradient direction for background layer ${index + 1}`,
              placeholder: '135deg or to right', title: 'Angle (135deg) or side keyword (to right)',
            });
            dir.value = model.direction || '';
            dir.disabled = disabled;
            dir.addEventListener('input', () => {
              model.direction = dir.value;
              commitGradient(model, fill);
              setDial(gradientAngle(model.direction));
            });
            dir.addEventListener('keydown', (e) => e.stopPropagation());
            const quick = h('div', { class: 'gradient-angle-presets' });
            [['↗', 45], ['→', 90], ['↘', 135], ['↓', 180]].forEach(([label, deg]) => {
              const b = h('button', {
                type: 'button', class: 'gradient-angle-preset',
                title: `${deg}deg`, 'aria-label': `Set gradient angle to ${deg} degrees`,
              }, label);
              b.disabled = disabled;
              b.addEventListener('click', () => applyAngle(deg));
              quick.append(b);
            });
            dirWrap.append(
              h('div', { class: 'gradient-angle' },
                dial,
                h('div', { class: 'gradient-angle-fields' }, dir, quick)),
            );
          } else {
            const shape = h('select', { class: 'gradient-shape', 'aria-label': `Radial shape for background layer ${index + 1}` });
            shape.append(h('option', { value: 'circle' }, 'Circle'), h('option', { value: 'ellipse' }, 'Ellipse'));
            shape.value = model.shape || 'ellipse';
            shape.disabled = disabled;
            shape.addEventListener('change', () => { model.shape = shape.value; commitGradient(model, fill); });
            const pad = h('div', { class: 'gradient-position-pad', role: 'group', 'aria-label': `Radial position for background layer ${index + 1}` });
            const posInput = h('input', {
              type: 'text', spellcheck: 'false', class: 'gradient-position',
              'aria-label': `Radial position for background layer ${index + 1}`,
              placeholder: 'at center or 20% 30%', title: 'Position, e.g. at center, at top left or 20% 30%',
            });
            posInput.value = model.position || '';
            posInput.disabled = disabled;
            const cellButtons = [];
            const syncPad = () => {
              const parsed = parseRadialPosition(model.position);
              cellButtons.forEach((btn) => {
                const active = !parsed.custom && btn.dataset.x === parsed.x && btn.dataset.y === parsed.y;
                btn.classList.toggle('on', active);
                btn.setAttribute('aria-pressed', active ? 'true' : 'false');
              });
            };
            const cells = [
              ['left', 'top'], ['center', 'top'], ['right', 'top'],
              ['left', 'center'], ['center', 'center'], ['right', 'center'],
              ['left', 'bottom'], ['center', 'bottom'], ['right', 'bottom'],
            ];
            for (const [x, y] of cells) {
              const btn = h('button', {
                type: 'button', class: 'gradient-position-cell',
                title: x === 'center' && y === 'center' ? 'Center' : `at ${x} ${y}`,
                'aria-label': x === 'center' && y === 'center' ? 'Position center' : `Position ${x} ${y}`,
                'data-x': x, 'data-y': y,
              });
              btn.disabled = disabled;
              btn.addEventListener('click', () => {
                model.position = formatRadialPosition({ x, y });
                commitGradient(model, fill);
                posInput.value = model.position;
                syncPad();
              });
              cellButtons.push(btn);
              pad.append(btn);
            }
            syncPad();
            posInput.addEventListener('input', () => {
              const text = posInput.value.trim();
              model.position = text ? (/^at\b/i.test(text) ? text : `at ${text}`) : '';
              commitGradient(model, fill);
              syncPad();
            });
            posInput.addEventListener('keydown', (e) => e.stopPropagation());
            dirWrap.append(
              h('div', { class: 'gradient-shape-row' }, shape),
              h('div', { class: 'gradient-position-row' }, pad, posInput),
            );
          }
        };
        renderDir();
        typeSel.addEventListener('change', () => {
          model.type = typeSel.value;
          commitGradient(model, fill);
          renderDir();
          typeSel.focus();
        });
        rep.addEventListener('change', () => { model.repeating = rep.checked; commitGradient(model, fill); });

        addStop.addEventListener('click', () => {
          model.stops.push({ color: '#ffffff', position: '100%' });
          commitGradient(model, fill);
          selectStop(model.stops.length - 1);
        });

        renderHandles();
        renderInspector();
        syncFill();
        controls.append(controlsRow, dirWrap);
        gradientBox.append(track, inspector, controls, addStop);
      };
      if (isGradientLayer) {
        gradientEdit = preview;
        gradientEdit.disabled = !activeEl();
        gradientEdit.addEventListener('click', () => {
          if (gradientBox.hidden) buildGradientEditor();
          else closeGradientEditor();
        });
        gradientBox = h('div', { class: 'gradient-editor', hidden: '' });
      }

      input.value = value;
      input.disabled = !activeEl();
      input.classList.toggle('is-set', !!value.trim());
      input.title = !values.declared && values.base
        ? 'Inherited from the base rule. Editing creates an override.'
        : 'Any CSS image value: url(), linear-gradient(), radial-gradient(), image-set(), and more.';
      preset.append(h('option', { value: '' }, 'Preset'));
      for (const [label, presetValue] of GRADIENT_PRESETS) {
        preset.append(h('option', { value: presetValue }, label));
      }
      preset.disabled = !activeEl();
      up.disabled = !activeEl() || index === 0;
      down.disabled = !activeEl() || index === layers.length - 1;
      duplicate.disabled = !activeEl();
      remove.disabled = !activeEl();
      updateLayerMeta(input, kind, preview, value);

      input.addEventListener('input', () => {
        layers[index] = input.value;
        input.classList.toggle('is-set', !!input.value.trim());
        updateLayerMeta(input, kind, preview, input.value);
        preset.value = '';
        // Hand-typed values replace the visual model — collapse the editor
        // instead of showing a stale one.
        closeGradientEditor();
        const serialized = serializeBackgroundLayers(layers);
        hasLocalOverride = !!serialized;
        HE.actions.setStyle('background-image', serialized);
        updateClearState();
      });
      input.addEventListener('change', () => {
        if (input.value.trim()) return;
        layers.splice(index, 1);
        writeLayers(layers, true);
      });
      preset.addEventListener('change', () => {
        if (!preset.value) return;
        layers[index] = preset.value;
        input.value = preset.value;
        input.classList.add('is-set');
        updateLayerMeta(input, kind, preview, preset.value);
        hasLocalOverride = true;
        HE.actions.setStyle('background-image', serializeBackgroundLayers(layers));
        updateClearState();
        preset.value = '';
        // A preset is a known-good gradient — keep the visual editor in sync.
        if (gradientBox && !gradientBox.hidden) buildGradientEditor();
        input.focus();
      });
      up.addEventListener('click', () => writeLayers(reorderBackgroundLayers(layers, index, -1), true));
      down.addEventListener('click', () => writeLayers(reorderBackgroundLayers(layers, index, 1), true));
      duplicate.addEventListener('click', () => {
        const next = [...layers.slice(0, index + 1), layers[index], ...layers.slice(index + 1)];
        writeLayers(next, true);
      });
      remove.addEventListener('click', () => writeLayers(layers.filter((_, i) => i !== index), true));

      actions.append(up, down, duplicate, remove);
      head.append(title, kind, actions);
      const editor = h('div', { class: 'background-layer-editor' }, preview, input, preset);
      item.append(head, editor);
      if (gradientBox) item.append(gradientBox);
      list.append(item);
    });
  };

  add.disabled = !activeEl();
  add.addEventListener('click', () => {
    const value = backgroundLayerDefault(addType.value);
    writeLayers([value, ...layers], true);
  });
  clear.addEventListener('click', () => writeLayers([], true));
  toolbar.append(addType, add, clear);
  wrap.append(hint, list, toolbar);
  updateClearState();
  renderLayers();
  return wrap;
}

function rootVarValue(name) {
  try {
    const vars = (HE.sheet && HE.sheet.rootVars) ? HE.sheet.rootVars() : [];
    const found = vars.find((v) => v.name === name);
    return found ? String(found.value || '') : '';
  } catch { return ''; }
}

function fontTokenCandidates(currentName = '') {
  let vars = [];
  try { vars = (HE.sheet && HE.sheet.rootVars) ? HE.sheet.rootVars() : []; } catch { vars = []; }
  return vars.filter((v) => {
    const val = String(v.value == null ? '' : v.value).trim();
    if (v.name === currentName) return true;
    if (!val) return false;
    if (/^(#|rgb\(|rgba\(|hsl\(|hsla\(|oklch\(|oklab\(|\blab\(|\blch\(|color\()/i.test(val)) return false;
    if (/^(-?(?:\d+(?:\.\d*)?|\.\d+)(px|rem|em|%|vw|svw|lvw|dvw|vh|svh|lvh|dvh|vmin|vmax|ch|ex|cap|ic|lh|rlh|cm|mm|in|pt|pc|s|ms|deg|fr)?)$/i.test(val)) return false;
    return true;
  });
}

// Load the Google font (if any) named by a font-family value into the editor
// chrome and the live canvas. Direct picks are covered by applyFontCss; token
// switches need the token resolved first because the sheet-wide font scan
// can't see through var().
function ensureFontLoaded(cssValue) {
  let g = null;
  try { g = fonts.parseFamilyName(cssValue); } catch { g = null; }
  if (!g) return;
  try { fonts.ensureUiGoogleFont(g); } catch { /* ignore */ }
  try { if (HE.canvas && HE.canvas.loadGoogleFont) HE.canvas.loadGoogleFont(g); } catch { /* ignore */ }
}

// A bad token value breaks EVERY class using the token at once, so validate
// before writing :root. Returns a reason string, or '' when acceptable.
function invalidFontTokenReason(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return ''; // empty allowed: users fall back / inherit
  if (/[;{}!]/.test(v)) return 'looks like more than a font value — use a single font-family, e.g. Inter, sans-serif';
  let sq = 0;
  let dq = 0;
  let depth = 0;
  for (const ch of v) {
    if (ch === "'") sq++;
    else if (ch === '"') dq++;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      if (!depth) return 'has an unbalanced parenthesis';
      depth--;
    }
  }
  if (sq % 2) return 'has an unbalanced single quote';
  if (dq % 2) return 'has an unbalanced double quote';
  if (depth) return 'has an unbalanced parenthesis';
  return '';
}

let fontPickerInstance = 0;

export function fontPickerControl() {
  const sel = activeSelector();
  const values = displayValue(sel, 'font-family');
  const declared = values.declared;
  const computedVal = !state.pseudo && activeEl() ? computed('font-family') : '';
  const varRef = declared ? parseVarRef(declared) : null;
  const tokenValue = varRef ? rootVarValue(varRef.name) : '';
  // When the class uses var(--font-x), show the *resolved* font so the
  // field reads e.g. "Playfair Display" instead of "var(--font-display)".
  const resolvedCss = varRef
    ? (tokenValue || varRef.fallback || computedVal || '')
    : (declared || computedVal || '');

  const display = fonts.displayName(resolvedCss) || (varRef ? varRef.name : (resolvedCss || ''));
  const placeholder = fonts.displayName(computedVal) || (computedVal || 'Select a font…');

  const wrap = h('div', { class: 'font-picker' });
  const inputRow = h('div', { class: 'font-picker-input-row' });
  const input = h('input', {
    type: 'text', spellcheck: 'false', class: 'font-picker-input', 'aria-label': 'Font family',
  });
  input.value = declared ? display : '';
  input.placeholder = placeholder;
  if (declared) {
    input.classList.add('is-set');
    // Preview the resolved face in the field itself
    const face = fonts.firstFamily(resolvedCss);
    if (face && !/^var\(/i.test(face)) input.style.fontFamily = `'${face}', ${fonts.findGoogleFont(face) ? fonts.findGoogleFont(face).category : 'sans-serif'}`;
  }
  if (varRef) {
    input.title = `Uses ${declared} → ${resolvedCss || '(empty token)'} — picking a font below writes a direct value on ${sel || 'the class'} (unlinks the token); editing the token row updates everywhere`;
  } else if (declared && values.declared !== values.value) {
    input.title = `CSS: ${declared}`;
  } else if (declared) {
    input.title = declared;
  }
  input.disabled = !activeEl();

  const toggleBtn = h('button', {
    type: 'button', class: 'font-picker-toggle', title: 'Browse fonts and tokens',
    'aria-label': 'Browse fonts and tokens', 'aria-expanded': 'false',
  }, '▾');
  toggleBtn.disabled = !activeEl();

  inputRow.append(input, toggleBtn);
  wrap.append(inputRow);

  // Token linkage: when font-family is var(--x), let the user see + edit
  // the token value right here (no trip to the Tokens section), unlink to
  // a direct value, or switch to a different font token.
  if (varRef) {
    const bar = h('div', { class: 'font-token-bar' });
    const nameEl = h('span', {
      class: 'font-token-name',
      title: `${varRef.name} = ${tokenValue || varRef.fallback || '(empty)'} — editing the value updates every class using this token`,
    }, `🔗 ${varRef.name}`);
    const tokInput = h('input', {
      type: 'text', spellcheck: 'false', class: 'font-token-value',
      placeholder: 'Token value, e.g. Inter, sans-serif',
      title: `Edit ${varRef.name} globally (:root) — updates everywhere this token is used`,
      'aria-label': `${varRef.name} token value`,
    });
    tokInput.value = tokenValue;
    tokInput.disabled = !activeEl();
    if (resolvedCss) {
      const face = fonts.firstFamily(resolvedCss);
      if (face && !/^var\(/i.test(face)) tokInput.style.fontFamily = `'${face}', sans-serif`;
    }
    tokInput.addEventListener('change', () => {
      const reason = invalidFontTokenReason(tokInput.value);
      if (reason) {
        if (HE.toast) HE.toast(`Token ${varRef.name} not updated — value ${reason}.`, 'error');
        tokInput.value = tokenValue;
        return;
      }
      if (HE.actions && HE.actions.setRootVar) HE.actions.setRootVar(varRef.name, tokInput.value);
      ensureFontLoaded(tokInput.value || varRef.fallback);
      if (HE.panel && HE.panel.refresh) HE.panel.refresh();
    });
    tokInput.addEventListener('keydown', (e) => e.stopPropagation());
    const unlink = h('button', {
      type: 'button', class: 'font-token-unlink',
      title: `Unlink: write the resolved value (${resolvedCss || 'current font'}) directly on ${sel || 'the class'} so this field no longer follows the token`,
    }, 'Unlink');
    unlink.disabled = !activeEl();
    unlink.addEventListener('click', () => {
      if (resolvedCss) applyFontCss(resolvedCss);
      else HE.actions.setStyle('font-family', '');
      if (HE.panel && HE.panel.refresh) HE.panel.refresh();
    });
    bar.append(nameEl, tokInput, unlink);
    wrap.append(bar);
    // Token switching lives inside the picker dropdown (Tokens group) —
    // no separate plate. The 🔗 bar above keeps linkage state + inline edit.
  }

  const dropdown = h('div', {
    id: `he-font-picker-${++fontPickerInstance}`,
    class: 'font-picker-dropdown', hidden: '', role: 'dialog',
    'aria-label': 'Font choices',
  });
  toggleBtn.setAttribute('aria-controls', dropdown.id);
  const searchInput = h('input', {
    type: 'text',
    class: 'font-picker-search',
    placeholder: 'Search fonts and tokens…',
    spellcheck: 'false',
    'aria-label': 'Search fonts and tokens',
  });
  const list = h('div', { class: 'font-picker-list', role: 'listbox', 'aria-label': 'Font choices' });

  dropdown.append(searchInput, list);
  wrap.append(dropdown);

  function applyFontCss(cssValue) {
    const g = fonts.parseFamilyName(cssValue);
    if (g) {
      fonts.ensureUiGoogleFont(g);
      if (HE.canvas.loadGoogleFont) HE.canvas.loadGoogleFont(g);
    }
    HE.actions.setStyle('font-family', cssValue);
    const name = fonts.displayName(cssValue);
    input.value = name;
    input.classList.toggle('is-set', !!cssValue.trim());
    const face = fonts.firstFamily(cssValue);
    const gfont = face && fonts.findGoogleFont(face);
    input.style.fontFamily = face
      ? `'${face}', ${gfont ? gfont.category : 'sans-serif'}`
      : '';
    input.title = cssValue;
    closeDropdown();
  }

  function renderList(query) {
    list.innerHTML = '';

    // Tokens group inside the picker (not a separate plate): clicking one
    // writes var(--name) so later token edits update this field.
    try {
      const q = String(query || '').trim().toLowerCase();
      const matches = fontTokenCandidates(varRef && varRef.name).filter((v) =>
        !q || v.name.toLowerCase().includes(q) || String(v.value || '').toLowerCase().includes(q));
      if (matches.length) {
        list.append(h('div', { class: 'font-picker-header' }, 'Tokens'));
        for (const v of matches) {
          const val = rootVarValue(v.name);
          const friendly = fonts.displayName(val) || (val || 'empty token');
          const active = declared === `var(${v.name})`;
          const face = fonts.firstFamily(val);
          const item = h('button', {
            type: 'button', role: 'option',
            class: 'font-picker-item' + (active ? ' token-on' : ''),
            'aria-selected': active ? 'true' : 'false',
          },
            h('span', {
              class: 'font-picker-token',
              style: face && !/^var\(/i.test(face) ? `font-family: '${face}', sans-serif` : '',
            }, (active ? '● ' : '') + v.name),
            h('span', { class: 'font-picker-cat' }, friendly.slice(0, 24)));
          item.title = `${v.name} = ${val || '(empty)'} — click to use this token`;
          item.addEventListener('click', () => {
            HE.actions.setStyle('font-family', `var(${v.name})`);
            ensureFontLoaded(val);
            closeDropdown();
            if (HE.panel && HE.panel.refresh) HE.panel.refresh();
          });
          list.append(item);
        }
      }
    } catch { /* token group is best-effort */ }

    // Folder fonts first (Task 72): @font-face rules vendored into the
    // project serve from local files — no Google request, works offline.
    // The live canvas renders them via the sheet; the row here keeps a
    // plain fallback stack so the editor chrome itself makes no request.
    try {
      const q = String(query || '').trim().toLowerCase();
      const css = HE.sheet ? HE.sheet.serialize() : '';
      const locals = fonts.localFamilies(css).filter((name) =>
        !q || String(name).toLowerCase().includes(q));
      if (locals.length) {
        list.append(h('div', { class: 'font-picker-header' }, 'On this site'));
        for (const name of locals) {
          const meta = fonts.findGoogleFont(name);
          const cat = meta ? meta.category : 'sans-serif';
          const item = h(
            'button',
            { type: 'button', role: 'option', class: 'font-picker-item', 'aria-selected': 'false' },
            h('span', { class: 'font-picker-name' }, name),
            h('span', { class: 'font-picker-cat' }, 'local')
          );
          item.title = `${name} — served from your project folder (fonts/), no external request. The canvas shows the true rendering.`;
          item.addEventListener('click', () =>
            applyFontCss(fonts.fontFamilyValue(name, cat))
          );
          list.append(item);
        }
      }
    } catch { /* local group is best-effort */ }

    const sys = fonts.searchSystem(query);
    if (sys.length) {
      list.append(h('div', { class: 'font-picker-header' }, 'System'));
      for (const f of sys) {
        const item = h(
          'button',
          { type: 'button', role: 'option', class: 'font-picker-item', 'aria-selected': 'false' },
          h('span', { class: 'font-picker-name', style: `font-family: ${f.stack}` }, f.label),
          h('span', { class: 'font-picker-cat' }, 'system')
        );
        item.addEventListener('click', () => applyFontCss(f.css));
        list.append(item);
      }
    }

    const allResults = fonts.searchFonts(query);
    // Folder copy wins: a vendored family lists under "On this site" only,
    // so opening the picker makes no Google request for it.
    let results = allResults;
    try {
      const css = HE.sheet ? HE.sheet.serialize() : '';
      const skip = new Set(fonts.localFamilies(css).map((n) => String(n).toLowerCase()));
      if (skip.size) results = allResults.filter((f) => !skip.has(f.family.toLowerCase()));
    } catch { /* filter is best-effort */ }
    if (!results.length) return;

    const groups = {};
    for (const f of results) {
      if (!groups[f.category]) groups[f.category] = [];
      groups[f.category].push(f);
    }
    const order = ['sans-serif', 'serif', 'monospace', 'display', 'handwriting'];
    const labels = {
      'sans-serif': 'Sans Serif',
      serif: 'Serif',
      monospace: 'Monospace',
      display: 'Display',
      handwriting: 'Handwriting',
    };
    for (const cat of order) {
      if (!groups[cat]) continue;
      list.append(h('div', { class: 'font-picker-header' }, labels[cat] || cat));
      for (const f of groups[cat]) {
        fonts.ensureUiGoogleFont(f.family);
        const item = h(
          'button',
          { type: 'button', role: 'option', class: 'font-picker-item', 'aria-selected': 'false' },
          h(
            'span',
            { class: 'font-picker-name', style: `font-family: '${f.family}', ${f.category}` },
            f.family
          ),
          h('span', { class: 'font-picker-cat' }, 'Google')
        );
        item.addEventListener('click', () =>
          applyFontCss(fonts.fontFamilyValue(f.family, f.category))
        );
        list.append(item);
      }
    }
  }

  let open = false;
  function closeDropdown(returnFocus = false) {
    if (returnFocus) toggleBtn.focus();
    dropdown.hidden = true;
    open = false;
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleDropdown() {
    open = !open;
    dropdown.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      fonts.preloadPickerFonts(24);
      searchInput.value = '';
      renderList('');
      searchInput.focus();
    }
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  input.addEventListener('click', (e) => {
    if (!activeEl()) return;
    e.stopPropagation();
    if (!open) toggleDropdown();
  });

  searchInput.addEventListener('input', () => {
    renderList(searchInput.value.trim());
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDropdown(true);
    }
    e.stopPropagation();
  });

  // Typing a plain name (e.g. Inter) writes proper CSS + loads Google font
  input.addEventListener('change', () => {
    const raw = input.value.trim();
    if (!raw) {
      HE.actions.setStyle('font-family', '');
      input.style.fontFamily = '';
      input.classList.remove('is-set');
      input.title = '';
      return;
    }
    const match = fonts.findGoogleFont(raw);
    const g = match ? match.family : fonts.parseFamilyName(raw);
    if (g) {
      const meta = fonts.findGoogleFont(g);
      applyFontCss(fonts.fontFamilyValue(g, meta ? meta.category : 'sans-serif'));
      return;
    }
    const sys = fonts.system.find(
      (s) => s.label.toLowerCase() === raw.toLowerCase() || s.css.toLowerCase() === raw.toLowerCase()
    );
    if (sys) {
      applyFontCss(sys.css);
      return;
    }
    // freeform CSS stack
    applyFontCss(raw);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
    e.stopPropagation();
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target) && open) {
      closeDropdown();
    }
  });

  return wrap;
}

// Compact picker for a :root font token. The token row keeps its raw text
// field for custom stacks, while this menu covers the common system and
// Google font choices without making the user type a family name.
export function fontTokenPicker(value, onChange) {
  let current = String(value || '').trim();
  let open = false;
  const wrap = h('div', { class: 'font-picker token-font-picker' });
  const button = h('button', {
    type: 'button',
    class: 'font-token-picker-button',
    title: 'Choose a font',
    'aria-label': 'Choose a font',
    'aria-haspopup': 'menu',
  });
  const dropdown = h('div', { class: 'font-picker-dropdown', hidden: '', role: 'dialog' });
  const searchInput = h('input', {
    type: 'text',
    class: 'font-picker-search',
    placeholder: 'Search fonts…',
    spellcheck: 'false',
    'aria-label': 'Search fonts',
  });
  const list = h('div', { class: 'font-picker-list' });

  const updateButton = (next) => {
    current = String(next || '').trim();
    const label = fonts.displayName(current) || 'Font';
    button.textContent = label;
    button.title = current ? `Choose a font (current: ${label})` : 'Choose a font';
    const face = fonts.firstFamily(current);
    const meta = face && fonts.findGoogleFont(face);
    button.style.fontFamily = face
      ? `'${face}', ${meta ? meta.category : 'sans-serif'}`
      : '';
  };

  const choose = (cssValue) => {
    updateButton(cssValue);
    ensureFontLoaded(cssValue);
    if (onChange) onChange(cssValue);
    dropdown.hidden = true;
    open = false;
  };

  // The token list lives in the scrolling left sidebar. Position this menu
  // against the button in viewport coordinates so the sidebar cannot clip it.
  const positionDropdown = () => {
    const buttonRect = button.getBoundingClientRect();
    const menuRect = dropdown.getBoundingClientRect();
    const gap = 4;
    const edge = 8;
    const openUp = buttonRect.bottom + gap + menuRect.height > window.innerHeight - edge;
    const top = openUp
      ? Math.max(edge, buttonRect.top - gap - menuRect.height)
      : buttonRect.bottom + gap;
    const left = Math.max(
      edge,
      Math.min(buttonRect.left, window.innerWidth - menuRect.width - edge),
    );
    dropdown.style.top = `${top}px`;
    dropdown.style.left = `${left}px`;
  };

  const addHeader = (label) => list.append(h('div', { class: 'font-picker-header' }, label));
  const addItem = (label, cssValue, category, style) => {
    const item = h('button', { type: 'button', class: 'font-picker-item', role: 'menuitem' });
    const name = h('span', { class: 'font-picker-name' }, label);
    if (style) name.style.fontFamily = style;
    item.append(name, h('span', { class: 'font-picker-cat' }, category));
    item.addEventListener('click', () => choose(cssValue));
    list.append(item);
  };

  const renderList = (query) => {
    list.replaceChildren();
    const q = String(query || '').trim().toLowerCase();
    // Folder fonts first (Task 72) — same "On this site" group as the main
    // picker, without waking Google for vendored families.
    let skip = new Set();
    try {
      const css = HE.sheet ? HE.sheet.serialize() : '';
      const locals = fonts.localFamilies(css).filter((name) =>
        !q || String(name).toLowerCase().includes(q));
      skip = new Set(fonts.localFamilies(css).map((n) => String(n).toLowerCase()));
      if (locals.length) {
        addHeader('On this site');
        for (const name of locals) {
          const meta = fonts.findGoogleFont(name);
          const cat = meta ? meta.category : 'sans-serif';
          addItem(name, fonts.fontFamilyValue(name, cat), 'local', null);
        }
      }
    } catch { /* local group is best-effort */ }
    const systems = fonts.searchSystem(q);
    if (systems.length) {
      addHeader('System');
      for (const font of systems) addItem(font.label, font.css, 'system', font.stack);
    }

    const results = fonts.searchFonts(q).filter((f) => !skip.has(f.family.toLowerCase()));
    if (!results.length) return;
    const groups = {};
    for (const font of results) {
      if (!groups[font.category]) groups[font.category] = [];
      groups[font.category].push(font);
    }
    const order = ['sans-serif', 'serif', 'monospace', 'display', 'handwriting'];
    const labels = {
      'sans-serif': 'Sans Serif',
      serif: 'Serif',
      monospace: 'Monospace',
      display: 'Display',
      handwriting: 'Handwriting',
    };
    for (const category of order) {
      if (!groups[category]) continue;
      addHeader(labels[category] || category);
      for (const font of groups[category]) {
        fonts.ensureUiGoogleFont(font.family);
        addItem(font.family, fonts.fontFamilyValue(font.family, font.category), 'Google', `'${font.family}', ${font.category}`);
      }
    }
  };

  const toggle = () => {
    open = !open;
    dropdown.hidden = !open;
    if (!open) return;
    fonts.preloadPickerFonts(24);
    searchInput.value = '';
    renderList('');
    positionDropdown();
    searchInput.focus();
  };

  updateButton(current);
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  searchInput.addEventListener('input', () => renderList(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.hidden = true;
      open = false;
    }
    e.stopPropagation();
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target) && open) {
      dropdown.hidden = true;
      open = false;
    }
  });

  // Keep the button label in sync when the adjacent raw token field changes.
  wrap.updateValue = updateButton;
  dropdown.append(searchInput, list);
  wrap.append(button, dropdown);
  return wrap;
}
