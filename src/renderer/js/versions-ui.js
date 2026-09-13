// Versions + branches UI (Task 28: git-like history, local only).
//
// Manual Save snapshots; autosave drafts persist outside the folder and are
// offered back. Restore and branch-tip loads go into the canvas dirty —
// files change only on Save.

import { HE } from './he.js';

function timeLabel(prefix) {
  const now = new Date();
  return `${prefix} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function projectDir() {
  return HE.project && HE.project.dir;
}

HE.versions = {
  meta: null, // { currentBranch, branches, versions[] } — refreshed per project

  async refresh() {
    if (!projectDir() || !window.he.versions) return null;
    this.meta = await window.he.versions.list(projectDir());
    renderBranchName();
    return this.meta;
  },

  async snapshot(label, branch) {
    if (!projectDir() || !HE.page || !HE.canvas) return null;
    const snap = HE.canvas.editSnapshot();
    const v = await window.he.versions.snapshot({
      dir: projectDir(),
      label: label || timeLabel('Snapshot'),
      branch: branch || (this.meta && this.meta.currentBranch) || 'main',
      page: HE.page,
      cssFile: HE.cssFile,
      html: snap.html,
      css: snap.css,
    });
    await this.refresh().catch(() => null);
    return v;
  },

  async afterSave() {
    if (!projectDir() || !HE.page || !window.he.versions) return;
    if (HE.settings && HE.settings.historyUi === false) return; // off switch: files only
    try {
      if (!this.meta) await this.refresh();
      const branch = (this.meta && this.meta.currentBranch) || 'main';
      await this.snapshot(timeLabel('Saved'), branch);
    } catch {
      /* versions are best-effort — files are already saved */
    }
  },

  openHistory() {
    if (!HE.project) return;
    if (HE.settings && HE.settings.historyUi === false) {
      HE.toast('Editor history is off — enable it in Settings.', 'info');
      return;
    }
    renderHistoryModal();
    document.getElementById('history-overlay').hidden = false;
    this.refresh().then(() => renderHistoryModal()).catch(() => {
      HE.toast('Could not load versions.', 'error');
    });
  },

  closeHistory() {
    document.getElementById('history-overlay').hidden = true;
  },

  async takeSnapshot() {
    const input = document.getElementById('history-label');
    const label = (input && input.value.trim()) || timeLabel('Snapshot');
    try {
      await this.snapshot(label);
      if (input) input.value = '';
      HE.toast(`Snapshotted on ${(this.meta && this.meta.currentBranch) || 'main'}.`, 'success');
    } catch {
      HE.toast('Snapshot failed.', 'error');
    }
    renderHistoryModal();
  },

  async createBranch() {
    const input = document.getElementById('history-new-branch');
    const name = (input && input.value.trim()) || '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(name)) {
      HE.toast('Branch names: letters/numbers/._-, max 40 chars.', 'error');
      return;
    }
    try {
      if (HE.dirty) await HE.save(); // safety: current work versioned on old branch first
      await window.he.versions.createBranch(projectDir(), name);
      await this.refresh();
      if (input) input.value = '';
      HE.toast(`Branched to ${name}.`, 'success');
    } catch (e) {
      HE.toast('Could not create branch: ' + (e.message || e), 'error');
    }
    renderHistoryModal();
  },

  async selectBranch(name) {
    try {
      if (HE.dirty) await HE.save(); // safety first — lands on the old branch
      const { tip } = await window.he.versions.switchBranch(projectDir(), name);
      await this.refresh();
      renderHistoryModal();
      if (!tip) {
        HE.toast(`Switched to ${name} — no versions yet.`, 'info');
        return;
      }
      if (tip.page !== HE.page || tip.cssFile !== HE.cssFile) {
        HE.toast(`Switched to ${name} — tip is on ${tip.page}, open it to continue.`, 'info');
        return;
      }
      await loadVersionContent(tip.id, `Switched to ${name} — tip loaded for review.`);
    } catch (e) {
      HE.toast('Could not switch branch: ' + (e.message || e), 'error');
    }
  },

  async restore(id) {
    const v = (this.meta && this.meta.versions.find((x) => x.id === id)) || null;
    if (v && (v.page !== HE.page || v.cssFile !== HE.cssFile)) {
      HE.toast(`That version is for ${v.page} — open it first.`, 'error');
      return;
    }
    try {
      if (HE.dirty) await HE.save(); // safety: current work versioned before restore
      await loadVersionContent(id, 'Restored for review — Save to keep it.');
      renderHistoryModal();
    } catch (e) {
      HE.toast('Could not restore version: ' + (e.message || e), 'error');
    }
  },
};

// Load version content into the canvas dirty. Never writes project files —
// the user reviews, then Save (which snapshots on the current branch).
async function loadVersionContent(id, msg) {
  const v = await window.he.versions.get(projectDir(), id);
  if (v.page !== HE.page || v.cssFile !== HE.cssFile) {
    HE.toast(`That version is for ${v.page} — open it first.`, 'error');
    return;
  }
  HE.commit();
  await HE.canvas.loadPage(v.html, v.css);
  HE.afterDomChange(); // rebuilds tree/palette/crumbs + marks dirty
  if (msg) HE.toast(msg, 'success');
}

function renderBranchName() {
  const el = document.getElementById('branch-name');
  if (!el) return;
  const git = HE.gitInfo;
  if (git && git.isRepo && git.branch) {
    el.textContent = `git: ${git.branch}`;
    el.title = git.kind === 'detached'
      ? `Git repo — detached HEAD at ${git.branch}. The editor never writes into your folder; its own history lives under History.`
      : `Git branch: ${git.branch}. The editor never writes into your folder; its own history lives under History.`;
    return;
  }
  const branch = (HE.versions.meta && HE.versions.meta.currentBranch) || 'main';
  el.textContent = branch;
  el.title = `Editor history branch: ${branch}`;
}
HE.renderBranchName = renderBranchName;

// Test seam: apply detected git info (or clear it) and re-render the label.
HE.applyGitInfo = function (info) {
  HE.gitInfo = info || null;
  renderBranchName();
};

function formatVersionTime(ts) {
  try {
    return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function renderHistoryModal() {
  const meta = HE.versions.meta;
  const sel = document.getElementById('history-branch');
  const list = document.getElementById('history-list');
  if (!sel || !list) return;
  sel.innerHTML = '';
  list.innerHTML = '';
  if (!meta) {
    list.append(Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Loading…' }));
    return;
  }
  for (const b of meta.branches) {
    const o = document.createElement('option');
    o.value = b;
    o.textContent = b;
    if (b === meta.currentBranch) o.selected = true;
    sel.appendChild(o);
  }
  const shown = meta.versions.filter((v) => v.branch === meta.currentBranch);
  if (!shown.length) {
    list.append(Object.assign(document.createElement('li'), { className: 'muted', textContent: 'No versions on this branch yet — edit and Save.' }));
    return;
  }
  for (const v of shown) {
    const li = document.createElement('li');
    li.className = 'history-item';
    const main = document.createElement('span');
    main.className = 'history-main';
    main.textContent = v.label;
    main.title = `${v.page} · ${v.cssFile}`;
    const sub = document.createElement('span');
    sub.className = 'muted history-sub2';
    const otherPage = v.page !== HE.page || v.cssFile !== HE.cssFile;
    sub.textContent = `${formatVersionTime(v.createdAt)} · ${v.page}${otherPage ? ' (other page)' : ''}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Restore';
    btn.title = 'Load this version for review (files change only on Save)';
    btn.addEventListener('click', () => HE.versions.restore(v.id));
    li.append(main, sub, btn);
    list.appendChild(li);
  }
}
