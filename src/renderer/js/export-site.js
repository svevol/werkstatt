// Export — copy site context for an AI agent + ZIP download (local only,
// no network, no deploy).

import { HE } from './he.js';
import { zipStore } from './zip.js';

async function collectExportFiles() {
  const out = [];
  if (!HE.project) return out;
  const snap = HE.canvas && HE.canvas.editSnapshot ? HE.canvas.editSnapshot() : null;
  for (const page of HE.project.pages) {
    if (page === HE.page && snap) out.push({ name: page, data: snap.html });
    else {
      try { out.push({ name: page, data: await window.he.readFile(page) }); }
      catch { /* skip unreadable */ }
    }
  }
  for (const css of HE.project.stylesheets || []) {
    if (css === HE.cssFile && snap) out.push({ name: css, data: snap.css });
    else {
      try { out.push({ name: css, data: await window.he.readFile(css) }); }
      catch { /* skip */ }
    }
  }
  for (const jf of HE.jsFiles || []) {
    if (jf.rel && jf.text != null) out.push({ name: jf.rel, data: jf.text });
  }
  return out;
}

HE.buildAiContext = async function () {
  if (!HE.project) return '';
  const snap = HE.canvas && HE.canvas.editSnapshot ? HE.canvas.editSnapshot() : { html: '', css: '' };
  let classes = [];
  try { classes = HE.sheet ? HE.sheet.classNames() : []; } catch { classes = []; }
  const lines = [
    '# Site context for AI agent (werkstatt export)',
    '',
    `- Pages: ${(HE.project.pages || []).join(', ')}`,
    `- Stylesheet: ${HE.cssFile || '(none)'}`,
    `- Classes: ${classes.join(', ')}`,
    `- JS: ${(HE.jsFiles || []).map((f) => f.rel).join(', ') || '(none)'}`,
    '',
    '## Current page: ' + HE.page,
    '```html',
    snap.html,
    '```',
    '',
    `## Shared CSS (${HE.cssFile || 'styles'})`,
    '```css',
    snap.css,
    '```',
    '',
    'Edit contract: HTML is truth, classes not inline, one shared CSS, JS only toggles classes (see AGENT_SITE_PROMPT.md).',
  ];
  return lines.join('\n');
};

HE.copyAiContext = async function () {
  const text = await HE.buildAiContext();
  try {
    await navigator.clipboard.writeText(text);
    HE.toast(`Copied ${text.length} chars of site context — paste back into your AI agent.`, 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); HE.toast(`Copied ${text.length} chars of site context.`, 'success'); }
    catch { HE.toast('Copy failed — select manually.', 'error'); }
    ta.remove();
  }
};

HE.exportZip = async function () {
  const files = await collectExportFiles();
  if (!files.length) { HE.toast('Nothing to export.', 'error'); return; }
  const blob = zipStore(files);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'site-export.zip';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};
