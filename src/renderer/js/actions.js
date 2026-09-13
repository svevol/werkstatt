// Actions — all mutations that touch the canvas DOM + shared sheet together:
// class lifecycle (create/attach/rename/delete/merge), style writes, purity
// tools, and the JS-impact guards around them.

import { HE } from './he.js';
import { escapeRegExp, CLASS_TOKEN_RE } from './util.js';
import { fonts } from './fonts.js';
import { buildFontFaceCss } from './localfonts.js';

// Cross-page class rename/delete: rewrites class attributes in the other
// pages of the project. Relative paths only — the main process resolves them
// against the project root (safeResolve).
async function updateClassInOtherPages(oldName, newName, action, fs = window.he) {
  if (!HE.project) return;
  for (const page of HE.project.pages) {
    if (page === HE.page) continue;
    const html = await fs.readFile(page);
    let updated = html;
    if (action === 'rename') {
      updated = html.replace(
        new RegExp(`(class=["'][^"']*?)\\b${escapeRegExp(oldName)}\\b([^"']*?["'])`, 'g'),
        `$1${newName}$2`
      );
    } else if (action === 'delete') {
      updated = html.replace(
        new RegExp(`(class=["'][^"']*?)\\s*\\b${escapeRegExp(oldName)}\\b\\s*([^"']*?["'])`, 'g'),
        (match, before, after) => {
          const combined = before + after;
          return combined.replace(/class=["']\s+/, (m) => m).replace(/\s+(["'])/, '$1');
        }
      );
    }
    if (updated !== html) {
      await fs.writeFile(page, updated);
      if (HE.recordCrossPageWrite) HE.recordCrossPageWrite(page, html, updated, fs);
    }
  }
}
HE._updateClassInOtherPages = updateClassInOtherPages;

// Awaited wrapper: cross-page writes are disk changes outside undo, so any
// failure must be surfaced instead of leaving a silently half-renamed site.
async function applyClassInOtherPages(oldName, newName, action) {
  try {
    await updateClassInOtherPages(oldName, newName, action);
  } catch (err) {
    HE.toast('Cross-page ' + action + ' of .' + oldName + ' failed: ' + ((err && err.message) || err), 'error');
  }
}

function collectUsedClassNames() {
  const used = new Set(HE.sheet.classNames());
  const root = HE.canvas.doc;
  if (root) {
    for (const node of root.querySelectorAll('[class]')) {
      for (const name of node.classList) used.add(name);
    }
  }
  return used;
}

function uniqueClassName(base) {
  const used = collectUsedClassNames();
  let name = base;
  let suffix = 2;
  while (used.has(name)) name = `${base}-${suffix++}`;
  return name;
}

// Sync bodies behind the JS-impact confirms below (kept sync so the
// no-JS-usage fast path applies DOM changes before returning, preserving
// the previous synchronous behaviour for callers and smoke tests). The
// cross-page file writes are awaited at the end with error surfacing.
// Picked matching rules become stale when classes/rules are renamed, deleted
// or re-scoped — leave the rule picker for those actions.
function clearRuleScope() {
  try {
    const st = HE.panel && HE.panel.state;
    if (!st) return;
    st.activeRule = null;
    st.activeRuleRule = null;
    st.activeRuleMedia = '';
    st.activeRuleElm = null;
  } catch { /* ignore */ }
}

async function doRenameClass(oldName, newName) {
  HE.commit();
  clearRuleScope();
  HE.sheet.renameClass(oldName, newName);
  for (const el of HE.canvas.doc.querySelectorAll('.' + oldName)) {
    el.classList.replace(oldName, newName);
  }
  if (HE.panel.state.activeClass === oldName) HE.panel.state.activeClass = newName;
  if (HE.panel.state.activeCombo === oldName) HE.panel.state.activeCombo = newName;
  HE.afterDomChange();
  if (HE.canvas.selected) HE.canvas.select(HE.canvas.selected);
  await applyClassInOtherPages(oldName, newName, 'rename');
}

async function doDeleteClass(name) {
  HE.commit();
  clearRuleScope();
  HE.sheet.deleteClassRules(name);
  for (const el of HE.canvas.doc.querySelectorAll('.' + name)) {
    el.classList.remove(name);
  }
  if (HE.panel.state.activeClass === name) {
    HE.panel.state.activeClass = HE.canvas.selected && HE.canvas.selected.classList[0] || null;
  }
  if (HE.panel.state.activeCombo === name) HE.panel.state.activeCombo = null;
  // Detached base may leave a combo pointing at a removed class.
  try {
    const sel = HE.canvas.selected;
    if (sel && HE.panel.state.activeCombo && !sel.classList.contains(HE.panel.state.activeCombo)) {
      HE.panel.state.activeCombo = null;
    }
    if (sel && HE.panel.state.activeClass && !sel.classList.contains(HE.panel.state.activeClass)) {
      HE.panel.state.activeClass = (sel.classList[0] || null);
      HE.panel.state.activeCombo = null;
    }
  } catch { /* ignore */ }
  HE.afterDomChange();
  if (HE.canvas.selected) HE.canvas.select(HE.canvas.selected);
  else HE.panel.refresh();
  await applyClassInOtherPages(name, null, 'delete');
}

HE.actions = HE.actions || {};
HE.actions.CLASS_NAME_RE = CLASS_TOKEN_RE;

HE.actions.validateClassName = function (raw) {
  const value = String(raw == null ? '' : raw).trim().replace(/^\./, '');
  if (!value) return { ok: false, value: '', error: 'Name is required.' };
  if (/[A-Z]/.test(value)) {
    return {
      ok: false,
      value,
      error: 'Use kebab-case (no capitals).',
      hint: 'BEM allowed: block__element--modifier, e.g. hero__title--large.',
    };
  }
  if (!CLASS_TOKEN_RE.test(value)) {
    return {
      ok: false,
      value,
      error: 'Use kebab-case: start with a letter, _ or -, then letters, digits, - or _.',
      hint: 'BEM allowed: block__element--modifier, e.g. hero__title--large.',
    };
  }
  return { ok: true, value, hint: 'BEM allowed: block__element--modifier.' };
};

HE.actions.ensureUniqueClassName = uniqueClassName;

// ---------- JS-impact guards (parsed selectors + class strings) ----------

// Sync lookup of cached-JS usages for class names. Never executes JS.
function jsUsagesForClasses(names) {
  try {
    if (HE.hooks && HE.hooks.classesUsagesInJs) {
      return HE.hooks.classesUsagesInJs(names) || [];
    }
  } catch {
    /* best-effort */
  }
  return [];
}
HE.jsUsagesForClasses = jsUsagesForClasses;

function jsComponentGuess(cls) {
  const base = String(cls || '').split(/__|--/)[0] || String(cls || '');
  return base.split('-')[0] || String(cls || '');
}

// Modal confirm: "app.js queries .accordion-panel – deleting may break
// accordion. Continue?" with per-file [Show file] (openExternal via
// window.he.openFile) + Cancel/Continue. For rename, a checkbox offers
// "Also rename in JS files (safe string replace of '.old' class literals
// only)". Resolves { proceed, updateJs }. No usages -> resolves proceed
// without showing UI. HE._jsConfirmStub(info) overrides the UI in tests.
HE.confirmJsImpact = function ({ action, classes, usages } = {}) {
  const names = [...new Set((classes || []).map((c) => String(c).replace(/^\./, '')).filter(Boolean))];
  const found = usages || jsUsagesForClasses(names);
  if (!found.length) return Promise.resolve({ proceed: true, updateJs: false });
  if (typeof HE._jsConfirmStub === 'function') {
    try {
      const r = HE._jsConfirmStub({ action, classes: names, usages: found });
      if (r && typeof r.then === 'function') return r.then((v) => normalizeConfirm(v));
      return Promise.resolve(normalizeConfirm(r));
    } catch {
      return Promise.resolve({ proceed: false, updateJs: false });
    }
  }
  const verb = action === 'rename' ? 'renaming' : action === 'duplicate' ? 'duplicating' : 'deleting';
  const kindWord = (kinds) => {
    if ((kinds || []).includes('queries')) return 'queries';
    if ((kinds || []).includes('class')) return 'toggles';
    return 'references';
  };
  return new Promise((resolve) => {
    const done = (value) => {
      try {
        overlay.remove();
      } catch { /* ignore */ }
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done({ proceed: false, updateJs: false });
      }
    };
    document.addEventListener('keydown', onKey, true);

    const overlay = document.createElement('div');
    overlay.className = 'he-confirm-overlay';
    const box = document.createElement('div');
    box.className = 'he-confirm-box';
    box.setAttribute('role', 'alertdialog');
    const title = document.createElement('div');
    title.className = 'he-confirm-title';
    title.textContent = 'JS uses this class';
    box.appendChild(title);
    const seenLines = new Set();
    for (const u of found.slice(0, 6)) {
      const line = `${u.file} ${kindWord(u.kinds)} .${u.cls} – ${verb} may break ${jsComponentGuess(u.cls)}. Continue?`;
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      const p = document.createElement('div');
      p.textContent = line;
      p.className = 'he-confirm-line';
      box.appendChild(p);
    }
    let check = null;
    if (action === 'rename' && names.length === 1) {
      const label = document.createElement('label');
      label.className = 'he-confirm-check';
      check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = false;
      const span = document.createElement('span');
      span.textContent = `Also rename in JS files (safe string replace of '.${names[0]}' class literals only)`;
      label.appendChild(check);
      label.appendChild(span);
      box.appendChild(label);
    }
    const row = document.createElement('div');
    row.className = 'he-confirm-row';
    const distinctFiles = [...new Map(found.filter((u) => u.full).map((u) => [u.full, u])).values()].slice(0, 3);
    for (const u of distinctFiles) {
      if (!window.he || !window.he.openFile) break;
      const show = document.createElement('button');
      show.type = 'button';
      show.textContent = 'Show ' + (u.file || 'file');
      show.title = 'Open in external editor (read-only here)';
      show.addEventListener('click', async () => {
        try {
          const err = await window.he.openFile(u.full);
          if (err) HE.toast('Could not open ' + u.file + ':\n' + err, 'error');
        } catch {
          HE.toast('Could not open ' + u.file, 'error');
        }
      });
      row.appendChild(show);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => done({ proceed: false, updateJs: false }));
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = action === 'rename' ? 'Rename' : action === 'duplicate' ? 'Duplicate' : 'Delete';
    go.className = 'he-confirm-primary';
    go.addEventListener('click', () => done({ proceed: true, updateJs: !!(check && check.checked) }));
    row.appendChild(cancel);
    row.appendChild(go);
    box.appendChild(row);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) done({ proceed: false, updateJs: false });
    });
    document.body.appendChild(overlay);
    cancel.focus();
  });

  function normalizeConfirm(v) {
    if (v === true) return { proceed: true, updateJs: false };
    if (v === false || v == null) return { proceed: false, updateJs: false };
    return { proceed: v.proceed !== false, updateJs: !!v.updateJs };
  }
};

// Safe JS rename: exact '.old' class literals only via
// HE.hooks.renameClassInJsText, never reformatting, written via
// window.he.writeFile. Updates the HE.jsFiles cache in place.
HE.renameClassInJs = async function (oldName, newName) {
  if (!HE.hooks || !HE.hooks.renameClassInJsText) return 0;
  if (!window.he || !window.he.writeFile) return 0;
  let total = 0;
  for (const f of HE.jsFiles || []) {
    if (!f || typeof f.text !== 'string' || !f.full) continue;
    let r;
    try {
      r = HE.hooks.renameClassInJsText(f.text, oldName, newName);
    } catch {
      continue;
    }
    if (r && r.count > 0 && r.text !== f.text) {
      try {
        await window.he.writeFile(f.full, r.text);
        f.text = r.text;
        total += r.count;
      } catch (err) {
        HE.toast('Could not update ' + (f.rel || f.src) + ': ' + ((err && err.message) || err), 'error');
      }
    }
  }
  return total;
};

// Suggest a semantic class name from nearest classed ancestor + tag.
// e.g. <h1> inside .hero -> hero-title, <p> -> hero-sub,
// <a>/<button> -> btn (or hero-cta when btn is taken). Falls back to tag-style.
HE.actions.suggestClassName = function (elm) {
  const tag = (elm.tagName || 'div').toLowerCase();
  let block = null;
  let node = elm.parentElement;
  while (node) {
    if (node.classList && node.classList.length) {
      const raw = String(node.classList[0] || '');
      const base = raw.split(/__|--/)[0].toLowerCase().replace(/[^a-z0-9-_]/g, '');
      if (base && /^[a-z_-]/.test(base)) {
        block = base.replace(/^[-_]+/, '') || null;
        if (block) break;
      }
      block = null;
    }
    node = node.parentElement;
  }
  const used = collectUsedClassNames();
  let base;
  if (block) {
    if (/^h[1-6]$/.test(tag)) base = `${block}-title`;
    else if (tag === 'p' || tag === 'span') base = `${block}-sub`;
    else if (tag === 'a' || tag === 'button') base = used.has('btn') ? `${block}-cta` : 'btn';
    else if (tag === 'img') base = `${block}-img`;
    else if (tag === 'ul' || tag === 'ol' || tag === 'li') base = `${block}-list`;
    else base = `${block}-${tag}`;
  } else {
    base = `${tag}-style`;
  }
  return uniqueClassName(base);
};

function ensureStyleClass(elm, preferredName) {
  const tag = elm.tagName.toLowerCase();
  let base = preferredName;
  if (!base) {
    try {
      base = HE.actions.suggestClassName(elm);
      // suggestClassName is already unique; use it directly
      HE.commit();
      elm.classList.add(base);
      HE.sheet.ensureRule('.' + base);
      HE.panel.state.activeClass = base;
      HE.panel.state.activeCombo = null;
      HE.afterDomChange();
      return '.' + base;
    } catch {
      base = `${tag}-style`;
    }
  }
  const name = uniqueClassName(base);

  HE.commit();
  elm.classList.add(name);
  HE.sheet.ensureRule('.' + name);
  HE.panel.state.activeClass = name;
  HE.panel.state.activeCombo = null;
  HE.afterDomChange();
  return '.' + name;
}
HE.actions.ensureStyleClass = ensureStyleClass;

Object.assign(HE.actions, {
  setStyle(prop, value, opts) {
    if (HE.canvas.mode !== 'edit') return;
    const st = HE.panel.state || {};
    // Picked matching rule: write the declaration on that exact CSSRule
    // object (descendant/attribute/media/@layer/nested) — never a new rule.
    if (st.activeRule && st.activeRuleRule && HE.sheet &&
        st.activeRuleRule.parentStyleSheet === HE.sheet.sheet) {
      if (opts && opts.now) HE.commit(); else HE.commitDebounced();
      let rule = st.activeRuleRule;
      if (st.pseudo) {
        try { rule = HE.sheet.ensureRuleVariant(rule, st.pseudo); } catch { rule = st.activeRuleRule; }
      }
      HE.sheet.setOnRule(rule, prop, value);
      if (prop === 'font-family' && HE.canvas.syncGoogleFontsFromSheet) {
        HE.canvas.syncGoogleFontsFromSheet();
      }
      HE.markDirty();
      return;
    }
    let sel = HE.panel.activeSelector();
    let createdClass = false;
    if (!sel && HE.canvas.selected) {
      const elm = HE.canvas.selected;
      if (elm.classList && elm.classList.length) {
        const active = HE.panel.state && HE.panel.state.activeClass;
        if (active && elm.classList.contains(active)) {
          const combo = HE.panel.state.activeCombo;
          const useCombo = combo && elm.classList.contains(combo) && combo !== active;
          sel = '.' + active + (useCombo ? '.' + combo : '') + (HE.panel.state.pseudo || '');
          if (!useCombo) HE.panel.state.activeCombo = null;
        } else {
          sel = '.' + elm.classList[0];
          if (HE.panel.state) {
            HE.panel.state.activeClass = elm.classList[0];
            HE.panel.state.activeCombo = null;
          }
        }
      } else {
        const auto = (opts && opts.auto) || HE.actions._autoClass;
        const suggestion = HE.actions.suggestClassName(elm);
        if (!auto && HE.panel && typeof HE.panel.promptForClassName === 'function') {
          const shown = HE.panel.promptForClassName(elm, suggestion, prop, value);
          if (shown) return;
        }
        sel = ensureStyleClass(elm, suggestion);
        createdClass = true;
      }
    }
    if (!sel) return;
    if (!createdClass) { if (opts && opts.now) HE.commit(); else HE.commitDebounced(); }
    const media = (typeof HE.viewportMedia === 'function') ? HE.viewportMedia() : '';
    if (media) HE.sheet.setMedia(sel, prop, value, media);
    else HE.sheet.set(sel, prop, value);
    if (prop === 'font-family' && HE.canvas.syncGoogleFontsFromSheet) {
      HE.canvas.syncGoogleFontsFromSheet();
    }
    HE.markDirty();
  },

  // Site Globals: write a declaration on a site-wide selector (html, body,
  // tag rules). Unlike setStyle this never creates/uses a class and never
  // routes through the selected element — used by the Site scope editor.
  setGlobal(selector, prop, value, opts) {
    if (HE.canvas.mode !== 'edit' || !HE.sheet || !selector || !prop) return;
    if (opts && opts.now) HE.commit(); else HE.commitDebounced();
    HE.sheet.set(selector, prop, value);
    if (prop === 'font-family' && HE.canvas.syncGoogleFontsFromSheet) {
      HE.canvas.syncGoogleFontsFromSheet();
    }
    HE.markDirty();
  },

  applyAccessibilityDefaults() {
    if (HE.canvas.mode !== 'edit' || !HE.sheet) return;
    HE.commit();
    // NOTE: use the CSSOM-normalized `*, ::before, ::after` form (not
    // `*, *::before, *::after`) so findRule/get round-trips and repeat
    // clicks skip instead of stacking duplicate rules.
    const defaults = [
      ['*, ::before, ::after', 'box-sizing', 'border-box'],
      ['img, picture, video, canvas, svg', 'max-width', '100%'],
      ['img, picture, video, canvas, svg', 'height', 'auto'],
      [':where(p, li, dt, dd, blockquote, figcaption)', 'overflow-wrap', 'anywhere'],
      [':where(p, li, dt, dd, blockquote, figcaption)', 'text-wrap', 'pretty'],
      [':focus-visible', 'outline', '2px solid currentColor'],
      [':focus-visible', 'outline-offset', '3px'],
    ];
    for (const [selector, prop, value] of defaults) {
      if (!HE.sheet.get(selector, prop)) HE.sheet.set(selector, prop, value);
    }
    HE.sheet.addRule(`@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`);
    HE.markDirty();
    if (HE.panel && HE.panel.refresh) HE.panel.refresh();
  },

  // Task 72: 1-click Google Fonts self-host. Downloads the used families'
  // woff2 files into project `fonts/` (main process) and writes local
  // @font-face rules into the shared sheet. Undo reverts the stylesheet
  // rules (downloaded files stay — a re-click reuses them). Idempotent:
  // families with a folder copy are skipped, existing files are kept.
  async selfhostGoogleFonts() {
    if (!HE.sheet || !HE.canvas || !HE.canvas.doc) {
      return { ok: false, error: 'Open a page first.' };
    }
    if (HE.canvas.mode !== 'edit') {
      return { ok: false, error: 'Switch back to Edit mode first.' };
    }
    let css = '';
    try {
      css = HE.sheet.serialize();
    } catch {
      return { ok: false, error: 'Stylesheet is not available.' };
    }
    let docHtml = '';
    try {
      docHtml = HE.canvas.doc.documentElement.outerHTML || '';
    } catch { docHtml = ''; }
    const used = fonts.detectGoogleFontsInCss(css);
    let linked = [];
    try {
      linked = fonts.detectGoogleFontLinks(docHtml);
    } catch { linked = []; }
    const all = [...new Set([...used, ...linked])];
    const todo = fonts.familiesNeedingLocal(all, css);
    if (!todo.length) {
      return { ok: true, vendored: [], files: 0, nothing: true };
    }
    if (!window.he || !window.he.selfhostFonts) {
      return { ok: false, error: 'Font download is unavailable in this build.' };
    }
    HE.commit();
    let res;
    try {
      const ipc = HE.fontsIpc ? HE.fontsIpc() : null;
      const backend = (ipc && ipc.selfhostFonts)
        ? ipc
        : { selfhostFonts: (families) => window.he.selfhostFonts(families) };
      res = await backend.selfhostFonts(todo);
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
    const before = css;
    const flat = [];
    for (const fam of res || []) {
      for (const e of (fam && fam.entries) || []) {
        // Skip blocks already in the sheet (repeat clicks stay byte-identical).
        if (before.includes(e.file) || flat.some((x) => x.file === e.file)) continue;
        flat.push(e);
      }
    }
    if (flat.length) {
      const blocks = buildFontFaceCss(flat).split('\n\n');
      for (const block of blocks) {
        try {
          HE.sheet.addRule(block);
        } catch { /* single-block failures must not lose the rest */ }
      }
    }
    if (HE.canvas.syncGoogleFontsFromSheet) HE.canvas.syncGoogleFontsFromSheet();
    HE.markDirty();
    if (HE.panel && HE.panel.refresh) HE.panel.refresh();
    return { ok: true, vendored: todo, files: flat.length };
  },

  attachClass(name) {
    const elm = HE.canvas.selected;
    if (!elm) return;
    HE.commit();
    clearRuleScope();
    elm.classList.add(name);
    // Adopt preview-only simulation: a chip attach makes the class real
    // so serialize keeps it (otherwise the simulator would strip it).
    try {
      if (HE.canvas.noteRealClass) HE.canvas.noteRealClass(name);
    } catch { /* ignore */ }
    HE.sheet.ensureRule('.' + name);
    HE.panel.state.activeClass = name;
    HE.panel.state.activeCombo = null;
    HE.afterDomChange();
    HE.canvas.select(elm);
  },

  // visual-builder-style combo: keep the base class, add a second class and edit
  // the compound '.base.combo'. The combo never creates a standalone
  // '.combo' rule — only the compound is ensured.
  attachComboClass(name) {
    const elm = HE.canvas.selected;
    if (!elm) return { ok: false, error: 'No element selected.' };
    const checked = HE.actions.validateClassName(name);
    if (!checked.ok) return { ok: false, error: checked.error };
    const base = (HE.panel.state.activeClass && elm.classList.contains(HE.panel.state.activeClass))
      ? HE.panel.state.activeClass : (elm.classList[0] || null);
    if (!base) return { ok: false, error: 'Add a base class first.' };
    if (checked.value === base) return { ok: false, error: 'Combo must differ from the base class.' };
    HE.commit();
    clearRuleScope();
    elm.classList.add(checked.value);
    try {
      if (HE.canvas.noteRealClass) HE.canvas.noteRealClass(checked.value);
    } catch { /* ignore */ }
    HE.sheet.ensureRule('.' + base + '.' + checked.value);
    HE.panel.state.activeClass = base;
    HE.panel.state.activeCombo = checked.value;
    HE.afterDomChange();
    HE.canvas.select(elm);
    return { ok: true, base, combo: checked.value, selector: '.' + base + '.' + checked.value };
  },

  // Switch editing scope without touching the DOM: 'base' edits '.btn',
  // 'combo' edits '.btn.large'. Combo target must be on the element.
  setScope(scope, comboName) {
    const elm = HE.canvas.selected;
    if (!elm) return false;
    // Class scope always leaves the matching-rules picker.
    HE.panel.state.activeRule = null;
    HE.panel.state.activeRuleRule = null;
    HE.panel.state.activeRuleMedia = '';
    HE.panel.state.activeRuleElm = null;
    if (scope === 'base') {
      HE.panel.state.activeCombo = null;
      HE.panel.state.pseudo = '';
      if (HE.panel.refresh) HE.panel.refresh();
      return true;
    }
    const combo = comboName || HE.panel.state.activeCombo;
    if (!combo || !elm.classList.contains(combo)) return false;
    if (combo === HE.panel.state.activeClass) return false;
    HE.panel.state.activeCombo = combo;
    if (HE.panel.refresh) HE.panel.refresh();
    return true;
  },

  // Matching-rules picker: edit the exact rule object under the selection.
  // Entry comes from `Sheet.rulesFor`; pass null to return to class scope.
  setRuleScope(entry) {
    const st = HE.panel.state;
    if (!entry) {
      st.activeRule = null;
      st.activeRuleRule = null;
      st.activeRuleMedia = '';
      st.activeRuleElm = null;
      st.pseudo = '';
      if (HE.panel.refresh) HE.panel.refresh();
      return true;
    }
    st.activeRule = entry.selector;
    st.activeRuleRule = entry.rule;
    st.activeRuleMedia = entry.media || '';
    st.activeRuleElm = HE.canvas.selected || null;
    st.activeCombo = null;
    st.pseudo = '';
    if (HE.panel.refresh) HE.panel.refresh();
    return true;
  },

  // Author a rule from the matching-rules sidebar: create it (at the current
  // viewport breakpoint) if missing, then edit it.
  addRuleScope(selector) {
    if (HE.canvas.mode !== 'edit' || !HE.sheet) return { ok: false, error: 'Edit mode only.' };
    const sel = String(selector || '').trim();
    if (!sel || /[{};]/.test(sel) || !/^[.\[]/.test(sel)) {
      return { ok: false, error: 'Unsupported selector.' };
    }
    HE.commit();
    const media = (typeof HE.viewportMedia === 'function') ? HE.viewportMedia() : '';
    let rule = null;
    try {
      rule = media ? HE.sheet.ensureRuleInMedia(media, sel) : HE.sheet.ensureRule(sel);
    } catch {
      return { ok: false, error: 'Could not create that rule.' };
    }
    HE.markDirty();
    HE.actions.setRuleScope({ selector: sel, rule, media });
    return { ok: true, selector: sel };
  },

  // Delete only the compound rule (e.g. '.btn.large' + pseudos/media),
  // keeping both classes on the element and both single-class rules.
  deleteComboStyles() {
    const st = HE.panel.state;
    if (!st.activeClass || !st.activeCombo) return { ok: false, error: 'No combo selected.' };
    HE.commit();
    HE.sheet.deleteComboRule('.' + st.activeClass + '.' + st.activeCombo);
    st.activeCombo = null;
    HE.afterDomChange();
    if (HE.canvas.selected) HE.canvas.select(HE.canvas.selected);
    else if (HE.panel.refresh) HE.panel.refresh();
    return { ok: true };
  },

  detachClass(name) {
    const elm = HE.canvas.selected;
    if (!elm) return;
    HE.commit();
    clearRuleScope();
    elm.classList.remove(name);
    // Dropping via chips also drops any preview-only tracking for that class.
    try {
      if (HE.canvas.noteRealClass) HE.canvas.noteRealClass(name);
    } catch { /* ignore */ }
    if (HE.panel.state.activeClass === name) {
      HE.panel.state.activeClass = elm.classList[0] || null;
      HE.panel.state.activeCombo = null;
    }
    if (HE.panel.state.activeCombo === name) HE.panel.state.activeCombo = null;
    HE.afterDomChange();
    HE.canvas.select(elm);
  },

  renameClass(oldName, newName, opts) {
    const usages = jsUsagesForClasses([oldName]);
    if (usages.length && !(opts && opts.skipJsCheck)) {
      return HE.confirmJsImpact({ action: 'rename', classes: [oldName], usages }).then((res) => {
        if (!res || !res.proceed) return false;
        return doRenameClass(oldName, newName).then(() => {
          const jsP = res.updateJs ? HE.renameClassInJs(oldName, newName) : Promise.resolve(0);
          return jsP.then(() => true);
        });
      });
    }
    return doRenameClass(oldName, newName).then(() => {
      if (opts && opts.updateJs) {
        return HE.renameClassInJs(oldName, newName).then(() => true);
      }
      return true;
    });
  },

  deleteClass(name, opts) {
    const usages = jsUsagesForClasses([name]);
    if (usages.length && !(opts && opts.skipJsCheck)) {
      return HE.confirmJsImpact({ action: 'delete', classes: [name], usages }).then((res) => {
        if (!res || !res.proceed) return false;
        return doDeleteClass(name).then(() => true);
      });
    }
    return doDeleteClass(name).then(() => true);
  },

  createClassWithStyles(elm, name, styles, opts) {
    const checked = HE.actions.validateClassName(name);
    if (!checked.ok) return { ok: false, error: checked.error };
    clearRuleScope();
    const keepSelection = !!(opts && opts.select === false);
    const prevActive = HE.panel.state.activeClass;
    const sel = ensureStyleClass(elm, checked.value);
    for (const s of styles || []) {
      HE.sheet.set(sel, s.prop, s.value);
      if (s.prop === 'font-family' && HE.canvas.syncGoogleFontsFromSheet) {
        HE.canvas.syncGoogleFontsFromSheet();
      }
    }
    HE.markDirty();
    if (keepSelection) {
      if (HE.canvas.selected !== elm) HE.panel.state.activeClass = prevActive;
      return { ok: true, selector: sel, name: sel.slice(1) };
    }
    if (HE.canvas.selected === elm && HE.panel && HE.panel.refresh) HE.panel.refresh();
    else if (HE.canvas.select) HE.canvas.select(elm);
    return { ok: true, selector: sel, name: sel.slice(1) };
  },

  // Design tokens: write a :root CSS variable. Class-independent.
  setRootVar(name, value) {
    if (HE.canvas.mode !== 'edit' || !HE.sheet) return;
    let n = String(name || '').trim();
    if (!n.startsWith('--')) n = '--' + n;
    if (!/^--[A-Za-z0-9-_]+$/.test(n)) return;
    HE.commitDebounced();
    const next = String(value == null ? '' : value).trim();
    HE.sheet.set(':root', n, next);
    // Deleting a token also clears its theme/scoped re-declarations so no
    // orphan override survives without a base value.
    if (!next && HE.sheet.themeVarGroups) {
      try {
        for (const g of HE.sheet.themeVarGroups()) {
          if (g.vars.some((v) => v.name === n)) HE.sheet.set(g.selector, n, '');
        }
      } catch { /* best-effort cleanup */ }
    }
    HE.markDirty();
  },

  // Design tokens: edit a theme-scoped override ([data-theme="dark"] { … }).
  setThemeVar(selector, name, value) {
    if (HE.canvas.mode !== 'edit' || !HE.sheet) return;
    const sel = String(selector || '').trim();
    const n = String(name || '').trim();
    if (!/\[data-theme/i.test(sel) || !/^--[A-Za-z0-9-_]+$/.test(n)) return;
    HE.commitDebounced();
    HE.sheet.set(sel, n, String(value == null ? '' : value).trim());
    HE.markDirty();
  },

  // Design tokens: rename --old to --new everywhere (the :root declaration
  // plus every var(--old) usage, including @media and fallbacks).
  // Single undo step. Returns { ok, count } or { ok: false, error }.
  renameRootVar(oldName, newName) {
    if (HE.canvas.mode !== 'edit' || !HE.sheet) return { ok: false, error: 'Open a site first.' };
    const o = String(oldName || '').trim();
    let n = String(newName || '').trim().replace(/^\./, '');
    if (!n.startsWith('--')) n = '--' + n;
    if (!/^--[A-Za-z0-9-_]+$/.test(n)) return { ok: false, error: 'Use --kebab-case, e.g. --accent.' };
    if (n === o) return { ok: true, count: 0 };
    let clash = false;
    try {
      clash = HE.sheet.rootVars().some((v) => v.name === n);
    } catch { clash = false; }
    if (clash) return { ok: false, error: `${n} already exists — pick another name.` };
    HE.commit();
    const count = HE.sheet.renameVar(o, n);
    HE.markDirty();
    if (HE.panel && HE.panel.refresh) HE.panel.refresh();
    return { ok: true, count };
  },

  // Purity tool (opt-in): move style="" declarations onto a class.
  // Creates a class when the element has none, otherwise merges into
  // the active scope (combo compound when a combo is active, else the
  // active/first single class) via HE.sheet.set, then removes style.
  // Single HE.commit() so undo restores both DOM + sheet.
  promoteInlineStyles() {
    if (HE.canvas.mode !== 'edit') return { ok: false, error: 'Edit mode only.' };
    const elm = HE.canvas.selected;
    if (!elm) return { ok: false, error: 'No element selected.' };
    if (!elm.hasAttribute || !elm.hasAttribute('style')) {
      return { ok: false, error: 'No inline styles.' };
    }
    const decls = [];
    try {
      for (let i = 0; i < elm.style.length; i++) {
        const prop = elm.style.item(i);
        const value = elm.style.getPropertyValue(prop);
        const pri = elm.style.getPropertyPriority(prop);
        if (prop && value) decls.push({ prop, value: pri ? value + ' !important' : value });
      }
    } catch {
      return { ok: false, error: 'Could not read inline styles.' };
    }
    if (!decls.length) {
      HE.commit();
      clearRuleScope();
      elm.removeAttribute('style');
      HE.afterDomChange();
      if (HE.canvas.select) HE.canvas.select(elm);
      return { ok: true, name: null };
    }
    HE.commit();
    clearRuleScope();
    let name = HE.panel && HE.panel.state && HE.panel.state.activeClass;
    if (!name || !elm.classList || !elm.classList.contains(name)) {
      name = (elm.classList && elm.classList[0]) || null;
    }
    if (!name) {
      name = HE.actions.suggestClassName(elm);
      elm.classList.add(name);
      HE.sheet.ensureRule('.' + name);
    } else {
      HE.sheet.ensureRule('.' + name);
    }
    if (HE.panel) HE.panel.state.activeClass = name;
    // Respect combo scope: promote onto the compound when one is active.
    let sel = '.' + name;
    try {
      const combo = HE.panel && HE.panel.state && HE.panel.state.activeCombo;
      if (combo && elm.classList.contains(combo) && combo !== name) {
        sel = '.' + name + '.' + combo;
        HE.sheet.ensureRule(sel);
      } else if (HE.panel) HE.panel.state.activeCombo = null;
    } catch { /* ignore */ }
    for (const d of decls) {
      HE.sheet.set(sel, d.prop, d.value);
      if (d.prop === 'font-family' && HE.canvas.syncGoogleFontsFromSheet) {
        HE.canvas.syncGoogleFontsFromSheet();
      }
    }
    elm.removeAttribute('style');
    HE.afterDomChange();
    if (HE.canvas.select) HE.canvas.select(elm);
    return { ok: true, name };
  },

  // Purity tool (opt-in): merge classes with identical declarations.
  // Keeps the first class per duplicate group, re-points DOM usages
  // (current page + other pages via rename logic) and deletes the
  // duplicate rules. Single commit for undo.
  async mergeDuplicateClasses() {
    if (HE.canvas.mode !== 'edit' || !HE.sheet) return { ok: false, merged: 0 };
    const groups = HE.sheet.findDuplicateRules ? HE.sheet.findDuplicateRules() : [];
    if (!groups.length) return { ok: true, merged: 0, groups };
    HE.commit();
    clearRuleScope();
    let merged = 0;
    for (const g of groups) {
      const [keep, ...dups] = g.classes;
      for (const dup of dups) {
        try {
          for (const el of HE.canvas.doc.querySelectorAll('.' + dup)) {
            if (!el.classList.contains(keep)) el.classList.add(keep);
            el.classList.remove(dup);
          }
        } catch {
          /* bad class name — skip DOM pass */
        }
        HE.sheet.deleteClassRules(dup);
        await applyClassInOtherPages(dup, keep, 'rename');
        if (HE.panel && HE.panel.state.activeClass === dup) {
          HE.panel.state.activeClass = keep;
        }
        if (HE.panel && HE.panel.state.activeCombo === dup) {
          HE.panel.state.activeCombo = null;
        }
        merged++;
      }
    }
    HE.afterDomChange();
    if (HE.canvas.selected && HE.canvas.select) HE.canvas.select(HE.canvas.selected);
    else if (HE.panel && HE.panel.refresh) HE.panel.refresh();
    return { ok: true, merged, groups };
  },
});
