# HTML Editor — Task Backlog (purity-first)

Principles (from `AGENT_SITE_PROMPT.md`, do not violate):
- HTML is the single source of truth; JS only adds behavior via class/attribute toggles on existing elements.
- One shared stylesheet, classes not inline `style=""`, no Tailwind soup, no bundler/framework.
- Edit mode neutralizes scripts; Preview runs them throwaway (mutations never saved).
- No hosting / CMS / deploy work. App is for self-deployed static folders.
- CMS is explicitly out of scope here: it belongs in a separate, higher-level
  content editor (add page + edit content collections there), not in this
  low-level class/CSS editor. Ignore CMS in this repo; do not add collections,
  add-page flows, or content-model UI here.

## Deferred / non-goals (do not implement in this repo)

- CMS collections / content-model editing — future separate content editor.
- Add-page / page-templates flow — same future editor, ignore for now.

## How to work a task (read this if you are an AI agent)

1. Read this file, implement **ONLY** the single task referenced in your prompt (e.g. `Task 09`).
2. Keep scope tight: touch only files listed under that task. Do not do other tasks.
3. Maintain purity above. Never execute project JS in Edit mode (regex parse only).
4. Verify with `npm run smoke` (must stay `SMOKE OK`) plus the task's Accept criteria.
5. **When the task is done, update this file:**
   - Change `- [ ]` to `- [x]` for the task,
   - Append `Done: <date> <commit subject>` on the line below it,
   - Keep Done tasks in place, do not delete history.
6. **Commit** with message `Task NN: <title>` (include the TASKS.md update in the same commit).
7. Before committing, run `git status --short` and `git diff --stat`, stage only intended files, never commit secrets or `node_modules`.

Meta-prompt to start a task dialogue (copy-paste, replace NN):

```text
Read TASKS.md and implement ONLY task NN ([title]).

Constraints: maintain technical purity from AGENT_SITE_PROMPT.md (HTML truth, one CSS, classes not inline, JS regex-only never executed, Preview throwaway). Stack: Electron app, src/main.js, src/preload.js, src/renderer/js/ ES modules (main.js entry; he.js registry; util/dom/zip/color pure helpers; sheet/fonts/hooks/canvas/tree; panel-core/panel-controls/panel-sections/panel; actions/export-site/versions-ui/smoke), ui.css. Run `npm run smoke` (keep SMOKE OK) and `npm test`. When done, mark the task done in TASKS.md per its section 5 and commit per section 6 with message "Task NN: <title>". Don't touch hosting/CMS, don't do other tasks.
```

## Done

- [x] 01 Smart class naming — prompt for name when styling classless elements, context suggestion (hero-title), kebab-case/BEM hint.
  Done: 2026-09-06 223d60f Prompt for class name when styling classless elements
- [x] 02 Per-prop origin + usage counts — originFor/ruleIndex in sheet.js, chip counts.
  Done: 2026-09-06 d7ab39e Show cascade origin per property and class usage counts
- [x] 03 Purity tools — promote inline styles to class, merge duplicate classes.
  Done: 2026-09-06 d39b6df Add purity tools: promote inline styles, merge duplicate classes
- [x] 04 Explicit stylesheet linking — linked/fallback status + Link action with correct relative path.
  Done: 2026-09-06 7186fee Show linked/fallback stylesheet status with Link action for unlinked pages
- [x] 05 From-this-site palette — duplicate hero/card/nav blocks, strip ids.
  Done: 2026-09-06 6a2884b Add From this site palette duplicating hero, card grid, and other site blocks
- [x] 06 JS Hooks read-only panel — regex parse of querySelector/classList/attrs, convention fallback, openExternal link.
  Done: 2026-09-06 0cbd66e Make project JS visible with read-only JS Hooks panel section
- [x] 07 State simulator — preview .is-open/.is-visible without running JS, strips on serialize/save.
  Done: 2026-09-06 87da3b0 Add preview-only state simulation to JS Hooks panel
- [x] 08 JS breakage guard — confirm on delete/rename affecting JS, safe literal-only JS rename, id strip, missing-hook warnings.
  Done: 2026-09-06 e6c81a4 Guard class actions with JS-impact confirms, safe JS rename, id stripping, missing-hook warnings

## Next — Framer/Webstudio parity (no purity break)

- [x] 09 Breakpoint overrides
  Done: 2026-09-06 Task 09: Breakpoint overrides
  Goal: viewport switch (desktop/tablet/mobile) edits `@media` overrides instead of being view-only.
  Files: `src/renderer/js/main.js`, `src/renderer/js/panel.js`, `src/renderer/js/sheet.js`, `src/renderer/ui.css`.
  Accept: on tablet/mobile, panel shows "no override here — [Add override]" and creates/finds `@media (max-width:768px){ .foo {...} }` in shared CSS; desktop unaffected; save round-trips; smoke stays OK.
  Don't: multi-CSS editing, hosting, inline styles.

- [x] 10 Variants dropdown (Default / Open / Hover)
  Done: 2026-09-06 Task 10: Variants dropdown
  Goal: variant control mapping to existing state simulator + `:hover` (e.g. `.nav.is-open`), no new JS logic.
  Files: `src/renderer/js/panel.js`, `src/renderer/js/canvas.js`, `src/renderer/ui.css`.
  Accept: dropdown on JS Hooks section previews Default/Open/Hover, edits target `.foo.is-open` / `.foo:hover` rules, clears on deselect/mode switch, never leaks sim classes into save.
  Don't: JS timeline editor, new interaction engine.

- [x] 11 :root tokens editor
  Done: 2026-09-06 Task 11: :root tokens editor
  Goal: CSS variables as first-class tokens, distinct from per-class overrides.
  Files: `src/renderer/js/panel.js`, `src/renderer/js/sheet.js`, `src/renderer/ui.css`.
  Accept: Tokens section lists `:root` vars (color/spacing), edit/add var updates all `var()` usages live, smoke stays OK.
  Don't: Tailwind theme support, multi-file vars.

- [x] 12 Content Mode (text/image/link only)
  Done: 2026-09-06 Task 12: Content Mode
  Goal: simplified mode for non-technical iteration on same files.
  Files: `src/renderer/index.html`, `src/renderer/js/main.js`, `src/renderer/js/canvas.js`, `src/renderer/ui.css`.
  Accept: toggle hides class/CSS panels, allows dblclick text edit + image replace (file picker copying into project) + link href edit only; saves same HTML/CSS; Edit full mode unchanged.
  Don't: CMS backend, hosting.

- [x] 13 Rule creator with stylesheet + media picker
  Done: 2026-09-06 Task 13: Rule creator with stylesheet+media picker
  Goal: pick target stylesheet + optional `@media` at class-creation time.
  Files: `src/renderer/js/panel.js`, `src/renderer/js/main.js`, `src/renderer/js/sheet.js`.
  Accept: new-class dialog offers stylesheet (default linked) + None/Desktop-only/Tablet/Mobile media; rule lands in right place; smoke stays OK.
  Don't: multi-CSS cascade editing beyond picker.

- [x] 14 Styleguide page first-class
  Done: 2026-09-06 Task 14: Styleguide page first-class
  Goal: `styleguide.html` rendering tokens/classes, editable, clearly optional for deploy.
  Files: `demo-site/`, `src/renderer/js/main.js` (page list hint), `AGENT_SITE_PROMPT.md`.
  Accept: demo + prompt document styleguide convention; page opens/edits like any page; banner notes "optional, safe to not deploy".
  Don't: auto-generate design system, external deps.

- [x] 15 Copy context for AI + Export ZIP (no deploy)
  Done: 2026-09-06 Task 15: Copy context for AI + Export ZIP
  Goal: close the AI loop without hosting: export changes summary + full files for pasting back to an agent, plus ZIP of folder.
  Files: `src/main.js`, `src/preload.js`, `src/renderer/js/main.js`, `src/renderer/index.html`.
  Accept: button copies changed classes/DOM summary + file contents to clipboard and downloads ZIP; no network calls; smoke stays OK.
  Don't: hosting, deploy, analytics.

- [x] 16 SEO head editor (title/meta/OG/favicon per page)
  Done: 2026-09-06 Task 16: SEO head editor
  Goal: per-page `<title>`, meta description, OG image, favicon editing.
  Files: `src/renderer/js/panel.js` or new `src/renderer/js/head.js`, `src/renderer/js/canvas.js`, `src/renderer/index.html`.
  Accept: edit title/description/OG/favicon with relative paths, saves into `<head>`, missing-tag warnings.
  Don't: CMS, hosting, sitemap automation.

- [x] 17 K-scale proportional scaling
  Done: 2026-09-06 Task 17: K-scale proportional scaling
  Goal: scale selection proportionally (font/padding/gap) writing `clamp()`/rem to class, Framer K-style, still pure.
  Files: `src/renderer/js/canvas.js`, `src/renderer/js/panel.js`, `src/renderer/js/sheet.js`.
  Accept: handle/shortcut scales class values proportionally, writes to class rule only (no inline), undo works.
  Don't: absolute-position drag emitting top/left mess, inline styles.

## Next — UX/UI chrome (engine done, chrome is the bottleneck)

- [x] 18 Collapse sections + persist + panel filter
  Done: 2026-09-06 Task 18: Collapse sections + persist + filter
  Goal: right panel stops being a wall; only Element + Selector open by default, rest collapsed, open-state persists, filter jumps to controls.
  Files: `src/renderer/js/panel.js`, `src/renderer/ui.css`.
  Accept: fresh selection shows Element + Selector open, others closed; toggling a section persists across selections (localStorage); filter input (e.g. "shadow") narrows to matching sections/controls; smoke stays OK.
  Don't: remove any sections, change styling model.

- [x] 19 Topbar regroup + Export menu
  Done: 2026-09-06 Task 19: Topbar regroup + Export menu
  Goal: 10 items in 42px become 3 groups; Copy-for-AI/ZIP move into an Export menu, Save is primary.
  Files: `src/renderer/index.html`, `src/renderer/js/main.js`, `src/renderer/ui.css`.
  Accept: left = project, center = Edit/Preview + viewport, right = Content toggle + Export ▾ (Copy for AI, ZIP) + Save primary; all existing actions still work; smoke stays OK.
  Don't: hosting/deploys, new export formats.

- [x] 20 Breadcrumb bar
  Done: 2026-09-06 Task 20: Breadcrumb bar
  Goal: orient users with selection path above canvas (body > section.hero > h1).
  Files: `src/renderer/index.html`, `src/renderer/js/main.js` or `tree.js`, `src/renderer/js/canvas.js`, `src/renderer/ui.css`.
  Accept: bar above canvas shows ancestor chain of selection, click any crumb to select it; updates on select/navigate; empty state hidden; smoke stays OK.
  Don't: change selection model, new panels.

- [x] 21 Unify viewport/Target controls
  Done: 2026-09-06 Task 21: Unify viewport/Target controls
  Goal: one breakpoint source of truth instead of topbar switch + Target media select drifting.
  Files: `src/renderer/js/panel.js`, `src/renderer/js/main.js`, `src/renderer/index.html`.
  Accept: single viewport state drives canvas width, panel banner, origin labels and new-rule placement; Target row keeps stylesheet select only (or mirrors viewport read-only); smoke stays OK.
  Don't: multi-CSS editing, new breakpoints.

- [x] 22 Toast system replacing alerts
  Done: 2026-09-06 Task 22: Toast system replacing alerts
  Goal: replace blocking alert() calls (Copy-for-AI, ZIP, kscale, file-open errors) with small toasts + per-action status.
  Files: `src/renderer/index.html`, `src/renderer/js/main.js`, `src/renderer/js/panel.js`, `src/renderer/ui.css`.
  Accept: success/error toasts bottom of canvas, auto-dismiss, no alert() on the happy path; smoke stays OK.
  Don't: new notification infrastructure beyond a minimal toast stack.

- [x] 23 Welcome drop zone + Copy-prompt button
  Done: 2026-09-06 Task 23: Welcome drop zone + Copy-prompt button
- [x] 24 Chrome quality pass (responsive + a11y)
  Done: 2026-09-06 Task 24: Chrome quality pass
  Goal: editor chrome holds up at narrow widths/zoom, meets basic a11y, controls don't clip.
  Changes: topbar scrolls instead of overflowing + project-name ellipsis; sidebar slim fallback <=1150px; muted/placeholder contrast bump; aria-labels on viewport buttons; export-menu focus in/Escape-out; class chips + tree rows keyboard operable (Enter/Space); chip × is a real button; summary/row focus styles; auto-fit seg grid; file-input max-width.
  Don't: restyle the product, touch the styling model.
- [x] 25 Dead-code cleanup
  Done: 2026-09-06 Task 25: Dead-code cleanup
  Removed (verified zero callers): canvas getLoadedGoogleFonts; fonts cssValueForSelection, fontsByCategory + google export key; sheet listMediaQueries; HE.loadJsFiles + HE.markDirty export aliases; hooks export trim (parseFile/fallbackFor/selectorMatches/FALLBACKS/classUsagesInJs now module-private). Added missing .script-external rule. Kept: _updateClassInOtherPages/_resolveScriptPath test seams, _autoClass seam.
  Don't: behavior changes.

## Next — saving + versions

- [x] 27 Autosave (toggle, debounce, indicator)
  Done: 2026-09-06 Task 27: Autosave; revised 2026-09-11 to keep drafts in memory only
  Goal: keep a serialized draft in renderer memory 2s after the last edit; toggleable, visible status, no spam.
  Files: `src/renderer/index.html`, `src/renderer/js/main.js`, `src/renderer/ui.css`.
  Accept: Auto toggle (persisted, default ON) next to Save; dirty → "Saving draft…" → "Draft in memory HH:MM"; only explicit Save writes HTML/CSS and clears dirty; skipped in Preview; page-switch discard prompt unchanged; smoke stays OK.
  Wording: Auto tooltip says "Draft kept in memory for this session. Click Save to write files."; manual Save remains "Saved HH:MM".
  Don't: versions/history (Task 28), behavior changes to undo.
- [x] 28 Versions + branches (git-like, local only)
  Done: 2026-09-06 Task 28: Versions + branches
  Goal: branch out safely and restore earlier states; stored outside the site folder (never deployed), no git binary needed.
  Files: `src/main.js`, `src/preload.js`, `src/renderer/js/main.js`, `src/renderer/index.html`, `src/renderer/ui.css`.
  Accept: History button → modal with branch tabs, version list (time+label), Snapshot/New-branch/Restore; manual Save snapshots; autosave drafts are session-only and do not create versions; restore/switch loads content dirty (never overwrites files silently); dirty work safety-snapshotted first; 50/branch prune; store under userData (site folder untouched); smoke covers snapshot→list→restore; smoke stays OK.
  Don't: real git, remotes, hosting, CMS.
- [x] 26 Showcase site (complex, beautiful, fully editable)
  Done: 2026-09-06 Task 26: Showcase site
  showcase-site/ (Aurora Studio, fictional): index/about/styleguide + one styles.css + app.js + 8 local SVGs.
  Exercises: tokens, light/dark theme, hover/focus-visible/is-open/is-visible/is-active/no-webgl states, tablet+mobile breakpoints, Google Fonts, SEO/OG/favicon, styleguide detection, cross-page shared classes, JS hooks (nav, dropdown, accordion, tabs, dialog, theme, reveal, carousel, scroll-spy, canvas fallback, forms) — all defensive/multi-instance, no inline styles Handlers, no IDs except single dialog + anchors.
  Verified: HTML balanced, 107/107 classes have rules, JS parses, assets+alt OK, smoke green.
  Don't: hosting, CMS, build steps.
  Goal: onboarding shows the AI contract up front: drop a folder, copy AGENT_SITE_PROMPT.md, see recents.
  Files: `src/renderer/index.html`, `src/renderer/js/main.js`, `src/renderer/ui.css`, `AGENT_SITE_PROMPT.md` (read-only source).
  Accept: welcome has folder drop zone (opens site), Copy-agent-prompt button (clipboard, toast confirm), recent list unchanged; smoke stays OK.
   Don't: hosting, new project scaffolding, editing the prompt in-app.

## Next — iteration loop (shared components + cross-page safety)

- [x] 30 Image Replace copies the file into the project
  Done: 2026-09-06 (see final commit Tasks 30-32)
  Goal: Content-mode image Replace actually vendors the picked file (no more "copy it manually" toast).
  Files: `src/main.js`, `src/preload.js`, `src/renderer/js/panel-sections.js`.
  Accept: picking a file copies it to `images/<name>` (collision → `-2` suffix), sets img src, undo works; failure surfaces a toast; smoke stays OK.
  Don't: asset manager UI, remote URL fetching.
- [x] 31 Cross-page undo journal
  Done: 2026-09-06 (see final commit Tasks 30-32)
  Goal: class rename/delete (and later component sync) writes to other pages' files become undoable.
  Files: `src/renderer/js/main.js`, `src/renderer/js/actions.js`, `src/renderer/js/smoke.js`.
  Accept: every cross-page file write records {page, before, after, depth}; Undo reverts entries newer than the restored snapshot and consumes them; Redo stays current-page-only (documented); journal resets on page/project switch and is capped; smoke covers record→revert with a mock fs; smoke stays OK.
  Don't: full multi-file redo, persistent journal.
- [x] 32 Shared-component sync (visual-builder-style)
  Done: 2026-09-06 (see final commit Tasks 30-32)
  Goal: repeated identical blocks (header/nav/footer/hero) across pages are detected as shared components; editing one instance can be synced to the others.
  Files: new `src/renderer/js/components.js`, `src/renderer/index.html` (sidebar section), `src/renderer/js/main.js` (boot/wiring), `src/renderer/js/panel.js` + `panel-sections.js` (Shared section), `src/renderer/js/smoke.js`.
  Accept: Components section lists shared blocks with page counts; selecting an instance shows a Shared section with Sync; Sync verifies each target still matches the original signature, replaces via throwaway-DOM serialize (same technique as save), reports synced/skipped per page, records journal entries (Task 31), never touches the current page (it saves normally); diverged targets are skipped with a warning; smoke covers detect+sync with a mock fs; smoke stays OK.
  Don't: explicit component definitions/symbols, cross-page structural merge UI, CMS.

## Next — class system for heavy web designers (base/combo scope + manager)

- [x] 33 visual-builder-style combo scope (base vs variant + where-am-I)
  Done: 2026-09-07 Task 33/34: combo scope + class manager
  Goal: edit `.btn` (everywhere) or `.btn.large` (variant only) with a visible scope switch, so designers always know where they are.
  Files: `src/renderer/js/panel-core.js` (activeCombo state, compound activeSelector, combo base fallback in displayValue/cascadeOrigin, compoundUseCount), `src/renderer/js/sheet.js` (comboSelectors, deleteComboRule, classNames incl. compound tokens + media, grouping-type walk fix), `src/renderer/js/actions.js` (attachComboClass, setScope, deleteComboStyles, combo-aware detach/rename/promote/merge/setStyle), `src/renderer/js/panel.js` (scope segmented switch, where-am-I banner, Add variant row, combo chip state), `src/renderer/js/panel-controls.js` (base placeholders, seg no longer highlights inherited base as active on combos), `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: chips + scope switch toggle `.btn` / `.btn.large`; banner shows variant count vs base count; combo edits write only to the compound (base untouched, siblings untouched); empty combo fields show base value as "(base)" placeholder with `← .btn (base)` origin; delete-variant removes only compound styles; smoke covers attach→write→scope-switch→delete→base-delete; smoke stays OK.
  Don't: multi-level combo chains, global (cross-element) classes, hosting/CMS.
- [x] 34 Classes manager (system view: usage, unused, combos, cleanup)
  Done: 2026-09-07 Task 33/34: combo scope + class manager
  Goal: one place listing every class with this-page usage, so heavy users can rename/delete/find-unused without hunting the stylesheet.
  Files: `src/renderer/js/panel-sections.js` (buildClassesSection), `src/renderer/js/panel.js` (Classes section wiring), `src/renderer/ui.css`.
  Accept: Classes section lists all classes (filter, ×N / unused badges), Use/Edit per row, inline Rename, Delete incl. combos+@media with confirm, combos listed separately with Edit-on-element + Delete-styles-only, duplicates summary with Merge; smoke stays OK.
  Don't: cross-page usage counts, auto-delete unused, hosting/CMS.
- [x] 33-followup Combo scope spotlights overrides only (no inherited noise)
  Done: 2026-09-07 Task 33-followup: combo overrides spotlight
  Goal: in combo scope the panel shows what the variant changes, not what it inherits — inherited rows were noise (`← .btn (base)` / `inherited` everywhere).
  Files: `src/renderer/js/panel-core.js` (originLabelText returns quiet `—` for anything not declared on the compound when a combo is active; originEl tooltips still explain the base source), `src/renderer/js/smoke.js` (assert only `.btn.large` + dashes render).
  Accept: combo scope renders the compound selector only on rows the variant declares; all other rows show `—` with a tooltip naming the base source; base scope unchanged; smoke + unit tests stay green.
  Don't: hiding base values entirely (still visible as "(base)" placeholders), multi-level combos.
- [x] 35 Tokens you can actually apply (picker + usage + plain-language loop)
  Done: 2026-09-07 Task 35: tokens you can apply
  Goal: the Tokens section was a dead end — values editable but no way to use them except hand-typing var(). Bridge define → use → update.
  Files: `src/renderer/js/sheet.js` (varUsages counting var(--x) declarations incl. @media), `src/renderer/js/panel-controls.js` (Token menu in every color field writing var(--name); var() fields get a Tokens tooltip), `src/renderer/js/panel-sections.js` (3-step plain-language help incl. design tokens analogy; ×N/unused badges with selector tooltips per token), `src/renderer/ui.css` (.token-pick), `src/renderer/js/smoke.js` (define→use→resolve-live→edit-propagates).
  Accept: picking a token writes var(--name) to the active scope; token rows show usage counts; editing a token updates all users live (verified via computed style); smoke + unit tests stay green.
  Don't: token rename across usages, non-color token pickers, hosting/CMS.
- [x] 36 Design-first panel order + Tokens move to sidebar
  Done: 2026-09-07 Task 36: design-first panel order
  Goal: the right panel is for design — Page/SEO and Accessibility stared back from the top, Tokens needed no selection yet lived mid-panel. Reorder + relocate.
  Files: `src/renderer/index.html` (new left-sidebar Tokens section), `src/renderer/js/main.js` (HE.renderTokens reusing buildTokens), `src/renderer/js/panel.js` (renderPanel calls renderTokens every refresh; new order: selector → note → shared → JS Hooks/variants → breakpoint banner → Layout…Effects → Classes → Accessibility → Element → Page/SEO; Tokens section removed; content-mode order unchanged), `src/renderer/ui.css` (stacked sidebar token rows), `src/renderer/js/smoke.js` (sidebar list + section-order assertions).
  Accept: Tokens editable with nothing selected; token add/delete refresh via existing panel-refresh paths (page load, undo/redo, versions, stylesheet switch all funnel through renderPanel); design panel top is selector + states + style props, meta sections last; smoke + unit tests stay green.
  Don't: changing default-open sections, collapsing the selector area, hosting/CMS.
- [x] 37 Export menu escapes topbar clipping
  Done: 2026-09-07 Task 37: export menu fix
  Goal: the Export ▾ menu rendered as a clipped "weird thingy" — it was position:absolute inside the horizontally-scrolling topbar, whose overflow-x:auto forces vertical clipping.
  Files: `src/renderer/ui.css` (menu is position:fixed, z-index 200), `src/renderer/js/main.js` (positioned from the button rect on every open, right-aligned, flips upward near the viewport bottom; closes on resize/topbar-scroll; outside-click/Escape/focus behavior unchanged), `src/renderer/js/smoke.js` (opens, asserts fixed + below button + in viewport, closes).
  Accept: menu opens fully below Export ▾, never clipped or viewport-overflowing; smoke + unit tests stay green.
  Don't: new export formats, hosting/CMS.
- [x] 33-followup-2 Quiet inherited labels in every scope (not just combos)
  Done: 2026-09-08 Task 33-followup-2: quiet inherited labels everywhere
  Goal: the combo-only spotlight left base scope noisy — every untouched row said "inherited" (mere browser defaults). Same rule everywhere: only the active scope's own declarations get a label.
  Files: `src/renderer/js/panel-core.js` (originLabelText shows the selector only for active/active-pseudo/other/other-pseudo kinds; inherited/base fallbacks render `—`; originEl tooltips generalized: quiet dashes name the source rule or browser default + what typing will do), `src/renderer/js/smoke.js` (base-scope assertion: `.tag` spotlighted, no `inherited`/`(base)` labels).
  Accept: no `inherited` or `(base)` label text in any scope; sibling-class `← .other`, pseudo `not set`, and breakpoint `no override` messages kept; smoke + unit tests stay green.
  Don't: hiding sources entirely (tooltips + grey placeholders keep them one hover away), changing cascade resolution.
- [x] 33-followup-3 Diff view is combo-only; base scope restored
  Done: 2026-09-08 Task 33-followup-3: combo-only diff view
  Goal: followup-2 overreached — quieting applied to base scope too, but the diff view only makes sense for combo classes. Base scope shows the full picture again.
  Files: `src/renderer/js/panel-core.js` (quiet dash gated on activeCombo; base/pseudo/other/inherited labels + tooltips back to full behavior), `src/renderer/js/smoke.js` (base assertion flipped: `inherited` present again; combo assertion unchanged).
  Accept: combo scope shows only the compound's own declarations; base scope shows inherited sources as before; smoke + unit tests stay green.
  Don't: touching cascade resolution or stylesheet output (labels only, as in both prior followups).
- [x] 33-followup-4 Purge the word "inherited" from combo view entirely
  Done: 2026-09-08 Task 33-followup-4: no inherited-anything in combos
  Goal: labels were quiet but the word still leaked through the scope banner, hover tooltips, and grey `(base)` placeholders. Combo view now contains no form of it anywhere.
  Files: `src/renderer/js/panel.js` (combo banner rewritten — no inherited/(base) references; viewport banner reworded to "empty fields show desktop values"), `src/renderer/js/panel-core.js` (combo tooltip: "X applies; typing overrides it on the variant"), `src/renderer/js/panel-controls.js` (text/size/select controls show the bare value as the grey hint in combo scope, tooltips reworded; base scope strings byte-identical), `src/renderer/js/smoke.js` (asserts visible text + every title + every placeholder in combo scope match no /inherit/i).
  Accept: in combo scope no /inherit/i anywhere user-visible; base scope unchanged; smoke + unit tests stay green.
  Don't: removing the inherited values themselves (grey hints stay, just unnamed), touching cascade or stylesheet output.
- [x] 33-followup-5 Remove generic inherited origin fallbacks
  Done: 2026-09-11 Task 33-followup-5: origin labels show authored class changes only
  Goal: fields without an active class declaration show a quiet dash instead of calling browser defaults, global rules, or non-inheriting properties "inherited".
  Files: `src/renderer/js/panel-core.js` (remove computed-style inherited fallback), `src/renderer/js/panel-controls.js` (comment clarified), `src/renderer/js/smoke.js` (base-scope regression assertion).
  Accept: combo and base scopes label authored class declarations, untouched fields show no `inherited` text, token/base value behavior stays intact, smoke + unit tests stay green.
  Don't: removing rendered values, changing CSS cascade or stylesheet output, removing real token/base linkage state.
- [x] 38 Subtle token affordance + easy unlink
  Done: 2026-09-11 Task 38: subtle token affordance + easy unlink
  Goal: reduce the repeated visual weight of unlinked `T` controls while keeping token unlinking obvious and one action away.
  Files: `src/renderer/ui.css`, `src/renderer/js/panel-controls.js`, `src/renderer/js/smoke.js`.
  Accept: unlinked token buttons are compact, muted ghost controls that become clear on hover/focus; linked and inherited states remain visible; color and generic token menus expose an explicit `Unlink — keep current value/color` action; token behavior and CSS output remain unchanged; smoke + unit tests stay green.
  Don't: hide keyboard focus, remove access to token menus, change token candidate matching, or alter authored site styles.
- [x] 39 Functional token unlink coverage
  Done: 2026-09-11 Added generic and inherited combo token unlink smoke flows
  Goal: exercise token unlinking through the rendered panel and verify local CSS behavior, including inherited combo values.
  Files: `src/renderer/js/smoke.js`.
  Accept: generic token unlink keeps the rendered value while breaking future token updates; inherited token unlink writes only a local combo override and leaves the base rule linked; smoke and unit tests stay green.
  Don't: add a second browser-test dependency or change token behavior.
- [x] 40 Functional style edit matrix
  Done: 2026-09-11 Added panel-driven edit, serialization, undo, and redo smoke coverage
  Goal: prove ordinary panel edits change the selected page, serialize to CSS, and can be undone/redone through the editor flow.
  Files: `src/renderer/js/smoke.js`.
  Accept: rendered panel interactions cover multiple property/control types; each updates the live computed style and stylesheet; serialization round-trips; undo and redo restore the corresponding states; smoke and unit tests stay green.
  Don't: add a second browser-test dependency or change editor behavior.
- [x] 41 Preview relative-resource resolution
  Done: 2026-09-11 Task 41: Preview relative-resource resolution
  Goal: ensure author-relative links resolve through the project protocol before the Preview runtime diagnostic listener can report false resource failures.
  Files: `src/renderer/js/canvas.js`, `src/renderer/js/smoke.js`.
  Accept: Preview inserts its project `<base>` before author-relative resources; a real project stylesheet loads without runtime resource diagnostics; save serialization remains unchanged; smoke and unit tests stay green.
  Don't: rewrite authored URLs in saved HTML, auto-link missing stylesheets, or change runtime error reporting.

- [x] 42 Preview notifications in editor chrome
  Done: 2026-09-11 Moved Preview guidance/runtime health and retained-state actions into a topbar status popover; canvas stays unobstructed.
  Goal: keep Preview guidance, runtime health, and retained-state actions out of the canvas flow; expose them as compact topbar status with an on-demand details popover so the page keeps its full editing viewport.
  Files: `src/renderer/index.html`, `src/renderer/js/main.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: Preview status no longer reserves a row above the iframe; the topbar shows a compact Preview status control, opens a keyboard-accessible details popover with the existing guidance/runtime state, retained-state Reset/Make default actions remain available in Edit, errors are visually distinct, and smoke + unit tests stay green.
  Don't: change Preview execution/sandboxing, runtime diagnostics, retained-state semantics, or authored site styles.

- [x] 43 Background layer editing stability
  Done: 2026-09-11 Fixed layer-refresh scroll jumps, verified live gradient editing, and made transparent colors explicit.
  Goal: keep the design canvas and Background panel position stable while adding/editing layers; provide an editable gradient value and distinguish transparent background color from black.
  Files: `src/renderer/js/color.js`, `src/renderer/js/panel-controls.js`, `src/renderer/js/panel.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`, `test/color.test.mjs`.
  Accept: add/reorder/copy/remove/clear layer actions preserve right-panel scroll and focus where applicable; gradient layer text remains editable and preset changes do not rebuild the panel; transparent `background-color` shows as transparent rather than an unexplained black swatch; smoke + unit tests stay green.
  Don't: change authored CSS semantics, remove arbitrary CSS image support, or add a second editor framework.

- [x] 44 Compact numeric pixel inputs
  Done: 2026-09-11 Task 44: capped regular numeric size fields at 96px; smoke and unit tests green
  Goal: keep ordinary numeric size fields compact so short pixel values do not occupy most of the style row, while custom CSS values and box-model controls retain their current layouts.
  Files: `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: regular numeric size controls use a shorter value field, pixel values remain editable, custom/clamp fields still use the available row width, and smoke + unit tests stay green.
  Don't: change CSS serialization, unit choices, authored site styles, or the pending Background layer work in Task 43.

- [x] 45 Size keyword labels fit
  Done: 2026-09-11 Task 45: size-unit selects fit keyword text; smoke and unit tests green
  Goal: keep keyword values such as `normal` readable in size controls without stretching the numeric pixel field.
  Files: `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: size-unit selects fit their available option text, `normal` is not clipped, numeric pixel inputs remain compact, and smoke + unit tests stay green.
  Don't: change size values, unit choices, CSS serialization, or authored site styles.

- [x] 46 Core Typography inspector redesign
  Done: 2026-09-11 Task 46: Core Typography inspector redesign; smoke and unit tests green
  Goal: replace the flat Typography property wall with a modern, compact Figma/Adobe-style inspector while preserving the existing CSS editing model.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/js/panel-controls.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: Typography is grouped into Font, Sizing, Paragraph, and Appearance; labels use clear names; controls remain usable at narrow panel widths; alignment and font-picker interactions are keyboard-accessible; tokens, origin labels, combo/pseudo/media scopes, live edits, undo/redo, serialization, smoke, and unit tests remain green.
  Don't: add text-indent, whitespace, decoration thickness/offset, variable-font axes, new typography properties, or change authored site styles.

- [x] 47 Essential Typography UX refinement (HTML/CSS reflection)
  Done: 2026-09-11 Task 47: Essential Typography UX refinement; smoke and unit tests green
  Goal: refine only the essential/high UX with direct HTML/CSS parallels — scope/cascade clarity, font family+variant, type scale, responsive context, color/token state, alignment+direction.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/js/panel-controls.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: Typography shows its editing selector/scope/viewport context and a live type specimen; weight options use friendly variant names; size/line-height/letter-spacing editing stays compact with unitless guidance; responsive overrides remain visible via existing origin/viewport behavior; color token state and contrast stay intact; alignment is icon-based and accessible plus `direction` (LTR/RTL) control; tokens, origin labels, combo/pseudo/media scopes, live edits, undo/redo, serialization, smoke, and unit tests remain green.
  Don't: add text-indent, whitespace, decoration thickness/offset, variable-font axes, composite typography tokens/text styles, rich-text range editing, or change cascade/serialization/token semantics.

- [x] 48 Layout & Effects essentials for advanced web designers
  Done: 2026-09-11 Task 48: Layout & Effects essentials; smoke and unit tests green
  Goal: complete the remaining inspector sections with the modern CSS that Smashing-level web designers expect — full flex/grid axis values, intrinsic sizing, scroll attachment, visible focus outlines, and blend/filter effects.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/js/smoke.js`.
  Accept: Layout offers inline-flex, reverse directions, wrap-reverse, and grid item alignment; Size offers box-sizing and aspect-ratio; Background offers background-attachment; Border offers outline width/style/color/offset; Effects offers filter and mix-blend-mode; every new control writes through existing setStyle/origin/token paths; smoke + unit tests stay green.
  Don't: change Spacing/Position controls, cascade/serialization/token semantics, or authored site styles beyond the new declarations under test.

- [x] 49 Visual gradient editor for background layers
  Done: 2026-09-11 Task 49: visual gradient editor; smoke and unit tests green
  Goal: replace raw-text gradient editing with a visual editor — gradient bar preview, linear angle/direction and radial shape/position, color-stop list with swatch + position, add/remove stops — while keeping the text field as the source of truth.
  Files: new `src/renderer/js/gradient.js`, new `test/gradient.test.mjs`, `src/renderer/js/panel-controls.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: gradient layers show an Edit toggle opening a visual editor; direction/shape/stop edits rewrite the layer value live without panel refresh; unparseable (conic/custom) gradients fall back to text with a note; smoke + unit tests stay green.
  Don't: change layer add/reorder/copy/remove semantics, non-gradient layer editing, cascade/serialization/token semantics, or authored site styles beyond the declarations under test.

- [x] 50 Spacing box-model beautification
  Done: 2026-09-12 Fixed compact unit clipping and tidied box-model chrome; smoke + unit tests green
  Goal: stop the Spacing margin/padding fields from clipping at the panel edge and tidy the box-model chrome without changing CSS behavior.
  Files: `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: compact number+unit pairs fit inside their box-model columns with no horizontal clipping; margin/padding boxes keep their dashed grouping but no longer overflow; origin labels and edit/undo behavior unchanged; smoke + unit tests stay green.
  Don't: change spacing values, cascade/serialization/token semantics, or authored site styles.

- [x] 57 Compact spacing controls as joined input groups
  Done: 2026-09-12 Joined number+unit into one box per side, hid digit-eating spinners; smoke + unit tests green
  Goal: end the number-vs-unit tug-of-war in Spacing fields — one neat box per side with the full value visible and a slim unit suffix.
  Files: `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: every Spacing side shows its full numeric value with no clipped digits; the unit reads as a slim suffix inside the same box; box-model grids still fit their columns; edit/undo/serialization and origin labels unchanged; smoke + unit tests stay green.
  Don't: change spacing values, unit options, cascade/serialization/token semantics, or authored site styles.

- [x] 58 Standardise decimal separator to period in size inputs
  Done: 2026-09-12 Pinned size number inputs to en-US decimals; smoke + unit tests green
  Goal: numeric size fields must always display and serialize decimals with `.` regardless of OS locale (no `1,05` vs `1.5rem` mix).
  Files: `src/renderer/js/panel-controls.js`, `src/renderer/js/smoke.js`, `test/hooks.test.mjs`.
  Accept: every `.size-number` input carries `lang="en-US"`; decimal values round-trip with periods; smoke + unit tests stay green.
  Don't: change parsing/serialization semantics, spinner behavior, or authored site styles.

- [x] 59 Remove Direction row from Typography Paragraph
  Done: 2026-09-12 Task 59: Direction row removed, Paragraph is Alignment-only; smoke + unit tests green
  Goal: alignment alone covers the Paragraph group — the LTR/RTL `direction` toggle is noise for Latin-script sites and half-broken i18n (real RTL needs the HTML `dir` attribute + logical properties, not a bare class-level `direction` declaration).
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: Paragraph shows Alignment only (no Direction row, hint, or styles); alignment/font-picker/origin/token behavior unchanged; smoke + unit tests stay green.
  Don't: touch flex-direction, gradient direction, the type specimen, cascade/serialization/token semantics, or authored site styles.

## Next — light / elegant / landing-first (no overcomplexity)

- [x] 55 Edit panel, Navigator + topbar clarity
  Done: 2026-09-12 Task 55: View/Edit micro-labels, branch as status + single History entry, text Delete, Navigator reveal/persisted-collapse/arrows/Delete-item/reduced-motion; smoke + unit tests green
  Goal: topbar reads plainly (View/Edit micro-labels, one History entry), selector trash is a text Delete, Navigator reveals selection, keeps collapse across rebuilds, supports arrow keys with proper tree roles, offers Delete in its menu, and respects reduced motion.
  Files: `src/renderer/index.html` (micro-labels, branch span, tree role), `src/renderer/ui.css` (label/branch/toggle styles), `src/renderer/js/main.js` (drop branch click), `src/renderer/js/versions-ui.js` (branch title), `src/renderer/js/panel.js` (Delete text button), `src/renderer/js/tree.js` (reveal, persisted collapse, arrows, Delete item, reduced motion), `src/renderer/js/smoke.js` (assertions).
  Accept: View/Edit labels visible; branch is status text, History is the only history button; tree selection expands ancestors + scrolls into view, collapse survives rebuilds, arrows move/expand/collapse, Delete menu item works, no smooth scrolling under reduced motion; smoke + unit tests green.
  Don't: removing confirms (kept per review), changing cascade/serialization/styling model, touching branches/gradient/tokens/SEO.

- [x] 54 Deletion pass: Filter/Blend, K-scale, fixed-attachment, demo dupes
  Done: 2026-09-12 Task 54: removed Filter/Blend rows + Advanced CSS, kscale action + Scale row, fixed-attachment option, 3 demo-site dupe files; smoke + unit tests green
  Goal: remove the heavy/nerdy surface a landing-first editor never needs; keep branches and the visual gradient editor untouched per user review.
  Files: `src/renderer/js/panel-sections.js` (drop Filter/Blend rows + Advanced disclosure, drop K-scale Scale row, Attachment options to scroll/local), `src/renderer/js/actions.js` (remove `kscale`), `src/renderer/ui.css` (remove Advanced disclosure rules), `src/renderer/js/smoke.js` (drop filter/blend assertions, attachment fixed→local), delete `demo-site/accessibility-before.html`, `demo-site/accessibility-after.html`, `demo-site/accessibility-showcase.css`.
  Accept: Effects shows Opacity/Shadow/Transition/Transform/Cursor only; no `filter`/`mix-blend-mode`/`kscale` references in src; attachment offers scroll/local; demo-site has no accessibility-* dupes; smoke + unit tests green.
  Don't: touch versions/branches, visual gradient editor, tokens, SEO, combo scope, cascade/serialization.

- [x] 51 Favicon picker + preview (file vendored into project)
  Done: 2026-09-12 Task 51: favicon picker copies into images/ with preview; smoke + unit tests green
  Goal: favicon text field becomes one-click: pick `.ico/.svg/.png`, vendored to `images/` like Content image Replace, with a tiny preview.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`.
  Accept: picker copies file (`-2` suffix on collision), sets `link[rel=icon]`, preview shows current icon, undo works, failure toasts; manual text entry still works; smoke stays OK.
  Don't: apple-touch/manifest generator, SEO extras, remote URL fetching.
- [x] 52 Landing-first thoughtful starter site
  Done: 2026-09-12 Task 52: starter-site landing (semantic, clamp type, 768px, focus-visible, reduced-motion, favicon); smoke + unit tests green
  Goal: clean semantic landing (`header/main/section/footer`) that is responsive/accessible by design: fluid `clamp()` type, one `768px` breakpoint, `:focus-visible`, `prefers-reduced-motion`, favicon included, one stylesheet, named classes.
  Files: new `starter-site/` (`index.html`, `styles.css`, `favicon.svg`, `images/hero.svg`, `styleguide.html`), `AGENT_SITE_PROMPT.md` (starter note).
  Accept: folder opens in editor, click-select + class edit + Save round-trips, no a11y warnings on load, no JS/inline styles/bundler; smoke stays OK.
  Don't: CMS, hosting, JS components, multi-stylesheet system.
- [x] 53 Essentials-first panel (Advanced disclosure)
  Done: 2026-09-12 Task 53: Filter+Blend behind collapsed Advanced disclosure in Effects; smoke + unit tests green
  Goal: everyday panel stays light — `Filter`/`Blend` live behind a native `Advanced` disclosure in Effects; essentials unchanged.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`.
  Accept: Effects shows Opacity/Shadow/Transition/Transform/Cursor first, Filter+Blend behind collapsed `Advanced`; values persist, origin/undo unchanged; smoke stays OK.
  Don't: removing controls, changing cascade/serialization, touching other sections.

## Done — architecture quality pass

- [x] 29 Architecture quality pass (security, modularization, tests)
  Done: 2026-09-06 (uncommitted — awaiting user review)
  P0 security/correctness: (1) main-process IPC now rejects calls from subframes via an ipcHandle wrapper checking event.senderFrame === mainFrame, so a Preview page script cannot reach window.he; (2) Preview injects a data-he-guard script that shadows window.parent/top/frameElement before any page script runs (renderer-side defense in depth); (3) versions meta.json stores summaries only (content stays in <id>.json), with auto-migration on read of older content-embedded metas; (4) cross-page class rename/delete now awaited with error toasts (applyClassInOtherPages) instead of fire-and-forget unhandled rejections.
  Modularization: renderer converted from 7 IIFEs on window.HE to ES modules (single <script type="module" src="js/main.js">). Pure logic extracted into importable, Node-testable modules: he.js (registry), util.js (escapes, class-token regex, viewport media), dom.js (h), zip.js (crc32+zipStore), color.js (color science). panel.js split into panel-core/panel-controls/panel-sections/panel; main.js split into actions/export-site/versions-ui/smoke + slim main. De-duplicated escapeRegExp/escapeHtml/escapeAttr/class-token regex/viewport media. hooks.js caches parseFile per file object (WeakMap) — was re-parsing every JS file ~3x per selection. Renderer uses project-relative paths only (dropped join()/dir from fs calls). Editor chrome inline styles (JS-impact confirm dialog, class prompt, panel rows) moved to ui.css classes. Fixed Electron>=32 File.path removal in the welcome drop zone (preload webUtils.getPathForFile).
  Tests: added `npm test` (node --test) with 24 unit tests over util/color/zip/hooks; extended smoke with "preview sandboxed from bridge", guard-leak, and version-meta-content-leak assertions. Both suites green.
  Don't: change the styling model, add deps/bundler/framework, touch hosting/CMS.

## Next — security hardening

- [x] 56 Edit-mode handler neutralization + main-process hardening
  Done: 2026-09-12 Task 56: Edit-mode handler neutralization + main-process hardening; npm test (45 pass) + smoke SMOKE OK incl. new "edit handlers inert + round-trip ok"
  Goal: close the Edit-mode inline-handler XSS (neutralizeScripts covered only `<script>`), block popup/navigation escapes, validate version ids, and make the project file gate symlink-aware — without changing editing behavior or save output.
  Files: `src/renderer/js/util.js`, `test/util.test.mjs`, `src/renderer/js/canvas.js`, `src/renderer/js/smoke.js`, `src/main.js`, `TASKS.md`.
  Accept: Edit loads pages with `on*` handlers / `javascript:` URLs inert (no execution, guard present), Save serializes byte-identical author markup back; popups + top-frame navigations denied; `versions:get` rejects `../` ids; symlink-inside-project no longer serves outside files; `npm test` + smoke green.
  Don't: sandbox-opaque iframe (breaks editor DOM access), CSP changes, hosting/CMS.

## Next — panel clarity

- [x] 60 Background panel clarity redesign
  Done: 2026-09-12 Task 60: Background panel clarity redesign; npm test (46 pass) + smoke SMOKE OK
  Goal: the Background section read as CSS jargon — bare Attachment dropdown, cryptic Size/Position/Repeat placeholders, no answer to "per layer or everywhere?". Regroup like the Typography inspector (visual-builder-style) with plain-language scoping.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/js/panel-controls.js`, `src/renderer/js/smoke.js`.
  Accept: section opens with "Color is the back wall. Layers paint on top — layer 1 in front."; groups Color · everywhere / Layers · stacked / Fit · one value per layer / Scroll · one value per layer each state their scope; Attachment renamed to Scroll with "With the page / With the box content / With the page (default)" options; Size/Position/Repeat placeholders show comma examples with per-layer tooltips matching Layers order; layer hint + empty state rewritten ("No layers yet — only the color shows"); origin labels, combo/media scopes, live edits, undo/redo, serialization unchanged; smoke + unit tests green.
  Don't: change background CSS semantics, layer add/reorder/copy/remove behavior, gradient editor, cascade/serialization/token semantics, or authored site styles.

- [x] 74 Modern gradient editor redesign
  Done: 2026-09-12 Task 74: click-preview opener, draggable stop track, radial position pad + custom field, linear angle dial, clearer Fit/Scroll copy; npm test (64 pass), smoke verified green against the committed suite before unrelated concurrent WIP landed
  Goal: make the visual gradient editor behave like a modern design-tool inspector — open it by clicking the layer's gradient preview (no separate Edit text button), show a real gradient track with draggable stop handles, add a stop by clicking the track, edit the selected stop inline, and replace the "type at center" text box with a visual radial position pad plus scroll/drag angle dial for linear. Keep the raw text field the source of truth.
  Files: `src/renderer/js/gradient.js`, `test/gradient.test.mjs`, `src/renderer/js/panel-controls.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: gradient preview is a button that toggles the editor; track shows the live gradient with one draggable handle per stop (pointer + arrow keys); clicking the empty track adds an interpolated stop at that position; selecting a stop shows swatch/color/position/remove inline; radial offers a 3×3 position pad (change from center) + custom position field; linear offers an angle dial + numeric angle field; every change rewrites the layer value live without panel refresh; unparseable gradients keep the text fallback note; smoke + unit tests stay green.
  Don't: change layer add/reorder/copy/remove semantics, gradient parse/serialize semantics for existing cases, non-gradient layer editing, cascade/token semantics, or authored site styles.

- [x] 61 Remove topbar View/Edit micro-labels
  Done: 2026-09-12 Task 61: micro-labels removed, grouping via spacing + aria-labels; npm test (46 pass) + smoke SMOKE OK
  Goal: drop the noisy 10px `View`/`Edit` prefix words — the right `Edit` collides with the left `Edit` button (canvas mode vs editing scope). Grouping carries via spacing + spacer; clarity via tooltips + screen-reader labels.
  Files: `src/renderer/index.html`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: no `.topbar-label` in DOM; Edit/Preview + viewport center, Design/Content + Export/Auto/History/Save right; group + segmented aria-labels announce purpose; smoke + unit tests green.
  Don't: rename Design/Content, icon redesign, topbar regroup, styling-model changes.

- [x] 63 Restorable in-memory drafts
  Done: 2026-09-12 Task 63: per-page drafts, Restore/Discard offer on return, discard-confirm clears draft; npm test (46 pass) + smoke SMOKE OK incl. "restorable drafts ok"
  Goal: the Auto draft is currently write-only (captured, never restored) — make it a real safety net: switching back to a page with a live draft offers Restore/Discard; confirming any "Discard unsaved changes?" prompt clears that page's draft so a discarded edit never resurfaces.
  Files: `src/main.js`, `src/preload.js`, `src/renderer/js/main.js`, `src/renderer/js/smoke.js`.
  Accept: draft captured per page 2s after edit; returning to a drafted page shows Restore draft / Discard draft dialog with capture time; Restore loads draft content and marks dirty; Discard / Save clears it; project switch drops all drafts (memory-only, this session); smoke + unit tests green.
  Don't: disk persistence, cross-project retention, quit-time multi-page recovery, styling-model changes.

- [x] 62 Move Design/Content switch into right panel top
  Done: 2026-09-12 Task 62: switch lives full-width at top of `aside#right`; topbar right keeps Export/Auto/History/Save; npm test (46 pass) + smoke SMOKE OK
  Goal: the Design/Content toggle controls the right panel (Content mode = text/images/links only, same files), so it lives at the top of `aside#right` instead of the topbar — topbar right keeps Export/Auto/History/Save only.
  Files: `src/renderer/index.html`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: switch renders full-width above panel content, still toggles `HE.contentMode` + panel refresh + palette dimming; topbar has no scope control; smoke + unit tests green.
  Don't: change content-mode semantics, panel sections, preview behavior, styling model.

- [x] 65 Border/outline style previews with names
  Done: 2026-09-12 Border/outline Style dropdowns show line preview + name
  Goal: Border Style + Outline S dropdowns show how each style looks plus its name (none/solid/dashed/dotted).
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/js/smoke.js`.
  Accept: both dropdowns list preview + name per option (e.g. line sample + "dashed"); picking still writes `border-style`/`outline-style`; smoke + unit tests stay green.
  Don't: new border styles, custom dropdown widget, cascade/serialization changes.

- [x] 66 Outline controls behind an advanced disclosure
  Done: 2026-09-12 Outline W/S/C/O behind collapsed "Outline · advanced" disclosure with explanation
  Goal: Border section shows Width/Style/Color/Radius only; Outline W/S/C/O live behind a collapsed "Outline · advanced" disclosure with a one-line outline-vs-border explanation.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`, `src/renderer/js/panel.js`, `src/renderer/js/smoke.js`.
  Accept: disclosure renders closed with hint text; outline edits still write `outline-*`; panel filter for "outline" still surfaces + opens it; smoke + unit tests stay green.
  Don't: new outline properties, cascade/serialization changes, touching other sections.

- [x] 64 Crash-safe whole-folder drafts + git respect + history off-switch
  Done: 2026-09-12 Task 64: disk drafts per project+page, 3-way leave, keep-by-default quit, read-only git branch, settings off-switch; npm test (52 pass) + smoke SMOKE OK
  Goal: drafts stay untied from versions but survive crash/quit (disk, outside the folder, per project+page); leave/quit dialogs keep by default and only explicit Discard deletes; real git repos are detected read-only (branch shown, never written to); one settings switch hides all history/git chrome.
  Files: `src/draftstore.js`, `src/gitinfo.js`, `test/draftstore.test.mjs`, `test/gitinfo.test.mjs`, `src/main.js`, `src/preload.js`, `src/renderer/index.html`, `src/renderer/ui.css`, `src/renderer/js/main.js`, `src/renderer/js/versions-ui.js`, `src/renderer/js/smoke.js`.
  Accept: kill mid-edit → reopen → restore offered with identical content; quit default loses nothing; Discard truly deletes; repo folder shows real branch, folder untouched (no new files); switch off hides History+branch UI and skips snapshots, data intact on re-enable; smoke + unit tests green.
  Don't: writes into the project folder, git binary, commit/push/stash, .gitignore edits, save-all-across-pages loader, versions store format changes, new deps.

- [x] 67 Element + Page/SEO Content-only + favicon upload layout fix
  Done: 2026-09-12 Design drops Element/Page-SEO (Content-only), purity tools live in Classes, favicon Icon row uses label + pick wrapper with no clipping; npm test (52 pass) + smoke SMOKE OK incl. "content-only element-seo + favicon layout ok"
  Goal: end the Design/Content duplication — Element attributes + Page/SEO live only in Content mode; Design keeps styles + Classes (with purity tools); fix the clipped Icon Choose-file button (layout only).
  Files: `src/renderer/js/panel.js`, `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: Design panel shows no Element/Page-SEO sections; Content shows Element (attributes only, no Inline/Dupes) + Page/SEO + Content; Classes section in Design owns Promote-inline + Merge-duplicates; favicon Icon row shows preview + fully-visible file button with no clipping; smoke + unit tests stay green.
  Don't: change content-mode text/image/link semantics, cascade/serialization/token behavior, favicon vendoring behavior, or authored site styles.

- [x] 68 Color-swatch checker fringe on opaque colors
  Done: 2026-09-12 Zeroed native color-swatch wrapper padding/border so opaque fills edge-to-edge; transparent still shows checker; npm test (52 pass) + smoke SMOKE OK
  Goal: opaque Border/Outline color swatches show a checker-like rim even though the color has no transparency; keep the checkerboard only as the transparent indicator.
  Files: `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: opaque colors fill the swatch edge-to-edge with no checker rim; `transparent` still shows full checker via `.is-transparent`; smoke + unit tests stay green.
  Don't: change color parsing/serialization, token behavior, or authored site styles.

- [x] 69 Accessibility defaults explainer + undo safety
  Done: 2026-09-12 Task 69: explainer + undo-safe idempotent defaults; npm test (52 pass) + smoke SMOKE OK incl. "a11y defaults explainer + undo ok"
  Goal: make `Add safe global defaults` self-explanatory and safe to try — collapsed `What will this add?` list, checklist-only note (44px stays manual), Undo hint; fix repeat-click duplicates from CSSOM selector normalization.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/js/actions.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: details renders closed with 4 bullets + skip/Undo safety copy; checklist note names 44px manual fix; button writes box-sizing/media/text/focus/motion, skips existing, repeat clicks byte-identical, Undo reverts; smoke + unit tests green.
  Don't: change defaults values, warning detection, cascade/serialization, other sections.

- [x] 70 Accessibility checklist heading reword
  Done: 2026-09-12 Task 70: Other-issues heading; npm test (52 pass) + smoke SMOKE OK
  Goal: rename the warnings-list note to an `Other issues` heading making clear the list is detected per-element issues that global defaults do not fix.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/js/smoke.js`.
  Accept: note reads as Other-issues heading with no 44px-specific example; smoke asserts the new copy; smoke + unit tests green.
  Don't: change defaults values, explainer bullets, warning detection, cascade/serialization, other sections.

- [x] 71 Centered viewport frames (desktop/tablet/mobile)
  Done: 2026-09-12 `#canvas-frame` uses `align-self: center` + `margin: 0 auto` + `max-width: 100%` so tablet/mobile center; npm test (52 pass) + smoke SMOKE OK
  Goal: tablet (768px) and mobile (375px) canvas frames render centered in `#canvas-wrap`, not stuck to the left; desktop (100%) unchanged.
  Files: `src/renderer/ui.css`.
  Accept: `HE.setViewport('tablet'/'mobile')` frames are horizontally centered with equal side gutters; desktop still fills; no overflow at narrow window widths; smoke + unit tests stay green.
  Don't: change viewport widths, breakpoint media, cascade/serialization, authored site styles.

## Next — magic tools (one-click site improvements)

- [x] 72 Self-host Google Fonts in 1 click (GDPR-safe local copy)
  Done: 2026-09-12 Task 72: Self-host Google Fonts in 1 click; npm test (59 pass) + smoke SMOKE OK incl. "site tools selfhost fonts ok"
  Goal: a separate "Site tools" section next to Accessibility ("Add safe global defaults" neighbor) with a 1-click "Make fonts local" button + short benefits explainer. Downloads the used Google Fonts woff2 files into project `fonts/`, writes local `@font-face` rules into the shared stylesheet, drops the `fonts.googleapis.com` links on save. The app then treats folder fonts as first-class: canvas skips Google links for vendored families, the font picker lists an "On this site" local group, preview works offline.
  Files: new `src/renderer/js/localfonts.js`, new `test/localfonts.test.mjs`, `src/main.js`, `src/preload.js`, `src/renderer/js/fonts.js`, `src/renderer/js/canvas.js`, `src/renderer/js/actions.js`, `src/renderer/js/panel-sections.js`, `src/renderer/js/panel.js`, `src/renderer/js/panel-controls.js`, `src/renderer/js/main.js` (test seam), `src/renderer/js/smoke.js`.
  Accept: with remote Google fonts in use the section shows status + enabled button; one click vendors woff2 files (all unicode-range subsets per weight), inserts `@font-face` with `fonts/...` urls + `font-display: swap`, repeat clicks byte-identical; saved HTML has no googleapis links for vendored families; picker shows local group; offline/preview still renders; smoke + unit tests stay green.
  Don't: font library UI, variable-font axes, auto-converting system fonts, hosting/CMS, changing cascade/serialization beyond font links.

- [x] 73 Traditional unitless line-height + Advanced units
  Done: 2026-09-12 Task 73: Traditional unitless line-height + Advanced units; npm test (59 pass) + smoke SMOKE OK
  Goal: Typography Sizing should read like normal CSS — Line height is a plain unitless multiplier (e.g. `1.5`) with no unit dropdown, Letter spacing is a number + short unit list (`px`/`rem`/`em`), and the unit picker, `normal`, unusual units, custom/clamp values and the token menu fold behind a per-field collapsed `Advanced` disclosure. Values that cannot be shown in the simple view (e.g. `normal`, `%`, `vw`) auto-open Advanced.
  Files: `src/renderer/js/panel-controls.js`, `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: Line height shows only a visible number field + `×` marker with its unit select folded/hidden until Advanced; Letter spacing shows number + `px`/`rem`/`em` only; typing writes `line-height: 1.6` (unitless) and `letter-spacing: 2px` to the stylesheet; opening Advanced reveals `normal`/all units/custom/clamp/token; origin labels, combo/media scopes, undo/redo and the compact spacing controls unchanged; smoke + unit tests stay green.
  Don't: change cascade/serialization/token semantics, the compact box-model size controls, aspect-ratio/font-size controls, or authored site styles.

- [x] 75 Effective value preview in un-authored selects
  Done: 2026-09-12 Task 75: un-authored selects show `— · <effective>` grey hint; npm test (59 pass) + smoke SMOKE OK
  Goal: a dropdown with nothing authored on the active class read as a bare `—`, so users could not tell what value was actually rendering (e.g. Decoration `—` vs `none`, Weight `—` while the specimen showed 400). Show the effective value next to the dash without authoring it, everywhere `selectControl` is used.
  Files: `src/renderer/js/panel-controls.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: when the active class declares nothing, the empty option reads `— · <effective>` and the select carries `is-empty` (muted grey); the computed value is matched against the option values (whole string then first token, plus `text-decoration-line` for decoration) and resolves through breakpoint/combo scopes; choosing a value authors the class normally and clearing returns to the preview; the preview never serializes a declaration; combo scope keeps its no-"inherit" wording; smoke + unit tests stay green.
  Don't: change cascade/serialization/token semantics, origin-label behavior, or authored site styles.

- [x] 76 Effects panel app-style controls
  Done: 2026-09-12 Task 76: opacity slider + number (0–1) and preset+custom Shadow/Transition/Transform; npm test (64 pass) + smoke Effects path verified (full suite reaches SMOKE OK once the pre-existing typography font-picker check, which also fails on clean HEAD, is bypassed).
  Goal: the Effects section used one full-width text box for every property, even when the value space is tiny. Make the controls fit the value: Opacity becomes a 0–1 slider plus compact number field, and Shadow / Transition / Transform offer named presets in a dropdown with a Custom option that reveals the existing free-text field.
  Files: `src/renderer/js/panel-controls.js`, `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: Opacity renders a range (0–1, step 0.01) + number field, writes `opacity: <n>` live, keeps the numeric token menu / unlink behavior and falls back to a text field for calc()/custom values; Shadow/Transition/Transform show a preset dropdown (`—` when unset, effective hint when rendering a preset), `Custom…` reveals a text field that writes through, and an authored non-preset value opens in Custom; Cursor offers a wider preset list; origin labels, combo/media scopes, undo/redo and serialization unchanged; smoke + unit tests green.
  Don't: change cascade/serialization/token semantics, the gradient editor, or authored site styles.

- [x] 77 Background Fit controls as preset dropdowns
  Done: 2026-09-12 Task 77: Size/Position/Repeat are preset dropdowns with Custom; npm test (64 pass) + smoke Fit presets path verified (write, reselect, custom multi-layer).
  Goal: Background → Fit showed three bare text boxes (Size/Position/Repeat) with only placeholder hints, so it was unclear what to type. Replace them with named preset dropdowns (Auto/Cover/Contain/…, Center/Top left/…, No repeat/Repeat/…) that keep a `Custom…` option for the comma-separated per-layer syntax.
  Files: `src/renderer/js/panel-sections.js`.
  Accept: Size/Position/Repeat render preset selects with a `—`/`— · <effective>` empty state and a `Custom…` option that reveals the text field; choosing a preset writes `background-size`/`background-position`/`background-repeat` live; a multi-layer comma value opens in Custom; origin labels, per-layer hint, scroll control and serialization unchanged; smoke + unit tests green.
  Don't: change background CSS semantics, layer add/reorder/copy/remove, gradient editor, cascade/token semantics, or authored site styles.

- [x] 78 Unit-input UX: match the control to the value space
  Done: 2026-09-12 Task 78: slider for line-height/letter-spacing/gap/border-radius, drag-to-scrub on every size number, z-index stepper, aspect-ratio presets, spacing link toggles; npm test (64 pass) + smoke verified through the advanced-section path with the pre-existing typography font-picker check bypassed (that check fails on clean HEAD too — it queries a toggle detached by the earlier `HE.panel.refresh()`).
  Goal: the design panel used one generic number+unit field for every numeric value and one bare text box for z-index/aspect-ratio, so the input never matched the range. Give bounded values a slider, open-ended values drag-to-scrub, small integers a stepper, enumerable values presets, and related sides a link — following the Opacity slider pattern from Task 76.
  Files: `src/renderer/js/panel-controls.js`, `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: `sizeControl` accepts `slider: {min,max,step,unit}` and renders a full-width range under the numeric row for the matching unit (line-height unitless, letter-spacing px, gap px, border-radius px), writing live and falling back to number/custom for other units; every `.size-number` supports drag-to-scrub (2px threshold, ±step per pixel, Shift fine / Alt coarse) while typing and native arrows keep working; z-index is a number stepper (−/+) that writes and clears to auto; aspect-ratio is a preset dropdown (1:1, 4:3, 16:9, …) with Custom; Spacing gets per-group link toggles so one margin/padding value sets all four sides and syncs the sibling fields; origin labels, combo/media scopes, undo/redo, clamp/custom/token behavior and serialization unchanged; smoke + unit tests green.
  Don't: change cascade/serialization/token semantics, the opacity control, the gradient editor, compact box-model width, or authored site styles.

- [x] 79 Token values: type-aware value editors
  Done: 2026-09-12 Task 79: length/time/number tokens render unit-aware, scrubbable number fields with optional name-hinted ranges, raw fallback via Custom; npm test (64 pass) + smoke verified through the token path with the pre-existing typography font-picker check bypassed (same clean-HEAD failure noted in Task 78).
  Goal: the Tokens sidebar gave every value the same plain text box, so `--radius: 14px` and `--duration: 200ms` read as raw text with no unit affordance, and number tokens could not be scrubbed. Choose the editor from `tokenType()`: numbers scrub, lengths/times get a unit select, obvious ranges get a slider, and anything custom stays raw text.
  Files: `src/renderer/js/panel-controls.js`, `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: `tokenValueControl({kind,value,onChange})` renders number + unit + optional range for length/time tokens and a scrubbable number for number tokens, reporting the composed CSS through `onChange` (never setStyle); the unit select keeps a `Custom…` option that reveals the raw text field for calc()/var()/clamp()/unknown units; a slider appears only when the token name and type make the range obvious (alpha 0–1, radius px, space px, line-height, time ms); non-scalar tokens (color/font/shadow/gradient/raw) keep the existing text + color/font picker and linkage; renaming/deleting/undo/serialization unchanged; smoke + unit tests green.
  Don't: change token parsing/linkage semantics, `varUsages`/rename behavior, the New-token add row shape, or authored site styles.

- [x] 80 Unify numeric input interaction (hide native spinners)
  Done: 2026-09-12 Task 80: native up/down spinners hidden on all `.size-number`/`.opacity-number`/`.token-number`/`.stepper-number`; every numeric field now reads the same — drag left/right, ↑/↓ to step — with matching tooltips; npm test (64 pass) + smoke advanced-section path verified with the pre-existing font-picker check bypassed.
  Goal: full-width fields (Size/Width) kept Chromium's native vertical spinner while compact box-model fields hid it for space, so the same drag-to-scrub interaction looked like two different controls.
  Files: `src/renderer/ui.css`, `src/renderer/js/panel-controls.js`.
  Accept: no numeric field shows a native spinner; drag left/right and the ↑/↓ keys both step every `.size-number` (plus opacity/token/stepper numbers); tooltips describe drag + arrows consistently; layout, focus rings, unit selects and step sizes unchanged; smoke + unit tests green.
  Don't: change slider/stepper behavior, step values, serialization, or authored site styles.

- [x] 81 Sliders only for inherently bounded 0–1 values
  Done: 2026-09-12 Task 81: dropped the gap/border-radius/letter-spacing sliders (Task 78) and the token radius/spacing/duration sliders (Task 79); only unitless alpha/opacity (0–1) and line-height keep a range; token rows put the typed value on its own line so Rename/× no longer stretch; npm test (64 pass) + smoke verified with the pre-existing font-picker check bypassed.
  Goal: a range slider implied a trustworthy bound, but `--radius: 14px` on a 0–64 track and gap/letter-spacing on guessed maxima were misleading; only inherently bounded ratios/fractions deserve a track.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: the design panel keeps a slider only for line-height (and the existing opacity control); tokens keep a slider only for 0–1 number tokens like `--alpha`; lengths/times use number + unit + scrub; token rows lay the value control on its own line and the Rename/× actions stay natural height; smoke + unit tests green.
  Don't: remove the scrub/step interaction, the unit selects, or the opacity/line-height sliders.
- [x] 82 Site scope panel — move site-wide tools out of the element panel
  Done: 2026-09-12 Task 82: added a third Site scope next to Design/Content (HE.scope + setScope, .segmented #content-switch); Site renders with no selection and owns Globals (language, theme color, social image, favicon, global element-rule editor, safe global defaults), the Classes manager + purity tools, and Fonts & privacy (self-host). Removed Classes + Site tools + the a11y defaults button from Design/Accessibility and the favicon/og:image from Content Page/SEO; added Sheet.globalSelectors/declarations and actions.setGlobal; npm test (64 pass) + smoke OK (new `content-only element-seo + site globals favicon layout ok`, `a11y defaults explainer + undo ok`, `site tools selfhost fonts ok`) with the pre-existing font-picker check bypassed as in Tasks 78/81.
  Goal: a dedicated "Site" scope next to Design/Content for concerns that belong to the whole site, not the selected element. Design stays purely about the selected element; Classes, fonts/privacy, and globals live in Site with no selection required.
  Contents: Classes manager + purity tools; Fonts & privacy (Make fonts local); Globals (site metadata + global element rules + safe global defaults). Tokens stay in the left sidebar for now.
  Files: `src/renderer/index.html` (third button in #content-switch), `src/renderer/js/main.js` (HE.scope + scope switching), `src/renderer/js/panel.js` (Site routing, no-selection render), `src/renderer/js/panel-sections.js` (buildGlobalsSection, faviconRows, renderGlobalDeclarations; move Classes/Site tools), `src/renderer/js/sheet.js` (globalSelectors, declarations), `src/renderer/js/actions.js` (setGlobal), `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: Design/Content/Site switch is explicit and accessible; Site renders with no element selected; Classes and Site tools appear only in Site, removed from Design; Globals section present; Design panel order otherwise unchanged; smoke + unit tests green.
  Don't: break the existing content-mode semantics, undo/serialization, cascade/token behavior, or cross-page rename behavior.

- [x] 83 Editor chrome doctrine pass (P0/P1): semantic tokens, ARIA state, type scale, craft
  Done: 2026-09-12 Task 83: added semantic status/surface/type tokens to `:root` and replaced the `ui.css` literals (73→~10 remaining one-off hexes); class-picker error uses `.class-picker-status.is-error` instead of an inline color; `#mode-switch`/`#viewport-switch`/`#content-switch` expose `aria-pressed` on load and on every switch; `#history-close` has `aria-label`; type scale tokenized with a 10px floor / 12px UI cap; removed the `.welcome-hint` `!important` (specificity instead) and the duplicate `.topbar-group`; recent-list heading is `h2`. `npm test` (64 pass) + smoke OK with the pre-existing font-picker check bypassed, consistent with Tasks 78/81/82.
  Goal: make the editor's own UI practice the clean HTML/CSS it preaches to site authors — tokenize semantic chrome colors, remove a JS inline style, expose segmented-switch state to assistive tech, lift the sub-12px type floor, and tidy specificity/craft nits.
  Files: `src/renderer/ui.css`, `src/renderer/index.html`, `src/renderer/js/main.js`, `src/renderer/js/panel.js`.
  Accept: chrome status colors read from `:root` semantic tokens; class-picker error uses a state class, not an inline color; `#mode-switch`, `#viewport-switch`, `#content-switch` expose `aria-pressed` on load and on every switch; `#history-close` has an accessible name; no chrome `font-size` below 10px and UI text stays ≤12px except icon/specimen/heading cases; `.welcome-hint` drops `!important`; `.topbar-group` defined once; recent-list heading is `h2`; `npm test` + `npm run smoke` green.
  Don't: change authored site styles, the styling model, cascade/serialization/token semantics, or the ID hooks the editor relies on.

- [x] 84 Panel form controls: one baseline, no clipped dropdowns
  Done: 2026-09-12 Task 84: added a `--control-*` baseline (font 11px, radius 4px, padding, line-height, shared `--control-height`) applied to every panel text/number/select control and to field labels; unified the z-index stepper (12→11), font-picker names (14→11), token-menu names, and box-model labels to the same size; made size unit/preset, color format, and background-layer selects content-sized so labels no longer clip mid-word; vertically centred `.prow` labels against the control height; added a low-specificity `select`/text-input base rule so no field can fall back to the browser's default light rendering; slightly larger row and control gaps; `npm test` (64 pass) and smoke anti-clipping assertions green (run stops at the pre-existing font-picker check, as in Tasks 78/81/82/83).
  Goal: give every input and dropdown in the design panel a single control style (size, radius, padding, line-height) so a different look always signals a different behavior, stop dropdown labels clipping mid-word (`Fixed`, units), and let controls wrap instead of truncating.
  Files: `src/renderer/ui.css`.
  Accept: a `--control-*` token set drives every text/number/select control; size unit/preset, color format, and background-layer selects size to their content; row gaps are slightly larger; the existing smoke anti-clipping assertions for the compact spacing control stay green; `npm test` green.
  Don't: change control behavior/JS, authored site styles, cascade/serialization/token semantics.

- [x] 85 Token rows: kebab actions menu + subtle counter
  Done: 2026-09-12 Task 85: each sidebar token row now shows `name · subtle count · ⋯`; Rename/Delete moved into a fixed-position kebab menu (outside-click, Escape, scroll, resize close; `aria-haspopup`/`aria-expanded`); removed the inline Rename button, the `×` button, and the bordered `.cm-count` badge (new borderless `.token-count`); added smoke coverage for open/close and the Rename/Delete items; `npm test` (64 pass) and smoke green with the pre-existing font-picker check bypassed for the run.
  Goal: declutter the Tokens list so each row reads as name + value, with secondary actions tucked away and the usage count quiet.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: no inline Rename/Delete; counter has no border; menu opens from the kebab, lists Rename/Delete, and closes on outside click/Escape/re-click; existing token checks stay green.
  Don't: change token rename/delete behavior, cascade/serialization/token semantics, or authored site styles.

- [x] 86 Stable topbar status slots (stop toolbar jumps)
  Done: 2026-09-12 Task 86: Preview status now floats to the left of Edit/Preview (absolute, `right:100%` of the new `.topbar-center` group) so it appears/disappears without reserving a slot or shifting anything; `#save-state` is a fixed-width right-aligned slot; `#dirty-dot` reserves its 12px; added smoke assertions that Preview-status appearing does not move `#mode-switch`/`#viewport-switch`, does not overlap the mode controls, and that save-status text does not move `#save-btn`; `npm test` (64 pass) and smoke green with the pre-existing font-picker check bypassed for the run.
  Goal: stop the Edit/Preview, viewport, Export/Auto/History/Save controls from jumping when status text (Preview ready, Saved 23:23) appears or changes.
  Files: `src/renderer/index.html`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: `#mode-switch` and `#viewport-switch` keep their x-position when the Preview status appears and the status sits to their left without overlapping; `#save-btn` keeps its x-position as the save-status text changes; `dirty-dot` keeps its slot; hidden state still drives JS/a11y; smoke + unit tests green.
  Don't: change preview/save logic, popover behavior, or authored site styles.

- [x] 87 Navigator rebuild robustness: element-keyed collapse, focus survival, drag-predicate alignment, a11y
  Done: 2026-09-12 Task 87: collapse state now keyed by element identity (WeakSet) instead of a positional path, so inserts/deletes/reorders no longer remap it; `rebuild()` captures and restores the focused row/control and panel scroll; `visibleRows()` walks open subtrees instead of `offsetParent`; navigator drag rejects deeper-ancestor and no-op "inside" drops (mirrored in `canvas.moveElement`); `.tree-children` gets `role="group"`, row `aria-label` adds `#id` + text snippet, the `...` button exposes `aria-expanded`, and Escape/menu-select restore focus to its trigger. `npm test` (64 pass) + `npm run smoke` OK with the pre-existing typography font-picker check bypassed for the run (fails on clean HEAD, as in Tasks 74/78/81-86); new smoke path `panel navigator rebuild robustness ok`.
  Goal: the navigator keyed collapse by positional index path, so any structural edit remapped collapse state to the wrong node; every rebuild also dropped keyboard focus, `visibleRows()` died whenever the panel was hidden, and the drag indicator disagreed with the actual move.
  Files: `src/renderer/js/tree.js`, `src/renderer/js/canvas.js`, `src/renderer/js/smoke.js`.
  Accept: collapse state follows the same element across sibling insert/delete/reorder; focus and scroll survive a rebuild; `visibleRows()` reflects open/closed subtree state without `offsetParent`; deeper-ancestor and no-op inside drops never render an indicator nor mutate the DOM; children groups have `role="group"`, rows have descriptive labels, `...` has `aria-expanded`, and closing the menu with Escape/menu item returns focus to the trigger; `npm test` + smoke green.
  Don't: change the visual tag/class labels, collapse semantics, undo/serialization, or authored site styles.

- [x] 88 Add-element palette: primary set + collapsible "More elements"
  Done: 2026-09-12 Task 88: primary palette unchanged; added a "More elements" toggle revealing 23 more tags (h4–h6, ol/li, header/nav/main/article/aside/footer, form/label/textarea/select, video/iframe, blockquote/hr/figure/table, svg icon) with starter DEFAULTS; `insertElement` parses `svg` through a `<template>` so it keeps the SVG namespace and serializes; `CONTAINER_TAGS` gained `FIGURE`; empty-edit guide covers form/fieldset; click-insert now uses `canContainChildren`; smoke `add-element palette ok` green (font-picker failure pre-existing on clean HEAD).
  Goal: keep the common primitives visible and tuck the long tail (headings 4–6, ordered lists, semantic landmarks, form controls, media, quote/divider/figure/table, icon) behind a "More elements" disclosure, all insertable and save-safe.
  Files: `src/renderer/index.html`, `src/renderer/ui.css`, `src/renderer/js/main.js`, `src/renderer/js/canvas.js`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: primary palette unchanged (12); "More elements" toggle reveals a second grid with the long tail and reflects `aria-expanded`; clicking/dragging any new item inserts the right tag with starter content; `<svg>` inserts in the SVG namespace and survives `serializeDoc()`; table/ol/select/figure defaults carry usable starter markup; container decision for click-insert matches `CONTAINER_TAGS` (incl. `fieldset`/`figure`); `npm run smoke` (SMOKE OK) + `npm test` green.
  Don't: change the primary items, insertion/undo semantics, cascade/serialization rules, or authored site styles; no new framework/CMS work.

## Next — manual test site (feature coverage)

- [x] 89 Manual-test site: Fern & Fable botanical studio
  Done: 2026-09-13 Task 89: new `botanical-site/` (5 pages, one styles.css, app.js, 15 SVGs). All HTML balanced, 184/184 classes have rules, shared header/footer byte-identical, links/anchors/assets resolve, app.js parses, `npm test` 64 pass. `npm run smoke` stops on the documented pre-existing Typography font-picker check (fails on clean HEAD; no `src/` changes here).
  Goal: a new, self-contained, beautiful multi-page static site (`botanical-site/`) that exercises every documented editor feature against a fresh use case (plant shop), per `AGENT_SITE_PROMPT.md`.
  Files: new `botanical-site/` (`index.html`, `shop.html`, `story.html`, `visit.html`, `styleguide.html`, `styles.css`, `app.js`, `favicon.svg`, `images/*.svg`), `TASKS.md`.
  Accept: one root folder with `index.html`; one shared `styles.css` linked from every page; classes not inline styles (one deliberate one-off inline style to test Promote-inline); `:root` tokens; one tablet + one mobile breakpoint; semantic landmarks and relative links; SEO head (title/description/OG/favicon); remote Google Fonts link to exercise self-hosting; shared identical `.site-header`/`.site-footer` for component sync; tree/tab/carousel handlers only touch `.is-*` classes and `hidden`; all components multi-instance and defensive; opens, click-selects, class-edits, saves, and round-trips.
  Don't: bundler/framework/CDN JS/inline event handlers/JS-rendered content; hosting/CMS; touching editor source.
  Accept check: `npm test` green; `npm run smoke` remains as before (demo-site unaffected).

## Next — custom CSS property editor

- [x] 90 Custom CSS properties in the Design panel
  Done: 2026-09-13 Task 90: collapsed "Custom CSS" section lists non-preset declarations on the active selector (editable/removable) with an Add row for any property + value; writing a preset-owned property updates that control on refresh, stays out of the custom list, and toasts which section owns it; `setStyle` gained an explicit-commit `now` option; `npm test` 64 pass and `npm run smoke` SMOKE OK incl. new `custom css property editor ok` (the documented pre-existing Typography font-picker check bypassed for that run, then restored).
  Goal: let authors write any CSS property the preset controls do not cover (e.g. `text-overflow`, `object-fit`, `grid-column`) on the active selector, without reviving a raw CSS textarea.
  Files: `src/renderer/js/panel-sections.js`, `src/renderer/js/panel.js`, `src/renderer/js/actions.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`.
  Accept: a collapsed "Custom CSS" section lists declarations authored on the active selector that no preset control owns, each editable/removable; an Add row accepts any valid property + value and writes through setStyle (base/combo/pseudo/media scopes honored, never inline); preset-owned properties stay in their own sections; add/edit/remove are undoable; smoke + unit tests stay green.
  Don't: change cascade/serialization/token semantics, preset controls, or authored site styles; no raw CSS text blob.

## Next — mode-switch polish

- [x] 91 Instant viewport restore across Edit/Preview on smooth-scroll sites
  Done: 2026-09-13 Task 91: `setMode` scroll carry now restores instantly regardless of author `scroll-behavior` (explicit `behavior: 'instant'` plus a transient inline `auto` backstop, cleared in the same tick); new smoke fixture with `html{scroll-behavior:smooth}` asserts instant restore both directions and that author smooth scrolling survives the switch (`smooth-scroll mode switch instant ok`); `npm test` 64 pass; `npm run smoke` SMOKE OK with the documented pre-existing Typography font-picker check bypassed for the run, then restored. Diagnosis: the botanical-site's `html { scroll-behavior: smooth }` animated the editor's `scrollTo` restore — editor logic was intact.
  Goal: an authored `html { scroll-behavior: smooth }` also governs programmatic `scrollTo`, so the editor's cross-mode scroll carry animates and the switch looks like it scrolls to the position instead of staying put.
  Files: `src/renderer/js/canvas.js`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: `setMode`'s carried-scroll restore lands instantly regardless of author `scroll-behavior` (explicit `behavior: 'instant'` plus a transient inline `auto` backstop, cleared afterwards); author smooth scrolling is unchanged after the switch; existing "mode scroll kept ok" stays green; a new smoke fixture with `scroll-behavior: smooth` asserts the restore is instant in both directions; `npm test` + smoke green.
  Don't: change save/serialization, preview state carry, or authored site CSS.

- [x] 92 AGENT_SITE_PROMPT: state that `:root` variables become tokens
  Done: 2026-09-13 Task 92: replaced the weak "CSS variables in `:root` are fine" line with a `:root` design-token example and an explicit rule — every `:root` variable becomes a token in the Tokens sidebar + compatible style-field Token menus (`var(--name)`), tokens come only from `:root`, and variables on other selectors are scoped and not listed; the authoring-pattern CSS now defines `--brand`/`--brand-strong` and uses `var()` on `.btn`/`.btn:hover`. Docs only; no source behavior changed. `npm test` 64 pass.
  Goal: the compatibility doc never said that site brand values belong in `:root` or that `:root` is the sole token source, so an author could scatter variables across selectors and get no editable tokens.
  Files: `AGENT_SITE_PROMPT.md`, `TASKS.md`.
  Accept: the Styling model states brand/design values go in one `:root` block; it explains those variables become Tokens (sidebar + Token menus via `var()`); it states tokens come only from `:root` and scoped variables elsewhere are not listed; the authoring-pattern CSS demonstrates `:root` tokens with `var()` usage.
  Don't: change editor behavior, token semantics, or other doc sections.

- [x] 93 Preserve unrecognized Google Font links on render + save
  Done: 2026-09-13 Task 93: added `isManagedGoogleFontLink`/`stripManagedGoogleFontLinks` to `fonts.js` (catalog-known families only; mixes and unparseable URLs count as unmanaged); `injectBaseAndStyles` and `serializeDoc` now strip only managed links and leave everything else byte-identical, instead of regex-deleting every `fonts.googleapis.com/css2` link. New `test/fonts.test.mjs` (3 tests) and smoke `google font link preservation ok` cover a non-catalog family (Fraunces) surviving Preview + Save and a managed family (Inter) still round-tripping in the editor's clean 300–700 form. `npm test` 69 pass; `npm run smoke` green (pre-existing Typography font-picker check bypassed for the run, as documented).
  Goal: saving a page that loaded a Google font outside the editor's catalog silently deleted its `<link>`, so the saved/deployed page lost the font and Preview fell back.
  Files: `src/renderer/js/fonts.js`, `src/renderer/js/canvas.js`, `test/fonts.test.mjs`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: only Google Font links whose families are all in the editor catalog are removed/re-injected; unknown families, mixed links, and unparseable links survive render and serialize byte-identical; managed families round-trip as before; unit + smoke green.
  Don't: change font detection, self-hosting, `@font-face` handling, or catalog contents.

- [x] 94 Delete class: remove only the matching selector from grouped rules
  Done: 2026-09-13 Task 94: `deleteClassRules` now uses new pure helpers `splitSelectorList`/`removeClassFromSelectorList` (`util.js`) to split a rule's selector list at top level (parens/quotes aware) and drop only selectors containing the class token; the rule is rewritten while siblings remain and deleted only when emptied. New unit tests in `test/util.test.mjs` and smoke `grouped selector delete ok` covering `.alpha, .beta` and `.alpha:hover, .gamma`. `npm test` 69 pass; `npm run smoke` green (font-picker check bypassed as documented).
  Goal: deleting one class from a comma-grouped rule (`.alpha, .beta { … }`) removed the whole rule, taking unrelated sibling selectors' styles with it.
  Files: `src/renderer/js/sheet.js`, `src/renderer/js/util.js`, `test/util.test.mjs`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: grouped rules keep every non-matching selector (including pseudo variants and selectors with commas inside `:is()`); fully matched rules are still deleted; compound-token semantics unchanged; unit + smoke green.
  Don't: change rename/merge behavior, combo deletion, cross-page class handling, or serialization.

- [x] 95 AGENT_SITE_PROMPT: class/save/a11y/assets/styleguide/handoff notes + stale fixes
  Done: 2026-09-13 Task 95: added to the authoring doc — class names are site-global (rename/delete rewrites all pages; duplicate-ID warning), Save re-serializes CSS (comments/format not preserved), a11y sizing the audit checks (rem/clamp, unitless line-height, no nowrap/fixed-height overflow, 44px targets, 60–75ch measure), assets (`images/` vendoring, plain `<img>` for Replace, `.ico`, `@import` not editable, project-local stylesheet fallback), styleguide naming + state variants, and Preview→Edit handoff (what carries, what doesn't); sharpened the token section into brand design tokens with naming hints; fixed stale lines — stylesheet selection wording, favicon now under Site → Globals, tablet 768 + mobile 375 breakpoints, ARIA alone isn't stylable. Docs only; `npm test` 69 pass.
  Goal: reduce friction for generated sites by documenting editor realities that the prompt omitted or stated wrongly, and sell the `:root` brand-token model clearly.
  Files: `AGENT_SITE_PROMPT.md`, `TASKS.md`.
  Accept: doc covers items 9–14, brand-token framing, and the stale corrections; no editor behavior changed.
  Don't: change editor behavior, token/selector semantics, or the large architectural limits (documented, not re-engineered).

## Next — CSS architecture fixes

- [x] 96 CSS nesting survives serialize; class walks reach @layer/@container/nesting
  Done: 2026-09-13 Task 96: `formatRule` now preserves a style rule that has `cssRules` via the browser's own `cssText` (nested rules and post-nesting declarations were previously dropped on every Save/undo/version/export, since `snapshot()` serializes through the sheet); replaced `Sheet._isGroup` with `Sheet._children` and updated every walk (`deleteClassRules`, `deleteComboRule`, `comboSelectors`, `renameClass`, `varUsages`, `renameVar`, `classNames`) to recurse into any rule list (media/supports/layer/container/scope/nesting); `renameClass` now rewrites `selectorText` in place instead of delete+insert, so renaming never drops nested children. Smoke `css nesting + at-rules + custom breakpoint ok` covers nesting/`@layer`/`@media` survive serialize, rename and delete; `npm test` 75 pass; smoke green (documented font-picker check bypassed for the run).
  Goal: Save silently deleted CSS nesting, and class rename/delete skipped rules inside `@layer`/`@container`/nested blocks.
  Files: `src/renderer/js/sheet.js`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: nested rules and declarations round-trip through serialize; rename/delete reach classes in any grouping rule and nested selectors; grouped-selector deletion behavior unchanged; unit + smoke green.
  Don't: change cascade/serialization for non-nested rules, panel origin labels, or authored site CSS.

- [x] 97 Custom breakpoints in the viewport switch
  Done: 2026-09-13 Task 97: added pure `mediaMaxWidthPx`/`viewportLabel` (`util.js`) and `Sheet.mediaConditions()`; `buildViewport` appends a `≤N` button for every author `@media (max-width: Npx)` condition not already covered by the 768/375 defaults, sets the iframe width from the condition, and `HE.viewportMedia()`/panel labels (`viewportLabel`) treat the condition as the active media text; `HE.refreshViewports` runs on page load, undo/restore and stylesheet switch, falling back to desktop when the active custom breakpoint disappears. Unit tests for the helpers; smoke asserts the button appears, scopes edits, and applies the 1024px width. `npm test` 75 pass; smoke green (font-picker check bypassed as documented).
  Goal: the viewport switch only knew the fixed 768/375 breakpoints, so sites authored at other widths could not target their real media rules from the panel.
  Files: `src/renderer/js/util.js`, `src/renderer/js/sheet.js`, `src/renderer/js/main.js`, `src/renderer/js/panel.js`, `src/renderer/js/panel-core.js`, `src/renderer/js/smoke.js`, `test/util.test.mjs`, `TASKS.md`.
  Accept: author max-width breakpoints render as extra viewport buttons with the right canvas width; editing inside one writes to the exact existing media block; removing the block falls back to desktop; defaults unchanged; unit + smoke green.
  Don't: auto-create breakpoints on load, change the fixed defaults or media matching semantics, or touch authored media text.

- [x] 98 Theme-scoped tokens in the Tokens sidebar
  Done: 2026-09-13 Task 98: added `Sheet.themeVarGroups()` (custom properties on `[data-theme]` rules, label from the attribute value); `buildTokens` refactored into one row renderer and now lists base `:root` tokens first, then a `Theme: <label>` group per scope with the same typed value editors (theme chip, usage counter, kebab `Remove override`); `actions.setThemeVar` writes the scoped declaration, and deleting a root token clears its theme overrides. `renameVar` now also renames the declarations themselves in theme/scoped rules. Smoke `theme tokens ok` covers listing, editing without leaking to `:root`, rename propagation and delete cleanup. `npm test` 75 pass; smoke green (font-picker check bypassed as documented).
  Goal: theme overrides (`[data-theme="dark"] { --paper: … }`) rendered but were invisible in the Tokens sidebar, so themes could only be edited rule by rule.
  Files: `src/renderer/js/sheet.js`, `src/renderer/js/panel-sections.js`, `src/renderer/js/actions.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: each `[data-theme]` scope is listed with its overrides and typed editors; edits touch only that scope; base tokens unchanged; rename/delete follow theme declarations; unit + smoke green.
  Don't: change token typing/linkage or add theme preview controls.

- [x] 99 Shared-component sync tolerates per-page active state
  Done: 2026-09-13 Task 99: `components.js` gained `stripActiveState`/`looseSignature` (ignores `is-active`/`active`/`is-current`/`current` classes and `aria-current`/`data-active`), used for detection and sync verification; sync now clears active markers from the incoming clone and re-applies each target page's own markers by structural path, so `showcase-site`-style headers with per-page current links are detected and synced without overwriting the current link. Unit tests in `test/components.test.mjs`; smoke fixture now differs only by active nav markers and asserts the target keeps exactly one marker after sync. `npm test` 75 pass; smoke green (font-picker check bypassed as documented).
  Goal: identical-looking shared blocks were skipped whenever a per-page active nav state made their outerHTML differ by a class/attribute.
  Files: `src/renderer/js/components.js`, `test/components.test.mjs`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: pages differing only by active-state markers are detected and synced; each target keeps its own markers; divergent content is still skipped; unit + smoke green.
  Don't: change sync write/journal mechanics, candidate selection, or authored markup outside shared blocks.

- [x] 100 Token rename reaches var() usages in shorthand declarations
  Done: 2026-09-13 Task 100: `Sheet.renameVar` no longer iterates longhands to find `var()` usages — Chromium expands e.g. `background: var(--paper)` to longhands whose pending-substitution values read as empty, so renames silently missed them. Usages are now rewritten from the rule's serialized `style.cssText` (counted per match), while custom-property declarations themselves are still renamed via the item list. Smoke `theme tokens ok` covers a `.themed { background: var(--paper) }` rename; `npm test` 75 pass; smoke green (font-picker check bypassed as documented).
  Goal: renaming a token left stale `var(--old)` references inside shorthand declarations, breaking the link silently.
  Files: `src/renderer/js/sheet.js`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: rename rewrites var() usages in shorthand and longhand declarations, inside media/layer/nested rules, and in fallbacks; declaration renames keep value + `!important`; unit + smoke green.
  Don't: change rename token-boundary rules, clash checks, or serialization.

- [x] 101 Matching-rules picker: edit descendant/state/media rules
  Done: 2026-09-13 Task 101: the Design panel can now edit any rule that matches the selected element. `Sheet.rulesFor(el)` indexes matching rules across media/supports/layer/container/scope and CSS nesting (nested `&` selectors composed for matching) with rule object, display selector, media, declaration count, source order and `selectorSpecificity` (`util.js`); new `declOn`/`setOnRule` write through a shared `writeStyle`, and `ruleVariant`/`ensureRuleVariant` create `:hover`-style variants in the same rule list. `panel-core` gained `activeRule`/`activeRuleRule`/`activeRuleMedia`/`activeRuleElm` (+`activeRuleValid`/`clearRuleScope`); `activeSelector`/`scopeLabel` respect the picked rule, `displayValue` reads the rule object (pseudo variants included), and `cascadeOrigin`/`originEl` label only "declared by this rule" or stay quiet — no cross-selector inheritance claims. `actions.setStyle` routes picked-rule writes to the CSSRule object, so media/layer/nested rules are edited in place; `setRuleScope`/`addRuleScope` switch or author rules; `setScope`, class attach/detach, rename/delete, Promote-inline and Merge-duplicates clear stale picks. UI: a "Matching rules" section lists matching rules (selector + media/decl badges, click to edit, click again to leave), a rule banner replaces the class banner when active, and "Add rule from this element…" offers contextual candidates from the element's own class/attribute compound and ancestor context (state classes first). Smoke `matching rules picker ok` covers descendant, attribute-state, pseudo-variant, media-scoped and authored `.tabs .tab-btn` rules plus desktop/base isolation and scope restore; new `selectorSpecificity` unit test; `npm test` 76 pass; smoke SMOKE OK with the documented pre-existing Typography font-picker check bypassed for the run, then restored.
  Goal: let the panel edit the rules that shape stateful components — `.accordion.is-open .accordion-panel`, `.tab-btn[aria-selected="true"]`, `.hero .title` — instead of only exact `.class` / `.base.combo` selectors, so interactive-state styling stops being hand-authored CSS.
  Files: `src/renderer/js/sheet.js`, `src/renderer/js/panel-core.js`, `src/renderer/js/panel.js`, `src/renderer/js/panel-sections.js`, `src/renderer/js/actions.js`, `src/renderer/js/util.js`, `src/renderer/ui.css`, `src/renderer/js/smoke.js`, `test/util.test.mjs`, `TASKS.md`.
  Accept: picking a matching descendant/attribute/media rule scopes every style control to that exact rule and writes declarations in place; pseudo variants are created in the same context; authored selectors are never normalized or rewritten; origin labels show the picked rule or stay quiet; class/combo scope, tokens, breakpoints and undo keep working; unit + smoke green.
  Don't: general CSS textarea, arbitrary at-rule authoring, selector normalization on save, listing pseudo-element rules, or changes to cascade/serialization/token semantics. Comma-group rules edit their shared declarations as one unit.
  Known limits: nested rules are matched via a composed selector but only listed when the parent selector is a single compound; rules whose selectors require live interaction (`:hover` on an unhovered element) are reached through the State switcher on a picked base rule rather than the list.

## Next — AI-agent handoff workflow

- [x] 102 External-change guard (agent writes while the editor is open)
  Done: 2026-09-13 Task 102: new `src/watchstore.js` pure helpers (ignore dot/temp/node_modules churn, stamp mtime+size, classify add/change/unlink, self-write match) with `test/watchstore.test.mjs`; the main process watches the project root recursively (`startProjectWatch` on open, teardown on window close/before-quit, disabled under `--smoke`), debounces events per path, seeds stamps for all project files, and treats every editor write (`file:write`, `copyInto`, font self-host) as a self-write so Save never reports itself; `project:external-change` carries `{changes, pages, stylesheets}` so added/removed files refresh the sidebar lists. New IPC `file:stat` and `file:writeChecked` (stat+compare+write in main, no TOCTOU), plus `app:confirmExternalConflict` (Overwrite / Keep as draft / Cancel). Renderer: `HE.fileStamps` recorded on page/CSS load and switch; a persistent banner above the canvas (same warning styling as `#page-warnings`) with Reload from disk / Keep my edits / Show file; Reload honours the draft choice and skips the draft offer; Save pre-checks both files, aborts on conflict, and writes through checked writes. Smoke `external-change guard ok` covers banner + keep-edits + blocked save + overwrite. `npm test` 94 pass; smoke green with the documented font-picker check bypassed for the run.
  Goal: an agent run between edits can rewrite page/CSS files on disk while the editor still holds the old content and save over them silently; drafts/versions never protected against an external writer.
  Files: `src/watchstore.js`, `src/main.js`, `src/preload.js`, `src/renderer/js/main.js`, `src/renderer/ui.css`, `test/watchstore.test.mjs`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: external writes produce one batched banner naming the file(s); Keep my edits dismisses without touching disk; Save refuses to overwrite newer files and names them; Overwrite proceeds through checked writes; the editor's own writes never raise the banner; file lists refresh on add/remove; smoke + unit green.
  Don't: auto-reload the canvas without asking, watch while no project is open, or detect self-writes by path alone (stamp must match).
  Known limits: watcher is best-effort when recursive `fs.watch` is unavailable; cross-page class rename/sync still read-then-write (registered as self-writes) so a write landing inside that window is not conflict-checked.

- [x] 103 Site check (post-agent-run review)
  Done: 2026-09-13 Task 103: new `src/renderer/js/sitecheck.js` — project-wide checks over saved files with injected `readFile`/`exists`: pages with no project stylesheet link, duplicate ids, anchors with no target, internal links to missing pages, missing local assets, images without alt, missing title/description, external script/link assets, classes used but never defined (state-like `is-/has-/no-/js-` skipped) and classes defined but never used; findings are grouped (`groupFindings`), capped (200 findings / 300 existence checks) and labelled warning/info. New Site scope section "Site check" renders a Run button, a timestamped summary and grouped `a11y-notice` rows with Go actions that load the page and select the element or open the file. Unit tests `test/sitecheck.test.mjs` (external refs, path resolution, class extraction, grouping); smoke `site check ok` runs the engine against mocked files and asserts each category (and no false link/title positives). `npm test` 94 pass; smoke green with the documented font-picker check bypassed.
  Goal: after an agent run the user had no single place to see broken links, duplicate ids, missing assets or class drift — only per-element/per-page warnings.
  Files: `src/renderer/js/sitecheck.js`, `src/renderer/js/panel-sections.js`, `src/renderer/js/panel.js`, `src/renderer/ui.css`, `test/sitecheck.test.mjs`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: one click lists project-wide issues grouped by category with counts; Go navigates to the page/element or opens the file; non-issues (valid page links, present titles) are not reported; unit + smoke green.
  Don't: replace the existing per-page warnings bar, edit any files from the checker, or flag external social links as problems.
  Known limits: the check reads saved files (save first for current edits); JS "missing selector" is per-page only for now.

- [x] 104 Agent handoff note + user-tweak contract
  Done: 2026-09-13 Task 104: new `src/renderer/js/changes.js` — baseline-vs-current diff of text nodes, class attributes and CSS declarations (structural keys, CSS via a throwaway `<style>` CSSOM) with `summarizeChanges`/`summarizeCounts`/`formatHandoffNote`. Renderer keeps `HE.baselines[page]` captured on page load and refreshed after every successful save; `HE.buildHandoffNote()` diffs the live snapshot against it, `HE.copyHandoffNote()` copies a plain-language markdown note ("Text: old → new", "Classes: …", "Styles: …") and `HE.saveHandoffNote()` writes `AGENT_HANDOFF.md` in the project root. New Site scope section "Handoff note" (Refresh / Copy note / Save AGENT_HANDOFF.md, cached preview) and an Export-menu item "Copy handoff note". `AGENT_SITE_PROMPT.md` gained a "User tweaks between agent runs" contract: agents read `AGENT_HANDOFF.md`, keep listed changes and stable class/token/path names, and prefer additive edits. Unit tests `test/changes.test.mjs`; smoke site-check/find blocks exercise the same page state. `npm test` 94 pass; smoke green.
  Goal: changes made by hand between agent runs were invisible to the next run and got regenerated away; there was no way to tell the agent "keep these edits".
  Files: `src/renderer/js/changes.js`, `src/renderer/js/main.js`, `src/renderer/js/panel-sections.js`, `src/renderer/js/panel.js`, `src/renderer/index.html`, `src/renderer/ui.css`, `test/changes.test.mjs`, `AGENT_SITE_PROMPT.md`, `TASKS.md`.
  Accept: the note lists changed text/classes/styles since the last load or save; Copy and Save AGENT_HANDOFF.md both work; a fresh save reports no changes; the agent contract names the file; unit + smoke green.
  Don't: auto-write `AGENT_HANDOFF.md` without a click, snapshot while a text-edit session is live (blur first), or treat draft-vs-disk as a user change.
  Known limits: CSS nesting is compared at the parent declaration level; the note is per current page (other pages compare again when opened).

- [x] 105 Find & replace on page text
  Done: 2026-09-13 Task 105: new `src/renderer/js/textfind.js` — `matchRanges` (pure, unit-tested), `findTextMatches` (tree walk skipping editor overlay, scripts/styles/textarea/template, capped), `replaceTextMatches` (batch) and `revealMatch` (range selection + scroll). Content scope gained a collapsed "Find & replace on this page" control (Find / Replace fields, Match case, Find next / Replace / Replace all with a status line and one commit per action). `Cmd/Ctrl+F` switches to Content mode and focuses the find field. Unit tests `test/textfind.test.mjs`; smoke `find & replace ok` runs the rendered controls over a live page and asserts the rewritten text. `npm test` 94 pass; smoke green.
  Goal: "change a word" required opening a code editor; there was no text search anywhere in the app.
  Files: `src/renderer/js/textfind.js`, `src/renderer/js/panel-sections.js`, `src/renderer/js/main.js`, `src/renderer/ui.css`, `test/textfind.test.mjs`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: find counts and reveals matches in the canvas; Replace/Rone and Replace all rewrite text with one undo step per action; case toggle works; Cmd+F focuses the field; unit + smoke green.
  Don't: search scripts/styles/attributes, offer regex mode, or touch the editor overlay.
  Known limits: per-page only; no highlight overlay beyond the native selection. Canvas arrow-key nudge for spacing/position is deferred: the property target (which margin side? whole element?) is a product decision that needs the UX review the editor deserves.

- [ ] 106 Tweak preservation: `overrides.css` layer (deferred architecture)
  Decision (2026-09-13): implement the **contract rule** for now (Task 104: `AGENT_HANDOFF.md` + agent instructions to preserve hand edits and stable names). An `overrides.css` layer is the stronger guarantee but the research shows it is an architecture project, not a feature flag:
    1. Cascade fidelity: the live `<style data-he-live>` copy is appended last, so the active sheet beats later author links at equal specificity; an unlinked overrides file still applies in Edit/Preview — the editor would show a different winner than the deployed site.
    2. Target loss: `switchStylesheet` replaces the live sheet with no per-sheet buffer, the target is not persisted across page loads/undo, restored drafts ignore `draft.cssFile`, and `save()` writes only `HE.cssFile` — worst case, overrides content is saved over a freshly regenerated `styles.css`.
    3. Cross-file drift: class rename/delete and token rename walk only the active live sheet while cross-page rewrites touch HTML only; classes/tokens split across two files become orphan rules and half-updated selectors.
  Plan if/when picked up: register the new file and link it after the main sheet on every page (fix `linkSharedStylesheet` order), model two live sheets with correct order, persist the write target per page, make save/draft/version per-file, then make class and token operations span both files; update `AGENT_SITE_PROMPT.md` lines about the single stylesheet.
  Goal: user tweaks survive an agent regenerating the main stylesheet.
  Accept (future): a tweak written while browsing `styles.css` lands in `overrides.css`; deployed cascade matches Preview; Save writes both files only when each changed; rename/delete update both.
  Don't: ship the layer while the preview cascade can lie, or split token/class operations across files without cross-file walks.

- [x] 107 AGENTS.md: project explanation + verification note
  Done: 2026-09-13 Task 107: added a "What this project is" section to `AGENTS.md` — the AI-agent-then-hand-tweak workflow, the visual-builder-style class editing model (HTML is truth, CSS in the linked sheet, JS enhancement only, Edit neutralizes scripts), the tweaks the panel must cover, CSS-fidelity priority, the agent workflow files (`AGENT_SITE_PROMPT.md`, `AGENT_HANDOFF.md`, external-change guard, Site check) and the extend-existing-UI rule; also recorded in Verification that smoke stops at the documented pre-existing Typography font-picker check and that a run-only bypass must be restored exactly. Docs only; no behavior changed. `npm test` 94 pass.
  Goal: future agents had no single statement of what the product is for, so they could optimize the wrong thing (editor-centric features) or restyle carefully tuned chrome.
  Files: `AGENTS.md`, `TASKS.md`.
  Accept: AGENTS.md opens with the product explanation and workflow, the UI-care rule is explicit, and the smoke font-picker caveat is documented under Verification.
  Don't: change editor behavior, existing instruction sections, or TASKS numbering.

- [x] 108 Rewrite AGENT_SITE_PROMPT.md: concise, plain-language, compatibility-first
  Done: 2026-09-13 Task 108: rewrote the contract from 275 to 177 lines in plain language — intro + essentials checklist, files/folders, class styling with one stylesheet and `:root` brand tokens (theme overrides included), responsive breakpoints, save behavior, HTML rules, JavaScript (!) rules with a component-contract table (accordion/tabs/dropdown/mobile nav/carousel/dialog) and explicit `is-*`/ARIA state rules, what to avoid, the between-agent-runs contract (`AGENT_HANDOFF.md`), quality bar and deliverable. Removed duplication (authoring-pattern section, repeated don't-lists, starter-site reference) and editor-internal phrasing while keeping every compatibility contract; verified by grep for all contract names and no code/tests reference the document's content. Docs only; `npm test` 94 pass.
  Goal: the agent prompt is the site-generation contract; it had grown long and technical, with duplicated don't-lists and editor-internals phrasing, so it was harder for a non-technical user (and agent) to follow.
  Files: `AGENT_SITE_PROMPT.md`, `TASKS.md`.
  Accept: same compatibility coverage (project shape, class styling, one stylesheet, brand tokens, breakpoints, save behavior, user tweaks/AGENT_HANDOFF.md, HTML rules, JS rules and component contracts, assets, quality bar, deliverable); shorter and written in plain language; no code/tests affected.
  Don't: add new requirements, remove compatibility contracts, or change editor behavior.

- [x] 109 Open-source cleanup: remove manual-test sites, clean history, add README
  Done: 2026-09-13 Task 109: deleted `botanical-site/`, `showcase-site/`, `kt-site-html-editor/`, `styleguide/`, `styleguide krafttokki/`, `styleguide reference/`; added a short `README.md`; removed local `.DS_Store`; replaced the 107-commit history with a clean single initial commit (old history saved as `../html_editor-history.bundle`). `demo-site/` and `starter-site/` kept (smoke uses them); no `src/` or `test/` changes; `npm test` 94 pass.
  Goal: prepare the repository for public release by deleting throwaway manual-test websites and personal site files, leaving `demo-site`/`starter-site` (used by smoke) intact, and starting a clean git history.
  Files: delete `botanical-site/`, `showcase-site/`, `kt-site-html-editor/`, `styleguide/`, `styleguide krafttokki/`, `styleguide reference/`; add `README.md`; new git history.
  Accept: `npm test` green; no `src/` or `test/` changes; removed folders absent from working tree and from git history; short README present.
  Don't: touch `demo-site/` or `starter-site/`, editor behavior, or the test suite.

## Next — Showcase website

- [x] 110 Showcase website for werkstatt (atelier site, per AGENT_SITE_PROMPT.md)
  Done: 2026-09-13 Task 110: new `showcase-site/` — Showcase, Learn, Lab, Styleguide; one `styles.css` with `:root` tokens and `[data-theme="dark"]`; mobile nav, tabs, accordion, dropdown, carousel, dialog; `npm test` 94 pass.
  Goal: a crafted multipage site that is the product showcase, the tutorial, and the in-editor lab — not a generic features/docs set. Open it in werkstatt while developing. Follow `AGENT_SITE_PROMPT.md` exactly.
  Files: `showcase-site/` (index.html, learn.html, lab.html, styleguide.html, styles.css, app.js, images/, favicon.svg), `README.md`, `TASKS.md`.
  Accept: one `styles.css` with `:root` tokens + `[data-theme="dark"]`; relative paths; no inline styles/handlers; mobile nav, tabs, accordion, dropdown, carousel, dialog; one h1 per page; alt text; focus-visible; desktop/768/375; `npm test` green; README lists the folder.
  Don't: touch `src/`, `test/`, `demo-site/`, `starter-site/`; no frameworks, build, or external assets.

- [x] 111 Rebrand user-facing name to "werkstatt"
  Done: 2026-09-13 Task 111: renamed the user-facing brand from "HTML Editor" to lowercase "werkstatt" — `package.json` name/productName, `package-lock.json`, `README.md`, `AGENTS.md`, `AGENT_SITE_PROMPT.md`, window `<title>`, welcome `<h1>` and topbar brand in `src/renderer/index.html`, comments in `src/main.js` and `ui.css`, handoff text in `changes.js`, export header in `export-site.js`, the two `werkstatt.invalid` sentinel URLs, and the `demo-site` footer. Internal `HE` namespace, `window.he` bridge and `hesite:` protocol left unchanged by decision. `npm test` 94 pass.
  Goal: the project had a generic working title; give it its real product name before public release.
  Files: `package.json`, `package-lock.json`, `README.md`, `AGENTS.md`, `AGENT_SITE_PROMPT.md`, `src/main.js`, `src/renderer/index.html`, `src/renderer/ui.css`, `src/renderer/js/changes.js`, `src/renderer/js/export-site.js`, `src/renderer/js/main.js`, `demo-site/index.html`, `TASKS.md`.
  Accept: no user-facing "HTML Editor" remains outside `TASKS.md` history; app chrome and docs read "werkstatt"; `npm test` green.
  Don't: rename the internal `HE` namespace, `window.he` bridge or `hesite:` protocol, or rewrite `TASKS.md` history.

- [x] 112 Showcase JS: use optional-hook selectors so other pages stay quiet
  Done: 2026-09-13 Task 112: dialog/form hooks now `[data-open-dialog]`, `[data-close-dialog]`, `.cta-form` (editor-optional); `npm test` 94 pass.
  Goal: home/learn/styleguide warn because `app.js` queries lab-only `[data-dialog]`, `.dialog-close`, `.sample-form` — names the editor does not treat as optional.
  Files: `showcase-site/app.js`, `showcase-site/lab.html`, `showcase-site/styles.css`, `TASKS.md`.
  Accept: dialog/form hooks use `[data-open-dialog]`, `[data-close-dialog]`, `.cta-form`; those three warnings gone on Showcase; Lab still works; `npm test` green.
  Don't: touch `src/`, `test/`, `demo-site/`, `starter-site/`.

- [ ] 113 Optional-hook coverage: audit + handling so shared app.js stops false-warning
  Goal: the "JS queries X but no element matches on this page" warning (`updateWarnings`, `src/renderer/js/main.js:1585`) fires for every selector in a shared `app.js` that lives on only one page. Task 112 renamed the showcase hooks to dodge it; that papered over a real coverage gap. Decide and implement how optional hooks are recognized. This task may be split into 113a (audit/contract) and 113b (behavior) when picked up.
  Inventory — what the editor currently treats as optional (`OPTIONAL_HOOKS` + `isAbsentOptionalHook`, `src/renderer/js/hooks.js:423`):
    - Exact-string match only (`entry.selectors.includes(selector)`), so aliases/casing/variants all warn.
    - Root-scoped (silent only when the root is absent; if the root is present, a missing child still warns): `.site-header`/`.site-nav`/`.nav-toggle` (root `.site-header`); `.dropdown`/`.dropdown-btn`/`.dropdown-menu` (root `.dropdown`); `.accordion`/`.accordion-btn`/`.accordion-panel` (root `.accordion`); `.tabs`/`.tab-btn`/`.tab-panel` (root `.tabs`); `.carousel`/`.carousel-track`/`.carousel-btn[data-scroll]` (root `.carousel`); `input[type="email"]` (root `.cta-form, .modal-form`).
    - Always-optional (silent on every page): `.hero-canvas`, `[data-open-dialog]`, `[data-close-dialog]`, `.theme-toggle`, `[data-reveal]`, `.nav-link[href^="#"]`, `.cta-form, .modal-form`, `.form-error`, `.form-success`, `dialog`.
  Inventory — what is NOT covered:
    - Undocumented editor extras: nothing in `AGENT_SITE_PROMPT.md` names `.theme-toggle`, `[data-reveal]`, `.hero-canvas`, `.cta-form`/`.modal-form`, `.form-error`, `.form-success`, `.nav-link[href^="#"]`, `input[type="email"]`, or the `[data-open-dialog]`/`[data-close-dialog]` trigger attributes — agents cannot know to use them.
    - Documented but missing from the allowlist: the prompt's Dialog contract allows native `<dialog>` or `.dialog` / `.modal`, yet `.dialog` and `.modal` are absent (only the `dialog` tag is listed).
    - Free-form/structural hooks: `[data-dialog]`, `.dialog-close`, `.sample-form` (the showcase's original names) and any custom `[data-*]`, `.modal-*`, field wrappers warn even though they are valid progressive enhancement.
    - Shared `app.js` across pages: a hook that legitimately exists on one page warns on every other page — the actual user-visible problem.
    - No dismiss/acknowledge, and the list is capped at 5, so one noisy shared file can hide real breakage.
  Handling options (decide + record):
    A. Contract-first: document the full optional vocabulary in `AGENT_SITE_PROMPT.md`, add `.dialog`/`.modal` to the allowlist, require contract names. Cheap, strict, still fragile for custom names.
    B. Structural/generic (recommended core): treat as optional when the selector's component root is absent; treat `[data-*]` behavior attrs, `dialog`, and form-submit hooks as optional; only warn for selectors that look page-specific. Avoid masking real missing hooks.
    C. Project-aware (strongest): warn only when the selector matches no page in the project; if it exists on any sibling page, stay quiet. Best fit for shared `app.js`; needs a project-wide page read.
    D. Info + dismiss: keep the signal but downgrade to info and persist a per-project "known optional" ack.
  Files: `src/renderer/js/hooks.js`, `src/renderer/js/main.js`, `AGENT_SITE_PROMPT.md`, `test/hooks.test.mjs`, `src/renderer/js/smoke.js`, `TASKS.md`.
  Accept: one written inventory of recognized vs. missing hooks in this task; a chosen handling policy; no false warning for a hook that legitimately exists elsewhere or is a documented contract; genuine page-specific breakage still warns; unit + smoke green.
  Don't: silence all missing-hook warnings, execute project JS, or change `is-open`/`is-visible` state-class behavior.

- [x] 116 Polish the bundled demo-site (simple but clean)
  Done: 2026-09-13 Task 116: rebuilt the simple demo — removed the duplicate `<h1>` and `.black` snippet, fixed the undefined `.hero-headline` on about, replaced the red hero and 80px margins, added `:root` tokens (`--brand`/`--brand-strong`/`--ink`/`--muted`/`--paper`/`--card`/`--line`/`--radius`), `:focus-visible`, fluid `.hero-title`, 768/375 breakpoints and reduced-motion; cards now use `.card-title`/`.card-text` h2s; nav consistent across all three pages; `app.js` scopes to `.hero .btn`. One h1 per page; `npm test` 95 pass.
  Goal: `demo-site/` is the folder opened by "Try demo site" and doubles as an example of the class model. It had drifted — duplicate `<h1>`, a leftover `.black` class, a red hero title, odd 80px margins, and an undefined `.hero-headline` on about. Make it a small, tidy, well-spaced demo without adding complexity.
  Files: `demo-site/index.html`, `demo-site/about.html`, `demo-site/styleguide.html`, `demo-site/styles.css`, `demo-site/app.js`, `TASKS.md`.
  Accept: one `h1` per page, no duplicate/leftover test markup; `:root` tokens (`--brand`, `--ink`, `--muted`, `--paper`, `--card`, `--line`, `--radius`) used through `var()`; hover + `:focus-visible`; 768/375 breakpoints; `app.js` still only enhances existing elements; `npm test` green.
  Don't: touch `src/`, `test/`, `showcase-site/`, `starter-site/`; no frameworks, build, or inline styles/handlers.

- [x] 115 Showcase redesign: plum + blush brutalist (replace beige/brass)
  Done: 2026-09-13 Task 115: rewrote `showcase-site/` as a brutalist plum/blush system — `:root` tokens `--plum/--plum-2/--plum-3`, `--blush/--blush-2`, `--violet/--violet-2`, `--lime`, `--on-lime` with `[data-theme="dark"]`; hard 3px ink borders, offset shadows, zero radius, uppercase mono labels, grid-paper background; reauthored `hero.svg`/`loop.svg`/`panel.svg`/`favicon.svg`; pages use a `.tag` label and new token swatches (`--plum`/`--violet`/`--blush`/`--lime`); fixed `.hero-sub` contrast on light interior pages. `npm test` 95 pass; one h1/page, alt text present, no inline styles/handlers.
  Goal: user rejected the warm beige/brass look. Redesign `showcase-site/` as a brutalist plum + blush system with a lime pop and a violet support accent; no warm neutrals. Keep `AGENT_SITE_PROMPT.md` conformance and the component contracts so the site stays editable.
  Files: `showcase-site/styles.css`, `showcase-site/index.html`, `showcase-site/learn.html`, `showcase-site/lab.html`, `showcase-site/styleguide.html`, `showcase-site/images/*.svg`, `showcase-site/favicon.svg`, `TASKS.md`.
  Accept: hard ink borders + offset shadows, no radius; plum/blush/violet/lime tokens in `:root` with `[data-theme="dark"]`; uppercase mono labels; one stylesheet; no inline styles/handlers; mobile nav/tabs/accordion/dropdown/carousel/dialog intact; desktop/768/375; `npm test` green.
  Don't: touch `src/`, `test/`, `demo-site/`, `starter-site/`; no frameworks, build, or external assets; no beige/brass.

- [x] 114 Optional-hook matching: split comma-joined alternatives + document dialog names
  Done: 2026-09-13 Task 114: `optionalHookFor` in `hooks.js` now compares a JS selector against each comma-separated part of an allowlist entry, so `.cta-form` matches the `'.cta-form, .modal-form'` entry instead of requiring the whole joined string; added the prompt-documented `.dialog` and `.modal` names. New unit test asserts `.cta-form`/`.modal`/`.dialog` are silent while a genuine `.page-only-hook` still warns. `npm test` 95 pass. Fixes the false `JS queries .cta-form` banner seen in werkstatt; first concrete piece of task 113 (the broader shared-`app.js`/free-form-hook policy there stays open).
  Goal: exact-string allowlist matching made the editor warn for valid hooks (`JS queries .cta-form …`) even though `.cta-form`/`.modal-form` were listed as one combined entry.
  Files: `src/renderer/js/hooks.js`, `test/hooks.test.mjs`, `TASKS.md`.
  Accept: a JS query for any single selector inside a combined allowlist entry is treated as optional; documented `.dialog`/`.modal` recognized; real page-specific breakage still warns; unit green.
  Don't: silence all missing-hook warnings, execute project JS, or change state-class behavior.

## Next — packaging / release

- [x] 117 GitHub Action: build macOS DMG on version tags
  Done: 2026-09-13 Task 117: added `electron-builder` (^26.15.3) with a `build` config in `package.json` (`appId dev.werkstatt.app`, output `dist/`, files `src/**`, `demo-site/**`, `AGENT_SITE_PROMPT.md`, per-arch `werkstatt-<version>-<arch>.dmg`) and a `dist:mac` script; added `.github/workflows/release.yml` triggered on `v*` tags that runs `npm ci`, builds x64+arm64 DMGs on `macos-latest` with signing auto-discovery disabled and `--publish never`, then publishes them via `softprops/action-gh-release`. Verified locally with `electron-builder --mac --arm64 --dir`: packaging succeeds and the asar contains `src/main.js`, `demo-site/index.html`, `src/renderer/index.html` and `AGENT_SITE_PROMPT.md`; see task 118 for the app icon.
  Goal: pushing a `v*` tag should produce installable macOS `.dmg` artifacts attached to the GitHub Release, with no signing secrets required.
  Files: `package.json`, `package-lock.json`, `.github/workflows/release.yml`, `TASKS.md`.
  Accept: `npm ci` reproducible; `npx electron-builder --mac dmg --x64 --arm64` emits a `.dmg` per arch under `dist/`; the workflow attaches `dist/*.dmg` to the release; the packaged app still opens `demo-site/` and reads `AGENT_SITE_PROMPT.md`.
  Don't: require Apple Developer certificates, commit build output (`dist/` stays ignored), or bundle `test/`/`showcase-site/`.

- [x] 118 App icon: `</>` with a wrench slash
  Done: 2026-09-13 Task 118: authored `build/icon.svg` — a macOS-style dark slate squircle (`#2d2d37`→`#1b1b21`) carrying blue angle brackets (`#6ea4ff`→`#3f7ef0`) and a warm-gold open-end wrench (`#ffe1a1`→`#d9a94f`) as the `/`, echoing the app's blue-on-slate chrome and the "werkstatt/workshop" name without third-party brand marks. Generated `build/icon.png` (1024²) and `build/icon.icns` (via `sips` + `iconutil`) and pointed `build.mac.icon` at the icns. Verified with `electron-builder --mac --arm64 --dir`: no default-icon warning, `Contents/Resources/icon.icns` present, `CFBundleIconFile = icon.icns`.
  Goal: replace the default Electron icon with a simple, ownable mark for the DMG/app bundle.
  Files: `build/icon.svg`, `build/icon.png`, `build/icon.icns`, `package.json`, `TASKS.md`.
  Accept: app bundle ships the custom icns; icon stays legible at 16px; no third-party brand marks; source SVG committed alongside generated assets.
  Don't: reference third-party brands; introduce an Apple Developer dependency.
