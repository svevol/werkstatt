# Agent Instructions

## What this project is

werkstatt is a local Electron visual editor for real, hand-editable static
sites (plain HTML/CSS/JS, no build step). The target user creates a site with
an AI agent, then wants to tweak it themselves between agent runs — change a
word, nudge a margin, adjust an accent color or an open-state style — without
sending the agent a one-letter request.

- The editing model is class-based, visual-builder-inspired: click an
  element, edit its class rules in the right panel, save the same files the
  agent wrote. HTML is the source of truth; CSS lives in the linked
  stylesheet; JS is progressive enhancement only. Edit mode neutralizes
  scripts, Preview runs them.
- The panel must cover the small, common tweaks: text and image content,
  spacing/size controls, brand tokens (`:root`), theme overrides, custom
  breakpoints, matching descendant/state rules, find & replace.
- Fidelity over features: authored CSS (nesting, `@layer`/`@container`,
  complex selectors) must survive open → edit → save. Never trade correctness
  for editor convenience.
- The AI workflow matters as much as the editor: `AGENT_SITE_PROMPT.md` is the
  site-generation contract, `AGENT_HANDOFF.md` carries manual tweaks back to
  the next agent run, and the external-change guard plus Site check protect
  work when files change on disk or come back from a generation pass.
- UI/UX is deliberately tuned: extend existing sections and patterns, reuse
  existing styles, and do not delete or restyle working chrome.
- Tasks 93–106 in `TASKS.md` document these pieces and their known limits;
  read them before extending tokens, cascade/origin labels, matching rules,
  serialization/save or the agent workflow.

## Task Tracking

- Create or update a concrete task in `TASKS.md` for every user request before implementation.
- Keep each task specific enough to identify the requested behavior, files, acceptance checks, and exclusions.
- Mark a task complete only after verification; include the completion date and a short result.
- Preserve existing user changes in the worktree and do not silently fold unrelated work into a task.

## Style-Origin Contract

- An origin label is a change indicator, not an exhaustive CSS cascade report.
- In combo scope, label only declarations authored by the active compound selector. Values supplied by the base class, another class, a global selector such as `*`, a tag rule, an ancestor, or the browser default stay quiet.
- The same quiet rule applies in base scope when no active class declaration exists. Do not call a computed value `inherited` merely because it exists.
- Keep actual class-origin labels and real token/base linkage behavior. Do not remove rendered fallback values; remove only misleading origin noise.

## Verification

- Run the relevant unit and smoke tests after changes.
- `npm run smoke` stops at a pre-existing Typography font-picker check on clean HEAD (documented in `TASKS.md`). When a change needs the rest of the suite, bypass that one check for the run and restore it exactly afterwards; never commit the bypass.
- Before committing, inspect status and diff, and stage only files and hunks belonging to the requested task.
