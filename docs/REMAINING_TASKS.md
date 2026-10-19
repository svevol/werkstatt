# werkstatt: remaining tasks before launch

Start from branch `cursor/launch-polish-27a7` (PR #1) or merge it into `main` first. `main` does not have these fixes yet.

## Blockers

1. **Isolate the preview frame.** A nested iframe's `contentWindow.top` reaches the editor, so opening an untrusted site lets its scripts reach the editor. Give the canvas its own origin (for example a separate `hesite://` origin or a sandboxed `<webview>`/`BrowserView`) without losing the editor's `contentDocument` access. Add a smoke test that a nested iframe can't reach the editor.
2. **Ship signed builds for every platform.** Releases are unsigned macOS DMGs on `v*` tags only. Add macOS signing and notarization, a Windows installer (NSIS, ideally signed) and a Linux AppImage or deb to `.github/workflows/release.yml`. Link each download from the README.

## Security hardening

3. **Tighten the CSP.** Move the inline preview guard into a file or a nonce so `script-src` no longer needs `'unsafe-inline'`. Decide whether `http:` stays in the style/font/img/connect sources.
4. **Review `bypassCSP` on `hesite://`.** Keep it only if project files can't load any other way.
5. **Restrict `file:copyInto`.** It reads any absolute path the renderer passes, capped at 25 MB. Allow only paths the user chose in a dialog.
6. **Close the symlink race.** A symlink swapped between the check and the write isn't caught. Open with `O_NOFOLLOW` or check with `realpath` on the opened handle.
7. **Fix the case-insensitive path check.** On macOS a path that differs only in case can fail the lexical containment check. Compare real paths.
8. **Limit `gitdir`.** Only follow a worktree `.git` file that points outside the project when it's a real git layout (such as `../.git/modules`).
9. **Decide on DevTools and `document.write`.** Hide DevTools in production builds, or keep it on purpose and say so in the README.
10. **Fix `npm audit`.** The findings are in the electron-builder toolchain. Upgrade without breaking the release workflow.

## Fidelity

11. **Save keeps the author's formatting.** Saving rewrites the whole stylesheet and HTML skeleton. Changing one margin produced a 68-line `git diff`: every `0` became `0px`, CSS comments were deleted, `<html>` and `<head>` collapsed onto one line and blank lines were added. Patch only the changed declarations and nodes in the original text (task 95 in TASKS.md). This matters most, because a clean diff is the promise to people who use AI agents.

## Git and save UX

12. **Show uncommitted git changes.** The dirty dot only tracks the editor. Add a read-only `git status` hint next to the branch name.
13. **Label non-git history.** A folder that isn't a repo shows a bare `main`, which looks like a git branch. Show `History: main` instead.
14. **Fix the quit prompt.** It uses a synchronous dialog, which crashed with a GLib error on Linux. Use the async message box the leave and draft prompts already use.

## Cleanup

15. **Silence `ENOENT` in smoke.** `versions:list` and `drafts:clear` log `ENOENT` when the folder doesn't exist yet. Treat a missing folder as empty.
16. **Decide where TASKS.md lives.** It's a 155 KB dev log at the repo root, and `AGENTS.md` and `CONTRIBUTING.md` point to it. Move it to `docs/` and leave a stub, or keep it where it is.

## Done when

- `npm test` and `npm run smoke` pass
- Opening a hostile test site can't reach the editor
- Signed downloads exist for macOS, Windows and Linux
- No history rewrites or license changes
