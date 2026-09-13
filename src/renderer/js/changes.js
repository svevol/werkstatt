// Change summaries for the agent handoff note.
//
// The editor keeps a baseline of what it loaded from disk (and what it last
// saved). Comparing that baseline with the current page/CSS produces a short,
// plain-language list of manual edits the next agent run should preserve.
//
// Parsing is deliberately forgiving: text/class maps come from DOMParser,
// CSS declarations from a throwaway <style> element's CSSOM.

const SKIP_TAGS = new Set(['script', 'style', 'textarea', 'template', 'noscript', 'title', 'head']);

export function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function elementKey(el, index) {
  return `${el.tagName.toLowerCase()}[${index}]`;
}

function isSkipped(el) {
  if (!el || el.nodeType !== 1) return true;
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return true;
  if (el.id === 'he-overlay-root') return true;
  if (el.hasAttribute && el.hasAttribute('data-he-script-type')) return true;
  return false;
}

// Map of stable structural key -> trimmed text content (text nodes only).
export function collectTextEntries(doc) {
  const map = new Map();
  if (!doc || !doc.body) return map;
  const walkElement = (el, base) => {
    let index = 0;
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        const text = normalizeText(child.nodeValue);
        if (text) map.set(`${base} > text[${index}]`, text);
        index++;
        continue;
      }
      if (child.nodeType !== 1 || isSkipped(child)) continue;
      walkElement(child, `${base} > ${elementKey(child, index)}`);
      index++;
    }
  };
  walkElement(doc.body, 'body');
  return map;
}

// Map of stable structural key -> sorted class list.
export function collectClassEntries(doc) {
  const map = new Map();
  if (!doc || !doc.body) return map;
  const walkElement = (el, base) => {
    let index = 0;
    for (const child of el.children) {
      if (isSkipped(child)) continue;
      const key = `${base} > ${elementKey(child, index)}`;
      const classes = [...child.classList].sort().join(' ');
      if (classes) map.set(key, classes);
      walkElement(child, key);
      index++;
    }
  };
  walkElement(doc.body, 'body');
  return map;
}

// Map of `@media selector { prop }` -> value for every declaration.
export function collectCssDecls(cssText, hostDoc) {
  const map = new Map();
  const host = hostDoc || (typeof document !== 'undefined' ? document : null);
  if (!host || !host.createElement || !host.head) return map;
  const style = host.createElement('style');
  style.textContent = String(cssText || '');
  host.head.appendChild(style);
  try {
    const walk = (list, media) => {
      for (const rule of list) {
        if (rule.type === 4) {
          const inner = media ? `${media} and ${rule.conditionText}` : rule.conditionText;
          walk(rule.cssRules, inner);
          continue;
        }
        if (rule.type !== 1 || !rule.selectorText || !rule.style) continue;
        const prefix = media ? `@${media} ` : '';
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style.item(i);
          const value = rule.style.getPropertyValue(prop).trim();
          if (!value) continue;
          map.set(`${prefix}${rule.selectorText} { ${prop} }`, value);
        }
      }
    };
    walk(style.sheet.cssRules, '');
  } catch {
    /* unparseable baseline — return what we have */
  } finally {
    style.remove();
  }
  return map;
}

// Generic before/after diff over key->value maps.
export function diffEntries(before, after) {
  const changed = [];
  const added = [];
  const removed = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const a = before.get(key);
    const b = after.get(key);
    if (a === undefined && b !== undefined) added.push({ key, value: b });
    else if (a !== undefined && b === undefined) removed.push({ key, value: a });
    else if (a !== b) changed.push({ key, from: a, to: b });
  }
  return { changed, added, removed };
}

export function summarizeChanges({ baselineHtml, currentHtml, baselineCss, currentCss, hostDoc }) {
  const beforeDoc = new DOMParser().parseFromString(String(baselineHtml || ''), 'text/html');
  const afterDoc = new DOMParser().parseFromString(String(currentHtml || ''), 'text/html');
  return {
    text: diffEntries(collectTextEntries(beforeDoc), collectTextEntries(afterDoc)),
    classes: diffEntries(collectClassEntries(beforeDoc), collectClassEntries(afterDoc)),
    css: diffEntries(collectCssDecls(baselineCss, hostDoc), collectCssDecls(currentCss, hostDoc)),
  };
}

export function summarizeCounts(summary) {
  const count = (d) => d.changed.length + d.added.length + d.removed.length;
  return count(summary.text) + count(summary.classes) + count(summary.css);
}

function short(value, max = 48) {
  const text = normalizeText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function formatHandoffNote(summary, options = {}) {
  const lines = [];
  const when = options.when ? new Date(options.when).toLocaleString() : 'just now';
  lines.push(`# Manual edits — ${options.page || 'site'} (${when})`);
  lines.push('');
  lines.push('Made by hand in werkstatt after generation. Keep these changes unless asked otherwise, and do not regenerate over them.');
  const addSection = (title, diff, fmtChanged, fmtAdded, fmtRemoved) => {
    const total = diff.changed.length + diff.added.length + diff.removed.length;
    if (!total) return;
    lines.push('');
    lines.push(`## ${title} (${total})`);
    for (const c of diff.changed.slice(0, 15)) lines.push(`- ${fmtChanged(c)}`);
    for (const a of diff.added.slice(0, 10)) lines.push(`- ${fmtAdded(a)}`);
    for (const r of diff.removed.slice(0, 10)) lines.push(`- ${fmtRemoved(r)}`);
    const shown = Math.min(diff.changed.length, 15) + Math.min(diff.added.length, 10) + Math.min(diff.removed.length, 10);
    if (total > shown) lines.push(`- …and ${total - shown} more`);
  };
  addSection('Text',
    summary.text,
    (c) => `${c.key}: “${short(c.from)}” → “${short(c.to)}”`,
    (a) => `${a.key}: added “${short(a.value)}”`,
    (r) => `${r.key}: removed “${short(r.value)}”`);
  addSection('Classes',
    summary.classes,
    (c) => `${c.key}: ${c.from || '(none)'} → ${c.to || '(none)'}`,
    (a) => `${a.key}: added .${a.value.split(' ').join(' .')}`,
    (r) => `${r.key}: removed .${r.value.split(' ').join(' .')}`);
  addSection('Styles',
    summary.css,
    (c) => `${c.key}: ${short(c.from, 32)} → ${short(c.to, 32)}`,
    (a) => `${a.key}: added ${short(a.value, 32)}`,
    (r) => `${r.key}: removed ${short(r.value, 32)}`);
  if (lines.length === 3) {
    lines.push('');
    lines.push('No differences found against the loaded baseline.');
  }
  return lines.join('\n');
}

export default { summarizeChanges, summarizeCounts, formatHandoffNote, diffEntries };
