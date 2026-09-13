// Navigator — DOM tree of the current page.

import { HE } from './he.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META']);
const rowByEl = new Map();
const boxByEl = new Map();
const elByRow = new WeakMap();
// Collapse state keyed by element identity so it survives re-renders even
// when siblings are inserted, deleted, or reordered.
const collapsed = new WeakSet();
let contextMenu = null;
let menuTarget = null;
let menuTrigger = null;
let draggedEl = null;
let dropRow = null;

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

function labelFor(el) {
  const tag = el.tagName.toLowerCase();
  const classes = [...el.classList].map((c) => '.' + c).join('');
  return { tag, classes };
}

function ariaLabelFor(el) {
  const tag = el.tagName.toLowerCase();
  const classes = [...el.classList].map((c) => ' .' + c).join('');
  const id = el.id ? ' #' + el.id : '';
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  const snippet = text.length > 60 ? text.slice(0, 60) + '…' : text;
  return `${tag}${classes}${id}${snippet ? ': ' + snippet : ''}`;
}

function closeContextMenu(restoreFocus = false) {
  if (!contextMenu) return;
  contextMenu.hidden = true;
  const trigger = menuTrigger;
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  menuTarget = null;
  menuTrigger = null;
  if (restoreFocus && trigger && trigger.isConnected) {
    try { trigger.focus(); } catch { /* best-effort */ }
  }
}

function clearDropIndicator() {
  if (dropRow) {
    dropRow.classList.remove('drop-before', 'drop-after', 'drop-inside');
    dropRow = null;
  }
}

function canReorder(target, position) {
  if (HE.canvas.mode !== 'edit' || !draggedEl || target === draggedEl || draggedEl.contains(target)) {
    return false;
  }
  // A deeper ancestor is not a meaningful drop; only the current parent is.
  if (target.contains(draggedEl) && target !== draggedEl.parentElement) return false;
  if (position === 'inside') {
    return (
      HE.canvas.canContainChildren(target) &&
      !(draggedEl.parentElement === target && target.lastElementChild === draggedEl)
    );
  }
  return (
    draggedEl.parentElement === target.parentElement
  );
}

function setDropIndicator(row, position) {
  if (dropRow !== row) {
    clearDropIndicator();
    dropRow = row;
  }
  row.classList.toggle('drop-before', position === 'before');
  row.classList.toggle('drop-after', position === 'after');
  row.classList.toggle('drop-inside', position === 'inside');
}

function dropPosition(el, row, clientY) {
  const rect = row.getBoundingClientRect();
  const relativeY = (clientY - rect.top) / rect.height;
  if (relativeY > 0.3 && relativeY < 0.7 && HE.canvas.canContainChildren(el)) return 'inside';
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function openContextMenu(el, x, y, trigger = null) {
  if (!contextMenu) {
    contextMenu = document.createElement('div');
    contextMenu.className = 'tree-context-menu';
    contextMenu.setAttribute('role', 'menu');
    document.body.appendChild(contextMenu);
  }

  menuTarget = el;
  menuTrigger = trigger;
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
  contextMenu.innerHTML = '';
  for (const [label, title, action] of [
    ['Duplicate', 'Duplicate element', () => HE.canvas.duplicateSelected()],
    ['Copy', 'Copy element', () => HE.canvas.copySelected()],
    ['Paste', 'Paste copied element after this element', () => HE.canvas.pasteCopied()],
    ['Delete', 'Delete element', () => HE.canvas.deleteSelected()],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-menu-item';
    button.textContent = label;
    button.title = title;
    button.setAttribute('role', 'menuitem');
    if (label === 'Paste' && !HE.canvas.canPaste()) button.disabled = true;
    button.addEventListener('click', () => {
      HE.canvas.select(menuTarget);
      action();
      closeContextMenu(true);
    });
    contextMenu.appendChild(button);
  }

  contextMenu.hidden = false;
  const rect = contextMenu.getBoundingClientRect();
  contextMenu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
  contextMenu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
  contextMenu.querySelector('button')?.focus();
}

document.addEventListener('click', (e) => {
  if (contextMenu && !contextMenu.contains(e.target)) closeContextMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeContextMenu(true);
});

function setExpanded(entry, open) {
  const { box, toggle, row, el } = entry;
  if (!box) return;
  box.style.display = open ? '' : 'none';
  if (toggle) {
    toggle.textContent = open ? '▾' : '▸';
    toggle.setAttribute('aria-expanded', String(open));
  }
  if (row) row.setAttribute('aria-expanded', String(open));
  if (open) collapsed.delete(el);
  else collapsed.add(el);
}

function scrollRowIntoView(row) {
  try {
    row.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  } catch { /* best-effort */ }
}

function scrollElIntoView(el) {
  try {
    el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  } catch { /* best-effort */ }
}

function visibleRows() {
  const host = document.getElementById('tree');
  if (!host) return [];
  const rows = [];
  const visit = (container) => {
    for (const node of container.children) {
      const row = node.querySelector(':scope > .tree-row');
      if (row) rows.push(row);
      const kids = node.querySelector(':scope > .tree-children');
      if (kids && kids.style.display !== 'none') visit(kids);
    }
  };
  visit(host);
  return rows;
}

// Remember which row / control had focus so a rebuild can restore it.
function captureFocus() {
  const active = document.activeElement;
  if (!active || !active.classList) return null;
  const el = elByRow.get(active);
  if (!el) return null;
  if (active.classList.contains('tree-toggle')) return { el, kind: 'toggle' };
  if (active.classList.contains('tree-more')) return { el, kind: 'more' };
  return { el, kind: 'row' };
}

function restoreFocus(snap) {
  if (!snap) return false;
  const row = rowByEl.get(snap.el);
  if (!row) return false;
  let target = row;
  if (snap.kind === 'toggle') target = row.querySelector(':scope > .tree-toggle') || row;
  else if (snap.kind === 'more') target = row.querySelector(':scope > .tree-more') || row;
  try { target.focus({ preventScroll: true }); } catch { /* best-effort */ }
  return true;
}

function buildNode(el) {
  const node = document.createElement('div');
  node.className = 'tree-node';

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.tabIndex = 0;
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-label', ariaLabelFor(el));
  rowByEl.set(el, row);
  elByRow.set(row, el);

  const kids = [...el.children].filter(
    (c) => !SKIP_TAGS.has(c.tagName) && c.id !== 'he-overlay-root'
  );
  const hasKids = kids.length > 0;
  const open = !collapsed.has(el);

  let toggle = null;
  if (hasKids) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tree-toggle';
    toggle.textContent = open ? '▾' : '▸';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', `Expand or collapse ${el.tagName.toLowerCase()}`);
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = boxByEl.get(el);
      if (entry) setExpanded(entry, entry.box.style.display === 'none');
    });
  } else {
    toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = '·';
    toggle.setAttribute('aria-hidden', 'true');
  }
  elByRow.set(toggle, el);
  row.appendChild(toggle);
  if (hasKids) row.setAttribute('aria-expanded', String(open));

  const { tag, classes } = labelFor(el);
  const tagSpan = document.createElement('span');
  tagSpan.className = 'tree-tag';
  tagSpan.textContent = tag;
  row.appendChild(tagSpan);

  if (classes) {
    const clsSpan = document.createElement('span');
    clsSpan.className = 'tree-class';
    clsSpan.textContent = classes;
    row.appendChild(clsSpan);
  }

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'tree-more';
  more.textContent = '...';
  more.draggable = false;
  more.title = 'More actions';
  more.setAttribute('aria-label', `More actions for ${tag}`);
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  elByRow.set(more, el);
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = more.getBoundingClientRect();
    openContextMenu(el, rect.right - 4, rect.bottom + 2, more);
  });
  row.appendChild(more);

  row.addEventListener('click', () => {
    closeContextMenu();
    HE.canvas.select(el);
    scrollElIntoView(el);
  });

  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      closeContextMenu();
      HE.canvas.select(el);
      scrollElIntoView(el);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = visibleRows();
      const i = rows.indexOf(row);
      const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const entry = boxByEl.get(el);
      const isOpen = entry && entry.box.style.display !== 'none';
      if (e.key === 'ArrowRight') {
        if (entry && !isOpen) setExpanded(entry, true);
        else if (entry && isOpen) entry.box.querySelector(':scope > .tree-node > .tree-row')?.focus();
      } else if (entry && isOpen) {
        setExpanded(entry, false);
      } else {
        row.closest('.tree-node')?.parentElement?.closest('.tree-node')?.querySelector(':scope > .tree-row')?.focus();
      }
    }
  });

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    HE.canvas.select(el);
    openContextMenu(el, e.clientX, e.clientY);
  });

  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    if (HE.canvas.mode !== 'edit') {
      e.preventDefault();
      return;
    }
    draggedEl = el;
    closeContextMenu();
    HE.canvas.select(el);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'reorder-element');
  });

  row.addEventListener('dragover', (e) => {
    const position = dropPosition(el, row, e.clientY);
    if (!canReorder(el, position)) {
      clearDropIndicator();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropIndicator(row, position);
  });

  row.addEventListener('drop', (e) => {
    const position = dropPosition(el, row, e.clientY);
    if (!canReorder(el, position)) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropIndicator();
    HE.canvas.moveElement(draggedEl, el, position);
    draggedEl = null;
  });

  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    clearDropIndicator();
    draggedEl = null;
  });

  node.appendChild(row);

  if (hasKids) {
    const box = document.createElement('div');
    box.className = 'tree-children';
    box.setAttribute('role', 'group');
    if (!open) box.style.display = 'none';
    kids.forEach((kid) => box.appendChild(buildNode(kid)));
    node.appendChild(box);
    boxByEl.set(el, { box, toggle, row, el });
  }

  return node;
}

HE.tree = {
  rebuild() {
    closeContextMenu();
    clearDropIndicator();
    draggedEl = null;
    const host = document.getElementById('tree');
    if (!host) return;
    const focus = captureFocus();
    const scrollTop = host.scrollTop;
    rowByEl.clear();
    boxByEl.clear();
    host.innerHTML = '';
    const body = HE.canvas.doc && HE.canvas.doc.body;
    if (!body) return;
    [...body.children]
      .filter((c) => !SKIP_TAGS.has(c.tagName) && c.id !== 'he-overlay-root')
      .forEach((c) => host.appendChild(buildNode(c)));
    this.highlight(HE.canvas.selected);
    // Keep keyboard navigation alive: restore the focused row/control and the
    // panel scroll offset that the teardown above destroyed.
    if (focus) {
      host.scrollTop = scrollTop;
      restoreFocus(focus);
    }
    // Per-page JS-hook check: "JS queries .x but no element matches" must
    // re-evaluate after every tree rebuild (DOM change / page load).
    if (HE.refreshWarnings) {
      try {
        HE.refreshWarnings();
      } catch {
        /* best-effort */
      }
    }
  },

  highlight(el) {
    for (const row of rowByEl.values()) row.classList.remove('on');
    const row = el && rowByEl.get(el);
    if (!row) return;
    row.classList.add('on');
    // Reveal: expand collapsed ancestors so the selection is visible,
    // then bring the row into view.
    try {
      const doc = HE.canvas.doc;
      let a = el.parentElement;
      while (a && doc && a !== doc.body) {
        const entry = boxByEl.get(a);
        if (entry && entry.box.style.display === 'none') setExpanded(entry, true);
        a = a.parentElement;
      }
    } catch { /* best-effort */ }
    scrollRowIntoView(row);
  },
};
