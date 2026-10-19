import test from 'node:test';
import assert from 'node:assert/strict';

import gitinfo from '../src/gitinfo.js';

const { parseGitHead } = gitinfo;

test('parseGitHead reads branch refs including slashes', () => {
  assert.deepEqual(parseGitHead('ref: refs/heads/main\n'), { kind: 'branch', branch: 'main' });
  assert.deepEqual(parseGitHead('ref: refs/heads/feature/landing-page'), { kind: 'branch', branch: 'feature/landing-page' });
});

test('parseGitHead reports detached HEAD abbreviated', () => {
  assert.deepEqual(parseGitHead('9f3a2b1c4d5e6f7a8b9c0d1e2f3a4b5c\n'), { kind: 'detached', branch: '9f3a2b1' });
});

test('parseGitHead rejects empty and malformed content', () => {
  assert.deepEqual(parseGitHead(''), { kind: 'unknown' });
  assert.deepEqual(parseGitHead(null), { kind: 'unknown' });
  assert.deepEqual(parseGitHead('ref: refs/tags/v1.0'), { kind: 'unknown' });
  assert.deepEqual(parseGitHead('../../state'), { kind: 'unknown' });
});

test('isGitPointerTarget follows only real git layouts', () => {
  const t = (p) => getIsGitPointerTarget()(p);
  function getIsGitPointerTarget() {
    return gitinfo.isGitPointerTarget || (() => { throw new Error('missing export'); });
  }
  assert.equal(t('/repo/.git/worktrees/feature/HEAD-dir'), true);
  assert.equal(t('/repo/.git/worktrees/feature'), true);
  assert.equal(t('/repo/.git/modules/sub/HEAD'), true);
  assert.equal(t('/repo/.git/modules/sub'), true);
  assert.equal(t('/repo/.git'), true);
  assert.equal(t('/repo/.git/file.txt'), false);
  assert.equal(t('/repo/.gitpointers/x'), false);
  assert.equal(t('/repo/submodules/build/x'), false);
  assert.equal(t('/etc/secret/HEAD'), false);
  assert.equal(t('/some/project/.git/../.git/worktrees/w'), true);
  assert.equal(t(''), false);
  assert.equal(t(null), false);
});
