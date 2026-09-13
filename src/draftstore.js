// Crash-safe drafts — pure helpers (no electron, no fs), unit-tested in node.
//
// Draft files live OUTSIDE the project folder (userData/drafts/<slug>/),
// one file per page. Filenames are base64url of the project-relative page
// path so slashes/unicode in page names can never escape the drafts folder.

const DRAFT_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

function draftFileName(page) {
  return Buffer.from(String(page), 'utf8').toString('base64url') + '.json';
}

function draftPageFromFile(name) {
  if (typeof name !== 'string' || !name.endsWith('.json')) return null;
  try {
    const page = Buffer.from(name.slice(0, -5), 'base64url').toString('utf8');
    if (!page || page.includes('\0')) return null;
    // Round-trip guard: crafted names that decode but would not re-encode
    // to themselves are rejected.
    if (draftFileName(page) !== name) return null;
    return page;
  } catch {
    return null;
  }
}

// A draft is stale when it has no usable timestamp, is older than the
// retention window, or (when the page list is known) targets a page that
// no longer exists in the project.
function isStaleDraft(summary, nowMs, knownPages) {
  const at = summary && summary.capturedAt;
  if (typeof at !== 'number' || !(at > 0)) return true;
  if (nowMs - at > DRAFT_MAX_AGE_MS) return true;
  if (Array.isArray(knownPages) && !knownPages.includes(summary.page)) return true;
  return false;
}

module.exports = { DRAFT_MAX_AGE_MS, draftFileName, draftPageFromFile, isStaleDraft };
