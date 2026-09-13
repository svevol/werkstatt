// External-change detection — pure helpers (no electron, no fs), unit-tested
// in node.
//
// The main process watches the project folder while it is open. Events are
// filtered (agents/editors write temp files, dotfiles, .git churn), debounced
// and compared against per-file stamps. Writes made by the editor itself are
// registered so a Save never reports itself as an external change.

const IGNORED_SEGMENTS = new Set(['node_modules']);
const IGNORED_SUFFIXES = ['.swp', '.swo', '.tmp', '.temp', '~'];
const IGNORED_PREFIXES = ['.#'];

function normalizeRel(rel) {
  return String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

// Dot-segments (.git, .DS_Store, .#locks), editor temp files and node_modules
// are never interesting to the user.
function isIgnoredRel(rel) {
  const p = normalizeRel(rel);
  if (!p) return true;
  const parts = p.split('/');
  if (parts.some((seg) => seg.startsWith('.') || IGNORED_SEGMENTS.has(seg))) return true;
  const base = parts[parts.length - 1];
  if (base === '.DS_Store') return true;
  if (IGNORED_PREFIXES.some((prefix) => base.startsWith(prefix))) return true;
  return IGNORED_SUFFIXES.some((suffix) => base.endsWith(suffix));
}

function stampOf(stat) {
  if (!stat) return null;
  return { mtimeMs: Number(stat.mtimeMs) || 0, size: Number(stat.size) || 0 };
}

function sameStamp(a, b) {
  if (!a || !b) return false;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

// Compare the previous stamp with the fresh stat: 'change' when metadata
// moved, 'add' when there was no previous stamp, 'unlink' when the file
// disappeared, null when unchanged/missing on both sides.
function classifyStamp(prev, next) {
  if (!next) return prev ? 'unlink' : null;
  if (!prev) return 'add';
  return sameStamp(prev, next) ? null : 'change';
}

// Is a fresh stat one of the editor's own recent writes? Entries expire so a
// later agent write to the same path is still reported.
function isSelfWrite(selfWrites, rel, next, nowMs, windowMs = 3000) {
  const entry = selfWrites && selfWrites.get(normalizeRel(rel));
  if (!entry) return false;
  if (nowMs - entry.at > windowMs) return false;
  return sameStamp(entry.stamp, next);
}

module.exports = {
  normalizeRel,
  isIgnoredRel,
  stampOf,
  sameStamp,
  classifyStamp,
  isSelfWrite,
};
