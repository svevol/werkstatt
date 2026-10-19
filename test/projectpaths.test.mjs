import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  isLexicalInside,
  hesitePathFromUrlPath,
  isGoogleFontFileUrl,
  assertInsideRoot,
} from '../src/projectpaths.js';

test('isLexicalInside rejects prefix siblings and parent segments', () => {
  const root = path.resolve('/tmp/werkstatt-site');
  assert.equal(isLexicalInside(root, path.join(root, 'index.html')), true);
  assert.equal(isLexicalInside(root, root), true);
  assert.equal(isLexicalInside(root, root + '-evil'), false);
  assert.equal(isLexicalInside(root, path.join(root, '..', 'etc', 'passwd')), false);
  assert.equal(isLexicalInside(root, root + '/index.html\0'), false);
});

test('hesitePathFromUrlPath serves site files and refuses traversal and dotfiles', () => {
  assert.equal(hesitePathFromUrlPath('/styles.css'), 'styles.css');
  assert.equal(hesitePathFromUrlPath('/fonts/inter.woff2'), 'fonts/inter.woff2');
  assert.equal(hesitePathFromUrlPath('/../../etc/passwd'), null);
  assert.equal(hesitePathFromUrlPath('/.env'), null);
  assert.equal(hesitePathFromUrlPath('/.git/HEAD'), null);
  assert.equal(hesitePathFromUrlPath('/assets/.hidden/logo.png'), null);
  assert.equal(hesitePathFromUrlPath('/node_modules/left-pad/index.js'), null);
  assert.equal(hesitePathFromUrlPath('/%2e%2e/%2e%2e/etc/passwd'), null);
  // The URL parser collapses a real ".." segment. A slash hidden as %2f survives
  // that pass and only becomes traversal after one decode — refuse it.
  assert.equal(hesitePathFromUrlPath(new URL('hesite://v/..%2f..%2fetc/passwd').pathname), null);
  // %252e%252e is a literal "%2e%2e" name after one decode. Don't serve it.
  assert.equal(hesitePathFromUrlPath(new URL('hesite://v/%252e%252e/secret.txt').pathname), null);
  assert.equal(hesitePathFromUrlPath('/'), null);
});

test('isGoogleFontFileUrl allows only fonts.gstatic.com woff2 files', () => {
  assert.equal(isGoogleFontFileUrl('https://fonts.gstatic.com/s/inter/v1/a.woff2'), true);
  assert.equal(isGoogleFontFileUrl('https://evil.example/a.woff2'), false);
  assert.equal(isGoogleFontFileUrl('http://fonts.gstatic.com/a.woff2'), false);
  assert.equal(isGoogleFontFileUrl('https://fonts.gstatic.com/a.woff'), false);
  assert.equal(isGoogleFontFileUrl('https://fonts.gstatic.com.evil.example/a.woff2'), false);
  assert.equal(isGoogleFontFileUrl('not a url'), false);
});

test('assertInsideRoot allows in-project files and rejects symlinks that escape', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'he-path-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'he-out-'));
  try {
    const file = path.join(root, 'index.html');
    await fs.writeFile(file, '<p>hi</p>');
    assert.equal(await assertInsideRoot(root, file), path.resolve(file));

    const insideLink = path.join(root, 'alias.html');
    await fs.symlink(file, insideLink);
    assert.equal(await assertInsideRoot(root, insideLink), path.resolve(insideLink));

    const outsideFile = path.join(outside, 'secret.txt');
    await fs.writeFile(outsideFile, 'nope');
    const outsideLink = path.join(root, 'leak');
    await fs.symlink(outsideFile, outsideLink);
    await assert.rejects(() => assertInsideRoot(root, outsideLink), /Path outside project/);

    const broken = path.join(root, 'broken');
    await fs.symlink(path.join(outside, 'missing.txt'), broken);
    await assert.rejects(() => assertInsideRoot(root, broken), /Path outside project/);

    await assert.rejects(
      () => assertInsideRoot(root, path.join(root, '..', path.basename(outside), 'secret.txt')),
      /Path outside project/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

// On case-insensitive filesystems (macOS APFS default), a path that only
// differs in case from the real project path is the same folder — the
// real-path walk must accept it even though the lexical compare refuses.
test('assertInsideRoot accepts a case-swapped path on case-insensitive volumes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'he-path-case-'));
  try {
    const subDir = path.join(root, 'sub');
    await fs.mkdir(subDir);
    const file = path.join(subDir, 'page.html');
    await fs.writeFile(file, '<p>hi</p>');
    const swappedSub = path.join(path.dirname(root), path.basename(root).toUpperCase(), 'sub', 'page.html');
    const swappedRoot = path.join(path.dirname(root), path.basename(root).toUpperCase());
    const swappedRootStat = await fs.stat(swappedRoot).then(() => true, () => false);
    if (swappedRootStat) {
      assert.equal(await assertInsideRoot(root, swappedSub), path.resolve(swappedSub));
    } else {
      await assert.rejects(() => assertInsideRoot(root, swappedSub), /Path outside project/);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
