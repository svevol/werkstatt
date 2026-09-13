// Real-git awareness — pure .git/HEAD parsing (no git binary, read-only).
// The editor never writes into the project folder; this only informs the
// branch label so the built-in "Editor history" is never confused with git.

function parseGitHead(text) {
  const line = String(text || '').split('\n')[0].trim();
  if (!line) return { kind: 'unknown' };
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(line);
  if (ref) return { kind: 'branch', branch: ref[1] };
  if (/^[0-9a-f]{4,40}$/i.test(line)) return { kind: 'detached', branch: line.slice(0, 7) };
  return { kind: 'unknown' };
}

module.exports = { parseGitHead };
