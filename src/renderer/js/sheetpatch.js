// Formatted-preserving CSS save (fidelity task 11 / task 95).
//
// The live stylesheet is an overlay <style> in the canvas, so all edits go
// through the browser's CSSOM (what you see is exactly what it renders), and
// the CSSOM loses the author's formatting: comments, empty lines, and the
// difference between `0` and `0px`. Re-serializing the whole stylesheet on
// save made one margin change produce a 68-line diff — the promise to people
// who use AI agents is a clean diff, so save must not rewrite untouched text.
//
// The strategy: scan the ORIGINAL text into a rule tree with byte offsets,
// align it with the CSSOM rule tree by position (order + selector), and
// splice only the blocks whose declarations actually changed. Everything
// else — comments, blank lines, whitespace inside untouched blocks — is
// preserved byte for byte. If the trees no longer align (a rule was
// inserted/deleted/moved), fall back to the old full serialization.

// Comment/string/brace-aware cursor over CSS text.
function scanBlocks(text) {
  const root = { children: [] };
  const stack = [root];
  let i = 0;
  let start = 0; // offset of the current block's prelude start (or file start)
  const len = text.length;
  let quote = null;
  let depthOfComment = false;
  let braceDepth = 0;
  while (i < len) {
    const ch = text[i];
    const next = text[i + 1];
    if (depthOfComment) {
      if (ch === '*' && next === '/') { depthOfComment = false; i += 2; continue; }
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') { depthOfComment = true; i += 2; continue; }
    if (ch === '"' || ch === "'") { quote = ch; i += 1; continue; }
    if (ch === '{') {
      const parent = stack[stack.length - 1];
      const prelude = text.slice(start, i).trim();
      const node = { prelude, start, bodyStart: i + 1, children: [], parent };
      parent.children.push(node);
      stack.push(node);
      braceDepth += 1;
      i += 1;
      start = i;
      continue;
    }
    if (ch === '}') {
      const node = stack.pop();
      if (stack.length) {
        node.bodyEnd = i;
        node.end = i + 1;
        braceDepth = Math.max(0, braceDepth - 1);
      }
      i += 1;
      start = i;
      continue;
    }
    i += 1;
  }
  // Unterminated nesting — treat the whole stylesheet as unscannable.
  if (stack.length !== 1) return null;
  return root;
}

// Prelude text the CSSOM would report for a rule, for tree alignment.
// Realms differ between frames, so instanceof is unavailable — the class
// name identifies the group type.
function preludeOf(rule) {
  try {
    const kind = rule.constructor && rule.constructor.name;
    // CSSMediaRule has no .mediaText of its own — the condition lives on
    // .conditionText (CSSConditionRule) and .media.mediaText (MediaList).
    if (kind === 'CSSMediaRule') return '@media ' + (rule.conditionText || (rule.media && rule.media.mediaText) || '');
    if (kind === 'CSSSupportsRule') return '@supports ' + (rule.conditionText || '');
    if (kind === 'CSSContainerRule') return '@container ' + (rule.conditionText || '');
    if (kind === 'CSSLayerBlockRule') return '@layer ' + (rule.name || '');
    if (kind === 'CSSKeyframesRule') return '@keyframes ' + (rule.name || '');
    return rule.selectorText || '';
  } catch {
    return null;
  }
}

// A block is a declaration block (not a nested rule container) when its
// body holds declarations and not further braces. Comments may contain
// braces of their own — mirror the scanner's comment handling.
function isDeclarationBlock(node, text) {
  if (node.children.length) return false;
  const body = text.slice(node.bodyStart, node.bodyEnd);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '/' && body[i + 1] === '*') {
      i += 1;
      while (i < body.length && !(body[i] === '*' && body[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (ch === '{' || ch === '}') return false;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === '\\') i += 1;
        i += 1;
      }
    }
  }
  return true;
}

// Normalize a selector/prelude for tree alignment.
function normalizePrelude(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/\/\*.*?\*\//g, ' ').trim().toLowerCase();
}

// @keyframes children serialize `from`/`to` as `0%`/`100%`. Map the words
// before comparing so authored keyframe selectors still align. Only exact
// comma-separated keywords map — selectors merely containing those words
// (e.g. `.from-x`) are untouched.
function normalizeKeyPrelude(s) {
  return String(s || '').split(',').map((part) => {
    const t = part.trim().toLowerCase();
    if (t === 'from') return '0%';
    if (t === 'to') return '100%';
    return t;
  }).join(',');
}

function alignTrees(scanNode, cssParent, text) {
  const out = [];
  const scanChildren = scanNode.children;
  const cssChildren = cssParent.cssRules ? Array.from(cssParent.cssRules) : [];
  if (scanChildren.length !== cssChildren.length) return null;
  for (let i = 0; i < scanChildren.length; i++) {
    const node = scanChildren[i];
    const rule = cssChildren[i];
    const info = { node, rule };
    if (isDeclarationBlock(node, text)) {
      if (!rule.style) return null;
      // Style rules compare selectors; descriptor blocks such as
      // @font-face/@page have no representative selector in the CSSOM —
      // index alignment carries them.
      const nodePrelude = normalizePrelude(node.prelude);
      const descriptorBlock = /^\s*@/.test(node.prelude);
      if (!descriptorBlock) {
        const ruleKey = rule.keyText != null ? rule.keyText : rule.selectorText;
        const rulePrelude = normalizePrelude(preludeOf(rule));
        const altPrelude = normalizePrelude(ruleKey || '');
        const keysAlign = nodePrelude === rulePrelude || nodePrelude === altPrelude
          || normalizeKeyPrelude(nodePrelude) === normalizeKeyPrelude(altPrelude);
        if (!keysAlign) return null;
      }
      info.kind = 'decls';
    } else {
      if (!rule.cssRules) return null;
      const rulePrelude = preludeOf(rule);
      if (normalizePrelude(node.prelude) !== normalizePrelude(rulePrelude)) return null;
      info.kind = 'group';
      const children = alignTrees(node, rule, text);
      if (!children) return null;
      info.children = children;
    }
    out.push(info);
  }
  return out;
}

// Declarations as the live model reports them — parsed from style.cssText,
// NOT by iterating style properties. Iterating expands shorthands into
// longhands (margin → margin-top/…), and shorthands containing var() come
// back with empty longhand values, which would destroy the declaration on
// re-emit. cssText keeps the authored shape (sheet.js serializes the same
// way), so both the untouched check and the re-emit stay faithful.
function declsOfModel(style) {
  let cssText = '';
  try {
    cssText = (style && style.cssText) || '';
  } catch {
    return null;
  }
  const raw = declsOfListText(cssText, false);
  if (!raw) return null;
  return parseDecls(raw);
}

// Split declaration-list text on top-level semicolons, respecting quotes and
// parentheses. Disk text may carry comments (ignored for comparison, kept in
// the raw text); cssText never contains any.
function declsOfListText(text, withComments) {
  const raw = [];
  let cur = '';
  let quote = null;
  let round = 0;
  let comment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (comment) {
      if (ch === '*' && text[i + 1] === '/') { comment = false; i += 1; }
      continue;
    }
    if (quote) {
      cur += ch;
      if (ch === '\\') { cur += text[i + 1] || ''; i += 1; }
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") { quote = ch; cur += ch; }
    else if (withComments && ch === '/' && text[i + 1] === '*') {
      // Comments ride along in the raw text; the comparison ignores them.
      comment = true;
      i += 1;
      cur += ' ';
    }
    else if (ch === '(') { round += 1; cur += ch; }
    else if (ch === ')') { round = Math.max(0, round - 1); cur += ch; }
    else if (ch === ';' && round === 0) { raw.push(cur); cur = ''; }
    else if (ch === '{' || ch === '}') return null; // unexpected — unscannable
    else cur += ch;
  }
  if (cur.trim()) raw.push(cur);
  return raw;
}

function parseDecls(raw) {
  const out = [];
  for (const decl of raw) {
    const m = /^([^:]+?)\s*:\s*([\s\S]*)$/.exec(decl);
    if (!m) {
      if (decl.trim()) return null; // unknown construct — full re-emit instead
      continue;
    }
    const prop = m[1].trim();
    let value = m[2].replace(/\s+/g, ' ').trim();
    let pri = '';
    const imp = /(.*?)\s*!\s*important$/i.exec(value);
    if (imp) { value = imp[1].trim(); pri = 'important'; }
    out.push({ prop, value, pri });
  }
  return out;
}

// Raw declarations parsed from an original block body.
function declsOfRaw(body) {
  const raw = declsOfListText(body, true);
  if (!raw) return null;
  return parseDecls(raw);
}

// The CSSOM rewrites numbers in declared values ("0" becomes "0px", ".5em"
// becomes "0.5em"). For the untouched-vs-touched decision those spellings
// are equivalent — compare structurally: whitespace split, number
// canonicalization, zero-length tokens collapse to plain 0.
const ZERO_LEN_UNITS = new Set([
  'px', 'em', 'rem', '%', 'vh', 'vw', 'vmin', 'vmax', 'pt', 'in', 'cm', 'mm',
  'pc', 'ex', 'ch', 'lh', 'fr', 'q', 'deg', 'grad', 'rad', 'turn', 's', 'ms',
]);

function normVal(v) {
  const tokens = String(v || '').replace(/\s+/g, ' ').trim().toLowerCase().split(/[\s,]+/);
  return tokens.map((tok) => {
    if (tok === '0') return '0';
    // Only an all-zero magnitude collapses: 0px/0.0em → 0, but 0.5em stays.
    const m = /^0(?:\.0+)?([a-z%]+)$/.exec(tok);
    if (m && ZERO_LEN_UNITS.has(m[1])) return '0';
    let t = tok;
    t = t.replace(/^0(?=\.)/, '');
    // Trailing zeros in the fraction, before any unit: .50em → .5em.
    t = t.replace(/(\.\d*?)0+(?=[a-z%]*$)/, '$1').replace(/\.$/, '');
    return t;
  }).join(' ');
}

function declsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (normVal(x.prop) !== normVal(y.prop)) return false;
    if (normVal(x.value) !== normVal(y.value)) return false;
    if (x.pri.toLowerCase() !== y.pri.toLowerCase()) return false;
  }
  return true;
}

// Indentation of the line where the block starts — and, when discoverable,
// the indentation of the first declaration inside the block, so re-emitted
// blocks keep the author's depth and inner spacing. A sensible two-space
// fallback covers fresh blocks.
function indentOf(text, at) {
  const lineStart = text.lastIndexOf('\n', at);
  const slice = text.slice(lineStart + 1, at);
  const m = /^[ \t]*/.exec(slice);
  return m ? m[0] : '';
}

function innerIndentOf(text, node) {
  const body = text.slice(node.bodyStart, node.bodyEnd);
  for (const line of body.split('\n')) {
    const m = /^([ \t]*)\S/.exec(line);
    if (m && m[1]) return m[1];
  }
  return null;
}

// Re-emit one declaration block: the raw prelude (selector text, comments,
// whitespace) verbatim, and the braces + declarations in the author's
// indent style. The model declarations come from style.cssText (see
// declsOfModel), so the emitted shape matches what the full serializer
// would write for this block — shorthands stay shorthands.
function formatDeclBlock(modelDecls, text, node) {
  // Indent from the selector's own line: for nested rules node.start sits
  // right after the parent's `{`, so measure from the block's `{` instead.
  const indent = indentOf(text, node.bodyStart - 1);
  const inner = innerIndentOf(text, node) || (indent + '  ');
  // The prelude on disk keeps any comment above the selector — but drop
  // leading newlines or the splice will drift.
  const preludeRaw = text.slice(node.start, node.bodyStart - 1);
  const finalPrelude = preludeRaw.replace(/(^\n+)|\s+$/, '').trimEnd();
  const lines = [`${finalPrelude.length ? finalPrelude : indent} {`];
  for (const d of modelDecls) {
    lines.push(`${inner}${d.prop}: ${d.value}${d.pri ? ` !${d.pri}` : ''};`);
  }
  lines.push(`${indent}}`);
  // Comments inside a CHANGED block are dropped; untouched blocks keep them
  // verbatim. No trailing newline: the splice range already excludes the
  // original line break after `}`, and the following text supplies it.
  return lines.join('\n');
}

// Walk the aligned tree, splice changed leaf blocks. Runs edits from the
// end of the file backwards so earlier offsets stay valid. Returns false
// when a block is unscannable — the caller falls back to full serialization
// rather than emit a block it cannot read faithfully.
function collectSplices(infoList, text, out) {
  for (const info of infoList) {
    if (info.kind === 'decls') {
      const node = info.node;
      const raw = text.slice(node.bodyStart, node.bodyEnd);
      const rawDecls = declsOfRaw(raw);
      const modelDecls = declsOfModel(info.rule.style);
      if (!rawDecls || !modelDecls) return false;
      if (!declsEqual(rawDecls, modelDecls)) {
        out.push({
          start: node.start,
          end: node.end,
          text: formatDeclBlock(modelDecls, text, node),
        });
      }
    } else if (info.kind === 'group' && info.children) {
      if (!collectSplices(info.children, text, out)) return false;
    }
  }
  return true;
}

// Main entry: the current CSSOM rule model + the css text as last loaded
// from disk → css text with only the changed declaration blocks rewritten.
export function patchCssText(originalText, cssom) {
  const text = String(originalText || '');
  const rules = cssom && cssom.cssRules ? cssom : null;
  if (!rules) return null;
  const scan = scanBlocks(text);
  if (!scan) return null;
  const aligned = alignTrees(scan, rules, text);
  if (!aligned) return null;
  const splices = [];
  if (!collectSplices(aligned, text, splices)) return null;
  if (!splices.length) return text; // nothing changed → byte-identical save
  let out = text;
  for (const s of splices.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  return out;
}
