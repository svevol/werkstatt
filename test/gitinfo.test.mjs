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
