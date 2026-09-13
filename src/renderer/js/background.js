// Pure helpers for CSS background-image layer values.

export function splitCssList(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return [];

  const parts = [];
  let current = '';
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (const ch of text) {
    if (quote) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (ch === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function parseBackgroundLayers(value) {
  const parts = splitCssList(value);
  if (parts.length === 1 && /^none(?:\s*!important)?$/i.test(parts[0])) return [];
  return parts;
}

export function serializeBackgroundLayers(layers) {
  return (layers || [])
    .map((layer) => String(layer == null ? '' : layer).trim())
    .filter(Boolean)
    .join(', ');
}

export function backgroundLayerKind(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text || text === 'none') return 'none';
  if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/.test(text)) return 'gradient';
  if (/^(?:-webkit-)?(?:url|image|image-set|cross-fade|element|paint)\s*\(/.test(text)) return 'image';
  return 'custom';
}

export function backgroundLayerLabel(value) {
  const kind = backgroundLayerKind(value);
  if (kind === 'none') return 'Empty';
  if (kind === 'gradient') return 'Gradient';
  if (kind === 'image') return 'Image';
  return 'CSS image';
}

export function reorderBackgroundLayers(layers, index, delta) {
  const next = [...(layers || [])];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
