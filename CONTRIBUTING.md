# Contributing to werkstatt

Thanks for your interest. werkstatt is source-available but not OSI open
source, and the maintainer decides what lands. This file explains how to
propose a change and the terms that apply to anything you submit.

## Contribution terms

By submitting a pull request, patch, or any other contribution, you agree that:

1. You are the author of the contribution and have the right to submit it. If
   you created it as part of your employment or for a client, you have that
   party's permission.
2. You grant Svetlana Shepelin a perpetual, worldwide, non-exclusive,
   royalty-free, irrevocable, sublicensable, transferable license to use,
   reproduce, modify, distribute, and relicense your contribution, alone or as
   part of the project, under any license now or later.
3. You retain copyright to your contribution.
4. Your contribution is provided "as is", without warranty.

This is a lightweight inbound contribution grant, not a signed Contributor
License Agreement (CLA). If external contributions grow, it may be replaced by
a full, vetted CLA.

## Development

```bash
npm install
npm start          # open the editor
npm test           # unit tests
npm run smoke      # Electron smoke run; needs a display (xvfb-run on Linux)
```

The main process (`src/main.js`) owns the filesystem. The renderer talks to it
only through `src/preload.js`. Editor UI lives in `src/renderer/js/`.

## How to propose a change

1. Fork the repository and create a branch.
2. Keep the change focused: one concern per pull request.
3. Explain the why, and link a `TASKS.md` entry if one applies.
4. Run `npm test` before opening the pull request, and `npm run smoke` for
   any change that touches the editor UI.
5. Open the pull request against `main`.

The maintainer reviews and decides whether to merge. Not all pull requests
are merged.

## Scope

Contributions go to the base editor that ships under
[LICENSE.txt](LICENSE.txt). The paid add-ons (hosting, login/SSO,
collaboration) are separate and not open to external contribution.

## Practical notes

- Edit mode disables scripts; changes must preserve authored CSS fidelity
  (see [AGENTS.md](AGENTS.md) and [AGENT_SITE_PROMPT.md](AGENT_SITE_PROMPT.md)).
- Discuss new dependencies before adding them.
