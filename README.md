# HTML Editor

A local, visual editor for hand-written static sites (plain HTML/CSS/JS, no build
step). Open a folder, click an element, edit its class rules in the right panel,
and save the same files back to disk. HTML is the source of truth; CSS lives in
the linked stylesheet; JavaScript is progressive enhancement only.

- **Edit mode** neutralizes scripts; **Preview** runs them.
- Class-based editing inspired by visual site builders.
- Designed for sites written by an AI agent and tweaked by hand between runs.

## Requirements

- Node.js 18+
- macOS, Windows, or Linux

## Run

```bash
npm install
npm start
```

Use **Open site folder** to load a project, or **Try demo site** to open the
bundled `demo-site/`.

## Test

```bash
npm test        # unit tests
npm run smoke   # end-to-end smoke run (Electron)
```

## Layout

```
src/            Electron main process, preload, and renderer
  main.js       app entry and file/IPC layer
  preload.js    context bridge
  renderer/js/  editor UI (ES modules)
demo-site/      bundled example site
starter-site/   minimal starting template
test/           unit tests (node --test)
AGENT_SITE_PROMPT.md   contract for AI-generated sites
AGENTS.md              instructions for contributors/agents
TASKS.md               development log
```

## License

TBD.
