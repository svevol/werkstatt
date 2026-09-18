// Smoke test — runs inside the app renderer via `npm run smoke`.
// Exercises the core invariants: scripts blocked in Edit, throwaway Preview,
// clean serialization, memory-only autosave, class lifecycle, cross-page
// rename, versions store.

import { HE } from './he.js';

HE.test = {
  async run() {
    const log = [];
    try {
      // Deterministic: no background autosave writes during the run.
      HE.autosave = false;
      HE.cancelAutosave();
      document.getElementById('welcome').hidden = true;
      document.getElementById('app').hidden = false;
      const welcomeDisplay = getComputedStyle(document.getElementById('welcome')).display;
      if (welcomeDisplay !== 'none') throw new Error('welcome overlay is not hidden after open: ' + welcomeDisplay);
      log.push('welcome hidden');

      const css = ':root { --border: 3px; --ink: #150520; --gap: 12px; }\n' +
        '.hero { padding: 40px; }\n.hero h1 { color: navy; }\n' +
        '.spacing-box { margin: 8px 16px 24px; padding: 4px 6px; }\n' +
        '.spacing-one { margin: 2px; }\n.spacing-four { padding: 1px 2px 3px 4px; }\n' +
        '.token-border { border: var(--border) solid var(--ink); }\n' +
        '.token-pad { padding: var(--gap) 0 0; }\n';
      const html =
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head>' +
        '<body><section class="hero"><h1>Hello</h1><p>World</p><div class="spacing-box">Spacing</div>' +
        '<div class="token-border">Token border</div><div class="token-pad">Token padding</div>' +
        '<script>window.__heRan = true;<\/script>' +
        '</section></body></html>';

      // Edit mode: scripts must NOT run
      await HE.canvas.setMode('edit');
      await HE.canvas.loadPage(html.replace('<\/script>', '</script>'), css);
      await new Promise((r) => setTimeout(r, 250));
      const canvasFrame = document.getElementById('canvas-frame');
      if (!canvasFrame || canvasFrame.classList.contains('is-loading')) throw new Error('canvas loading transition did not finish');
      log.push('page loaded (edit)');

      // --- Autosave keeps a session draft without writing project files ---
      const autosaveState = {
        project: HE.project,
        page: HE.page,
        cssFile: HE.cssFile,
        cssLinked: HE.cssLinked,
      };
      HE.project = { dir: '/tmp/test-site', pages: ['page1.html'], stylesheets: [] };
      HE.page = 'page1.html';
      HE.cssFile = 'styles.css';
      HE.autosave = true;
      const prevDraftIpc = HE.draftIpc;
      HE.draftIpc = () => null; // fake dir — skip the disk side path here (covered below)
      HE.markDirty();
      await new Promise((r) => setTimeout(r, 2150));
      if (!HE.autosaveDraft || HE.autosaveDraft.page !== 'page1.html') {
        throw new Error('autosave did not keep an in-memory draft');
      }
      if (!HE.dirty || document.getElementById('dirty-dot').hidden) {
        throw new Error('memory-only autosave cleared dirty state');
      }
      if (!/^Draft kept \d{2}:\d{2}$/.test(document.getElementById('save-state').textContent)) {
        throw new Error('autosave status did not describe the kept draft');
      }
      // The save-status slot has a fixed width, so its text never nudges Save.
      const saveStateEl = document.getElementById('save-state');
      const saveBtnEl = document.getElementById('save-btn');
      const saveBtnLeft = saveBtnEl.getBoundingClientRect().left;
      const keptText = saveStateEl.textContent;
      saveStateEl.textContent = 'Draft kept 23:59';
      const saveBtnLeftLong = saveBtnEl.getBoundingClientRect().left;
      saveStateEl.textContent = keptText;
      if (Math.abs(saveBtnLeftLong - saveBtnLeft) > 1) {
        throw new Error('save-status text shifted the Save button');
      }
      const writes = [];
      const previousAfterSave = HE.versions.afterSave;
      HE.versions.afterSave = async () => {};
      try {
        await HE.save(async (path, content) => writes.push({ path, content }));
      } finally {
        HE.versions.afterSave = previousAfterSave;
      }
      if (writes.length !== 2 || writes[0].path !== 'page1.html' || writes[1].path !== 'styles.css') {
        throw new Error('manual Save did not write page and stylesheet');
      }
      if (HE.dirty || HE.autosaveDraft) throw new Error('manual Save did not clear draft state');
      HE.draftIpc = prevDraftIpc;
      HE.autosave = false;
      HE.cancelAutosave();
      HE.project = autosaveState.project;
      HE.page = autosaveState.page;
      HE.cssFile = autosaveState.cssFile;
      HE.cssLinked = autosaveState.cssLinked;
      log.push('draft capture ok');

      // --- Task 64: crash-safe whole-folder drafts + 3-way leave ---
      const restorePage = HE.page;
      const restoreProject = HE.project;
      const restoreAutosave = HE.autosave;
      const restoreDirty = HE.dirty;
      HE.project = { dir: '/tmp/test-site', pages: ['page1.html', 'other.html', 'no-draft.html', 'disk-me.html', 'leave-me.html'], stylesheets: ['styles.css'] };
      const fakeDisk = {};
      const origDraftIpc = HE.draftIpc;
      const origAskLeave = HE.askLeave;
      const origConfirmRestore = HE.confirmRestoreDraft;
      const origToast = HE.toast;
      const notices = [];
      try {
        HE.draftIpc = () => ({
          write: async (p) => { fakeDisk[p.page] = { ...p, capturedAt: Date.now() }; return true; },
          read: async (_d, page) => (fakeDisk[page] ? { ...fakeDisk[page] } : null),
          clear: async (_d, page) => { delete fakeDisk[page]; return true; },
          list: async () => Object.values(fakeDisk).map((d) => ({ page: d.page, cssFile: d.cssFile, capturedAt: d.capturedAt })),
          clearAll: async () => { for (const k of Object.keys(fakeDisk)) delete fakeDisk[k]; return true; },
        });
        HE.autosave = true;
        // Persist path: memory draft reaches the disk store.
        HE.storeDraft('disk-me.html', { html: '<h1>kept</h1>', css: '.k{}', cssFile: 'styles.css', capturedAt: Date.now() });
        if (!await HE.persistDraft('disk-me.html')) throw new Error('persistDraft did not write');
        if (!fakeDisk['disk-me.html'] || fakeDisk['disk-me.html'].html !== '<h1>kept</h1>') {
          throw new Error('draft did not reach the disk store');
        }
        // Fresh-session path: empty memory falls back to disk.
        delete HE.drafts['disk-me.html'];
        HE.confirmRestoreDraft = async () => true;
        const revived = await HE.maybeRestoreDraft('disk-me.html', '<h1>file</h1>', '');
        if (!revived.restored || revived.html !== '<h1>kept</h1>') throw new Error('disk fallback did not revive the draft');
        if (!HE.getDraft('disk-me.html')) throw new Error('revived draft missing from memory');
        // Discard removes memory + disk.
        HE.confirmRestoreDraft = async () => false;
        const dropped = await HE.maybeRestoreDraft('disk-me.html', '<h1>file</h1>', '');
        if (dropped.restored || dropped.html !== '<h1>file</h1>') throw new Error('discard choice did not return the file');
        if (HE.getDraft('disk-me.html') || fakeDisk['disk-me.html']) throw new Error('discarded draft survived');
        // Missing draft loads the file silently.
        let asked = false;
        HE.confirmRestoreDraft = async () => { asked = true; return true; };
        const plain = await HE.maybeRestoreDraft('no-draft.html', '<h1>file</h1>', '.x{}');
        if (plain.restored || plain.html !== '<h1>file</h1>' || asked) {
          throw new Error('missing draft should load the file silently');
        }
        // Three-way leave: keep/cancel preserve, discard deletes everywhere.
        HE.page = 'leave-me.html';
        HE.storeDraft('leave-me.html', { html: 'd', css: '', cssFile: '', capturedAt: Date.now() });
        await HE.persistDraft('leave-me.html');
        HE.askLeave = async () => 'keep';
        if (await HE.confirmLeavePage('Leave?') !== 'keep') throw new Error('keep choice misreported');
        if (!HE.getDraft('leave-me.html') || !fakeDisk['leave-me.html']) throw new Error('keep choice dropped the draft');
        HE.askLeave = async () => 'cancel';
        if (await HE.confirmLeavePage('Leave?') !== 'cancel') throw new Error('cancel choice misreported');
        if (!HE.getDraft('leave-me.html') || !fakeDisk['leave-me.html']) throw new Error('cancel choice dropped the draft');
        HE.askLeave = async () => 'discard';
        if (await HE.confirmLeavePage('Leave?') !== 'discard') throw new Error('discard choice misreported');
        if (HE.getDraft('leave-me.html') || fakeDisk['leave-me.html']) throw new Error('leave-discard kept the draft');
        if (HE.draftPages().length !== 0) throw new Error('draft page set not empty after discard');
        // Project-open announce points at other pages' drafts.
        HE.storeDraft('other.html', { html: 'o', css: '', cssFile: '', capturedAt: Date.now() });
        await HE.persistDraft('other.html');
        delete HE.drafts['other.html'];
        HE.toast = (msg) => notices.push(String(msg));
        await HE.announceOtherDrafts(['page1.html', 'other.html'], 'page1.html');
        if (!notices.some((m) => m.includes('other.html'))) throw new Error('project-open announce missed the draft');
        // Quit-time flush persists the current page.
        HE.page = 'page1.html';
        HE.dirty = true;
        await window.__heFlushDrafts();
        if (!fakeDisk['page1.html']) throw new Error('quit-time flush did not persist');
      } finally {
        HE.draftIpc = origDraftIpc;
        HE.askLeave = origAskLeave;
        HE.confirmRestoreDraft = origConfirmRestore;
        HE.toast = origToast;
        for (const k of Object.keys(fakeDisk)) delete fakeDisk[k];
        HE.drafts = {};
        HE.autosaveDraft = null;
        HE.page = restorePage;
        HE.project = restoreProject;
        HE.autosave = restoreAutosave;
        HE.dirty = restoreDirty;
        document.getElementById('dirty-dot').hidden = !restoreDirty;
        HE.syncDirtyIpc();
        HE.cancelAutosave();
      }
      log.push('crash-safe drafts + leave ok');

      const ranInEdit = HE.canvas.doc.defaultView.__heRan === true;
      if (ranInEdit) throw new Error('script ran in edit mode');
      log.push('scripts blocked in edit');

      // neutralized script present
      const inert = HE.canvas.doc.querySelector('script[type="text/he-script"]');
      if (!inert) throw new Error('expected neutralized script in edit mode');
      log.push('script neutralized');

      const h1 = HE.canvas.doc.querySelector('h1');
      HE.canvas.select(h1);
      log.push('selected: ' + (HE.panel.state.activeClass || '(none — expected, h1 has no class)'));

      // Box-model controls must read authored margin/padding shorthands as
      // side values, then normalize the shorthand when one side is edited.
      const spacingBox = HE.canvas.doc.querySelector('.spacing-box');
      HE.canvas.select(spacingBox);
      const spacingSection = document.querySelector('#panel [data-sec="spacing"]');
      const sideValues = (layer) => [...spacingSection.querySelectorAll(`${layer} .size-number`)]
        .map((input) => input.value);
      if (JSON.stringify(sideValues('.bm-margin')) !== JSON.stringify(['8', '16', '24', '16'])) {
        throw new Error('margin shorthand did not populate box model: ' + sideValues('.bm-margin').join(','));
      }
      if (JSON.stringify(sideValues('.bm-padding')) !== JSON.stringify(['4', '6', '4', '6'])) {
        throw new Error('padding shorthand did not populate box model: ' + sideValues('.bm-padding').join(','));
      }
      if (HE.sheet.get('.spacing-one', 'margin-left') !== '2px' ||
          HE.sheet.get('.spacing-four', 'padding-left') !== '4px') {
        throw new Error('box shorthand expansion failed');
      }
      if ([...spacingSection.querySelectorAll('.origin-label')].some((el) => /inherit/i.test(el.textContent || ''))) {
        throw new Error('box model still shows generic inherited labels');
      }
      if (spacingSection.querySelectorAll('.t-menu-btn').length) {
        throw new Error('compact spacing controls still show token buttons');
      }
      const bmGrids = [...spacingSection.querySelectorAll('.bm-fields')];
      if (!bmGrids.length) throw new Error('spacing box-model grid missing');
      for (const grid of bmGrids) {
        if (grid.scrollWidth > grid.clientWidth + 1) throw new Error('spacing box overflows its column');
      }
      const compactUnits = [...spacingSection.querySelectorAll('.size-control.compact .size-unit')];
      if (!compactUnits.length) throw new Error('compact spacing controls missing');
      for (const unit of compactUnits) {
        if (unit.scrollWidth > unit.clientWidth + 1) throw new Error('spacing unit select clipped');
      }
      const compactNumbers = [...spacingSection.querySelectorAll('.size-control.compact .size-number')];
      for (const number of compactNumbers) {
        if (number.scrollWidth > number.clientWidth + 1) throw new Error('spacing number value clipped');
      }
      const marginBottom = spacingSection.querySelector('.bm-margin .bm-field:nth-child(3) .size-number');
      marginBottom.value = '32';
      marginBottom.dispatchEvent(new Event('input', { bubbles: true }));
      if (HE.sheet.get('.spacing-box', 'margin-bottom') !== '32px' ||
          HE.sheet.get('.spacing-box', 'margin-top') !== '8px' ||
          HE.sheet.serialize().includes('margin: 8px 16px 24px')) {
        throw new Error('editing a shorthand spacing side left conflicting CSS');
      }
      const paddingLeft = spacingSection.querySelector('.bm-padding .bm-field:nth-child(4) .size-number');
      paddingLeft.value = '';
      paddingLeft.dispatchEvent(new Event('input', { bubbles: true }));
      if (HE.sheet.get('.spacing-box', 'padding-left') || HE.sheet.get('.spacing-box', 'padding')) {
        throw new Error('clearing a shorthand spacing side did not remove it');
      }
      if (!marginBottom.classList.contains('is-scrubbable')) {
        throw new Error('spacing number field is not drag-scrubbable');
      }
      const marginLink = spacingSection.querySelector('.bm-margin .bm-link');
      if (!marginLink) throw new Error('spacing link toggle missing');
      marginLink.click();
      if (marginLink.getAttribute('aria-pressed') !== 'true') {
        throw new Error('spacing link toggle did not activate');
      }
      const marginTop = spacingSection.querySelector('.bm-margin .bm-field:nth-child(1) .size-number');
      marginTop.value = '12';
      marginTop.dispatchEvent(new Event('input', { bubbles: true }));
      if (HE.sheet.get('.spacing-box', 'margin-top') !== '12px' ||
          HE.sheet.get('.spacing-box', 'margin-right') !== '12px' ||
          HE.sheet.get('.spacing-box', 'margin-bottom') !== '12px' ||
          HE.sheet.get('.spacing-box', 'margin-left') !== '12px') {
        throw new Error('linked margin did not set every side');
      }
      const marginRightNumber = spacingSection.querySelector('.bm-margin .bm-field:nth-child(2) .size-number');
      if (marginRightNumber.value !== '12') {
        throw new Error('linked margin did not sync the sibling field');
      }
      const borderWidthRow = [...document.querySelectorAll('#panel [data-sec="border"] .prow')]
        .find((el) => el.querySelector('label')?.textContent.trim() === 'Width');
      const borderWidthInput = borderWidthRow && borderWidthRow.querySelector('.size-number');
      if (!borderWidthInput) throw new Error('functional border width control missing');
      const borderInputStyle = getComputedStyle(borderWidthInput);
      if (borderInputStyle.flexGrow !== '0' || parseFloat(borderInputStyle.flexBasis) > 96.1) {
        throw new Error('numeric pixel input is still too wide');
      }
      borderWidthInput.value = '4';
      borderWidthInput.dispatchEvent(new Event('input', { bubbles: true }));
      if (HE.sheet.get('.spacing-box', 'border-width') !== '4px') {
        throw new Error('pixel input did not change the stylesheet');
      }
      // Task 120: a longhand authored inside a var() shorthand must read back
      // (per longhand) and unfold without losing its var() siblings.
      if (HE.sheet.get('.token-border', 'border-width') !== 'var(--border)' ||
          HE.sheet.get('.token-border', 'border-style') !== 'solid' ||
          HE.sheet.get('.token-border', 'border-color') !== 'var(--ink)') {
        throw new Error('border shorthand did not resolve per longhand: ' +
          HE.sheet.get('.token-border', 'border-width'));
      }
      if (HE.sheet.get('.token-pad', 'padding-top') !== 'var(--gap)' ||
          HE.sheet.get('.token-pad', 'padding-left') !== '0px') {
        throw new Error('var() padding shorthand did not resolve per longhand: ' +
          HE.sheet.get('.token-pad', 'padding-top'));
      }
      HE.canvas.select(HE.canvas.doc.querySelector('.token-border'));
      HE.actions.setStyle('border-width', '5px', { now: true });
      const tokenBorderCss = HE.sheet.serialize();
      if (HE.sheet.get('.token-border', 'border-width') !== '5px' ||
          HE.sheet.get('.token-border', 'border-color') !== 'var(--ink)' ||
          !/border-color:\s*var\(--ink\)/.test(tokenBorderCss) ||
          /border:\s*var\(--border\)/.test(tokenBorderCss)) {
        throw new Error('editing a var() shorthand longhand lost its siblings: ' + tokenBorderCss);
      }
      HE.actions.setStyle('border-style', 'dashed', { now: true });
      if (HE.sheet.get('.token-border', 'border-style') !== 'dashed' ||
          HE.sheet.get('.token-border', 'border-color') !== 'var(--ink)') {
        throw new Error('second longhand edit changed a sibling');
      }
      HE.canvas.select(spacingBox);
      log.push('var() shorthand longhands ok');
      const typographySection = document.querySelector('#panel [data-sec="typography"]');
      const typographyGroups = [...(typographySection?.querySelectorAll('[data-type-group]') || [])]
        .map((el) => el.dataset.typeGroup);
      if (typographyGroups.join(',') !== 'font,sizing,paragraph,appearance') {
        throw new Error('Typography groups wrong: ' + typographyGroups.join(','));
      }
      const weightSelect = [...(typographySection?.querySelectorAll('.type-group-font select') || [])]
        .find((el) => el.getAttribute('aria-label') === 'font weight');
      const weightOptions = weightSelect ? [...weightSelect.options] : [];
      if (!weightSelect || !weightOptions.some((option) => option.value === '100') ||
          !weightOptions.some((option) => option.value === '900') ||
          !weightOptions.some((option) => option.value === '400' && /regular/i.test(option.textContent))) {
        throw new Error('Typography weight range missing');
      }
      // Task 75: a select with nothing authored on the class shows a quiet dash
      // plus the effective rendered value, so a browser/global default is
      // visible without being written to CSS. Choosing a value authors it.
      const emptyPreview = (select) => select
        && [...select.options].find((option) => option.value === '' && /—\s*·\s*\S/.test(option.textContent || ''));
      if (!emptyPreview(weightSelect) || !weightSelect.classList.contains('is-empty') ||
          HE.sheet.get('.spacing-box', 'font-weight')) {
        throw new Error('un-authored weight select should preview the effective value without authoring it');
      }
      weightSelect.value = '700';
      weightSelect.dispatchEvent(new Event('change', { bubbles: true }));
      if (HE.sheet.get('.spacing-box', 'font-weight') !== '700') {
        throw new Error('choosing a select value should author the class');
      }
      weightSelect.value = '';
      weightSelect.dispatchEvent(new Event('change', { bubbles: true }));
      HE.panel.refresh();
      const weightAfterClear = [...document.querySelectorAll('#panel [data-sec="typography"] .type-group-font select')]
        .find((el) => el.getAttribute('aria-label') === 'font weight');
      if (!emptyPreview(weightAfterClear) || !weightAfterClear.classList.contains('is-empty') ||
          HE.sheet.get('.spacing-box', 'font-weight')) {
        throw new Error('clearing should return the select to its effective-value preview');
      }
      if (/font-weight/.test(HE.sheet.serialize())) {
        throw new Error('effective preview must not serialize a declaration');
      }
      // An authored value outside the option list (variable-font weight 480)
      // must stay selected instead of silently collapsing to the "—" option.
      HE.actions.setStyle('font-weight', '480');
      HE.panel.refresh();
      const variableWeightSelect = [...document.querySelectorAll('#panel [data-sec="typography"] .type-group-font select')]
        .find((el) => el.getAttribute('aria-label') === 'font weight');
      const variableWeightOption = variableWeightSelect
        && [...variableWeightSelect.options].find((option) => option.value === '480');
      if (!variableWeightOption || !variableWeightOption.selected || variableWeightSelect.value !== '480') {
        throw new Error('authored font-weight outside the option list should stay visible and selected');
      }
      HE.actions.setStyle('font-weight', '');
      HE.panel.refresh();
      const borderStylePreviewRow = [...document.querySelectorAll('#panel [data-sec="border"] .prow')]
        .find((el) => el.querySelector('label')?.textContent.trim() === 'Style');
      const borderStylePreviewSelect = borderStylePreviewRow && borderStylePreviewRow.querySelector('select');
      if (!emptyPreview(borderStylePreviewSelect)) {
        throw new Error('non-typography selects should preview the effective value too');
      }
      const typeContext = typographySection?.querySelector('.type-context');
      const typeSpecimen = typographySection?.querySelector('.type-specimen-text');
      if (!typeContext || !/.spacing-box|No class/.test(typeContext.textContent || '')) {
        throw new Error('Typography scope context missing');
      }
      if (!typeSpecimen || !(typeSpecimen.textContent || '').includes('Ag')) {
        throw new Error('Typography specimen preview missing');
      }
      const alignment = typographySection?.querySelector('.type-alignment .seg');
      const alignmentButtons = [...(alignment?.querySelectorAll('button') || [])];
      if (!alignment || alignment.getAttribute('role') !== 'group' ||
          alignment.getAttribute('aria-label') !== 'Text alignment' || alignmentButtons.length !== 4 ||
          alignmentButtons.some((button) => !button.hasAttribute('aria-pressed') || !button.dataset.value)) {
        throw new Error('Typography alignment accessibility missing');
      }
      // The default text-align computes to logical `start`; the control must
      // still show the physical side (left) that renders now.
      const pressedAlignment = alignmentButtons
        .filter((button) => button.getAttribute('aria-pressed') === 'true')
        .map((button) => button.dataset.value);
      if (pressedAlignment.join(',') !== 'left') {
        throw new Error('Alignment should show the effective value: ' + pressedAlignment.join(','));
      }
      const fontPickerToggle = typographySection?.querySelector('.font-picker-toggle');
      if (!fontPickerToggle || fontPickerToggle.getAttribute('aria-expanded') !== 'false' ||
          !fontPickerToggle.getAttribute('aria-controls')) {
        throw new Error('Typography font picker accessibility missing');
      }
      typographySection.open = true;
      fontPickerToggle.click();
      const fontPicker = document.getElementById(fontPickerToggle.getAttribute('aria-controls'));
      const fontSearch = fontPicker && fontPicker.querySelector('.font-picker-search');
      if (!fontPicker || fontPicker.hidden || fontPickerToggle.getAttribute('aria-expanded') !== 'true' ||
          !fontPicker.querySelector('button.font-picker-item') || !fontSearch) {
        throw new Error('Typography font picker did not open as an accessible menu');
      }
      fontSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (!fontPicker.hidden || fontPickerToggle.getAttribute('aria-expanded') !== 'false' ||
          document.activeElement !== fontPickerToggle) {
        throw new Error('Typography font picker did not close and restore focus');
      }
      const sizingGroup = typographySection.querySelector('.type-group-sizing');
      const typeRowByLabel = (name) => [...sizingGroup.querySelectorAll('.prow')]
        .find((el) => el.querySelector('label')?.textContent.trim() === name);

      const lineHeightRow = typeRowByLabel('Line height');
      const lineHeightNumber = lineHeightRow && lineHeightRow.querySelector('.size-number');
      const lineHeightUnit = lineHeightRow && lineHeightRow.querySelector('.size-unit');
      const lineHeightAdvanced = lineHeightRow && lineHeightRow.querySelector('details.size-advanced');
      const lineHeightMark = lineHeightRow && lineHeightRow.querySelector('.size-unitless-mark');
      if (!lineHeightNumber || lineHeightNumber.getAttribute('lang') !== 'en-US' || lineHeightNumber.hidden) {
        throw new Error('unitless line-height number input missing');
      }
      if (!lineHeightUnit || lineHeightUnit.value !== 'unitless' || !lineHeightUnit.hidden) {
        throw new Error('line-height unit select should stay folded until Advanced');
      }
      if (!lineHeightMark || lineHeightMark.hidden || (lineHeightMark.textContent || '').trim() !== '×') {
        throw new Error('unitless line-height multiplier marker missing');
      }
      if (!lineHeightAdvanced || lineHeightAdvanced.open || !lineHeightAdvanced.querySelector('summary')) {
        throw new Error('line-height Advanced disclosure missing or open by default');
      }
      // A plain typed number must serialize as a unitless multiplier.
      lineHeightNumber.value = '1.6';
      lineHeightNumber.dispatchEvent(new Event('input', { bubbles: true }));
      if (HE.sheet.get('.spacing-box', 'line-height') !== '1.6') {
        throw new Error('unitless line-height did not write CSS: ' + HE.sheet.get('.spacing-box', 'line-height'));
      }
      // `normal` and every unit are one Advanced click away.
      lineHeightAdvanced.open = true;
      lineHeightAdvanced.dispatchEvent(new Event('toggle'));
      if (lineHeightUnit.hidden || [...lineHeightUnit.options].some((option) => option.hidden)) {
        throw new Error('line-height Advanced did not reveal every unit');
      }
      lineHeightUnit.value = 'normal';
      lineHeightUnit.dispatchEvent(new Event('change', { bubbles: true }));
      if (HE.sheet.get('.spacing-box', 'line-height') !== 'normal') {
        throw new Error('line-height normal keyword did not write CSS');
      }
      // Back to the unitless simple view for the rest of the run.
      lineHeightUnit.value = 'unitless';
      lineHeightUnit.dispatchEvent(new Event('change', { bubbles: true }));
      lineHeightAdvanced.open = false;
      lineHeightAdvanced.dispatchEvent(new Event('toggle'));
      if (lineHeightAdvanced.open || !lineHeightUnit.hidden) {
        throw new Error('line-height Advanced did not fold back to the simple view');
      }

      const letterRow = typeRowByLabel('Letter spacing');
      const letterNumber = letterRow && letterRow.querySelector('.size-number');
      const letterUnit = letterRow && letterRow.querySelector('.size-unit');
      const letterAdvanced = letterRow && letterRow.querySelector('details.size-advanced');
      if (!letterNumber || letterNumber.hidden || !letterUnit || !letterAdvanced || letterAdvanced.open) {
        throw new Error('letter-spacing simple control missing');
      }
      const letterVisibleUnits = [...letterUnit.options].filter((o) => !o.hidden).map((o) => o.value);
      if (JSON.stringify(letterVisibleUnits) !== JSON.stringify(['px', 'rem', 'em'])) {
        throw new Error('letter-spacing short unit list wrong: ' + letterVisibleUnits.join(','));
      }
      if (letterUnit.value !== 'px') throw new Error('letter-spacing should default to px');
      letterNumber.value = '2';
      letterNumber.dispatchEvent(new Event('input', { bubbles: true }));
      if (HE.sheet.get('.spacing-box', 'letter-spacing') !== '2px') {
        throw new Error('letter-spacing px value did not write CSS: ' + HE.sheet.get('.spacing-box', 'letter-spacing'));
      }
      HE.canvas.select(h1);
      log.push('spacing shorthand + box model ok');

      const plainP = HE.canvas.doc.querySelector('p');
      HE.canvas.select(plainP);
      const h1Sug = HE.actions.suggestClassName(HE.canvas.doc.querySelector('h1'));
      if (h1Sug !== 'hero-title') throw new Error('h1 suggestion wrong: ' + h1Sug);
      log.push('suggest ok: ' + h1Sug);
      if (HE.actions.validateClassName('myClass').ok) throw new Error('camelCase accepted');
      if (HE.actions.validateClassName('').ok) throw new Error('empty name accepted');
      if (!HE.actions.validateClassName('hero__title--large').ok) throw new Error('BEM name rejected');
      HE.actions.setStyle('color', 'tomato');
      if (HE.panel.state.pendingClass) {
        const prefilled = (document.querySelector('.class-prompt-input') || {}).value
          || HE.panel.state.pendingClass.suggestion;
        log.push('prompt shown: ' + prefilled);
        HE.panel.dismissClassPrompt(); // auto path uses suggestion
      }
      const generatedClass = plainP.classList[0];
      if (!generatedClass || HE.sheet.get('.' + generatedClass, 'color') !== 'tomato') {
        throw new Error('classless element style write failed');
      }
      log.push('classless element style ok');

      HE.canvas.select(h1);
      HE.actions.attachClass('title');
      HE.actions.setStyle('font-size', '48px');
      HE.actions.setStyle('color', 'tomato');
      const out = HE.sheet.serialize();
      if (!out.includes('.title') || !out.includes('font-size: 48px')) throw new Error('style write failed: ' + out);
      log.push('style write ok');

      HE.actions.renameClass('title', 'headline');
      if (!HE.sheet.get('.headline', 'color')) throw new Error('sheet rename failed');
      if (!h1.classList.contains('headline')) throw new Error('dom rename failed');
      log.push('rename ok');

      HE.canvas.insertElement('p', HE.canvas.doc.body, 'append');
      HE.canvas.deleteSelected();
      log.push('insert/delete ok');

      await HE.undo(); await HE.undo(); await HE.undo(); await HE.undo();
      log.push('undo ok, classes on h1 now: [' + h1.classList + ']');

      const copyTarget = HE.canvas.doc.querySelector('section.hero');
      HE.canvas.select(copyTarget);
      HE.canvas.copySelected();
      HE.canvas.pasteCopied();
      if (HE.canvas.doc.querySelectorAll('section.hero').length !== 2) throw new Error('copy/paste failed');
      HE.canvas.deleteSelected();
      log.push('copy/paste ok');

      const serializedDoc = HE.canvas.serializeDoc();
      if (serializedDoc.includes('he-overlay-root') || serializedDoc.includes('data-he-live') || serializedDoc.includes('data-he-editor')) {
        throw new Error('editor artifacts leaked into saved HTML');
      }
      if (serializedDoc.includes('text/he-script') || serializedDoc.includes('data-he-script-type')) {
        throw new Error('script neutralization leaked into saved HTML');
      }
      if (serializedDoc.includes('data-he-guard')) {
        throw new Error('preview guard leaked into saved HTML');
      }
      log.push('clean serialization ok');

      // Fresh load + serialize preserves script tags
      const html2 =
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head>' +
        '<body><h1 class="x">Hi</h1><script src="app.js"><\/script></body></html>'.replace('<\/script>', '</script>');
      await HE.canvas.loadPage(html2, '.x{color:red}');
      const ser2 = HE.canvas.serializeDoc();
      if (!ser2.includes('app.js') || ser2.includes('text/he-script')) {
        throw new Error('script src not preserved cleanly: ' + ser2.slice(0, 300));
      }
      log.push('script src preserved');

      // Relative author resources must resolve through the project protocol
      // before the Preview diagnostics listener observes their load events.
      const resourceProject = await window.he.openProjectPath(await window.he.demoPath());
      if (!resourceProject || resourceProject.error) {
        throw new Error('preview resource fixture project failed to open');
      }
      HE.canvas.setBaseUrl(await window.he.baseUrl());
      HE.canvas.setPageRel('index.html');
      await HE.canvas.setMode('preview');
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head>' +
        '<body><p>relative stylesheet</p></body></html>',
        ''
      );
      await new Promise((r) => setTimeout(r, 30));
      const resourceRuntime = HE.canvas.getRuntimeDiagnostics && HE.canvas.getRuntimeDiagnostics();
      const resourceLink = HE.canvas.doc.querySelector('link[rel="stylesheet"]');
      if (!resourceLink || !resourceLink.sheet || !resourceRuntime ||
          resourceRuntime.errors.length || resourceRuntime.resources.length) {
        throw new Error('Preview relative stylesheet failed: ' + JSON.stringify(resourceRuntime));
      }
      HE.canvas.setBaseUrl(null);
      HE.canvas.setPageRel(null);
      log.push('preview relative resources ok');

      // Preview mode runs scripts — and cannot reach the editor via parent
      await HE.canvas.setMode('preview');
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><p id="t">x</p><script>document.getElementById("t").dataset.ok="1";' +
        'try{window.__heBridge=window.parent.he}catch(e){window.__heBridge="blocked"};throw new Error("runtime smoke")<\/script></body></html>'.replace('<\/script>', '</script>'),
        ''
      );
      await new Promise((r) => setTimeout(r, 30));
      const ok = HE.canvas.doc.getElementById('t').dataset.ok;
      if (ok !== '1') throw new Error('script did not run in preview');
      log.push('scripts run in preview');
      const runtime = HE.canvas.getRuntimeDiagnostics && HE.canvas.getRuntimeDiagnostics();
      if (!runtime || !runtime.errors.some((e) => e.message.includes('runtime smoke'))) {
        throw new Error('Preview runtime diagnostic missing: ' + JSON.stringify(runtime));
      }
      log.push('runtime diagnostics ok');
      const bridge = HE.canvas.doc.defaultView.__heBridge;
      if (bridge && bridge !== 'blocked' && typeof bridge === 'object') {
        throw new Error('preview script reached the IPC bridge via window.parent');
      }
      log.push('preview sandboxed from bridge');

      await HE.canvas.setMode('edit');
      const cleanRuntimeHtml = HE.canvas.serializeDoc();
      if (cleanRuntimeHtml.includes('data-he-runtime')) throw new Error('runtime diagnostics leaked into saved HTML');

      // --- Preview is throwaway: script mutations must not leak back ---
      const CLOSE = '</scr' + 'ipt>';
      const mutHtml =
        '<!DOCTYPE html><html><head></head><body><p class="hero-sub">original</p>' +
        '<script>document.querySelector(".hero-sub").textContent = "MUTATED BY SCRIPT";' + CLOSE +
        '</body></html>';
      await HE.canvas.loadPage(mutHtml, '');
      await HE.canvas.setMode('preview');
      const mutatedText = HE.canvas.doc.querySelector('.hero-sub').textContent;
      if (mutatedText !== 'MUTATED BY SCRIPT') throw new Error('preview script did not run');
      const snapPreview = HE.canvas.editSnapshot();
      // NB: the script source itself contains the string "MUTATED BY SCRIPT",
      // so assert on the serialized <p> element, not a bare substring.
      if (!snapPreview.html.includes('<p class="hero-sub">original</p>')) {
        throw new Error('editSnapshot in preview lost the edit-mode content');
      }
      if (snapPreview.html.includes('<p class="hero-sub">MUTATED BY SCRIPT</p>')) {
        throw new Error('editSnapshot in preview captured script mutations');
      }
      await HE.canvas.setMode('edit');
      const backText = HE.canvas.doc.querySelector('.hero-sub').textContent;
      if (backText !== 'original') {
        throw new Error('preview mutation leaked into edit mode: ' + backText);
      }
      log.push('preview is throwaway');

      // --- Script neutralization survives tricky markup ---
      const tricky =
        '<!DOCTYPE html><html><head></head><body><p>edge</p>' +
        '<script data-cond="a>b">window.__needle = "<script>";' + CLOSE +
        '<!-- <script src="ghost.js">' + CLOSE + ' -->' +
        '<script src="app.js" data-note="x>y">' + CLOSE +
        '</body></html>';
      await HE.canvas.loadPage(tricky, '');
      const trickyOut = HE.canvas.serializeDoc();
      if (trickyOut.includes('text/he-script') || trickyOut.includes('data-he-script-type')) {
        throw new Error('neutralization leaked into serialized HTML');
      }
      if (!trickyOut.includes('data-cond="a>b"')) {
        throw new Error('attribute containing > was mangled: ' + trickyOut.slice(0, 400));
      }
      if (!trickyOut.includes('"<script>"')) {
        throw new Error('<script> inside script body was corrupted');
      }
      if (!trickyOut.includes('ghost.js')) throw new Error('commented-out script lost');
      if (!trickyOut.includes('data-note="x>y"')) {
        throw new Error('external script attrs mangled: ' + trickyOut.slice(0, 400));
      }
      log.push('neutralization edge cases ok');

      // --- Inline handlers are inert in Edit but survive Save ---
      const handlerHtml =
        '<!DOCTYPE html><html><head></head><body><p>handlers</p>' +
        '<img src="missing.png" onerror="window.__heHandler = 1">' +
        '<a href="javascript:window.__heJsUrl = 1">js</a>' +
        '<a href="page2.html">normal</a>' +
        '<div onclick="window.__heClick = 1" class="clickable">tap</div>' +
        '</body></html>';
      await HE.canvas.setMode('edit');
      await HE.canvas.loadPage(handlerHtml, '');
      await new Promise((r) => setTimeout(r, 250));
      const heView = HE.canvas.doc.defaultView;
      if (heView.__heHandler || heView.__heJsUrl) throw new Error('inline handler ran in edit mode');
      if (!HE.canvas.doc.querySelector('img[data-he-onerror]')) {
        throw new Error('event handler not neutralized in edit mode');
      }
      if (!HE.canvas.doc.querySelector('a[data-he-href]')) {
        throw new Error('javascript: URL not neutralized in edit mode');
      }
      if (!HE.canvas.doc.querySelector('a[href="page2.html"]')) {
        throw new Error('normal link href mangled by neutralization');
      }
      if (!HE.canvas.doc.querySelector('script[data-he-guard]')) {
        throw new Error('edit-mode guard missing');
      }
      HE.canvas.doc.querySelector('.clickable').dispatchEvent(new heView.MouseEvent('click', { bubbles: true }));
      if (heView.__heClick) throw new Error('click handler ran in edit mode');
      const handlerOut = HE.canvas.serializeDoc();
      for (const needle of [
        'onerror="window.__heHandler = 1"',
        'href="javascript:window.__heJsUrl = 1"',
        'onclick="window.__heClick = 1"',
        'href="page2.html"',
      ]) {
        if (!handlerOut.includes(needle)) throw new Error('handler neutralization did not round-trip: ' + needle);
      }
      if (/data-he-on|data-he-href|data-he-guard/.test(handlerOut)) {
        throw new Error('neutralization artifacts leaked into saved HTML');
      }
      if (!HE.canvas.doc.querySelector('img[data-he-onerror]')) {
        throw new Error('live DOM left live after serialize');
      }
      log.push('edit handlers inert + round-trip ok');

      // --- Preview recovers when a page script navigates the frame ---
      await HE.canvas.setMode('preview');
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head><script>location.replace("about:blank");' + CLOSE +
          '</head><body><p>nav</p></body></html>',
        ''
      );
      await new Promise((r) => setTimeout(r, 400)); // let the recovery cycle settle
      await HE.canvas.setMode('edit');
      if (!HE.canvas.doc.querySelector('style[data-he-editor]')) {
        throw new Error('editor did not recover canvas after preview navigation');
      }
      log.push('preview navigation recovery ok');

      // --- Duplicate id warning ---
      const d1 = HE.canvas.doc.createElement('div');
      d1.id = 'dup-test';
      const d2 = HE.canvas.doc.createElement('div');
      d2.id = 'dup-test';
      HE.canvas.doc.body.appendChild(d1);
      HE.canvas.doc.body.appendChild(d2);
      HE.refreshWarnings();
      const warnBar = document.getElementById('page-warnings');
      if (!warnBar || warnBar.hidden || !warnBar.textContent.includes('Duplicate id "dup-test"')) {
        throw new Error('duplicate id warning missing');
      }
      d1.remove();
      d2.remove();
      HE.refreshWarnings();
      if (!warnBar.hidden) throw new Error('warnings did not clear');
      log.push('duplicate id warning ok');

      // --- External (CDN) script warning ---
      HE.pageScripts = { external: ['app.js', 'https://cdn.jsdelivr.net/npm/lib@1/x.js'], inline: 1 };
      HE.refreshWarnings();
      if (warnBar.hidden || !warnBar.textContent.includes('cdn.jsdelivr.net')) {
        throw new Error('external script warning missing');
      }
      HE.pageScripts = { external: ['app.js'], inline: 0 };
      HE.refreshWarnings();
      if (!warnBar.hidden) throw new Error('external script warning did not clear');
      log.push('external script warning ok');

      // --- External-change guard: banner, keep-edits, save conflict ---
      const priorPage = HE.page;
      const priorCss = HE.cssFile;
      HE.project = { dir: '/tmp/test-site', pages: ['index.html'], stylesheets: ['styles.css'] };
      HE.page = 'index.html';
      HE.cssFile = 'styles.css';
      HE.externalChanges = [];
      HE.onExternalChange({
        changes: [{ path: 'styles.css', kind: 'change' }],
        pages: ['index.html'],
        stylesheets: ['styles.css'],
      });
      const extBanner = document.getElementById('external-change-banner');
      if (!extBanner || extBanner.hidden || !/styles\.css/.test(extBanner.textContent)) {
        throw new Error('external-change banner missing');
      }
      const keepBtn = [...extBanner.querySelectorAll('button')].find((b) => /Keep my edits/.test(b.textContent));
      if (!keepBtn) throw new Error('external-change keep button missing');
      keepBtn.click();
      if (!extBanner.hidden || HE.externalChanges.length) {
        throw new Error('keep my edits did not dismiss the banner');
      }
      const realFileIpc = HE.fileIpc;
      let wrote = 0;
      let confirmSeen = [];
      HE.fileIpc = () => ({
        statFile: async () => ({ mtimeMs: 99, size: 99 }),
        writeFileChecked: async () => { wrote++; return { ok: true, stamp: { mtimeMs: 100, size: 1 } }; },
        confirmExternalConflict: async (paths) => { confirmSeen = paths; return 2; },
      });
      try {
        HE.fileStamps['index.html'] = { mtimeMs: 1, size: 1 };
        HE.fileStamps['styles.css'] = { mtimeMs: 1, size: 1 };
        HE.dirty = true;
        const blocked = await HE.save();
        if (blocked !== false || wrote !== 0) throw new Error('save overwrote a newer disk file');
        if (!confirmSeen.includes('index.html') || !confirmSeen.includes('styles.css')) {
          throw new Error('save conflict did not name both files: ' + confirmSeen.join(','));
        }
        HE.fileIpc = () => ({
          statFile: async () => ({ mtimeMs: 99, size: 99 }),
          writeFileChecked: async () => { wrote++; return { ok: true, stamp: { mtimeMs: 100, size: 1 } }; },
          confirmExternalConflict: async () => 0,
        });
        const ok = await HE.save();
        if (!ok || wrote !== 2) throw new Error('overwrite choice did not save both files: ' + wrote);
        if (HE.dirty) throw new Error('successful save did not clear dirty');
      } finally {
        HE.fileIpc = realFileIpc;
        HE.externalChanges = [];
      }
      HE.page = priorPage;
      HE.cssFile = priorCss;
      if (document.getElementById('external-change-banner')) {
        document.getElementById('external-change-banner').remove();
      }
      log.push('external-change guard ok');

      // --- Site check engine (mocked project files) ---
      const checkFiles = {
        'index.html': '<!DOCTYPE html><html><head><title>Home</title></head><body>' +
          '<img src="images/missing.png"><a href="#nope">x</a><a href="page2.html">p2</a>' +
          '<div id="d"></div><div id="d"></div><p class="phantom">x</p></body></html>',
        'page2.html': '<!DOCTYPE html><html><head><title>Two</title><meta name="description" content="d"></head><body><p class="card">x</p></body></html>',
        'styles.css': '.card { color: red; }\n.orphan { color: blue; }',
      };
      const checkFindings = await HE.runSiteCheck({
        pages: ['index.html', 'page2.html'],
        stylesheets: ['styles.css'],
        readFile: async (p) => checkFiles[p],
        exists: async (p) => p !== 'images/missing.png',
        currentPage: 'index.html',
      });
      const checkIds = checkFindings.map((f) => f.id);
      for (const wanted of ['duplicate-id', 'missing-anchor', 'missing-asset', 'img-alt', 'missing-description', 'class-unused', 'class-undefined']) {
        if (!checkIds.includes(wanted)) throw new Error('site check missed ' + wanted + ': ' + checkIds.join(','));
      }
      if (checkIds.includes('link-target')) throw new Error('site check flagged a valid page link');
      if (checkIds.includes('missing-title')) throw new Error('site check flagged a present title');
      log.push('site check ok');

      // --- Find & replace on page text (Content mode) ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><p class="find-me">Hello world, hello there.</p></body></html>',
        ''
      );
      HE.canvas.select(HE.canvas.doc.querySelector('.find-me'));
      HE.setScope('content');
      const findQuery = document.getElementById('find-query');
      const findRepl = document.querySelector('#panel [data-sec="content"] input[aria-label="Replacement text"]');
      if (!findQuery || !findRepl) throw new Error('find & replace controls missing');
      findQuery.value = 'hello';
      const nextBtn = [...document.querySelectorAll('#panel [data-sec="content"] button')]
        .find((b) => b.textContent === 'Find next');
      nextBtn.click();
      const findStatus = document.querySelector('#panel .find-status');
      if (!/1 of 2/.test(findStatus.textContent || '')) {
        throw new Error('find next did not report matches: ' + findStatus.textContent);
      }
      findRepl.value = 'hi';
      const realConfirm = window.confirm;
      window.confirm = () => true;
      const allBtn = [...document.querySelectorAll('#panel [data-sec="content"] button')]
        .find((b) => b.textContent === 'Replace all');
      try { allBtn.click(); } finally { window.confirm = realConfirm; }
      const replacedText = HE.canvas.doc.querySelector('.find-me').textContent;
      if (!/hi world, hi there/.test(replacedText)) {
        throw new Error('replace all did not rewrite text: ' + replacedText);
      }
      HE.setScope('design');
      log.push('find & replace ok');

      HE.project = { dir: '/tmp/test-site', pages: ['page1.html', 'page2.html'] };
      HE.page = 'page1.html';
      const files = {
        'page1.html': '<div class="old-class">Page 1</div>',
        'page2.html': '<div class="old-class">Page 2</div>',
      };
      const mockFs = {
        readFile: async (path) => files[path.split('/').pop()],
        writeFile: async (path, content) => { files[path.split('/').pop()] = content; },
      };
      await HE._updateClassInOtherPages('old-class', 'new-class', 'rename', mockFs);
      if (!files['page2.html'].includes('new-class')) throw new Error('cross-page rename failed');
      log.push('cross-page rename ok');

      // --- Cross-page undo journal (Task 31) ---
      const journal = HE.crossPageJournal.filter((e) => e.page === 'page2.html');
      if (!journal.length || journal[0].before !== '<div class="old-class">Page 2</div>') {
        throw new Error('cross-page journal missing before-content');
      }
      await HE.revertCrossPageWrites(-1);
      if (files['page2.html'] !== '<div class="old-class">Page 2</div>') {
        throw new Error('cross-page revert failed');
      }
      if (HE.crossPageJournal.length) throw new Error('journal entries not consumed by revert');
      log.push('cross-page undo ok');

      // --- Shared components (Task 32: detect + sync + diverged skip) ---
      // Headers differ only by their per-page active nav marker — detection
      // and sync must tolerate that while preserving each page's own marker.
      const compFiles = {
        'index.html': '<!DOCTYPE html><html><head></head><body><header class="site-header"><a class="logo" href="/">Studio</a><nav><a href="/" class="nav-link is-active" aria-current="page">Home</a><a href="/about.html" class="nav-link">About</a></nav></header><main><h1>Home</h1></main></body></html>',
        'about.html': '<!DOCTYPE html><html><head></head><body><header class="site-header"><a class="logo" href="/">Studio</a><nav><a href="/" class="nav-link">Home</a><a href="/about.html" class="nav-link is-active" aria-current="page">About</a></nav></header><main><h1>About</h1></main></body></html>',
      };
      const compFs = {
        readFile: async (p) => {
          const k = p.split('/').pop();
          if (!(k in compFiles)) throw new Error('missing: ' + p);
          return compFiles[k];
        },
        writeFile: async (p, content) => { compFiles[p.split('/').pop()] = content; },
      };
      HE.project = { dir: '/tmp/test-site', pages: ['index.html', 'about.html'] };
      HE.page = 'index.html';
      await HE.canvas.loadPage(compFiles['index.html'], '');
      const sharedEntries = await HE.scanSharedComponents(compFs);
      const headerEntry = sharedEntries.find((e) => e.cls === 'site-header');
      if (!headerEntry || !headerEntry.pages.includes('about.html')) {
        throw new Error('shared header not detected');
      }
      log.push('shared detect ok');
      HE.canvas.doc.querySelector('header.site-header nav a').textContent = 'Start';
      const syncRes = await HE.syncSharedComponent(headerEntry, compFs);
      if (!syncRes.synced.includes('about.html')) {
        throw new Error('sync missed about.html: ' + JSON.stringify(syncRes));
      }
      if (!compFiles['about.html'].includes('>Start<') || !compFiles['about.html'].includes('<main><h1>About</h1></main>')) {
        throw new Error('sync corrupted target page');
      }
      const aboutHeader = compFiles['about.html'].match(/<header[^>]*>.*?<\/header>/s)[0];
      const aboutActive = (aboutHeader.match(/is-active/g) || []).length;
      if (aboutActive !== 1 || !/nav-link is-active" aria-current="page">About/.test(aboutHeader)) {
        throw new Error('sync did not preserve the target page active marker: ' + aboutHeader);
      }
      log.push('shared sync ok');
      compFiles['about.html'] = compFiles['about.html'].replace('site-header', 'site-header-x');
      const syncRes2 = await HE.syncSharedComponent(headerEntry, compFs);
      if (!syncRes2.skipped.some((s) => s.page === 'about.html' && s.reason === 'changed on that page')) {
        throw new Error('diverged target not skipped: ' + JSON.stringify(syncRes2));
      }
      if (!HE.crossPageJournal.some((e) => e.page === 'about.html' && e.before.includes('>Home<'))) {
        throw new Error('sync write not journaled');
      }
      log.push('shared diverge-skip + journal ok');

      // --- Shared panel section renders for a shared instance ---
      await HE.canvas.loadPage(compFiles['index.html'], '');
      const liveHeader = HE.canvas.doc.querySelector('header.site-header');
      HE.sharedEntries = [{
        key: 'header.site-header', label: 'header.site-header', tag: 'header',
        cls: 'site-header', signature: 'x', liveEl: liveHeader, pages: ['about.html'],
      }];
      HE.canvas.select(liveHeader);
      const panelHtml = document.getElementById('panel').innerHTML;
      if (!panelHtml.includes('Shared component') || !panelHtml.includes('Sync to 1 page')) {
        throw new Error('shared panel section missing');
      }
      HE.sharedEntries = [];
      log.push('shared panel ok');

      // --- Combo classes: base vs variant scope (Tasks 33/34) ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><a class="btn">One</a><a class="btn">Two</a></body></html>',
        '.btn{color:blue}'
      );
      const btn = HE.canvas.doc.querySelector('a.btn');
      HE.canvas.select(btn);
      if (HE.panel.state.activeClass !== 'btn') throw new Error('base scope not selected');
      HE.actions.setStyle('color', 'blue');
      const comboRes = HE.actions.attachComboClass('large');
      if (!comboRes || !comboRes.ok) throw new Error('attachCombo failed');
      if (HE.panel.activeSelector() !== '.btn.large') throw new Error('combo selector wrong: ' + HE.panel.activeSelector());
      HE.actions.setStyle('color', 'red');
      if (HE.sheet.get('.btn.large', 'color') !== 'red') throw new Error('combo write failed');
      if (HE.sheet.get('.btn', 'color') !== 'blue') throw new Error('combo write leaked to base');
      // Combo scope spotlights only what the variant changes: the color row
      // shows '.btn.large', every other row is a quiet dash — and the word
      // "inherited" appears nowhere (labels, banner, tooltips, placeholders).
      HE.panel.refresh();
      const comboPanel = document.getElementById('panel');
      const labels = [...comboPanel.querySelectorAll('.origin-label')].map((el) => el.textContent);
      if (!labels.includes('.btn.large')) throw new Error('combo override not spotlighted: ' + labels.join('|'));
      const noisy = labels.filter((t) => t !== '—' && t !== '.btn.large');
      if (noisy.length) throw new Error('combo scope shows inherited labels: ' + noisy.join('|'));
      if (/inherit/i.test(comboPanel.textContent || '')) throw new Error('combo scope shows inherited text');
      const comboHints = [
        ...comboPanel.querySelectorAll('[title]'),
        ...comboPanel.querySelectorAll('input[placeholder]'),
      ].map((el) => el.title || el.placeholder || '').join('\n');
      if (/inherit/i.test(comboHints)) {
        const hit = comboHints.split('\n').find((t) => /inherit/i.test(t));
        throw new Error('combo scope leaks inherited hint: ' + hit);
      }
      // Second button with only .btn must not match the combo.
      const btns = HE.canvas.doc.querySelectorAll('a.btn');
      if (btns[1].classList.contains('large')) throw new Error('combo leaked to sibling');
      // Scope switch back to base edits the base rule.
      HE.actions.setScope('base');
      if (HE.panel.activeSelector() !== '.btn') throw new Error('scope base switch failed');
      // Classes manager lists the combo separately.
      const _combos = HE.sheet.comboSelectors();
      if (!_combos.includes('.btn.large')) throw new Error('comboSelectors missing .btn.large, got [' + _combos.join(',') + ']');
      if (!HE.sheet.classNames().includes('large')) throw new Error('classNames missing combo token');
      // Delete only variant styles keeps base + classes.
      HE.actions.setScope('combo', 'large');
      HE.actions.deleteComboStyles();
      if (HE.sheet.get('.btn.large', 'color')) throw new Error('deleteComboStyles failed');
      if (!btn.classList.contains('large')) throw new Error('deleteComboStyles dropped the class');
      // Deleting the base removes its combos too.
      const projectPages = HE.project.pages;
      HE.project.pages = ['index.html'];
      HE.actions.deleteClass('btn', { skipJsCheck: true });
      HE.project.pages = projectPages;
      await new Promise((r) => setTimeout(r, 0));
      if (HE.sheet.get('.btn', 'color')) throw new Error('base delete failed');
      log.push('combo scope ok');

      // --- Task 94: deleting a class keeps sibling selectors in a group ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><p class="alpha">A</p><p class="beta">B</p><p class="gamma">G</p></body></html>',
        '.alpha, .beta { color: #ff0000; }\n.alpha:hover, .gamma { color: #0000ff; }',
      );
      const projectPages94 = HE.project.pages;
      HE.project.pages = ['index.html'];
      HE.actions.deleteClass('alpha', { skipJsCheck: true });
      HE.project.pages = projectPages94;
      await new Promise((r) => setTimeout(r, 0));
      if (HE.sheet.get('.alpha', 'color')) throw new Error('grouped delete failed to remove .alpha');
      if (!HE.sheet.get('.beta', 'color')) {
        throw new Error('grouped delete removed sibling .beta selector');
      }
      if (!HE.sheet.get('.gamma', 'color')) {
        throw new Error('grouped delete removed unrelated .gamma selector');
      }
      log.push('grouped selector delete ok');

      // --- Tasks 96/97: CSS nesting + at-rules survive; custom breakpoints ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><div class="card"><span class="card-title">T</span><em class="layer-note">L</em></div></body></html>',
        '.card { color: #111111; .card-title { color: #222222; } }\n' +
        '@layer base { .layer-note { color: #333333; } }\n' +
        '@media (max-width: 1024px) { .card { padding: 1rem; } }'
      );
      const nestedSerialized = HE.sheet.serialize();
      if (!/card-title/.test(nestedSerialized)) {
        throw new Error('nested CSS was dropped on serialize: ' + nestedSerialized.slice(0, 200));
      }
      if (!/@layer/.test(nestedSerialized) || !/layer-note/.test(nestedSerialized)) {
        throw new Error('@layer content was dropped on serialize');
      }
      HE.sheet.renameClass('layer-note', 'layer-caption');
      HE.sheet.renameClass('card-title', 'card-heading');
      const renamedSerialized = HE.sheet.serialize();
      if (!/layer-caption/.test(renamedSerialized) || /layer-note/.test(renamedSerialized)) {
        throw new Error('rename did not reach @layer');
      }
      if (!/card-heading/.test(renamedSerialized) || /card-title/.test(renamedSerialized)) {
        throw new Error('rename did not reach nested rules');
      }
      HE.sheet.deleteClassRules('layer-caption');
      HE.sheet.deleteClassRules('card-heading');
      const deletedSerialized = HE.sheet.serialize();
      if (/layer-caption|card-heading/.test(deletedSerialized)) {
        throw new Error('delete did not reach @layer / nested rules');
      }
      if (!HE.sheet.get('.card', 'color')) {
        throw new Error('delete damaged the parent rule');
      }
      HE.refreshViewports();
      const vpButtons = [...document.querySelectorAll('#viewport-switch button')].map((b) => b.dataset.vp);
      if (!vpButtons.includes('(max-width: 1024px)')) {
        throw new Error('custom breakpoint missing from viewport switch: ' + vpButtons.join('|'));
      }
      HE.setViewport('(max-width: 1024px)');
      if (HE.viewportMedia() !== '(max-width: 1024px)') {
        throw new Error('custom viewport did not scope edits: ' + HE.viewportMedia());
      }
      if (document.getElementById('canvas-frame').style.width !== '1024px') {
        throw new Error('custom viewport width not applied');
      }
      HE.setViewport('desktop');
      log.push('css nesting + at-rules + custom breakpoint ok');

      // --- Background layers: color stays independent from ordered images ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><div class="hero">Hero</div><div class="spacer"></div></body></html>',
        '.hero{background-color:rgba(0, 0, 0, 0);background-image:linear-gradient(red, blue), url("hero.svg");}.spacer{height:2400px}',
      );
      const hero = HE.canvas.doc.querySelector('.hero');
      HE.canvas.select(hero);
      const heroColorBefore = HE.sheet.get('.hero', 'background-color');
      const backgroundColorRow = [...document.querySelectorAll('#panel [data-sec="background"] .prow')]
        .find((el) => el.querySelector('label')?.textContent.trim() === 'Color');
      const backgroundColorPicker = backgroundColorRow && backgroundColorRow.querySelector('.color-picker-shell');
      const backgroundColorInput = backgroundColorRow && backgroundColorRow.querySelector('input[type="text"]');
      if (!backgroundColorPicker || !backgroundColorPicker.classList.contains('is-transparent') ||
          !backgroundColorInput || backgroundColorInput.value !== 'transparent') {
        throw new Error('transparent background color was presented as a solid swatch');
      }
      let layerCards = [...document.querySelectorAll('#panel .background-layer')];
      if (layerCards.length !== 2) throw new Error('background layers did not render: ' + layerCards.length);
      const moveBack = layerCards[0].querySelector('[aria-label*="toward the back"]');
      if (!moveBack) throw new Error('background layer reorder control missing');
      moveBack.click();
      const reordered = HE.sheet.get('.hero', 'background-image');
      if (reordered.indexOf('hero.svg') > reordered.indexOf('linear-gradient')) {
        throw new Error('background layer reorder wrote the wrong order: ' + reordered);
      }
      const addType = document.querySelector('#panel .background-layer-add-type');
      const addLayer = document.querySelector('#panel .background-layer-add');
      addType.value = 'image';
      const rightPanel = document.getElementById('right');
      rightPanel.scrollTop = rightPanel.scrollHeight;
      const scrollBeforeAdd = rightPanel.scrollTop;
      const canvasView = HE.canvas.doc.defaultView;
      canvasView.scrollTo(0, 400);
      const canvasScrollBeforeAdd = canvasView.scrollY;
      addLayer.click();
      layerCards = [...document.querySelectorAll('#panel .background-layer')];
      if (layerCards.length !== 3 || !HE.sheet.get('.hero', 'background-image').includes('image.svg')) {
        throw new Error('background layer add failed');
      }
      if (HE.sheet.get('.hero', 'background-color') !== heroColorBefore) {
        throw new Error('background color was changed with image layers');
      }
      if (scrollBeforeAdd > 0 && rightPanel.scrollTop < scrollBeforeAdd - 1) {
        throw new Error(`background layer add reset the panel scroll (${scrollBeforeAdd} -> ${rightPanel.scrollTop})`);
      }
      if (canvasScrollBeforeAdd > 0 && canvasView.scrollY < canvasScrollBeforeAdd - 1) {
        throw new Error(`background layer add reset the canvas scroll (${canvasScrollBeforeAdd} -> ${canvasView.scrollY})`);
      }
      const gradientInput = layerCards.find((card) => card.querySelector('.background-layer-kind.gradient'))
        ?.querySelector('.background-layer-input');
      if (!gradientInput || gradientInput.disabled) throw new Error('gradient layer editor is not editable');
      gradientInput.value = 'linear-gradient(90deg, red, blue)';
      gradientInput.dispatchEvent(new Event('input', { bubbles: true }));
      if (HE.sheet.get('.hero', 'background-image').indexOf('linear-gradient(90deg, red, blue)') < 0) {
        throw new Error('gradient layer editor did not write the layer value');
      }
      const gradientCard = layerCards.find((card) => card.querySelector('.background-layer-kind.gradient'));
      const gradientEditBtn = gradientCard && gradientCard.querySelector('.gradient-edit');
      if (!gradientEditBtn) throw new Error('gradient visual edit toggle missing');
      gradientEditBtn.click();
      const gradientEditor = gradientCard.querySelector('.gradient-editor');
      if (!gradientEditor || gradientEditor.hidden || !gradientEditor.querySelector('.gradient-track')) {
        throw new Error('gradient visual editor did not open');
      }
      if (!gradientEditBtn.classList.contains('background-layer-preview')) {
        throw new Error('gradient preview should be the editor opener');
      }
      const gradientDirection = gradientEditor.querySelector('.gradient-direction');
      if (!gradientDirection) throw new Error('gradient direction control missing');
      gradientDirection.value = '45deg';
      gradientDirection.dispatchEvent(new Event('input', { bubbles: true }));
      if (HE.sheet.get('.hero', 'background-image').indexOf('linear-gradient(45deg, red, blue)') < 0) {
        throw new Error('gradient direction edit did not write the layer value: ' + HE.sheet.get('.hero', 'background-image'));
      }
      if (gradientInput.value.indexOf('45deg') < 0) {
        throw new Error('gradient editor did not sync the text field');
      }
      const gradientAddStop = gradientEditor.querySelector('.gradient-stop-add');
      if (!gradientAddStop) throw new Error('gradient add-stop control missing');
      gradientAddStop.click();
      // Note: the sheet normalizes the swatch hex to rgb().
      if (HE.sheet.get('.hero', 'background-image').indexOf('255, 255, 255) 100%') < 0) {
        throw new Error('gradient add-stop did not write the layer value');
      }
      const gradientHandles = gradientEditor.querySelectorAll('.gradient-handle');
      if (gradientHandles.length !== 3) {
        throw new Error('gradient track should show one handle per stop: ' + gradientHandles.length);
      }
      const gradientType = gradientEditor.querySelector('.gradient-type');
      if (!gradientType) throw new Error('gradient type control missing');
      gradientType.value = 'radial';
      gradientType.dispatchEvent(new Event('change', { bubbles: true }));
      const positionPad = gradientCard.querySelector('.gradient-position-pad');
      if (!positionPad) throw new Error('radial position pad missing');
      const topLeftCell = positionPad.querySelector('[data-x="left"][data-y="top"]');
      if (!topLeftCell) throw new Error('radial position cell missing');
      topLeftCell.click();
      if (HE.sheet.get('.hero', 'background-image').indexOf('at left top') < 0) {
        throw new Error('radial position pad did not write the layer value: ' + HE.sheet.get('.hero', 'background-image'));
      }
      if (gradientCard.querySelector('.gradient-dial')) {
        throw new Error('angle dial should not show for radial gradients');
      }
      log.push('gradient editor track/pad ok');
      log.push('background layers ok');

      // --- Tokens: define once, use via var(), edit updates everywhere ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><p class="tag">x</p></body></html>',
        ':root{--brand:#4f8cff;--accent:#ff3366;--space-lg:2rem;--radius:14px;--duration:200ms;--font-body:\'Inter\', sans-serif}\n*{overflow:hidden}\n.tag{color:black;font-family:var(--font-body)}'
      );
      const tag = HE.canvas.doc.querySelector('p.tag');
      HE.canvas.select(tag);
      HE.actions.setStyle('color', 'var(--brand)');
      if (HE.sheet.get('.tag', 'color') !== 'var(--brand)') throw new Error('token write failed');
      const tu = HE.sheet.varUsages('--brand');
      if (!tu.count || !tu.selectors.includes('.tag')) throw new Error('varUsages wrong: ' + JSON.stringify(tu));
      const res1 = HE.canvas.doc.defaultView.getComputedStyle(tag).color;
      if (res1 !== 'rgb(79, 140, 255)') throw new Error('var() did not resolve live: ' + res1);
      HE.actions.setRootVar('--brand', '#ff0000');
      if (HE.sheet.get(':root', '--brand') !== '#ff0000') throw new Error('token edit failed');
      const res2 = HE.canvas.doc.defaultView.getComputedStyle(tag).color;
      if (res2 !== 'rgb(255, 0, 0)') throw new Error('token edit did not propagate: ' + res2);
      // Base scope uses the same quiet-origin convention: own declarations
      // are spotlighted, while browser/global defaults stay unlabelled.
      HE.panel.refresh();
      const baseLabels = [...document.querySelectorAll('#panel .origin-label')].map((el) => el.textContent);
      if (!baseLabels.includes('.tag')) throw new Error('own declaration not spotlighted');
      if (baseLabels.some((text) => /inherit/i.test(text))) {
        throw new Error('base scope shows generic inherited labels: ' + baseLabels.join('|'));
      }
      const panelTok = document.getElementById('token-list').textContent;
      if (!panelTok.includes('--brand')) throw new Error('sidebar tokens missing');
      const fontTokenButton = document.querySelector('#token-list .font-token-picker-button');
      if (!fontTokenButton) throw new Error('font token picker missing');
      fontTokenButton.click();
      const fontDropdown = document.querySelector('#token-list .token-font-picker .font-picker-dropdown');
      const fontMenuRect = fontDropdown && fontDropdown.getBoundingClientRect();
      if (!fontDropdown || getComputedStyle(fontDropdown).position !== 'fixed' ||
          fontMenuRect.left < 0 || fontMenuRect.right > window.innerWidth ||
          fontMenuRect.top < 0 || fontMenuRect.bottom > window.innerHeight) {
        throw new Error('font token picker menu is clipped');
      }
      const playfair = [...document.querySelectorAll('#token-list .token-font-picker .font-picker-item')]
        .find((el) => el.textContent.includes('Playfair Display'));
      if (!playfair) throw new Error('font token option missing');
      playfair.click();
      if (HE.sheet.get(':root', '--font-body') !== "'Playfair Display', serif") {
        throw new Error('font token picker did not update the root token');
      }

      // Color token controls keep the rendered color visible while the raw
      // declaration controls linkage. Direct edits unlink; menu actions link,
      // switch, unlink without changing the color, and create new tokens.
      const colorRow = () => [...document.querySelectorAll('#panel [data-sec="typography"] .color-row')][0];
      const colorTokenButton = () => colorRow() && colorRow().querySelector('.token-menu-btn');
      const colorPicker = () => colorRow() && colorRow().querySelector('input[type="color"]');
      const colorToken = (name) => {
        const row = colorRow();
        return row && [...row.querySelectorAll('.token-menu-item')]
          .find((el) => el.querySelector('.token-name')?.textContent === name);
      };
      const emit = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

      // Typed token values: lengths/times get number + unit (+ optional range),
      // numbers scrub, and non-scalar values keep the raw text field.
      const tokenRowByLabel = (name) => [...document.querySelectorAll('#token-list .prow')]
        .find((el) => el.querySelector('label')?.textContent === name);
      const spaceRow = tokenRowByLabel('--space-lg');
      const spaceNumber = spaceRow && spaceRow.querySelector('.token-number');
      const spaceUnit = spaceRow && spaceRow.querySelector('.token-unit');
      if (!spaceRow || !spaceNumber || spaceNumber.value !== '2' || !spaceUnit || spaceUnit.value !== 'rem') {
        throw new Error('length token did not render a number + unit editor');
      }
      if (!spaceNumber.classList.contains('is-scrubbable')) {
        throw new Error('length token value is not drag-scrubbable');
      }
      if (!spaceRow.querySelector('.token-custom').hidden) {
        throw new Error('length token custom field should stay hidden for a unit value');
      }
      spaceUnit.value = 'px';
      emit(spaceUnit, 'change');
      if (HE.sheet.get(':root', '--space-lg') !== '2px') {
        throw new Error('length token unit change did not write the root value');
      }
      const radiusRow = tokenRowByLabel('--radius');
      const radiusNumber = radiusRow && radiusRow.querySelector('.token-number');
      const radiusUnit = radiusRow && radiusRow.querySelector('.token-unit');
      if (!radiusRow || !radiusNumber || radiusNumber.value !== '14' || !radiusUnit || radiusUnit.value !== 'px') {
        throw new Error('radius token did not render a number + px unit');
      }
      if (radiusRow.querySelector('.token-slider')) {
        throw new Error('length tokens should not offer a range slider');
      }
      radiusNumber.value = '20';
      emit(radiusNumber, 'input');
      if (HE.sheet.get(':root', '--radius') !== '20px') {
        throw new Error('radius token number did not write the root value');
      }
      const durationRow = tokenRowByLabel('--duration');
      const durationUnit = durationRow && durationRow.querySelector('.token-unit');
      if (!durationUnit || durationUnit.value !== 'ms') {
        throw new Error('time token did not render an ms unit');
      }
      if (durationRow.querySelector('.token-slider')) {
        throw new Error('time tokens should not offer a range slider');
      }
      durationUnit.value = 's';
      emit(durationUnit, 'change');
      if (HE.sheet.get(':root', '--duration') !== '200s') {
        throw new Error('time token unit change did not write the root value');
      }

      // Token rows keep Rename/Delete behind a kebab menu, not inline buttons.
      const moreBtn = spaceRow.querySelector('.token-row-more');
      if (!moreBtn || moreBtn.getAttribute('aria-haspopup') !== 'menu') {
        throw new Error('token row kebab menu missing');
      }
      moreBtn.click();
      const actionMenu = document.querySelector('.token-row-menu');
      const actionLabels = actionMenu
        ? [...actionMenu.querySelectorAll('.token-row-menu-item')].map((b) => b.textContent)
        : [];
      if (!actionMenu || actionLabels.join(',') !== 'Rename,Delete') {
        throw new Error('token row menu actions missing: ' + actionLabels.join(','));
      }
      moreBtn.click();
      if (document.querySelector('.token-row-menu') || moreBtn.getAttribute('aria-expanded') !== 'false') {
        throw new Error('token row menu did not close on re-click');
      }

      const row = colorRow();
      if (!row || !colorTokenButton()) throw new Error('color token control missing');
      if (!colorTokenButton().classList.contains('is-linked') || colorTokenButton().textContent !== '--brand') {
        throw new Error('initial color token link missing');
      }
      if (colorToken('--space-lg') || colorToken('--font-body')) {
        throw new Error('color menu exposed a non-color token');
      }

      const directPicker = colorPicker();
      directPicker.value = '#00ff00';
      emit(directPicker, 'input');
      if (HE.sheet.get('.tag', 'color') !== 'rgb(0, 255, 0)') {
        throw new Error('direct picker edit did not write a literal color: ' + HE.sheet.get('.tag', 'color'));
      }
      if (colorTokenButton().classList.contains('is-linked')) throw new Error('direct color edit stayed linked');
      const quietTokenStyle = getComputedStyle(colorTokenButton());
      if (colorTokenButton().textContent !== 'T' || quietTokenStyle.width !== '18px' || Number(quietTokenStyle.opacity) > 0.5) {
        throw new Error('unlinked color token button is not quiet: ' + quietTokenStyle.width + ' / ' + quietTokenStyle.opacity);
      }
      if (HE.sheet.varUsages('--brand').selectors.includes('.tag')) throw new Error('unlinked color still counted as token usage');

      colorTokenButton().click();
      const accentItem = colorToken('--accent');
      if (!accentItem) throw new Error('accent color token option missing');
      accentItem.click();
      if (HE.sheet.get('.tag', 'color') !== 'var(--accent)') throw new Error('color token link failed');
      if (colorPicker().value !== '#ff3366') throw new Error('picker stayed on the old color after token link');
      if (!colorTokenButton().classList.contains('is-linked') || colorTokenButton().textContent !== '--accent') {
        throw new Error('linked color control did not update');
      }
      const linkedTokenButton = colorTokenButton();
      const linkedTokenStyle = getComputedStyle(linkedTokenButton);
      if (Number(linkedTokenStyle.opacity) < 0.99) {
        throw new Error('linked color token button stayed muted: ' + linkedTokenStyle.opacity +
          ' / ' + linkedTokenButton.className + ' / disabled=' + linkedTokenButton.disabled);
      }

      colorTokenButton().click();
      const brandItem = colorToken('--brand');
      if (!brandItem) throw new Error('brand color token option missing');
      brandItem.click();
      if (HE.sheet.get('.tag', 'color') !== 'var(--brand)') throw new Error('color token switch failed');
      if (colorPicker().value !== '#ff0000') throw new Error('picker did not follow switched token');

      // Editing a token through the Tokens sidebar updates the open color
      // control without changing its var() declaration.
      const brandRow = [...document.querySelectorAll('#token-list .prow')]
        .find((el) => el.querySelector('label')?.textContent === '--brand');
      const brandInput = brandRow && brandRow.querySelector('.token-row input[type="text"]');
      if (!brandInput) throw new Error('brand token input missing');
      brandInput.value = '#0000ff';
      emit(brandInput, 'change');
      if (HE.sheet.get('.tag', 'color') !== 'var(--brand)') throw new Error('token edit replaced color linkage');
      if (colorPicker().value !== '#0000ff') throw new Error('color control did not refresh after token edit');

      colorTokenButton().click();
      const unlink = colorRow().querySelector('.token-menu-unlink');
      if (!unlink || unlink.hidden) throw new Error('color unlink action missing');
      unlink.click();
      const unlinkedColor = HE.canvas.doc.defaultView.getComputedStyle(tag).color;
      if (HE.sheet.get('.tag', 'color').includes('var(')) throw new Error('unlink kept var() declaration');
      if (colorTokenButton().classList.contains('is-linked')) throw new Error('unlink indicator stayed linked');
      HE.actions.setRootVar('--brand', '#ff00ff');
      if (HE.canvas.doc.defaultView.getComputedStyle(tag).color !== unlinkedColor) {
        throw new Error('unlinked color still followed the token');
      }

      const newTokenRow = [...document.querySelectorAll('#token-list .prow')]
        .find((el) => el.querySelector('label')?.textContent === 'New');
      const newTokenInputs = newTokenRow && newTokenRow.querySelectorAll('.token-row input');
      const newTokenAdd = newTokenRow && newTokenRow.querySelector('.token-row button');
      if (!newTokenRow || !newTokenInputs || newTokenInputs.length < 2 || !newTokenAdd) {
        throw new Error('sidebar token creation controls missing');
      }
      newTokenInputs[0].value = '--tag-color';
      newTokenInputs[1].value = '#0000ff';
      newTokenAdd.click();
      if (!HE.sheet.get(':root', '--tag-color')) throw new Error('new color token was not created');
      colorTokenButton().click();
      const newColorItem = colorToken('--tag-color');
      if (!newColorItem) throw new Error('new compatible color token did not activate the menu');
      newColorItem.click();
      if (HE.sheet.get('.tag', 'color') !== 'var(--tag-color)') throw new Error('new color token was not linked');
      if (colorTokenButton().textContent !== '--tag-color' || !colorTokenButton().classList.contains('is-linked')) {
        throw new Error('new color token indicator did not update');
      }

      const opacityRow = [...document.querySelectorAll('#panel [data-sec="effects"] .prow')]
        .find((el) => el.querySelector('label')?.textContent === 'Opacity');
      if (!opacityRow || opacityRow.querySelector('.t-menu-btn')) {
        throw new Error('unused numeric token control was visible');
      }
      HE.actions.setRootVar('--alpha', '0.7');
      HE.panel.refresh();
      const activeOpacityRow = [...document.querySelectorAll('#panel [data-sec="effects"] .prow')]
        .find((el) => el.querySelector('label')?.textContent === 'Opacity');
      const opacityTokenButton = activeOpacityRow && activeOpacityRow.querySelector('.t-menu-btn');
      if (!opacityTokenButton) throw new Error('compatible numeric token did not activate opacity');
      opacityTokenButton.click();
      const alphaItem = [...activeOpacityRow.querySelectorAll('.token-menu-item')]
        .find((el) => el.querySelector('.token-name')?.textContent === '--alpha');
      if (!alphaItem) throw new Error('numeric token option missing');
      alphaItem.click();
      if (HE.sheet.get('.tag', 'opacity') !== 'var(--alpha)') throw new Error('numeric token link failed');
      // Generic token unlink: use the rendered menu, keep the current value,
      // then prove later root-token edits no longer affect the local field.
      HE.panel.refresh();
      const linkedOpacityRow = [...document.querySelectorAll('#panel [data-sec="effects"] .prow')]
        .find((el) => el.querySelector('label')?.textContent === 'Opacity');
      const linkedOpacityButton = linkedOpacityRow && linkedOpacityRow.querySelector('.t-menu-btn');
      if (!linkedOpacityButton || !linkedOpacityButton.classList.contains('is-linked') ||
          linkedOpacityButton.textContent !== '--alpha') {
        throw new Error('generic token link was not visible in the panel');
      }
      const opacityBeforeUnlink = HE.canvas.doc.defaultView.getComputedStyle(tag).opacity;
      linkedOpacityButton.click();
      const genericUnlink = linkedOpacityRow && linkedOpacityRow.querySelector('.token-menu-unlink');
      if (!genericUnlink || genericUnlink.hidden || !genericUnlink.textContent.includes('keep current value')) {
        throw new Error('generic token unlink action missing');
      }
      genericUnlink.click();
      const localOpacity = HE.sheet.get('.tag', 'opacity');
      if (!localOpacity || /var\(/i.test(localOpacity) || HE.sheet.get(':root', '--alpha') !== '0.7') {
        throw new Error('generic token unlink did not write a local value: ' + localOpacity);
      }
      if (HE.canvas.doc.defaultView.getComputedStyle(tag).opacity !== opacityBeforeUnlink) {
        throw new Error('generic token unlink changed the rendered value');
      }
      HE.actions.setRootVar('--alpha', '0.2');
      if (HE.canvas.doc.defaultView.getComputedStyle(tag).opacity !== opacityBeforeUnlink) {
        throw new Error('unlinked generic value still follows the root token');
      }
      const unlinkedOpacityRow = [...document.querySelectorAll('#panel [data-sec="effects"] .prow')]
        .find((el) => el.querySelector('label')?.textContent === 'Opacity');
      const unlinkedOpacityButton = unlinkedOpacityRow && unlinkedOpacityRow.querySelector('.t-menu-btn');
      if (!unlinkedOpacityButton || unlinkedOpacityButton.classList.contains('is-linked') ||
          unlinkedOpacityButton.textContent !== 'T') {
        throw new Error('generic token unlink did not clear the token affordance');
      }
      if (!/\.tag\s*\{[^}]*opacity\s*:/s.test(HE.sheet.serialize())) {
        throw new Error('generic token unlink did not serialize a local opacity');
      }
      log.push('generic token unlink ok');

      // Inherited token unlink: the base remains linked while the active combo
      // receives only a local override.
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><p class="pill">combo</p><p class="pill">base</p></body></html>',
        ':root{--alpha:0.7}\n.pill{opacity:var(--alpha)}'
      );
      const pill = HE.canvas.doc.querySelector('.pill');
      const basePill = HE.canvas.doc.querySelectorAll('.pill')[1];
      HE.canvas.select(pill);
      const inheritedCombo = HE.actions.attachComboClass('large');
      if (!inheritedCombo || !inheritedCombo.ok) throw new Error('inherited token combo setup failed');
      const inheritedOpacityRow = [...document.querySelectorAll('#panel [data-sec="effects"] .prow')]
        .find((el) => el.querySelector('label')?.textContent === 'Opacity');
      const inheritedOpacityButton = inheritedOpacityRow && inheritedOpacityRow.querySelector('.t-menu-btn');
      if (!inheritedOpacityButton || !inheritedOpacityButton.classList.contains('is-linked') ||
          !inheritedOpacityButton.classList.contains('is-inherited') || inheritedOpacityButton.textContent !== '--alpha') {
        throw new Error('inherited generic token was not visible in the panel');
      }
      const inheritedBeforeUnlink = HE.canvas.doc.defaultView.getComputedStyle(pill).opacity;
      inheritedOpacityButton.click();
      const inheritedUnlink = inheritedOpacityRow && inheritedOpacityRow.querySelector('.token-menu-unlink');
      if (!inheritedUnlink || inheritedUnlink.hidden || !inheritedUnlink.textContent.includes('keep current value')) {
        throw new Error('inherited token unlink action missing');
      }
      inheritedUnlink.click();
      const comboOpacity = HE.sheet.get('.pill.large', 'opacity');
      if (!comboOpacity || /var\(/i.test(comboOpacity) || HE.sheet.get('.pill', 'opacity') !== 'var(--alpha)') {
        throw new Error('inherited token unlink changed the base rule: ' + comboOpacity);
      }
      if (HE.canvas.doc.defaultView.getComputedStyle(pill).opacity !== inheritedBeforeUnlink) {
        throw new Error('inherited token unlink changed the rendered value');
      }
      const baseBeforeRootEdit = HE.canvas.doc.defaultView.getComputedStyle(basePill).opacity;
      HE.actions.setRootVar('--alpha', '0.2');
      if (HE.canvas.doc.defaultView.getComputedStyle(pill).opacity !== inheritedBeforeUnlink ||
          HE.canvas.doc.defaultView.getComputedStyle(basePill).opacity === baseBeforeRootEdit) {
        throw new Error('inherited base token did not stay linked outside the combo');
      }
      log.push('inherited token unlink ok');
      // Design-first panel order: style sections + Accessibility.
      // Site sections (Classes, Fonts, Globals) live in the Site scope;
      // Element + Page/SEO live only in Content mode (Task 67); tokens out of the panel.
      const order = [...document.querySelectorAll('#panel [data-sec]')].map((el) => el.dataset.sec);
      const pos = (s) => order.indexOf(s);
      if (order.includes('tokens')) throw new Error('tokens still in design panel');
      if (order.includes('element') || order.includes('page')) {
        throw new Error('Element/Page-SEO should live only in Content mode, found in Design: ' + order.join(','));
      }
      for (const s of ['classes', 'tools', 'globals']) {
        if (order.includes(s)) throw new Error(`Site section ${s} should not render in Design: ` + order.join(','));
      }
      if (!(pos('layout') > -1 && pos('accessibility') > pos('effects'))) {
        throw new Error('panel order wrong: ' + order.join(','));
      }
      log.push('tokens var() ok');

      // --- Task 98: theme-scoped tokens listed + editable in the sidebar ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html data-theme="dark"><head></head><body><p class="themed">T</p></body></html>',
        ':root{--paper:#ffffff;--brand:#4f8cff}\n[data-theme="dark"]{--paper:#111111}\n.themed{background:var(--paper);color:var(--brand)}'
      );
      HE.panel.refresh();
      const themeGroups = HE.sheet.themeVarGroups();
      if (themeGroups.length !== 1 || themeGroups[0].selector !== '[data-theme="dark"]' ||
          !themeGroups[0].vars.some((v) => v.name === '--paper' && v.value === '#111111')) {
        throw new Error('themeVarGroups wrong: ' + JSON.stringify(themeGroups));
      }
      const themeHeading = [...document.querySelectorAll('#token-list .cm-sub')]
        .find((el) => /Theme:\s*dark/.test(el.textContent || ''));
      if (!themeHeading) throw new Error('theme group missing from Tokens sidebar');
      const themeRow = [...document.querySelectorAll('#token-list .prow')]
        .find((el) => el.querySelector('.token-theme-chip') && el.querySelector('label')?.textContent === '--paper');
      if (!themeRow) throw new Error('theme token row missing');
      const themeInput = themeRow.querySelector('input[type="text"]');
      if (!themeInput) throw new Error('theme token value control missing');
      themeInput.value = '#222222';
      emit(themeInput, 'change');
      if (HE.sheet.get('[data-theme="dark"]', '--paper') !== '#222222') {
        throw new Error('theme token edit did not write the override');
      }
      if (HE.sheet.get(':root', '--paper') !== '#ffffff') {
        throw new Error('theme token edit leaked into :root');
      }
      // Renaming the base token follows theme declarations too.
      const renameRes = HE.actions.renameRootVar('--paper', '--surface');
      if (!renameRes.ok) throw new Error('token rename failed: ' + renameRes.error);
      const afterRename = HE.sheet.serialize();
      if (!/\[data-theme="dark"\]\s*\{[^}]*--surface/.test(afterRename)) {
        throw new Error('theme override was not renamed: ' + afterRename);
      }
      if (/--paper/.test(afterRename)) throw new Error('old token name survived rename');
      // Deleting the token clears its theme override too.
      HE.actions.setRootVar('--surface', '');
      if (HE.sheet.get('[data-theme="dark"]', '--surface')) {
        throw new Error('theme override survived token delete');
      }
      log.push('theme tokens ok');

      // --- Task 101: matching-rules picker edits descendant/state rules ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body>' +
        '<div class="accordion is-open"><button class="accordion-btn" aria-expanded="true">Q</button><div class="accordion-panel">A</div></div>' +
        '<section class="hero"><h1 class="hero-title">T</h1></section>' +
        '<div class="tabs"><button class="tab-btn" aria-selected="true">One</button></div>' +
        '</body></html>',
        '.accordion.is-open .accordion-panel { display: block; color: #101010; }\n' +
        '.accordion .accordion-btn { color: #202020; }\n' +
        '.hero .hero-title { color: #303030; }\n' +
        '.tab-btn[aria-selected="true"] { color: #404040; }\n' +
        '.accordion-panel { padding: 4px; }\n' +
        '@media (max-width: 768px) { .accordion-panel { padding: 8px; } }'
      );
      const accPanel = HE.canvas.doc.querySelector('.accordion-panel');
      HE.canvas.select(accPanel);
      HE.panel.refresh();
      const panelRules = HE.sheet.rulesFor(accPanel).map((e) => e.selector);
      if (!panelRules.includes('.accordion.is-open .accordion-panel') || !panelRules.includes('.accordion-panel')) {
        throw new Error('rulesFor missed descendant/base rules: ' + panelRules.join('|'));
      }
      const ruleSels = [...document.querySelectorAll('#panel [data-sec="rules"] .rule-row .rule-sel')]
        .map((el) => el.textContent);
      if (!ruleSels.includes('.accordion.is-open .accordion-panel')) {
        throw new Error('rules section did not render the descendant rule: ' + ruleSels.join('|'));
      }
      // Click the row to pick the rule, then edit through the normal controls.
      const targetRow = [...document.querySelectorAll('#panel [data-sec="rules"] .rule-row')]
        .find((el) => el.querySelector('.rule-sel')?.textContent === '.accordion.is-open .accordion-panel');
      targetRow.querySelector('.rule-main').click();
      if (HE.panel.activeSelector() !== '.accordion.is-open .accordion-panel') {
        throw new Error('picking a rule did not scope the panel: ' + HE.panel.activeSelector());
      }
      HE.actions.setStyle('color', 'tomato');
      if (!HE.sheet.get('.accordion.is-open .accordion-panel', 'color')) {
        throw new Error('rule-scope edit did not write the picked rule');
      }
      if (HE.canvas.doc.defaultView.getComputedStyle(accPanel).color !== 'rgb(255, 99, 71)') {
        throw new Error('rule-scope edit did not change the rendered value');
      }
      if (HE.sheet.get('.accordion-panel', 'color')) {
        throw new Error('rule-scope edit leaked into the base rule');
      }
      // A media-scoped matching rule edits that media block, not a top-level copy.
      const mediaEntry = HE.sheet.rulesFor(accPanel)
        .find((e) => e.selector === '.accordion-panel' && e.media === '(max-width: 768px)');
      if (!mediaEntry) throw new Error('media rule not matched by rulesFor');
      HE.actions.setRuleScope(mediaEntry);
      HE.actions.setStyle('padding', '20px');
      if (HE.sheet.getMedia('.accordion-panel', 'padding', '(max-width: 768px)') !== '20px') {
        throw new Error('media rule edit did not write the media block');
      }
      if (HE.sheet.get('.accordion-panel', 'padding') !== '4px') {
        throw new Error('media rule edit leaked into the desktop rule');
      }
      HE.actions.setRuleScope(null);
      // Pseudo switch on a picked rule creates the variant in place.
      HE.actions.setRuleScope({ selector: '.accordion.is-open .accordion-panel', rule: HE.sheet.rulesFor(accPanel).find((e) => e.selector === '.accordion.is-open .accordion-panel').rule, media: '' });
      HE.panel.state.pseudo = ':hover';
      HE.actions.setStyle('color', 'gold');
      if (!HE.sheet.get('.accordion.is-open .accordion-panel:hover', 'color')) {
        throw new Error('pseudo variant was not created for a picked rule');
      }
      HE.panel.state.pseudo = '';
      HE.actions.setRuleScope(null);
      if (HE.panel.activeSelector() !== '.accordion-panel') {
        throw new Error('leaving rule scope did not restore the class scope: ' + HE.panel.activeSelector());
      }
      // Attribute-state rule on a tab button is editable the same way.
      const tabBtn = HE.canvas.doc.querySelector('.tab-btn');
      HE.canvas.select(tabBtn);
      const tabEntry = HE.sheet.rulesFor(tabBtn).find((e) => e.selector === '.tab-btn[aria-selected="true"]');
      if (!tabEntry) throw new Error('attribute rule not matched: ' + HE.sheet.rulesFor(tabBtn).map((e) => e.selector).join('|'));
      HE.actions.setRuleScope(tabEntry);
      HE.actions.setStyle('color', 'navy');
      if (!HE.sheet.get('.tab-btn[aria-selected="true"]', 'color')) {
        throw new Error('attribute-state rule edit failed');
      }
      // Author a new contextual rule from the element's ancestors.
      HE.canvas.select(tabBtn);
      const made = HE.actions.addRuleScope('.tabs .tab-btn');
      if (!made.ok) throw new Error('addRuleScope failed: ' + made.error);
      if (HE.panel.activeSelector() !== '.tabs .tab-btn') {
        throw new Error('authored rule did not become the edit scope');
      }
      HE.actions.setStyle('padding-left', '12px');
      if (HE.sheet.get('.tabs .tab-btn', 'padding-left') !== '12px') {
        throw new Error('authored contextual rule did not accept edits');
      }
      HE.actions.setRuleScope(null);
      log.push('matching rules picker ok');

      // --- Functional style edits: real panel controls change the live page ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><div class="editable"><span>A</span><span>B</span></div></body></html>',
        '.editable{display:block;width:100px;color:#112233;opacity:0.9;overflow:visible}'
      );
      const editable = HE.canvas.doc.querySelector('.editable');
      HE.canvas.select(editable);
      const panelRow = (sectionName, label) => [...document.querySelectorAll(`#panel [data-sec="${sectionName}"] .prow`)]
        .find((el) => el.querySelector('label')?.textContent.trim() === label);

      const widthRow = panelRow('size', 'Width');
      const widthInput = widthRow && widthRow.querySelector('.size-number');
      if (!widthInput) throw new Error('functional width control missing');
      widthInput.value = '240';
      emit(widthInput, 'input');
      if (HE.sheet.get('.editable', 'width') !== '240px' ||
          HE.canvas.doc.defaultView.getComputedStyle(editable).width !== '240px') {
        throw new Error('width control did not change the live page');
      }

      const displayRow = panelRow('layout', 'Display');
      const gridButton = displayRow && [...displayRow.querySelectorAll('.seg button')]
        .find((button) => button.textContent.trim() === 'grid');
      if (!gridButton) throw new Error('functional display control missing');
      gridButton.click();
      if (HE.sheet.get('.editable', 'display') !== 'grid' ||
          HE.canvas.doc.defaultView.getComputedStyle(editable).display !== 'grid') {
        throw new Error('display control did not change the live page');
      }

      const columnsRow = panelRow('layout', 'Columns');
      const columnsInput = columnsRow && columnsRow.querySelector('input[type="text"]');
      if (!columnsInput) throw new Error('functional text control missing');
      columnsInput.value = '1fr 2fr';
      emit(columnsInput, 'input');
      if (HE.sheet.get('.editable', 'grid-template-columns') !== '1fr 2fr') {
        throw new Error('text control did not change the stylesheet');
      }

      const styleColorRow = panelRow('typography', 'Color');
      const styleColorPicker = styleColorRow && styleColorRow.querySelector('input[type="color"]');
      if (!styleColorPicker) throw new Error('functional color control missing');
      styleColorPicker.value = '#ff0000';
      emit(styleColorPicker, 'input');
      if (HE.canvas.doc.defaultView.getComputedStyle(editable).color !== 'rgb(255, 0, 0)' ||
          /var\(/i.test(HE.sheet.get('.editable', 'color'))) {
        throw new Error('color control did not change the live page');
      }

      const effectOpacityRow = panelRow('effects', 'Opacity');
      const effectOpacityInput = effectOpacityRow && effectOpacityRow.querySelector('.opacity-number');
      if (!effectOpacityInput) throw new Error('functional opacity control missing');
      effectOpacityInput.value = '0.65';
      emit(effectOpacityInput, 'input');
      if (HE.sheet.get('.editable', 'opacity') !== '0.65' ||
          HE.canvas.doc.defaultView.getComputedStyle(editable).opacity !== '0.65') {
        throw new Error('opacity control did not change the live page');
      }

      const overflowRow = panelRow('size', 'Overflow');
      const overflowSelect = overflowRow && overflowRow.querySelector('select');
      if (!overflowSelect) throw new Error('functional select control missing');
      overflowSelect.value = 'hidden';
      emit(overflowSelect, 'change');
      if (HE.sheet.get('.editable', 'overflow') !== 'hidden' ||
          HE.canvas.doc.defaultView.getComputedStyle(editable).overflow !== 'hidden') {
        throw new Error('select control did not change the live page');
      }

      const editSnapshot = HE.canvas.editSnapshot();
      if (!editSnapshot.css.includes('width: 240px') || !editSnapshot.css.includes('opacity: 0.65')) {
        throw new Error('functional edits did not appear in serialized CSS');
      }
      await HE.canvas.loadPage(editSnapshot.html, editSnapshot.css);
      const reloadedEditable = HE.canvas.doc.querySelector('.editable');
      HE.canvas.select(reloadedEditable);
      const reloadedStyle = HE.canvas.doc.defaultView.getComputedStyle(reloadedEditable);
      if (reloadedStyle.width !== '240px' || reloadedStyle.display !== 'grid' ||
          reloadedStyle.color !== 'rgb(255, 0, 0)' || reloadedStyle.opacity !== '0.65' ||
          reloadedStyle.overflow !== 'hidden') {
        throw new Error('serialized functional edits did not round-trip');
      }

      // A separated edit creates an undo point; redo must restore the changed value.
      await new Promise((resolve) => setTimeout(resolve, 850));
      const finalOpacityRow = panelRow('effects', 'Opacity');
      const finalOpacityInput = finalOpacityRow && finalOpacityRow.querySelector('.opacity-number');
      if (!finalOpacityInput) throw new Error('round-trip opacity control missing');
      finalOpacityInput.value = '0.25';
      emit(finalOpacityInput, 'input');
      if (HE.canvas.doc.defaultView.getComputedStyle(reloadedEditable).opacity !== '0.25') {
        throw new Error('final opacity edit did not change the live page');
      }
      const previousRefreshComponents = HE.refreshComponents;
      HE.refreshComponents = () => {};
      try {
        await HE.undo();
        const undoEditable = HE.canvas.doc.querySelector('.editable');
        if (HE.sheet.get('.editable', 'opacity') !== '0.65' ||
            HE.canvas.doc.defaultView.getComputedStyle(undoEditable).opacity !== '0.65') {
          throw new Error('undo did not restore the previous functional edit');
        }
        await HE.redo();
        const redoEditable = HE.canvas.doc.querySelector('.editable');
        if (HE.sheet.get('.editable', 'opacity') !== '0.25' ||
            HE.canvas.doc.defaultView.getComputedStyle(redoEditable).opacity !== '0.25') {
          throw new Error('redo did not restore the latest functional edit');
        }
      } finally {
        HE.refreshComponents = previousRefreshComponents;
      }
      log.push('functional style edit matrix ok');

      // --- Advanced section essentials: modern CSS controls write through ---
      // Self-contained helpers: this block must not rely on helpers defined
      // by neighboring (uncommitted) smoke sections.
      const advEmit = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
      const advRow = (sectionName, label) => [...document.querySelectorAll(`#panel [data-sec="${sectionName}"] .prow`)]
        .find((el) => el.querySelector('label')?.textContent.trim() === label);
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><div class="flexa">F</div><div class="grida">G</div><div class="boxa">B</div></body></html>',
        '.flexa{display:flex}.grida{display:grid}.boxa{display:block}'
      );
      const flexa = HE.canvas.doc.querySelector('.flexa');
      HE.canvas.select(flexa);
      const layoutRowBy = (label) => advRow('layout', label);
      const displaySegRow = layoutRowBy('Display');
      if (!displaySegRow || ![...displaySegRow.querySelectorAll('.seg button')]
        .some((b) => b.textContent.trim() === 'inline-flex')) {
        throw new Error('inline-flex display option missing');
      }
      const directionRow = layoutRowBy('Direction');
      const reverseBtn = directionRow && [...directionRow.querySelectorAll('.seg button')]
        .find((b) => b.textContent.trim() === 'row-reverse');
      if (!reverseBtn) throw new Error('flex row-reverse option missing');
      reverseBtn.click();
      if (HE.sheet.get('.flexa', 'flex-direction') !== 'row-reverse') {
        throw new Error('flex direction control did not write CSS');
      }
      const wrapRow = layoutRowBy('Wrap');
      const wrapSelect = wrapRow && wrapRow.querySelector('select');
      if (!wrapSelect || ![...wrapSelect.options].some((o) => o.value === 'wrap-reverse')) {
        throw new Error('flex wrap-reverse option missing');
      }
      wrapSelect.value = 'wrap-reverse';
      advEmit(wrapSelect, 'change');
      if (HE.sheet.get('.flexa', 'flex-wrap') !== 'wrap-reverse') {
        throw new Error('flex wrap control did not write CSS');
      }
      const gapRow = layoutRowBy('Gap');
      if (gapRow && gapRow.querySelector('.size-slider')) {
        throw new Error('length fields should not offer a range slider');
      }
      const gapNumber = gapRow && gapRow.querySelector('.size-number');
      if (!gapNumber || !gapNumber.classList.contains('is-scrubbable')) {
        throw new Error('flex gap number is missing its scrub affordance');
      }
      gapNumber.value = '24';
      advEmit(gapNumber, 'input');
      if (HE.sheet.get('.flexa', 'gap') !== '24px') {
        throw new Error('gap number did not write CSS');
      }

      const grida = HE.canvas.doc.querySelector('.grida');
      HE.canvas.select(grida);
      const gridAlignRow = layoutRowBy('Align');
      const gridJustifyRow = layoutRowBy('Justify');
      if (!gridAlignRow || !gridJustifyRow) throw new Error('grid alignment controls missing');
      const gridJustifySelect = gridJustifyRow.querySelector('select');
      gridJustifySelect.value = 'center';
      advEmit(gridJustifySelect, 'change');
      if (HE.sheet.get('.grida', 'justify-items') !== 'center') {
        throw new Error('grid justify-items control did not write CSS');
      }

      const boxa = HE.canvas.doc.querySelector('.boxa');
      HE.canvas.select(boxa);
      const boxRow = advRow('size', 'Box');
      const boxSelect = boxRow && boxRow.querySelector('select');
      if (!boxSelect) throw new Error('box-sizing control missing');
      boxSelect.value = 'border-box';
      advEmit(boxSelect, 'change');
      if (HE.sheet.get('.boxa', 'box-sizing') !== 'border-box') {
        throw new Error('box-sizing control did not write CSS');
      }
      const ratioRow = advRow('size', 'Ratio');
      const ratioSelect = ratioRow && ratioRow.querySelector('.preset-select');
      const ratioCustom = ratioRow && ratioRow.querySelector('.preset-custom');
      if (!ratioRow || !ratioSelect || !ratioCustom) throw new Error('aspect-ratio control missing');
      ratioSelect.value = '16 / 9';
      advEmit(ratioSelect, 'change');
      if (HE.sheet.get('.boxa', 'aspect-ratio') !== '16 / 9') {
        throw new Error('aspect-ratio preset did not write CSS');
      }
      ratioSelect.value = '__custom__';
      advEmit(ratioSelect, 'change');
      ratioCustom.value = '21 / 9';
      advEmit(ratioCustom, 'input');
      if (HE.sheet.get('.boxa', 'aspect-ratio') !== '21 / 9') {
        throw new Error('aspect-ratio custom value did not write CSS');
      }

      const zRow = advRow('position', 'Z-index');
      const zNumber = zRow && zRow.querySelector('.stepper-number');
      const zInc = zRow && zRow.querySelector('.stepper-inc');
      if (!zRow || !zNumber || !zInc) throw new Error('z-index stepper control missing');
      zInc.click();
      if (HE.sheet.get('.boxa', 'z-index') !== '1') {
        throw new Error('z-index stepper did not write CSS');
      }
      zNumber.value = '';
      advEmit(zNumber, 'input');
      if (HE.sheet.get('.boxa', 'z-index')) throw new Error('clearing z-index did not unset it');

      const attachRow = advRow('background', 'Scroll');
      const attachSelect = attachRow && attachRow.querySelector('select');
      if (!attachSelect) throw new Error('background-attachment control missing');
      const attachOptionValues = [...attachSelect.options].map((o) => o.value);
      if (!attachOptionValues.includes('scroll') || !attachOptionValues.includes('local')) {
        throw new Error('background-attachment options should offer page/box scroll choices');
      }
      attachSelect.value = 'local';
      advEmit(attachSelect, 'change');
      if (HE.sheet.get('.boxa', 'background-attachment') !== 'local') {
        throw new Error('background-attachment control did not write CSS');
      }
      const bgSection = document.querySelector('#panel [data-sec="background"]');
      const bgText = (bgSection?.textContent || '');
      for (const phrase of ['back wall', 'one value per layer', 'With the box content']) {
        if (!bgText.includes(phrase)) throw new Error(`background panel missing clarity copy: ${phrase}`);
      }

      const borderSection = document.querySelector('#panel [data-sec="border"]');
      if (!borderSection) throw new Error('border section missing');
      const outlineDisclosure = borderSection.querySelector('details.border-advanced');
      if (!outlineDisclosure) throw new Error('outline advanced disclosure missing');
      if (outlineDisclosure.open) throw new Error('outline disclosure should render closed');
      const outlineSummary = (outlineDisclosure.querySelector('summary')?.textContent || '').toLowerCase();
      if (!outlineSummary.includes('outline') || !outlineSummary.includes('advanced')) {
        throw new Error('outline disclosure should be labeled Outline advanced: ' + outlineSummary);
      }
      if (!/never moves layout|focus ring/i.test(outlineDisclosure.textContent || '')) {
        throw new Error('outline disclosure should explain outline vs border');
      }
      for (const label of ['Outline W', 'Outline S', 'Outline C', 'Outline O']) {
        const row = advRow('border', label);
        if (!row) throw new Error(`outline row missing: ${label}`);
        if (!outlineDisclosure.contains(row)) throw new Error(`${label} should live inside the outline disclosure`);
      }
      for (const label of ['Width', 'Style', 'Color', 'Radius']) {
        const row = advRow('border', label);
        if (!row) throw new Error(`border row missing: ${label}`);
        if (outlineDisclosure.contains(row)) throw new Error(`${label} should stay outside the outline disclosure`);
      }
      outlineDisclosure.setAttribute('open', '');
      const borderStyleRow = advRow('border', 'Style');
      const borderStyleSelect = borderStyleRow && borderStyleRow.querySelector('select');
      if (!borderStyleSelect) throw new Error('border style control missing');
      const outlineStyleRow = advRow('border', 'Outline S');
      const outlineStyleSelect = outlineStyleRow && outlineStyleRow.querySelector('select');
      if (!outlineStyleSelect) throw new Error('outline style control missing');
      for (const sel of [borderStyleSelect, outlineStyleSelect]) {
        const labels = [...sel.options].map((o) => o.textContent);
        for (const name of ['none', 'solid', 'dashed', 'dotted']) {
          if (!labels.some((t) => t.includes(name))) {
            throw new Error(`border style options should name ${name}`);
          }
        }
        // Every named option shows a line-sample preview alongside its name.
        if (!labels.some((t) => /━|╌|●|∅/.test(t))) {
          throw new Error('border style options should preview the line look');
        }
      }
      outlineStyleSelect.value = 'solid';
      advEmit(outlineStyleSelect, 'change');
      if (HE.sheet.get('.boxa', 'outline-style') !== 'solid') {
        throw new Error('outline style control did not write CSS');
      }
      const outlineOffsetRow = advRow('border', 'Outline O');
      const outlineOffsetInput = outlineOffsetRow && outlineOffsetRow.querySelector('.size-number');
      if (!outlineOffsetInput) throw new Error('outline offset control missing');
      outlineOffsetInput.value = '2';
      advEmit(outlineOffsetInput, 'input');
      if (HE.sheet.get('.boxa', 'outline-offset') !== '2px') {
        throw new Error('outline offset control did not write CSS');
      }
      outlineDisclosure.removeAttribute('open');

      // Panel filter for "outline" surfaces the Border section and opens the disclosure.
      const panelFilterInput = document.querySelector('#panel .panel-filter input');
      if (!panelFilterInput) throw new Error('panel filter input missing');
      panelFilterInput.value = 'outline';
      panelFilterInput.dispatchEvent(new Event('input', { bubbles: true }));
      if (borderSection.style.display === 'none') throw new Error('filter "outline" hid the Border section');
      if (!outlineDisclosure.open) throw new Error('filter "outline" should open the outline disclosure');
      panelFilterInput.value = '';
      panelFilterInput.dispatchEvent(new Event('input', { bubbles: true }));

      log.push('advanced section essentials ok');

      // --- Effective values outside the preset/button lists ---
      // A control must show what is rendering even when the value is not one of
      // its options: a button's computed border-style `outset`, an inherited
      // variable-font weight, a multi-layer background, a `<li>`'s display
      // `list-item`, and background-position's computed `0% 0%`.
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body>' +
        '<button class="plain-btn">B</button>' +
        '<ul><li class="plain-item">I</li></ul>' +
        '<div class="multi-layer"></div>' +
        '<div class="bg-default">bg</div>' +
        '<div class="weight-source"><span class="weight-child">w</span></div>' +
        '</body></html>',
        '.multi-layer{background-image:linear-gradient(red,blue),linear-gradient(green,yellow)}' +
        '.bg-default{background-image:linear-gradient(red,blue)}' +
        '.weight-source{font-weight:480}'
      );
      const effRow = (sectionName, label) => [...document.querySelectorAll(`#panel [data-sec="${sectionName}"] .prow`)]
        .find((el) => el.querySelector('label')?.textContent.trim() === label);
      const effEmpty = (select) => select && [...select.options].find((o) => o.value === '');

      HE.canvas.select(HE.canvas.doc.querySelector('.plain-btn'));
      const btnBorderStyle = effRow('border', 'Style')?.querySelector('select');
      if (!/outset/.test(effEmpty(btnBorderStyle)?.textContent || '')) {
        throw new Error('border style should preview the computed outset on a button: '
          + (effEmpty(btnBorderStyle)?.textContent || ''));
      }

      HE.canvas.select(HE.canvas.doc.querySelector('.multi-layer'));
      const multiScroll = effRow('background', 'Scroll')?.querySelector('select');
      if (!/scroll/.test(effEmpty(multiScroll)?.textContent || '')) {
        throw new Error('multi-layer background-attachment should preview scroll: '
          + (effEmpty(multiScroll)?.textContent || ''));
      }

      HE.canvas.select(HE.canvas.doc.querySelector('.bg-default'));
      const positionSelect = effRow('background', 'Position')?.querySelector('.preset-select');
      if (!/top left/i.test(effEmpty(positionSelect)?.textContent || '')) {
        throw new Error('background-position 0% 0% should name the Top left preset: '
          + (effEmpty(positionSelect)?.textContent || ''));
      }

      HE.canvas.select(HE.canvas.doc.querySelector('.weight-child'));
      const weightPreview = effRow('typography', 'Weight')?.querySelector('select');
      if (!/480/.test(effEmpty(weightPreview)?.textContent || '')) {
        throw new Error('inherited variable-font weight 480 should preview in the Weight field: '
          + (effEmpty(weightPreview)?.textContent || ''));
      }

      HE.canvas.select(HE.canvas.doc.querySelector('.plain-item'));
      const liDisplay = effRow('layout', 'Display');
      const liPressed = liDisplay && [...liDisplay.querySelectorAll('.seg button')]
        .find((b) => b.dataset.value === 'list-item');
      if (!liPressed || liPressed.getAttribute('aria-pressed') !== 'true') {
        throw new Error('display should show the computed list-item as a pressed button');
      }
      HE.actions.setStyle('display', 'flow-root', { now: true });
      HE.panel.refresh();
      const flowDisplay = [...document.querySelectorAll('#panel [data-sec="layout"] .seg button')]
        .find((b) => b.dataset.value === 'flow-root');
      if (!flowDisplay || flowDisplay.getAttribute('aria-pressed') !== 'true') {
        throw new Error('authored display flow-root should appear as a pressed button');
      }
      HE.actions.setStyle('display', '', { now: true });
      HE.panel.refresh();
      log.push('effective off-list control values ok');

      // Restore the advanced-block page/selection for the next self-contained section.
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><div class="flexa">F</div><div class="grida">G</div><div class="boxa">B</div></body></html>',
        '.flexa{display:flex}.grida{display:grid}.boxa{display:block}'
      );
      HE.canvas.select(HE.canvas.doc.querySelector('.boxa'));

      // --- Task 90: Custom CSS property editor ---
      const customSection = document.querySelector('#panel [data-sec="custom"]');
      if (!customSection) throw new Error('custom CSS section missing');
      const customNames = () => [...customSection.querySelectorAll('.custom-prop-name')]
        .map((el) => el.textContent.trim());
      if (customNames().some((n) => ['box-sizing', 'aspect-ratio', 'outline-offset'].includes(n))) {
        throw new Error('custom CSS list should not repeat preset-owned properties: ' + customNames().join(','));
      }
      const cName = customSection.querySelector('.custom-prop-name-input');
      const cVal = customSection.querySelector('.custom-prop-value');
      const cAdd = customSection.querySelector('.custom-prop-add');
      if (!cName || !cVal || !cAdd) throw new Error('custom CSS add row missing');
      cName.value = 'text-overflow';
      cVal.value = 'ellipsis';
      cAdd.click();
      if (HE.sheet.get('.boxa', 'text-overflow') !== 'ellipsis') {
        throw new Error('custom CSS add did not write CSS');
      }
      const findCustomRow = () => [...document.querySelectorAll('#panel [data-sec="custom"] .custom-prop-row')]
        .find((row) => row.querySelector('.custom-prop-name')?.textContent.trim() === 'text-overflow');
      const customRow = findCustomRow();
      if (!customRow) throw new Error('custom property did not appear in the list');
      const customValueInput = customRow.querySelector('.custom-prop-value');
      customValueInput.value = 'clip';
      advEmit(customValueInput, 'change');
      if (HE.sheet.get('.boxa', 'text-overflow') !== 'clip') {
        throw new Error('custom CSS value edit did not write CSS');
      }
      const customDel = findCustomRow()?.querySelector('.custom-prop-del');
      if (!customDel) throw new Error('custom property remove button missing');
      customDel.click();
      if (HE.sheet.get('.boxa', 'text-overflow')) throw new Error('custom CSS remove did not clear CSS');
      // A property that already has a control updates that control (single
      // source of truth) and does not duplicate into the custom list.
      const cs2 = document.querySelector('#panel [data-sec="custom"]');
      cs2.querySelector('.custom-prop-name-input').value = 'cursor';
      cs2.querySelector('.custom-prop-value').value = 'pointer';
      cs2.querySelector('.custom-prop-add').click();
      if (HE.sheet.get('.boxa', 'cursor') !== 'pointer') {
        throw new Error('custom write of a panel-owned property did not reach CSS');
      }
      const afterNames = [...document.querySelectorAll('#panel [data-sec="custom"] .custom-prop-name')]
        .map((el) => el.textContent.trim());
      if (afterNames.includes('cursor')) {
        throw new Error('panel-owned property should not duplicate into the custom list');
      }
      const cursorSelect = document.querySelector('#panel [data-sec="effects"] select[aria-label="cursor"]');
      if (!cursorSelect || cursorSelect.value !== 'pointer') {
        throw new Error('preset control did not reflect the custom write: ' + (cursorSelect ? cursorSelect.value : 'missing'));
      }
      log.push('custom css property editor ok');

      // --- Task 61/62: topbar without micro-labels, scope switch in right panel, navigator reveal ---
      if (document.querySelector('#topbar .topbar-label')) {
        throw new Error('topbar micro-labels should be removed');
      }
      if (!document.querySelector('#right #content-switch')) {
        throw new Error('Design/Content switch should live at the top of the right panel');
      }
      if (document.querySelector('#topbar #content-switch')) {
        throw new Error('Design/Content switch should no longer be in the topbar');
      }
      const modeBtns = [...document.querySelectorAll('#mode-switch button')].map((el) => el.textContent.trim());
      const scopeBtns = [...document.querySelectorAll('#content-switch button')].map((el) => el.textContent.trim());
      if (!modeBtns.includes('Edit') || !modeBtns.includes('Preview')) {
        throw new Error('canvas mode Edit/Preview missing: ' + modeBtns.join('|'));
      }
      if (!scopeBtns.includes('Design') || !scopeBtns.includes('Content') || !scopeBtns.includes('Site')) {
        throw new Error('editing scope Design/Content/Site missing: ' + scopeBtns.join('|'));
      }
      for (const id of ['mode-switch', 'content-switch']) {
        const label = document.getElementById(id).getAttribute('aria-label') || '';
        if (!label) throw new Error(id + ' missing aria-label');
      }
      if (document.getElementById('branch-name').tagName !== 'SPAN') {
        throw new Error('branch-name is not a status label');
      }
      // --- Task 64 phase 2: real-git branch display (read-only) ---
      const origGitInfo = HE.gitInfo;
      const origBranchMeta = HE.versions.meta;
      try {
        HE.applyGitInfo({ isRepo: true, kind: 'branch', branch: 'feature/x' });
        if (document.getElementById('branch-name').textContent !== 'git: feature/x') {
          throw new Error('git branch not shown in topbar');
        }
        HE.applyGitInfo({ isRepo: true, kind: 'detached', branch: '9f3a2b1' });
        if (!document.getElementById('branch-name').textContent.includes('9f3a2b1')) {
          throw new Error('detached HEAD not shown in topbar');
        }
        HE.applyGitInfo({ isRepo: false });
        HE.versions.meta = { currentBranch: 'wip', branches: ['wip'], versions: [] };
        HE.renderBranchName();
        if (document.getElementById('branch-name').textContent !== 'wip') {
          throw new Error('editor branch not shown without a repo');
        }
      } finally {
        HE.versions.meta = origBranchMeta;
        HE.applyGitInfo(origGitInfo);
      }
      // --- Task 64 phase 3: single history/git off switch ---
      const origSettings = { ...(HE.settings || { historyUi: true }) };
      const origSettingsIpc = HE.settingsIpc;
      const origVersionsSnapshot = HE.versions.snapshot;
      const origSnapshotMeta = HE.versions.meta;
      const fakeSettings = { historyUi: true };
      const settingsNotices = [];
      const origToast64 = HE.toast;
      const settingsPage = HE.page;
      const settingsProject = HE.project;
      try {
        HE.settingsIpc = () => ({
          get: async () => ({ ...fakeSettings }),
          set: async (patch) => { Object.assign(fakeSettings, patch); return { ...fakeSettings }; },
        });
        HE.toast = (msg) => settingsNotices.push(String(msg));
        await HE.setHistoryUi(false);
        if (!document.getElementById('history-btn').hidden) throw new Error('History button visible while off');
        if (!document.getElementById('branch-name').hidden) throw new Error('branch label visible while off');
        if (fakeSettings.historyUi !== false) throw new Error('setting not persisted');
        if (!document.getElementById('settings-history-ui') || document.getElementById('settings-history-ui').checked) {
          throw new Error('settings checkbox out of sync');
        }
        HE.versions.openHistory();
        if (!document.getElementById('history-overlay').hidden) throw new Error('history opened while off');
        if (!settingsNotices.some((m) => m.includes('Settings'))) throw new Error('no off-switch hint shown');
        let snapped = false;
        HE.versions.snapshot = async () => { snapped = true; return null; };
        HE.versions.meta = { currentBranch: 'main', branches: ['main'], versions: [] };
        HE.page = 'page1.html';
        HE.project = { dir: '/tmp/test-site', pages: ['page1.html'], stylesheets: [] };
        await HE.versions.afterSave();
        if (snapped) throw new Error('snapshot taken while history off');
        await HE.setHistoryUi(true);
        if (document.getElementById('history-btn').hidden) throw new Error('History button hidden while on');
        if (document.getElementById('branch-name').hidden) throw new Error('branch label hidden while on');
        await HE.versions.afterSave();
        if (!snapped) throw new Error('snapshot skipped while history on');
      } finally {
        HE.versions.meta = origSnapshotMeta;
        HE.versions.snapshot = origVersionsSnapshot;
        HE.settingsIpc = origSettingsIpc;
        HE.toast = origToast64;
        HE.settings = origSettings;
        HE.page = settingsPage;
        HE.project = settingsProject;
        HE.applySettings();
      }
      if (document.getElementById('tree').getAttribute('role') !== 'tree') {
        throw new Error('navigator missing tree role');
      }
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><section class="outer"><div class="mid"><p class="deep">Hi</p></div></section></body></html>',
        '.outer{display:block}.mid{display:block}.deep{display:block}'
      );
      const deep = HE.canvas.doc.querySelector('.deep');
      HE.canvas.select(deep);
      const deepRow = [...document.querySelectorAll('#tree .tree-row')].find((r) => r.getAttribute('aria-label') === 'p .deep: Hi');
      if (!deepRow || !deepRow.classList.contains('on')) throw new Error('navigator did not highlight selection');
      const midRow = [...document.querySelectorAll('#tree .tree-row')].find((r) => r.getAttribute('aria-label') === 'div .mid: Hi');
      if (!midRow || midRow.offsetParent === null) throw new Error('navigator did not reveal selection ancestors');
      const toggleBtn = midRow.querySelector(':scope > .tree-toggle');
      if (!toggleBtn || toggleBtn.tagName !== 'BUTTON' || toggleBtn.getAttribute('aria-expanded') !== 'true') {
        throw new Error('navigator toggle missing button semantics');
      }
      const groupRole = midRow.closest('.tree-node')?.querySelector(':scope > .tree-children')?.getAttribute('role');
      if (groupRole !== 'group') throw new Error('navigator children missing group role');
      midRow.focus();
      midRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      if (document.activeElement !== deepRow) throw new Error('navigator ArrowDown did not move focus');
      deepRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      if (document.activeElement !== midRow) throw new Error('navigator ArrowLeft did not move to parent');
      log.push('panel navigator topbar clarity ok');

      // --- Navigator rebuild robustness: collapse identity, focus survival, a11y ---
      const findRow = (prefix) =>
        [...document.querySelectorAll('#tree .tree-row')].find((r) => (r.getAttribute('aria-label') || '').startsWith(prefix));
      // Collapse the current parent by element identity, not tree position.
      HE.canvas.deselect();
      midRow.querySelector(':scope > .tree-toggle').click();
      if (findRow('div .mid').querySelector(':scope > .tree-toggle').getAttribute('aria-expanded') !== 'false') {
        throw new Error('navigator collapse toggle did not collapse');
      }
      const outerEl = HE.canvas.doc.querySelector('.outer');
      HE.canvas.insertElement('p', outerEl, 'before');
      if (findRow('div .mid').querySelector(':scope > .tree-toggle').getAttribute('aria-expanded') !== 'false') {
        throw new Error('navigator collapse state lost after a sibling insert');
      }
      // A rebuild must not drop the focused row.
      const midFocusRow = findRow('div .mid');
      midFocusRow.focus();
      HE.canvas.insertElement('p', outerEl, 'before');
      if (!(document.activeElement.getAttribute('aria-label') || '').startsWith('div .mid')) {
        throw new Error('navigator lost focus across a rebuild');
      }
      // Context menu Escape returns focus to its trigger.
      HE.canvas.select(HE.canvas.doc.querySelector('.mid'));
      const midMore = findRow('div .mid').querySelector(':scope > .tree-more');
      midMore.click();
      if (!document.querySelector('.tree-context-menu') || document.querySelector('.tree-context-menu').hidden) {
        throw new Error('navigator context menu did not open');
      }
      if (midMore.getAttribute('aria-expanded') !== 'true') throw new Error('navigator more button missing aria-expanded');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (document.activeElement !== midMore) throw new Error('navigator context menu did not restore focus');
      if (midMore.getAttribute('aria-expanded') !== 'false') throw new Error('navigator more button aria-expanded stuck');
      // No-op and ancestor "inside" drops are rejected without touching the DOM.
      const midEl = HE.canvas.doc.querySelector('.mid');
      const deepEl = HE.canvas.doc.querySelector('.deep');
      const htmlBeforeDrop = HE.canvas.doc.body.innerHTML;
      if (HE.canvas.moveElement(deepEl, midEl, 'inside') !== false) throw new Error('no-op inside drop was accepted');
      if (HE.canvas.moveElement(midEl, outerEl, 'inside') !== false) throw new Error('ancestor inside drop was accepted');
      if (HE.canvas.doc.body.innerHTML !== htmlBeforeDrop) throw new Error('rejected drop mutated the DOM');
      log.push('panel navigator rebuild robustness ok');

      // --- Add-element palette: primary grid + "More elements" disclosure ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><div class="host"></div></body></html>', ''
      );
      const paletteGrid = document.getElementById('palette-grid');
      const paletteMore = document.getElementById('palette-more-grid');
      const paletteToggle = document.getElementById('palette-more-toggle');
      if (!paletteGrid || !paletteMore || !paletteToggle) throw new Error('palette More controls missing');
      if (paletteGrid.querySelectorAll('.palette-item').length < 12) throw new Error('primary palette shrank');
      if (paletteMore.querySelectorAll('.palette-item').length < 20) throw new Error('More palette missing the long tail');
      if (!paletteMore.hidden) throw new Error('More palette should start collapsed');
      const paletteHost = HE.canvas.doc.querySelector('.host');
      const insertFromPalette = (grid, label) => {
        HE.canvas.select(paletteHost);
        const item = [...grid.querySelectorAll('.palette-item')].find((n) => n.textContent === label);
        if (!item) throw new Error('palette item missing: ' + label);
        item.click();
      };
      insertFromPalette(paletteGrid, 'Section');
      insertFromPalette(paletteMore, 'Header');
      insertFromPalette(paletteMore, 'Table');
      insertFromPalette(paletteMore, 'Icon');
      if (!paletteHost.querySelector(':scope > section')) throw new Error('primary palette insert failed');
      if (!paletteHost.querySelector(':scope > header')) throw new Error('landmark palette insert failed');
      const paletteTable = paletteHost.querySelector(':scope > table');
      if (!paletteTable || !paletteTable.querySelector('td')) throw new Error('table default rows missing');
      const paletteIcon = paletteHost.querySelector(':scope > svg');
      if (!paletteIcon || paletteIcon.namespaceURI !== 'http://www.w3.org/2000/svg') {
        throw new Error('SVG palette item lost its namespace');
      }
      paletteToggle.click();
      if (paletteMore.hidden || paletteToggle.getAttribute('aria-expanded') !== 'true') {
        throw new Error('More toggle did not reveal the extra palette');
      }
      const paletteSerialized = HE.canvas.serializeDoc();
      if (!paletteSerialized.includes('<header') || !paletteSerialized.includes('<svg')) {
        throw new Error('new palette elements did not serialize');
      }
      log.push('add-element palette ok');

      // --- Export menu escapes the topbar (fixed, below the button, in viewport) ---
      const exportBtn = document.getElementById('export-btn');
      const exportMenu = document.getElementById('export-menu');
      exportBtn.click();
      if (exportMenu.hidden) throw new Error('export menu did not open');
      if (getComputedStyle(exportMenu).position !== 'fixed') throw new Error('export menu not fixed-positioned');
      const ebr = exportBtn.getBoundingClientRect();
      const emr = exportMenu.getBoundingClientRect();
      if (emr.top < ebr.bottom - 1) throw new Error('export menu overlaps topbar');
      if (emr.bottom > window.innerHeight + 1 || emr.right > window.innerWidth + 1 || emr.left < -1) {
        throw new Error('export menu overflows viewport');
      }
      exportBtn.click();
      if (!exportMenu.hidden) throw new Error('export menu did not close');
      log.push('export menu ok');

      // --- JS-state previews + preview→edit carry-over (never saved) ---
      const stateFixture =
        '<!DOCTYPE html><html><head></head><body>' +
        '<div class="tabs"><div class="tab-list" role="tablist">' +
        '<button class="tab-btn" role="tab" aria-selected="true">One</button>' +
        '<button class="tab-btn" role="tab" aria-selected="false">Two</button></div>' +
        '<div class="tab-panel" role="tabpanel"><p>First</p></div>' +
        '<div class="tab-panel" role="tabpanel" hidden><p>Second</p></div></div>' +
        '<div class="accordion"><button class="accordion-btn" aria-expanded="false">Q</button>' +
        '<div class="accordion-panel" hidden><p>A</p></div></div>' +
        '<div class="carousel"><div class="carousel-track"><span>a</span><span>b</span></div>' +
        '<button class="carousel-btn" data-scroll="1">Next</button></div>' +
        '</body></html>';
      await HE.canvas.loadPage(stateFixture, '');
      await HE.canvas.setMode('edit');
      {
        const d = HE.canvas.doc;
        const panels = [...d.querySelectorAll('.tab-panel')];
        HE.canvas.select(d.querySelector('.accordion'));
        const behaviorPanel = document.getElementById('panel');
        if (!behaviorPanel || !behaviorPanel.textContent.includes('JS Behavior') || behaviorPanel.textContent.includes('JS Hooks')) {
          throw new Error('JS Behavior panel label missing');
        }
        HE.canvas.previewTab(d.querySelector('.tabs'), 1);
        if (panels[1].hasAttribute('hidden') || !panels[0].hasAttribute('hidden')) {
          throw new Error('edit tab preview failed');
        }
        const tgl = HE.canvas.previewToggle(d.querySelector('.accordion-btn'));
        if (!tgl || !tgl.open) throw new Error('edit accordion preview did not open');
        const ap = d.querySelector('.accordion-panel');
        if (ap.hasAttribute('hidden')) throw new Error('accordion panel still hidden');
        const sc = HE.canvas.scrollCarousel(d.querySelector('.carousel'), 1);
        if (!sc || !sc.ok) throw new Error('carousel scroll mirror failed');
        // Save restores authored states while the live view keeps previews.
        const serPrev = HE.canvas.serializeDoc();
        if (!serPrev.includes('hidden')) throw new Error('preview state leaked into save');
        if (panels[1].hasAttribute('hidden') || ap.hasAttribute('hidden')) {
          throw new Error('preview did not survive serialize');
        }
        log.push('edit state previews ok');
      }
      // Arrange state in Preview (as page scripts would), return to Edit.
      const editFrameTop = document.getElementById('canvas-frame').getBoundingClientRect().top;
      const modeSwitchEl = document.getElementById('mode-switch');
      const viewportSwitchEl = document.getElementById('viewport-switch');
      const modeLeftBefore = modeSwitchEl.getBoundingClientRect().left;
      const viewportLeftBefore = viewportSwitchEl.getBoundingClientRect().left;
      await HE.canvas.setMode('preview');
      const previewFrameTop = document.getElementById('canvas-frame').getBoundingClientRect().top;
      if (Math.abs(previewFrameTop - editFrameTop) > 1) {
        throw new Error(`mode banner moved canvas (${editFrameTop} → ${previewFrameTop})`);
      }
      if (Math.abs(modeSwitchEl.getBoundingClientRect().left - modeLeftBefore) > 1 ||
          Math.abs(viewportSwitchEl.getBoundingClientRect().left - viewportLeftBefore) > 1) {
        throw new Error('Preview status appearing shifted the mode/viewport controls');
      }
      const previewStatusWrap = document.getElementById('preview-status-wrap');
      const previewStatusTrigger = document.getElementById('preview-status-trigger');
      const previewStatusPopover = document.getElementById('preview-status-popover');
      if (!previewStatusWrap || previewStatusWrap.hidden || !previewStatusTrigger || !previewStatusPopover ||
          document.getElementById('canvas-status-slot')) {
        throw new Error('Preview status did not move into editor chrome');
      }
      if (previewStatusWrap.getBoundingClientRect().right > modeSwitchEl.getBoundingClientRect().left + 1) {
        throw new Error('Preview status overlaps the mode controls');
      }
      previewStatusTrigger.click();
      if (previewStatusPopover.hidden || getComputedStyle(previewStatusPopover).position !== 'fixed' ||
          document.getElementById('preview-banner').hidden) {
        throw new Error('Preview status popover did not open from the topbar');
      }
      previewStatusTrigger.click();
      if (!previewStatusPopover.hidden) throw new Error('Preview status popover did not close');
      previewStatusTrigger.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (!previewStatusPopover.hidden || document.activeElement !== previewStatusTrigger ||
          previewStatusTrigger.getAttribute('aria-expanded') !== 'false') {
        throw new Error('Preview status popover is not keyboard-dismissible');
      }
      {
        const d = HE.canvas.doc;
        const panels = [...d.querySelectorAll('.tab-panel')];
        const btns = [...d.querySelectorAll('.tab-btn')];
        btns.forEach((b, j) => b.setAttribute('aria-selected', String(j === 1)));
        panels.forEach((p, j) => {
          if (j === 1) p.removeAttribute('hidden');
          else p.setAttribute('hidden', '');
        });
        const ap = d.querySelector('.accordion-panel');
        ap.removeAttribute('hidden');
        d.querySelector('.accordion').classList.add('is-open');
        d.querySelector('.accordion-btn').setAttribute('aria-expanded', 'true');
      }
      await HE.canvas.setMode('edit');
      {
        const d = HE.canvas.doc;
        const returnedFrameTop = document.getElementById('canvas-frame').getBoundingClientRect().top;
        if (Math.abs(returnedFrameTop - previewFrameTop) > 1) {
          throw new Error(`retained state moved canvas (${previewFrameTop} → ${returnedFrameTop})`);
        }
        const panels = [...d.querySelectorAll('.tab-panel')];
        const btns = [...d.querySelectorAll('.tab-btn')];
        if (panels[1].hasAttribute('hidden') || !panels[0].hasAttribute('hidden')) {
          throw new Error('preview tab state not carried into edit');
        }
        const ap = d.querySelector('.accordion-panel');
        if (ap.hasAttribute('hidden')) throw new Error('preview accordion state not carried into edit');
        const serCarry = HE.canvas.serializeDoc();
        if (!serCarry.includes('hidden')) throw new Error('carried state leaked into save');
        if (panels[1].hasAttribute('hidden') || ap.hasAttribute('hidden')) {
          throw new Error('carried preview did not survive serialize');
        }
        const retained = HE.canvas.getRetainedPreviewState && HE.canvas.getRetainedPreviewState();
        if (!retained || !retained.summary.canCommit || !retained.summary.text.includes('Tab: Two') || !retained.summary.text.includes('Accordion: Open')) {
          throw new Error('retained Preview state summary missing: ' + JSON.stringify(retained));
        }
        const stateBanner = document.getElementById('state-banner');
        if (!stateBanner || stateBanner.hidden || !stateBanner.textContent.includes('Runtime changes are temporary')) {
          throw new Error('retained state banner missing');
        }
        if (!previewStatusWrap || previewStatusWrap.hidden) throw new Error('retained state status control missing');
        previewStatusTrigger.click();
        if (previewStatusPopover.hidden || stateBanner.hidden) throw new Error('retained state popover did not open');
        previewStatusTrigger.click();
        log.push('retained state banner ok');
        if (!HE.canvas.makePreviewStateDefault()) throw new Error('make default action failed');
        if (HE.canvas.getRetainedPreviewState()) throw new Error('retained state survived make default');
        if (!previewStatusWrap.hidden) throw new Error('retained state status control did not clear');
        if (btns[1].getAttribute('aria-selected') !== 'true' || !panels[0].hasAttribute('hidden') || panels[1].hasAttribute('hidden')) {
          throw new Error('tab default state was not committed: ' + btns.map((b) => b.getAttribute('aria-selected')).join(',') + ' / ' + panels.map((p) => p.hasAttribute('hidden')).join(','));
        }
        if (!d.querySelector('.accordion').classList.contains('is-open') || ap.hasAttribute('hidden')) {
          throw new Error('accordion default state was not committed');
        }
        log.push('make default ok');
      }

      // Reset returns to authored state without discarding the current page
      // content or writing files.
      await HE.canvas.loadPage(stateFixture, '');
      await HE.canvas.setMode('preview');
      {
        const d = HE.canvas.doc;
        const panels = [...d.querySelectorAll('.tab-panel')];
        const btns = [...d.querySelectorAll('.tab-btn')];
        btns.forEach((b, j) => b.setAttribute('aria-selected', String(j === 1)));
        panels.forEach((p, j) => {
          if (j === 1) p.removeAttribute('hidden');
          else p.setAttribute('hidden', '');
        });
        d.querySelector('.accordion-panel').removeAttribute('hidden');
        d.querySelector('.accordion').classList.add('is-open');
        await HE.canvas.setMode('edit');
        if (!HE.canvas.getRetainedPreviewState()) throw new Error('reset fixture did not retain state');
        if (!await HE.canvas.resetPreviewState()) throw new Error('reset action failed');
        const resetDoc = HE.canvas.doc;
        if (!resetDoc.querySelectorAll('.tab-panel')[1].hasAttribute('hidden') || !resetDoc.querySelector('.accordion-panel').hasAttribute('hidden')) {
          throw new Error('reset did not restore authored state');
        }
        if (HE.canvas.getRetainedPreviewState()) throw new Error('retained state survived reset');
        log.push('reset state ok');
      }

      // --- Mode switches keep the viewport on the same part of the page ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><div class="talltop">Top</div><p>Bottom</p></body></html>',
        '.talltop{height:2500px}'
      );
      await HE.canvas.setMode('edit');
      {
        const d = HE.canvas.doc;
        d.defaultView.scrollTo(0, 400);
        const yEdit = d.defaultView.scrollY || 0;
        await HE.canvas.setMode('preview');
        const yPrev = HE.canvas.doc.defaultView.scrollY || 0;
        if (yPrev !== yEdit) throw new Error(`preview did not keep scroll (${yEdit} → ${yPrev})`);
        await HE.canvas.setMode('edit');
        const yBack = HE.canvas.doc.defaultView.scrollY || 0;
        if (yBack !== yEdit) throw new Error(`edit did not keep scroll (${yEdit} → ${yBack})`);
        log.push('mode scroll kept ok');
      }

      // --- Authored `scroll-behavior: smooth` must not animate the restore ---
      // The switch should land on the same position instantly, not scroll to
      // it, and the author's smooth scrolling must survive the switch.
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><div class="talltop">Top</div><p>Bottom</p></body></html>',
        'html{scroll-behavior:smooth}.talltop{height:2500px}'
      );
      await HE.canvas.setMode('edit');
      {
        const d = HE.canvas.doc;
        const rootEl = d.documentElement;
        // Deterministic setup: force an instant jump to 400, then hand the
        // smooth behavior back to the stylesheet so only the restore is tested.
        rootEl.style.scrollBehavior = 'auto';
        d.defaultView.scrollTo(0, 400);
        rootEl.style.scrollBehavior = '';
        const yEdit = d.defaultView.scrollY || 0;
        if (yEdit !== 400) throw new Error(`smooth fixture did not scroll (${yEdit})`);
        await HE.canvas.setMode('preview');
        const yPrev = HE.canvas.doc.defaultView.scrollY || 0;
        if (yPrev !== yEdit) throw new Error(`smooth site: preview restore not instant (${yEdit} → ${yPrev})`);
        if (HE.canvas.doc.defaultView.getComputedStyle(HE.canvas.doc.documentElement).scrollBehavior !== 'smooth') {
          throw new Error('smooth site: author scroll-behavior not restored after preview switch');
        }
        await HE.canvas.setMode('edit');
        const yBack = HE.canvas.doc.defaultView.scrollY || 0;
        if (yBack !== yEdit) throw new Error(`smooth site: edit restore not instant (${yEdit} → ${yBack})`);
        if (HE.canvas.doc.defaultView.getComputedStyle(HE.canvas.doc.documentElement).scrollBehavior !== 'smooth') {
          throw new Error('smooth site: author scroll-behavior not restored after edit switch');
        }
        log.push('smooth-scroll mode switch instant ok');
      }

      // --- Task 67/82: Element + Page/SEO Content-only, Site scope owns classes/globals/fonts ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head><title>T</title><link rel="icon" href="images/favicon.svg"></head><body><h1 class="t">Hi</h1></body></html>',
        '.t{display:block}'
      );
      await HE.canvas.setMode('edit');
      HE.setScope('design');
      HE.canvas.select(HE.canvas.doc.querySelector('.t'));
      if (document.querySelector('#panel [data-sec="element"]') || document.querySelector('#panel [data-sec="page"]')) {
        throw new Error('Design panel should not show Element/Page-SEO sections');
      }
      for (const s of ['classes', 'tools', 'globals']) {
        if (document.querySelector(`#panel [data-sec="${s}"]`)) {
          throw new Error(`Design panel should not show Site section ${s}`);
        }
      }
      HE.setScope('site');
      const classesSec = document.querySelector('#panel [data-sec="classes"]');
      if (!classesSec || !classesSec.textContent.includes('Promote inline styles to class')) {
        throw new Error('Site Classes section should own Promote-inline purity tool');
      }
      const globalsSec = document.querySelector('#panel [data-sec="globals"]');
      if (!globalsSec) throw new Error('Site Globals section missing');
      if (!document.querySelector('#panel [data-sec="tools"]')) throw new Error('Site Fonts & privacy section missing');
      HE.setContentMode(true);
      HE.canvas.select(HE.canvas.doc.querySelector('.t'));
      if (!document.querySelector('#panel [data-sec="element"]') || !document.querySelector('#panel [data-sec="page"]') || !document.querySelector('#panel [data-sec="content"]')) {
        throw new Error('Content mode should show Element + Page-SEO + Content sections');
      }
      const contentElText = document.querySelector('#panel [data-sec="element"]').textContent || '';
      if (contentElText.includes('Promote inline') || contentElText.includes('Merge duplicates')) {
        throw new Error('Content Element should hold attributes only, no purity tools');
      }
      if (document.querySelector('#panel [data-sec="page"] .favicon-pick')) {
        throw new Error('favicon should live in Site Globals, not Content Page/SEO');
      }
      HE.setScope('site');
      const globalsOpen = document.querySelector('#panel [data-sec="globals"]');
      globalsOpen.setAttribute('open', '');
      const favPick = globalsOpen.querySelector('.favicon-pick input[type="file"]');
      if (!favPick) throw new Error('favicon file picker missing in Site Globals');
      const favRow = favPick.closest('.favicon-prow');
      if (!favRow || favRow.children.length !== 2 || !favRow.querySelector('.favicon-pick')) {
        throw new Error('favicon Icon row should be label + pick wrapper (no 3-child grid clipping)');
      }
      if (favPick.getBoundingClientRect().width < 40) throw new Error('favicon file button clipped');
      HE.setScope('design');
      log.push('content-only element-seo + site globals favicon layout ok');

      // --- Task 69: Accessibility defaults explainer + undo safety ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head></head><body><button class="tiny">Go</button></body></html>',
        '.tiny{display:inline-block;width:20px;height:20px}'
      );
      await HE.canvas.setMode('edit');
      HE.canvas.select(HE.canvas.doc.querySelector('.tiny'));
      const a11ySec = document.querySelector('#panel [data-sec="accessibility"]');
      if (!a11ySec) throw new Error('accessibility section missing');
      const a11yText = a11ySec.textContent || '';
      if (!/other issues|global defaults do not fix/i.test(a11yText)) {
        throw new Error('accessibility checklist note missing');
      }
      if (!/44px/.test(a11yText)) throw new Error('accessibility 44px warning missing for tiny button');
      if (a11ySec.querySelector('button.a11y-defaults')) {
        throw new Error('global defaults button should live in Site Globals, not Accessibility');
      }
      HE.setScope('site');
      const a11yGlobalsSec = document.querySelector('#panel [data-sec="globals"]');
      if (!a11yGlobalsSec) throw new Error('Site Globals section missing');
      const explainer = a11yGlobalsSec.querySelector('details.a11y-details');
      if (!explainer) throw new Error('accessibility defaults explainer missing');
      if (explainer.open) throw new Error('accessibility explainer should render closed');
      if (!/what will this add/i.test(explainer.querySelector('summary')?.textContent || '')) {
        throw new Error('accessibility explainer summary wrong');
      }
      for (const phrase of ['border-box', 'max-width', 'focus ring', 'reduced motion', 'Undo']) {
        if (!explainer.textContent.includes(phrase)) throw new Error(`accessibility explainer missing: ${phrase}`);
      }
      const defaultsBtn = [...a11yGlobalsSec.querySelectorAll('button')].find((b) => b.textContent.includes('Add safe global defaults'));
      if (!defaultsBtn) throw new Error('accessibility defaults button missing in Site Globals');
      defaultsBtn.click();
      if (HE.sheet.get('*, ::before, ::after', 'box-sizing') !== 'border-box') {
        throw new Error('accessibility defaults did not write box-sizing');
      }
      const focusOutline = HE.sheet.get(':focus-visible', 'outline') || '';
      if (!/2px/i.test(focusOutline) || !/solid/i.test(focusOutline)) {
        throw new Error('accessibility defaults did not write focus-visible :: got=' + focusOutline);
      }
      const cssAfterFirst = HE.sheet.serialize();
      defaultsBtn.click();
      const cssAfterSecond = HE.sheet.serialize();
      if (cssAfterSecond !== cssAfterFirst) {
        throw new Error('accessibility defaults should be idempotent on repeat clicks');
      }
      await HE.undo();
      await HE.undo();
      if (HE.sheet.get('*, ::before, ::after', 'box-sizing')) {
        throw new Error('accessibility defaults should be undoable');
      }
      HE.setScope('design');
      log.push('a11y defaults explainer + undo ok');

      // --- Task 72: self-host Google Fonts (1-click local, GDPR-safe) ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"></head>' +
        '<body><p class="gfont">Hi</p></body></html>',
        '.gfont{font-family: \'Inter\', sans-serif}'
      );
      await HE.canvas.setMode('edit');
      HE.canvas.select(HE.canvas.doc.querySelector('.gfont'));
      HE.setScope('site');
      const toolsSec = document.querySelector('#panel [data-sec="tools"]');
      if (!toolsSec) throw new Error('site tools section missing');
      if (!/make fonts local/i.test(toolsSec.textContent || '')) throw new Error('site tools fonts button missing');
      const whySummary = toolsSec.querySelector('.pset-body details summary');
      if (!whySummary || !/why keep fonts/i.test(whySummary.textContent || '')) {
        throw new Error('site tools benefits explainer missing');
      }
      const whyText = toolsSec.querySelector('.pset-body details')?.textContent || '';
      for (const phrase of ['GDPR', 'offline', 'pinned', 'ad-block']) {
        if (!new RegExp(phrase, 'i').test(whyText)) throw new Error(`site tools explainer missing: ${phrase}`);
      }
      const toolsStatus = toolsSec.querySelector('.site-tools-status');
      if (!toolsStatus || !/inter/i.test(toolsStatus.textContent || '')) {
        throw new Error('site tools status should name the remote font');
      }
      const origFontsIpc = HE.fontsIpc;
      HE.fontsIpc = () => ({
        selfhostFonts: async (families) => {
          if (!families.includes('Inter')) throw new Error('expected Inter requested, got=' + families.join(','));
          return [{
            family: 'Inter',
            entries: [
              { family: 'Inter', weight: '400', style: 'normal', file: 'fonts/inter-400-1.woff2', unicodeRange: 'U+0000-00FF' },
              { family: 'Inter', weight: '700', style: 'normal', file: 'fonts/inter-700-1.woff2', unicodeRange: 'U+0000-00FF' },
            ],
          }];
        },
      });
      try {
        const toolsBtn = [...toolsSec.querySelectorAll('button')].find((b) => /make fonts local/i.test(b.textContent || ''));
        if (!toolsBtn || toolsBtn.disabled) throw new Error('site tools button should be enabled with remote fonts');
        toolsBtn.click();
        let waited = 0;
        while (!/@font-face/i.test(HE.sheet.serialize()) && waited < 60) {
          await new Promise((r) => setTimeout(r, 50));
          waited++;
        }
        const vendoredCss = HE.sheet.serialize();
        if (!/@font-face/i.test(vendoredCss)) throw new Error('selfhost did not write @font-face');
        if (!/fonts\/inter-400-1\.woff2/.test(vendoredCss)) throw new Error('selfhost @font-face missing local file url');
        if (!/font-display:\s*swap/.test(vendoredCss)) throw new Error('selfhost @font-face missing font-display: swap');
        const savedNoGoogle = HE.canvas.serializeDoc();
        if (/fonts\.googleapis\.com/.test(savedNoGoogle)) {
          throw new Error('saved HTML still links Google for a vendored family');
        }
        const again = await HE.actions.selfhostGoogleFonts();
        if (!again.ok || !again.nothing) throw new Error('selfhost should report nothing-to-do on repeat');
        if (HE.sheet.serialize() !== vendoredCss) throw new Error('selfhost repeat changed the stylesheet');
        HE.setScope('design');
        const typoSec = document.querySelector('#panel [data-sec="typography"]');
        const fontToggle = typoSec && typoSec.querySelector('.font-picker-toggle');
        if (!fontToggle) throw new Error('font picker toggle missing');
        fontToggle.click();
        await new Promise((r) => setTimeout(r, 100));
        const pickerHeaders = [...typoSec.querySelectorAll('.font-picker-header')].map((el) => el.textContent || '');
        if (!pickerHeaders.includes('On this site')) throw new Error('font picker missing On-this-site local group');
        await HE.undo();
        if (/@font-face/i.test(HE.sheet.serialize())) throw new Error('selfhost @font-face should be undoable');
      } finally {
        HE.fontsIpc = origFontsIpc;
      }
      log.push('site tools selfhost fonts ok');

      // --- Task 93: unrecognized Google fonts survive Preview + Save ---
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head>' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..700&display=swap">' +
        '</head><body><p class="unknown-font">Hi</p></body></html>',
        '.unknown-font{font-family: \'Fraunces\', serif}'
      );
      const unknownLink = [...HE.canvas.doc.querySelectorAll('link')]
        .find((l) => /fonts\.googleapis\.com\/css2\?family=Fraunces/.test(l.getAttribute('href') || ''));
      if (!unknownLink) throw new Error('unknown Google font link was stripped from the page');
      const unknownSaved = HE.canvas.serializeDoc();
      if (!/fonts\.googleapis\.com\/css2\?family=Fraunces/.test(unknownSaved)) {
        throw new Error('unknown Google font link was dropped on save');
      }
      // Managed families still round-trip in the editor's clean 300-700 form.
      await HE.canvas.loadPage(
        '<!DOCTYPE html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"></head>' +
        '<body><p class="known-font">Hi</p></body></html>',
        '.known-font{font-family: \'Inter\', sans-serif}'
      );
      const knownSaved = HE.canvas.serializeDoc();
      if (!/fonts\.googleapis\.com\/css2\?family=Inter:wght@300;400;500;600;700&display=swap/.test(knownSaved)) {
        throw new Error('managed Google font link did not round-trip: ' + knownSaved.slice(0, 400));
      }
      log.push('google font link preservation ok');

      // --- Versions store roundtrip (main-process IPC, disposable test data) ---
      const demoDir = await window.he.demoPath();
      const vsnap = await window.he.versions.snapshot({
        dir: demoDir, label: 'smoke', page: 'index.html', cssFile: 'styles.css',
        html: '<p>smoke-version</p>', css: '.smoke{color:red}',
      });
      const vlist = await window.he.versions.list(demoDir);
      if (!vlist.versions.some((v) => v.id === vsnap.id)) throw new Error('version missing from list');
      const vgot = await window.he.versions.get(demoDir, vsnap.id);
      if (vgot.html !== '<p>smoke-version</p>' || vgot.css !== '.smoke{color:red}') {
        throw new Error('version content mismatch');
      }
      const vmeta = vlist.versions.find((v) => v.id === vsnap.id);
      if (vmeta && (vmeta.html || vmeta.css)) {
        throw new Error('version list leaked full content into meta');
      }
      await window.he.versions.createBranch(demoDir, 'smoke-branch');
      const vsw = await window.he.versions.switchBranch(demoDir, 'smoke-branch');
      if (vsw.currentBranch !== 'smoke-branch') throw new Error('branch switch failed');
      await window.he.versions.switchBranch(demoDir, 'main');
      log.push('versions ok');

      return 'SMOKE OK :: ' + log.join(' | ');
    } catch (err) {
      return 'SMOKE FAIL :: ' + err.message + ' :: ' + log.join(' | ');
    }
  },
};
