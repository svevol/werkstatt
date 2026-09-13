# AI agent prompt: HTML Editor–compatible website

Use the text below when asking an AI agent to create a website that opens and edits cleanly in this HTML Editor.

---

You are building a static multi-page website that a person will open and tweak in HTML Editor — a visual editor for real HTML and CSS files. They will change words, colors, spacing and interactive states between your runs. Follow these rules so everything stays editable and nothing you write gets lost.

## The essentials

- One website folder, plain files, no build step, no framework.
- `index.html` as the home page, plus any extra `.html` pages.
- One shared `styles.css` linked from every page.
- Style with clear class names; no inline `style=""`.
- Put brand values (colors, fonts, spacing, radii) in a single `:root` block.
- Real HTML holds the content; JavaScript only adds behavior.
- All paths are relative — images, styles, scripts and page links.

## Files and folders

```text
my-site/
  index.html
  about.html
  styleguide.html   # optional reference page
  styles.css
  AGENT_HANDOFF.md  # optional — the user's manual edits; read it if present
  app.js            # optional
  images/
    hero.jpg
```

- At least one `.html` file is required; `index.html` is expected as home.
- The editor ignores dotfiles and `node_modules`; do not include them.
- Keep file names and the folder layout stable on later runs.

## Styling with classes

- Give every meaningful element a class and style it through that class:
  good — `.hero-title { font-size: 44px; }`, `.btn:hover { background: #3d59e0; }`;
  avoid styling bare tags for layout (resets on `body`, `*`, `img` are fine).
- Class names are shared across the whole site. Renaming or deleting a class in the editor updates every page that uses it, so never reuse one name for two different things.
- Names like `.hero-title`, `.btn-primary`, `.site-header`, `.card` keep the panel readable. Utility-only piles (`mt-4 flex px-2`) are hard to edit — use named component classes.

### One stylesheet

- Link exactly one local stylesheet from every page:

  ```html
  <link rel="stylesheet" href="styles.css">
  ```

- The editor edits the first local stylesheet link it finds. Do not add extra sheets such as `reset.css`, and do not put rules behind `@import` — keep real rules in `styles.css`.
- Do not use CSS-in-JS, Tailwind-style utility soup, CSS modules, or shadow DOM components.

### Brand tokens

- Define the values that make the site look like itself in one `:root` block, then use them with `var()`:

  ```css
  :root {
    --brand: #4f6bff;
    --brand-strong: #3d59e0;
    --ink: #1a1a1a;
    --paper: #ffffff;
    --font-body: 'Inter', sans-serif;
    --space-lg: 2rem;
    --radius: 8px;
  }
  ```

- Every `:root` variable becomes an editable token in the editor: it gets its own sidebar entry and a token menu next to compatible style fields, and changing it once updates every user.
- Clear names help the editor sort them: `--brand-*` (colors), `--ink-*`, `--font-*`, `--space-*` (spacing), `--radius-*`, `--duration-*` (times).
- Tokens should cover the brand language — colors, type, rhythm, shape — not every one-off margin.
- Theme overrides belong in the same stylesheet, e.g.:

  ```css
  [data-theme="dark"] { --paper: #111111; --ink: #f5f5f5; }
  ```

  The editor lists those values with the theme, so the user can edit both themes from one place.

### Responsive design

- Build desktop-first with plain pixel breakpoints: `@media (max-width: 768px)` for tablet and `@media (max-width: 375px)` for mobile.
- The editor offers every `max-width` breakpoint it finds in the stylesheet. `min-width` and combined conditions still work in the browser, but the editor cannot target them from its viewport switch.
- Prefer flex/grid and `clamp()` over fixed pixel layouts.

### What happens when the editor saves

- It rewrites the stylesheet in a clean, normalized form. CSS comments are not kept, so keep formatting simple and do not park documentation in CSS.
- Avoid `!important`: it makes later manual tweaks fight the stylesheet.

## HTML

- Valid HTML5 with a proper head:

  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="styles.css">
    <title>…</title>
    <meta name="description" content="…">
  </head>
  <body>…</body>
  </html>
  ```

- Use semantic landmarks: `header`, `nav`, `main`, `section`, `footer`.
- Keep text in normal elements — headings, paragraphs, links, buttons, list items — so it can be double-clicked and edited. Do not bake text into images.
- Images: real `<img src="…" alt="…">` with relative paths, kept in an `images/` folder. A plain `<img>` can be swapped with one click; `<picture>` and `srcset` cannot. Give every image `alt` text.
- Links between pages use relative paths (`about.html`, `pages/contact.html`).
- Never repeat an `id`. Duplicates confuse anchors and scripts, and the editor warns about them. Use classes for anything that repeats.

## JavaScript

- HTML is the source of truth. Scripts may only add behavior to elements that already exist; they must not create the page's content or move content around. Anything a script builds at runtime is invisible in the editor.
- One external `app.js` is best (`<script src="app.js" defer></script>`). The editor can read it and explain each component to the user. Inline scripts still run in Preview, but the editor cannot explain them.
- External CDN scripts do not run in the editor's Preview. Put library code in the project as a local file, or use plain JavaScript.
- Use plain JavaScript (no React/Vue/jQuery), wire every instance — `document.querySelectorAll('.x').forEach(init)` — and guard each lookup with `if (!el) return;`, because users duplicate and delete blocks.
- Decorative canvas/WebGL backgrounds need a CSS fallback: the section must look finished with JavaScript switched off, and the canvas should be cleared transparently so it never hides the authored design.

### States are classes and attributes

- Express every interactive state as a class or attribute on an existing element, and style both states in CSS:
  - open/closed: `.is-open`, `hidden`, `aria-expanded`
  - active tab: `aria-selected="true"`, `hidden`
  - reveal on scroll: hidden is added by JavaScript, then `.is-visible` appears
  - mobile nav: `.is-open` on `.site-nav`
- The default state in the HTML matters: closed panels and menus carry `hidden`, and the visible tab is `aria-selected="true"` with no `hidden`.
- The editor remembers tabs, open accordions/dropdowns, the mobile nav and carousel position when moving between Edit and Preview. Dialogs, theme switches, form messages and scroll effects always come from the default HTML, so make those look right without JavaScript.
- Respect `prefers-reduced-motion`.

### Component contracts

Use these names so the editor recognizes each component and can show its states:

| Component | Markup | State |
|---|---|---|
| Accordion | `.accordion` > `.accordion-btn` + `.accordion-panel` | `.is-open` on the root, `aria-expanded` on the button, `hidden` on the panel |
| Tabs | `.tabs` > `.tab-btn` / `[role="tab"]` + `.tab-panel` / `[role="tabpanel"]` | `aria-selected`, `hidden`; one button per panel, same order |
| Dropdown | `.dropdown` > `.dropdown-btn` + `.dropdown-menu` | `.is-open`, `aria-expanded`, `hidden` |
| Mobile nav | `.site-header` > `.nav-toggle` + `.site-nav` | `.is-open` on `.site-nav`, `aria-expanded` on the button |
| Carousel | `.carousel` > `.carousel-track` + `.carousel-btn[data-scroll]` | real children in the HTML, horizontal scrolling |
| Dialog | native `<dialog>` or `.dialog` / `.modal` | dialog content lives in the HTML |

### Avoid

- SPA routers, frameworks (React/Vue/Svelte), or jQuery.
- Content built by JavaScript (fetch + `innerHTML`, client-side markdown). Content belongs in the HTML.
- DOM restructuring at load (wrappers, moving nodes); sliders and lightboxes that wrap children break the editor.
- `document.write`, auto-redirects, popups, or scroll-jacking.
- Inline event handlers (`onclick="…"`) — use `addEventListener` in `app.js`.
- Inline `style=` for design values; the panel cannot follow them, and JavaScript-set inline styles override the user's edits.

## Between agent runs

- The person will make small hand edits in the editor between your runs — a word, a margin, a color. Treat those edits as intentional work, not as drift to clean up.
- Read `AGENT_HANDOFF.md` in the site root if it exists. It lists their manual changes (text, classes, styles). Keep them unless the user explicitly asks to revert.
- Prefer small, targeted edits over regenerating a file. Keep existing class names, token names, breakpoints and file paths stable so the editor's links keep working.
- Re-read the page and stylesheet before rewriting them: the editor may have saved the user's changes since your last run.

## Quality bar

- Looks good at desktop, tablet (768px) and mobile (375px).
- Accessible basics: good contrast, `alt` text, labels on form fields, a visible `:focus-visible` outline, one `h1` per page, and semantic headings in order.
- Comfortable details: `rem`/`clamp()` font sizes, unitless `line-height`, no `white-space: nowrap` on text, no fixed-height text boxes with hidden overflow, touch targets at least 44px, and lines of text about 60–75 characters wide.
- Visible copy in plain words — no framework or DOM jargon.
- Readable formatting; do not minify.
- A `styleguide.html` page is a nice touch: one of each component and state, using the real classes, titled "Styleguide — optional reference". It is safe to exclude from deploy.

## Deliverable

Create the complete site folder with all pages, one `styles.css`, and assets. Output real static files only — no React/Next/Vite app, no package installs, no build step, no backend.
