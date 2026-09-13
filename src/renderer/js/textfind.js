// Page text search + replace for Content mode.
//
// Walks the live canvas document's text nodes, skipping editor overlays and
// non-content tags. Pure range math is unit-tested; the DOM walkers run in
// the renderer and are covered by smoke.

const SKIP_TAGS = new Set(['script', 'style', 'textarea', 'template', 'noscript', 'title']);

export function matchRanges(haystack, needle, caseSensitive = false) {
  const out = [];
  const query = String(needle == null ? '' : needle);
  if (!query) return out;
  const hay = String(haystack == null ? '' : haystack);
  const h = caseSensitive ? hay : hay.toLowerCase();
  const q = caseSensitive ? query : query.toLowerCase();
  let i = 0;
  while (i <= h.length - q.length) {
    const at = h.indexOf(q, i);
    if (at === -1) break;
    out.push({ start: at, end: at + q.length });
    i = at + Math.max(1, q.length);
  }
  return out;
}

function isFindableNode(node) {
  if (!node || node.nodeType !== 3) return false;
  const parent = node.parentElement;
  if (!parent) return false;
  const tag = parent.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return false;
  if (parent.closest && parent.closest('#he-overlay-root')) return false;
  if (parent.closest && parent.closest('[data-he-script-type]')) return false;
  return !!(node.nodeValue && node.nodeValue.trim());
}

// [{ node, start, end }] in document order, capped for safety.
export function findTextMatches(doc, query, options = {}) {
  const { caseSensitive = false, limit = 500 } = options;
  const out = [];
  if (!doc || !doc.body || !query) return out;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (isFindableNode(node)) {
      for (const range of matchRanges(node.nodeValue, query, caseSensitive)) {
        out.push({ node, start: range.start, end: range.end });
        if (out.length >= limit) return out;
      }
    }
    node = walker.nextNode();
  }
  return out;
}

// Replace every match; returns the number of replacements. Callers commit once.
export function replaceTextMatches(doc, query, replacement, options = {}) {
  const { caseSensitive = false } = options;
  const matches = findTextMatches(doc, query, { caseSensitive, limit: 10000 });
  // Group per node and rebuild once: replacing in place would shift the
  // start/end indices of later matches inside the same text node.
  const byNode = new Map();
  for (const match of matches) {
    if (!byNode.has(match.node)) byNode.set(match.node, []);
    byNode.get(match.node).push(match);
  }
  let count = 0;
  for (const [node, list] of byNode) {
    const text = node.nodeValue || '';
    let out = '';
    let last = 0;
    for (const match of list) {
      out += text.slice(last, match.start) + String(replacement == null ? '' : replacement);
      last = match.end;
      count++;
    }
    out += text.slice(last);
    node.nodeValue = out;
  }
  return count;
}

// Select a match inside the canvas document and scroll it into view.
export function revealMatch(match) {
  if (!match || !match.node) return false;
  try {
    const doc = match.node.ownerDocument;
    const range = doc.createRange();
    range.setStart(match.node, match.start);
    range.setEnd(match.node, match.end);
    const win = doc.defaultView;
    const selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const el = match.node.parentElement;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    return true;
  } catch {
    return false;
  }
}

export default { matchRanges, findTextMatches, replaceTextMatches, revealMatch };
