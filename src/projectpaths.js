// Path gates for the main process. Pure helpers plus one fs check so unit
// tests can cover traversal without spinning up Electron.
//
// Lexical containment stops `../` before any syscall. The fs walk then
// refuses symlinks that resolve outside the project, including broken
// symlinks (realpath fails, and a later write would follow them).

const path = require('path');
const fs = require('fs/promises');

function isLexicalInside(root, candidate) {
  if (typeof candidate !== 'string' || candidate.includes('\0')) return false;
  if (typeof root !== 'string' || !root || root.includes('\0')) return false;
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === base || resolved.startsWith(base + path.sep);
}

// Project-relative path from a hesite URL pathname (already decoded once by
// the URL parser, then decoded once more here so a double-encoded `..` cannot
// sneak through). Dotfiles, `node_modules`, and parent segments are not served.
function hesitePathFromUrlPath(pathname) {
  let rel = String(pathname || '');
  if (rel.includes('\0')) return null;
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  if (rel.startsWith('/')) rel = rel.slice(1);
  if (!rel || rel.endsWith('/')) return null;
  const parts = rel.split('/');
  for (const part of parts) {
    // A leftover % means the segment was still encoded (for example %252e%252e).
    // Real ".." is either a segment here or was already collapsed by the URL parser.
    if (!part || part === '.' || part === '..' || part.startsWith('.') || part === 'node_modules' || part.includes('%')) {
      return null;
    }
  }
  return parts.join('/');
}

// Google Fonts CSS is fetched from fonts.googleapis.com. Only the woff2 files
// it points at on fonts.gstatic.com are downloaded — never an arbitrary host
// embedded in that CSS.
function isGoogleFontFileUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    return url.protocol === 'https:'
      && url.hostname === 'fonts.gstatic.com'
      && /\.woff2$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function assertInsideRoot(root, full) {
  if (!isLexicalInside(root, full)) throw new Error('Path outside project');
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(full);
  let rootReal = rootResolved;
  try {
    rootReal = await fs.realpath(rootResolved);
  } catch { /* missing root — lexical check already passed */ }
  let probe = resolved;
  for (;;) {
    let listed = null;
    try {
      listed = await fs.lstat(probe);
    } catch {
      listed = null;
    }
    if (listed && listed.isSymbolicLink()) {
      let real;
      try {
        real = await fs.realpath(probe);
      } catch {
        throw new Error('Path outside project');
      }
      if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
        throw new Error('Path outside project');
      }
      return resolved;
    }
    if (listed) {
      const real = await fs.realpath(probe);
      if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
        throw new Error('Path outside project');
      }
      return resolved;
    }
    const parent = path.dirname(probe);
    if (parent === probe) throw new Error('Path outside project');
    probe = parent;
  }
}

module.exports = {
  isLexicalInside,
  hesitePathFromUrlPath,
  isGoogleFontFileUrl,
  assertInsideRoot,
};
