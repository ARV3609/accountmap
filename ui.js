// ui.js — all DOM rendering. No framework: small template functions + direct
// event wiring. Kept intentionally simple so the whole app stays auditable.

import * as store from './store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function initials(str) {
  const parts = String(str || '?').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const LOGIN_METHODS = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'password', label: 'Email + password' },
  { id: 'apple', label: 'Apple' },
  { id: 'github', label: 'GitHub' },
  { id: 'microsoft', label: 'Microsoft' },
  { id: 'oauth', label: 'Other OAuth' },
  { id: 'unknown', label: 'Unknown' },
];
function methodLabel(id) { return (LOGIN_METHODS.find(m => m.id === id) || LOGIN_METHODS[LOGIN_METHODS.length-1]).label; }

const ACCOUNT_TYPES = ['work', 'client', 'personal', 'testing', 'other'];

/* ====================================================================== */
/* Router                                                                  */
/* ====================================================================== */
let currentView = 'dashboard';
let currentParam = null;

export function switchView(name, param = null) {
  currentView = name;
  currentParam = param;
  $$('.view').forEach(v => v.classList.add('hidden'));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $('#search-results-wrap').classList.add('hidden');
  $('#search-input').value = '';

  const mainNav = $('#main-nav');
  if (name === 'account-detail' || name === 'platform-detail' || name === 'settings') {
    // keep tabs visible but none active; detail pages are reachable from lists
  }

  const view = $('#view-' + name);
  view.classList.remove('hidden');

  if (name === 'dashboard') renderDashboard();
  else if (name === 'accounts') renderAccountsList();
  else if (name === 'platforms') renderPlatformsList();
  else if (name === 'account-detail') renderAccountDetail(param);
  else if (name === 'platform-detail') renderPlatformDetail(param);
  else if (name === 'settings') renderSettings();

  window.scrollTo(0, 0);
}

export function refreshCurrent() { switchView(currentView, currentParam); }

/* ====================================================================== */
/* Dashboard                                                               */
/* ====================================================================== */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function renderDashboard() {
  const s = store.stats();
  const el = $('#view-dashboard');

  if (s.accountCount === 0 && s.platformCount === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="motif"><div class="node filled"></div><div class="node"></div><div class="node"></div></div>
        <h3>Let's map your accounts</h3>
        <p>Add the Gmail accounts you use, then the platforms they're on. You'll be able to search either one instantly.</p>
        <button class="btn btn-primary" id="empty-add-account">Add your first account</button>
      </div>`;
    $('#empty-add-account').onclick = () => openAccountModal();
    return;
  }

  el.innerHTML = `
    <div class="greeting">
      <h1>${greeting()} 👋</h1>
      <p>Search above, or browse what you've mapped so far.</p>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="num mono">${s.accountCount}</div><div class="label">Accounts</div></div>
      <div class="stat-card"><div class="num mono">${s.platformCount}</div><div class="label">Platforms</div></div>
    </div>

    <div class="section-title"><h2>Recently added</h2></div>
    <div id="dash-recent"></div>

    <div class="section-title"><h2>Most-used accounts</h2></div>
    <div id="dash-most-used"></div>
  `;

  const recentEl = $('#dash-recent');
  if (s.recent.length === 0) {
    recentEl.innerHTML = `<div class="search-empty">No connections yet — link an account to a platform to see it here.</div>`;
  } else {
    recentEl.innerHTML = s.recent.map(r => rowCardHTML({
      title: r.platform.name, sub: r.account.email, badge: methodLabel(r.connection.loginMethod),
      dataset: `data-goto="platform" data-id="${r.platform.id}"`, avatarText: initials(r.platform.name),
    })).join('');
  }

  const mostEl = $('#dash-most-used');
  if (s.mostUsed.length === 0) {
    mostEl.innerHTML = `<div class="search-empty">Once accounts are linked to platforms, your busiest accounts show up here.</div>`;
  } else {
    mostEl.innerHTML = s.mostUsed.map(r => rowCardHTML({
      title: r.account.email, sub: r.account.organization || r.account.type, badge: `${r.count} platform${r.count===1?'':'s'}`,
      dataset: `data-goto="account" data-id="${r.account.id}"`, avatarText: initials(r.account.name || r.account.email),
    })).join('');
  }

  wireRowCardNav(el);
}

function rowCardHTML({ title, sub, badge, dataset, avatarText }) {
  return `
    <div class="row-card" ${dataset}>
      <div class="swatch">${esc(avatarText || '?')}</div>
      <div class="meta">
        <div class="title">${esc(title)}</div>
        <div class="sub mono">${esc(sub || '')}</div>
      </div>
      ${badge ? `<div class="count-pill">${esc(badge)}</div>` : ''}
    </div>`;
}

function wireRowCardNav(root) {
  $$('.row-card[data-goto]', root).forEach(card => {
    card.addEventListener('click', () => {
      const kind = card.dataset.goto, id = card.dataset.id;
      if (kind === 'account') switchView('account-detail', id);
      else if (kind === 'platform') switchView('platform-detail', id);
    });
  });
}

/* ====================================================================== */
/* Accounts list                                                           */
/* ====================================================================== */
function renderAccountsList() {
  const el = $('#view-accounts');
  const accounts = store.listAccounts().sort((a,b) => (a.name||a.email).localeCompare(b.name||b.email));

  if (accounts.length === 0) {
    el.innerHTML = emptyStateHTML('No accounts yet', 'Add the Gmail or work accounts you use — one at a time, or as you go.', 'Add account');
    $('#empty-cta', el).onclick = () => openAccountModal();
    return;
  }

  el.innerHTML = `<div class="section-title"><h2>${accounts.length} account${accounts.length===1?'':'s'}</h2></div><div id="accounts-list"></div>`;
  $('#accounts-list').innerHTML = accounts.map(a => rowCardHTML({
    title: a.name || a.email, sub: a.email, badge: `${store.connectionsForAccount(a.id).length} platforms`,
    dataset: `data-goto="account" data-id="${a.id}"`, avatarText: initials(a.name || a.email),
  })).join('');
  wireRowCardNav(el);
}

/* ====================================================================== */
/* Platforms list                                                          */
/* ====================================================================== */
function renderPlatformsList() {
  const el = $('#view-platforms');
  const platforms = store.listPlatforms().sort((a,b) => a.name.localeCompare(b.name));

  if (platforms.length === 0) {
    el.innerHTML = emptyStateHTML('No platforms yet', 'Add a website or service, then link the account you use on it.', 'Add platform');
    $('#empty-cta', el).onclick = () => openPlatformModal();
    return;
  }

  el.innerHTML = `<div class="section-title"><h2>${platforms.length} platform${platforms.length===1?'':'s'}</h2></div><div id="platforms-list"></div>`;
  $('#platforms-list').innerHTML = platforms.map(p => rowCardHTML({
    title: p.name, sub: p.category || p.url, badge: `${store.connectionsForPlatform(p.id).length} account${store.connectionsForPlatform(p.id).length===1?'':'s'}`,
    dataset: `data-goto="platform" data-id="${p.id}"`, avatarText: initials(p.name),
  })).join('');
  wireRowCardNav(el);
}

function emptyStateHTML(title, body, cta) {
  return `
    <div class="empty-state">
      <div class="motif"><div class="node"></div><div class="node filled"></div><div class="node"></div></div>
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
      <button class="btn btn-primary" id="empty-cta">${esc(cta)}</button>
    </div>`;
}

/* ====================================================================== */
/* Account detail                                                          */
/* ====================================================================== */
function renderAccountDetail(id) {
  const el = $('#view-account-detail');
  const a = store.getAccount(id);
  if (!a) { switchView('accounts'); return; }
  const conns = store.connectionsForAccount(id).map(c => ({ c, platform: store.getPlatform(c.platformId) })).filter(x => x.platform);

  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="back-btn">&larr; Back</button>
    <div class="detail-header">
      <div class="swatch-lg">${esc(initials(a.name || a.email))}</div>
      <div>
        <h1>${esc(a.name || a.email)}</h1>
        <div class="sub">${esc(a.email)}</div>
      </div>
    </div>
    <div class="tag-list">
      <span class="tag-pill">${esc(a.type)}</span>
      ${a.organization ? `<span class="tag-pill">${esc(a.organization)}</span>` : ''}
      ${(a.tags||[]).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}
    </div>
    ${a.notes ? `<p style="font-size:14px;color:var(--ink-soft);margin-top:10px;">${esc(a.notes)}</p>` : ''}

    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn btn-sm" id="copy-email">Copy email</button>
      <button class="btn btn-sm" id="edit-account">Edit</button>
      <button class="btn btn-sm btn-danger" id="delete-account">Delete</button>
    </div>

    <div class="section-title"><h2>Linked platforms (${conns.length})</h2>
      <span class="link" id="add-conn-from-account">+ Link a platform</span>
    </div>
    <div id="account-conns"></div>
  `;

  $('#back-btn').onclick = () => switchView('accounts');
  $('#copy-email').onclick = () => { navigator.clipboard?.writeText(a.email); toast('Email copied'); };
  $('#edit-account').onclick = () => openAccountModal(a);
  $('#delete-account').onclick = () => confirmThen(`Delete ${a.email}? This also removes its ${conns.length} platform link${conns.length===1?'':'s'}.`, () => {
    store.deleteAccount(a.id); toast('Account deleted'); switchView('accounts');
  });
  $('#add-conn-from-account').onclick = () => openConnectionModal({ accountId: a.id });

  const connsEl = $('#account-conns');
  connsEl.innerHTML = conns.length === 0
    ? `<div class="search-empty">Not linked to any platform yet.</div>`
    : conns.map(({c, platform}) => connItemHTML(c, platform.name, platform.category || platform.url)).join('');
  wireConnItems(connsEl, conns.map(x => x.c));
}

/* ====================================================================== */
/* Platform detail                                                         */
/* ====================================================================== */
function renderPlatformDetail(id) {
  const el = $('#view-platform-detail');
  const p = store.getPlatform(id);
  if (!p) { switchView('platforms'); return; }
  const conns = store.connectionsForPlatform(id).map(c => ({ c, account: store.getAccount(c.accountId) })).filter(x => x.account);

  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="back-btn">&larr; Back</button>
    <div class="detail-header">
      <div class="swatch-lg">${esc(initials(p.name))}</div>
      <div>
        <h1>${esc(p.name)}</h1>
        <div class="sub">${esc(p.url || p.category || '')}</div>
      </div>
    </div>
    <div class="tag-list">
      ${p.category ? `<span class="tag-pill">${esc(p.category)}</span>` : ''}
      ${(p.tags||[]).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}
    </div>
    ${p.notes ? `<p style="font-size:14px;color:var(--ink-soft);margin-top:10px;">${esc(p.notes)}</p>` : ''}

    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn btn-sm" id="edit-platform">Edit</button>
      <button class="btn btn-sm btn-danger" id="delete-platform">Delete</button>
    </div>

    <div class="section-title"><h2>Accounts used here (${conns.length})</h2>
      <span class="link" id="add-conn-from-platform">+ Link an account</span>
    </div>
    <div id="platform-conns"></div>
  `;

  $('#back-btn').onclick = () => switchView('platforms');
  $('#edit-platform').onclick = () => openPlatformModal(p);
  $('#delete-platform').onclick = () => confirmThen(`Delete ${p.name}? This also removes its ${conns.length} account link${conns.length===1?'':'s'}.`, () => {
    store.deletePlatform(p.id); toast('Platform deleted'); switchView('platforms');
  });
  $('#add-conn-from-platform').onclick = () => openConnectionModal({ platformId: p.id });

  const connsEl = $('#platform-conns');
  connsEl.innerHTML = conns.length === 0
    ? `<div class="search-empty">No account linked yet.</div>`
    : conns.map(({c, account}) => connItemHTML(c, account.email, account.organization || account.type, true)).join('');
  wireConnItems(connsEl, conns.map(x => x.c));
}

function connItemHTML(c, title, sub, isEmail) {
  return `
    <div class="conn-item" data-conn="${c.id}">
      <div>
        <div class="title ${isEmail ? 'mono' : ''}">${esc(title)}</div>
        <div class="sub">${esc([c.purpose, c.project].filter(Boolean).join(' · ') || sub || '')}</div>
      </div>
      <div class="method-pill">${esc(methodLabel(c.loginMethod))}</div>
    </div>`;
}

function wireConnItems(root, conns) {
  $$('.conn-item', root).forEach(item => {
    item.addEventListener('click', () => {
      const c = conns.find(x => x.id === item.dataset.conn);
      if (c) openConnectionModal({ existing: c });
    });
  });
}

/* ====================================================================== */
/* Search                                                                   */
/* ====================================================================== */
export function wireSearch() {
  const input = $('#search-input');
  const wrap = $('#search-results-wrap');
  const mainNav = $('#main-nav');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => runSearch(input.value), 80);
  });
  input.addEventListener('focus', () => { if (input.value) runSearch(input.value); });

  function runSearch(q) {
    if (!q.trim()) { wrap.classList.add('hidden'); mainNav.style.display = ''; return; }
    mainNav.style.display = 'none';
    wrap.classList.remove('hidden');
    const { accounts, platforms } = store.search(q);
    const el = $('#search-results');
    if (accounts.length === 0 && platforms.length === 0) {
      el.innerHTML = `<div class="search-empty">Nothing matches "${esc(q)}" yet.</div>`;
      return;
    }
    let html = '';
    if (platforms.length) {
      html += `<div class="section-title"><h2>Platforms</h2></div>`;
      html += platforms.map(p => {
        const conns = store.connectionsForPlatform(p.id).map(c => store.getAccount(c.accountId)).filter(Boolean);
        const sub = conns.length ? conns.map(a => a.email).join(', ') : (p.url || p.category || 'No account linked');
        return rowCardHTML({ title: p.name, sub, badge: conns.length ? `${conns.length} account${conns.length===1?'':'s'}` : null, dataset: `data-goto="platform" data-id="${p.id}"`, avatarText: initials(p.name) });
      }).join('');
    }
    if (accounts.length) {
      html += `<div class="section-title"><h2>Accounts</h2></div>`;
      html += accounts.map(a => {
        const conns = store.connectionsForAccount(a.id).map(c => store.getPlatform(c.platformId)).filter(Boolean);
        const sub = conns.length ? conns.map(p => p.name).join(', ') : (a.organization || a.type);
        return rowCardHTML({ title: a.email, sub, badge: conns.length ? `${conns.length} platform${conns.length===1?'':'s'}` : null, dataset: `data-goto="account" data-id="${a.id}"`, avatarText: initials(a.name || a.email) });
      }).join('');
    }
    el.innerHTML = html;
    wireRowCardNav(el);
  }
}

/* ====================================================================== */
/* Settings                                                                 */
/* ====================================================================== */
import * as backup from './backup.js';

async function renderSettings() {
  const el = $('#view-settings');
  const meta = store.getMeta();
  const folder = await backup.getConnectedFolder();

  el.innerHTML = `
    <div class="section-title"><h2>Vault</h2></div>
    <div class="settings-group">
      <div class="settings-row">
        <div><div class="label">Lock vault</div><div class="desc">Requires your passphrase again next time.</div></div>
        <button class="btn btn-sm" id="s-lock">Lock now</button>
      </div>
      <div class="settings-row">
        <div><div class="label">Change passphrase</div><div class="desc">Re-encrypts your entire vault.</div></div>
        <button class="btn btn-sm" id="s-change-pass">Change</button>
      </div>
    </div>

    <div class="section-title"><h2>Backup — keep your data even if this browser is cleared</h2></div>
    <div class="settings-group">
      <div class="settings-row">
        <div><div class="label">Last backup</div><div class="desc">${meta?.lastBackupAt ? fmtDate(meta.lastBackupAt) : 'Never — your only copy is in this browser right now.'}</div></div>
        <button class="btn btn-sm btn-primary" id="s-backup-now">Back up now</button>
      </div>
      ${backup.supportsFolderSync ? `
      <div class="settings-row">
        <div><div class="label">Auto-backup folder</div><div class="desc">${folder && !folder.needsPermission ? 'Connected — a fresh encrypted copy is saved here on every change.' : (folder && folder.needsPermission ? 'Connected, but needs permission again.' : 'Pick a folder on this device for automatic encrypted backups.')}</div></div>
        <button class="btn btn-sm" id="s-connect-folder">${folder ? (folder.needsPermission ? 'Reconnect' : 'Change') : 'Connect'}</button>
      </div>` : `
      <div class="settings-row">
        <div><div class="label">Auto-backup folder</div><div class="desc">Not available in this browser (needs Chrome or Edge on desktop). Use "Back up now" instead — it downloads a file to your device.</div></div>
      </div>`}
      <div class="settings-row">
        <div><div class="label">Restore from a backup file</div><div class="desc">Decrypts a .accountmap.json file and imports it.</div></div>
        <button class="btn btn-sm" id="s-restore">Restore</button>
      </div>
    </div>

    <div class="section-title"><h2>Import / export</h2></div>
    <div class="settings-group">
      <div class="settings-row">
        <div><div class="label">Export as CSV</div><div class="desc">Plain, unencrypted — for spreadsheets or migrating away.</div></div>
        <button class="btn btn-sm" id="s-export-csv">Export</button>
      </div>
      <div class="settings-row">
        <div><div class="label">Import from CSV</div><div class="desc">Columns: platform, email, login_method, client, notes</div></div>
        <label class="btn btn-sm" for="s-import-csv-input" style="cursor:pointer;">Choose file</label>
        <input type="file" id="s-import-csv-input" accept=".csv" class="hidden">
      </div>
    </div>

    <div class="section-title"><h2>Danger zone</h2></div>
    <div class="settings-group">
      <div class="settings-row">
        <div><div class="label">Erase this vault</div><div class="desc">Deletes everything from this device. Cannot be undone without a backup.</div></div>
        <button class="btn btn-sm btn-danger" id="s-erase">Erase</button>
      </div>
    </div>

    <p style="font-size:12px; color:var(--ink-soft); text-align:center; margin-top:24px;">
      AccountMap stores everything on this device only, encrypted with your passphrase.<br>No servers, no accounts, no analytics.
    </p>
  `;

  $('#s-lock').onclick = () => window.__accountmap.lockNow();
  $('#s-change-pass').onclick = () => openChangePassModal();
  $('#s-backup-now').onclick = async () => { await backup.downloadBackup(); toast('Backup downloaded'); renderSettings(); };
  $('#s-restore').onclick = () => openRestoreModal();
  $('#s-export-csv').onclick = () => exportCSV();
  $('#s-import-csv-input').onchange = (e) => { if (e.target.files[0]) importCSV(e.target.files[0]); };
  $('#s-erase').onclick = () => openEraseModal();
  if (backup.supportsFolderSync) {
    $('#s-connect-folder').onclick = async () => {
      try {
        const existing = folder && folder.needsPermission ? folder.handle : null;
        if (existing) { const ok = await backup.reconnectFolder(existing); if (ok) { toast('Folder reconnected'); renderSettings(); return; } }
        await backup.connectFolder();
        toast('Backup folder connected');
        renderSettings();
      } catch (e) { if (e.name !== 'AbortError') toast('Could not connect folder'); }
    };
  }
}

function exportCSV() {
  const rows = [['platform', 'email', 'login_method', 'purpose', 'project', 'notes']];
  store.listConnections().forEach(c => {
    const p = store.getPlatform(c.platformId), a = store.getAccount(c.accountId);
    if (!p || !a) return;
    rows.push([p.name, a.email, c.loginMethod, c.purpose, c.project, c.notes]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'accountmap-export.csv'; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('CSV exported');
}

async function importCSV(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { toast('CSV looks empty'); return; }
  const header = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  let count = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const platformName = cols[idx('platform')]?.trim();
    const email = cols[idx('email')]?.trim();
    if (!platformName || !email) continue;
    let account = store.listAccounts().find(a => a.email.toLowerCase() === email.toLowerCase());
    if (!account) account = store.upsertAccount({ email, name: email.split('@')[0] });
    let platform = store.listPlatforms().find(p => p.name.toLowerCase() === platformName.toLowerCase());
    if (!platform) platform = store.upsertPlatform({ name: platformName });
    const loginRaw = (idx('login_method') >= 0 ? cols[idx('login_method')] : '').toLowerCase();
    const method = LOGIN_METHODS.find(m => loginRaw.includes(m.id) || (m.id==='google' && loginRaw.includes('google')))?.id || 'unknown';
    const already = store.connectionsForPlatform(platform.id).find(c => c.accountId === account.id);
    if (!already) {
      store.upsertConnection({
        accountId: account.id, platformId: platform.id, loginMethod: method,
        purpose: idx('client') >= 0 ? cols[idx('client')] : (idx('purpose') >= 0 ? cols[idx('purpose')] : ''),
        project: idx('project') >= 0 ? cols[idx('project')] : '',
        notes: idx('notes') >= 0 ? cols[idx('notes')] : '',
      });
      count++;
    }
  }
  toast(`Imported ${count} connection${count===1?'':'s'}`);
  refreshCurrent();
}

function parseCSVLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/* ====================================================================== */
/* Modals                                                                   */
/* ====================================================================== */
function closeModal() { $('#modal-root').innerHTML = ''; }

function openModal(innerHTML) {
  $('#modal-root').innerHTML = `<div class="overlay" id="overlay"><div class="sheet">${innerHTML}</div></div>`;
  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
}

function confirmThen(message, onYes) {
  openModal(`
    <div class="sheet-head"><h2>Are you sure?</h2></div>
    <p style="font-size:14px; color:var(--ink-soft);">${esc(message)}</p>
    <div class="sheet-actions">
      <button class="btn" id="c-no">Cancel</button>
      <button class="btn btn-danger" id="c-yes">Delete</button>
    </div>
  `);
  $('#c-no').onclick = closeModal;
  $('#c-yes').onclick = () => { closeModal(); onYes(); };
}

function chipRowHTML(name, options, selected) {
  return `<div class="chip-row" data-chipgroup="${name}">${options.map(o => {
    const val = typeof o === 'string' ? o : o.id;
    const label = typeof o === 'string' ? o : o.label;
    return `<div class="chip ${val === selected ? 'selected' : ''}" data-value="${esc(val)}">${esc(label)}</div>`;
  }).join('')}</div>`;
}
function wireChipRow(root, name) {
  const group = $(`[data-chipgroup="${name}"]`, root);
  group.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $$('.chip', group).forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
  });
  return () => $('.chip.selected', group)?.dataset.value;
}

export function openAccountModal(existing = null) {
  openModal(`
    <div class="sheet-head"><h2>${existing ? 'Edit account' : 'Add account'}</h2></div>
    <div class="field"><label>Gmail / email address</label><input class="mono" id="f-email" type="email" placeholder="work03@gmail.com" value="${esc(existing?.email||'')}"></div>
    <div class="field"><label>Display name (optional)</label><input id="f-name" placeholder="e.g. Acme dev account" value="${esc(existing?.name||'')}"></div>
    <div class="field"><label>Type</label>${chipRowHTML('type', ACCOUNT_TYPES, existing?.type || 'work')}</div>
    <div class="field"><label>Organization / client (optional)</label><input id="f-org" placeholder="e.g. Acme Corp" value="${esc(existing?.organization||'')}"></div>
    <div class="field"><label>Tags (comma separated, optional)</label><input id="f-tags" placeholder="dev, design" value="${esc((existing?.tags||[]).join(', '))}"></div>
    <div class="field"><label>Notes (optional)</label><textarea id="f-notes">${esc(existing?.notes||'')}</textarea></div>
    <div class="sheet-actions">
      <button class="btn" id="cancel">Cancel</button>
      <button class="btn btn-primary" id="save">${existing ? 'Save' : 'Add account'}</button>
    </div>
  `);
  const root = $('#modal-root');
  const getType = wireChipRow(root, 'type');
  $('#cancel').onclick = closeModal;
  $('#save').onclick = () => {
    const email = $('#f-email').value.trim();
    if (!email) { toast('Add an email address'); return; }
    const tags = $('#f-tags').value.split(',').map(t => t.trim()).filter(Boolean);
    store.upsertAccount({
      id: existing?.id, email, name: $('#f-name').value.trim(), type: getType() || 'work',
      organization: $('#f-org').value.trim(), tags, notes: $('#f-notes').value.trim(),
    });
    closeModal(); toast(existing ? 'Account updated' : 'Account added'); refreshCurrent();
  };
}

export function openPlatformModal(existing = null) {
  openModal(`
    <div class="sheet-head"><h2>${existing ? 'Edit platform' : 'Add platform'}</h2></div>
    <div class="field"><label>Platform name</label><input id="f-name" placeholder="e.g. GitHub" value="${esc(existing?.name||'')}"></div>
    <div class="field"><label>Website (optional)</label><input class="mono" id="f-url" placeholder="github.com" value="${esc(existing?.url||'')}"></div>
    <div class="field"><label>Category (optional)</label><input id="f-cat" placeholder="e.g. Development" value="${esc(existing?.category||'')}"></div>
    <div class="field"><label>Tags (comma separated, optional)</label><input id="f-tags" placeholder="hosting, client A" value="${esc((existing?.tags||[]).join(', '))}"></div>
    <div class="field"><label>Notes (optional)</label><textarea id="f-notes">${esc(existing?.notes||'')}</textarea></div>
    <div class="sheet-actions">
      <button class="btn" id="cancel">Cancel</button>
      <button class="btn btn-primary" id="save">${existing ? 'Save' : 'Add platform'}</button>
    </div>
  `);
  $('#cancel').onclick = closeModal;
  $('#save').onclick = () => {
    const name = $('#f-name').value.trim();
    if (!name) { toast('Add a platform name'); return; }
    const tags = $('#f-tags').value.split(',').map(t => t.trim()).filter(Boolean);
    const p = store.upsertPlatform({
      id: existing?.id, name, url: $('#f-url').value.trim(), category: $('#f-cat').value.trim(),
      tags, notes: $('#f-notes').value.trim(),
    });
    closeModal(); toast(existing ? 'Platform updated' : 'Platform added'); refreshCurrent();
    if (!existing) openConnectionModal({ platformId: p.id, promptedFromNewPlatform: true });
  };
}

export function openConnectionModal({ accountId = null, platformId = null, existing = null } = {}) {
  const accounts = store.listAccounts().sort((a,b) => (a.name||a.email).localeCompare(b.name||b.email));
  const platforms = store.listPlatforms().sort((a,b) => a.name.localeCompare(b.name));
  if (accounts.length === 0) { toast('Add an account first'); openAccountModal(); return; }
  if (platforms.length === 0) { toast('Add a platform first'); openPlatformModal(); return; }

  const aId = existing?.accountId || accountId;
  const pId = existing?.platformId || platformId;

  openModal(`
    <div class="sheet-head"><h2>${existing ? 'Edit link' : 'Link account to platform'}</h2></div>
    <div class="field-row">
      <div class="field">
        <label>Account</label>
        <select id="f-account" ${accountId && !existing ? 'disabled' : ''}>
          ${accounts.map(a => `<option value="${a.id}" ${a.id===aId?'selected':''}>${esc(a.email)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Platform</label>
        <select id="f-platform" ${platformId && !existing ? 'disabled' : ''}>
          ${platforms.map(p => `<option value="${p.id}" ${p.id===pId?'selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field"><label>Login method</label>${chipRowHTML('method', LOGIN_METHODS, existing?.loginMethod || 'google')}</div>
    <div class="field"><label>Purpose / client (optional)</label><input id="f-purpose" placeholder="e.g. Client A" value="${esc(existing?.purpose||'')}"></div>
    <div class="field"><label>Project (optional)</label><input id="f-project" placeholder="e.g. Redesign" value="${esc(existing?.project||'')}"></div>
    <div class="field"><label>Notes (optional)</label><textarea id="f-notes">${esc(existing?.notes||'')}</textarea></div>
    <div class="sheet-actions">
      ${existing ? '<button class="btn btn-danger" id="del">Delete link</button>' : '<button class="btn" id="cancel">Cancel</button>'}
      <button class="btn btn-primary" id="save">${existing ? 'Save' : 'Save link'}</button>
    </div>
  `);
  const root = $('#modal-root');
  const getMethod = wireChipRow(root, 'method');
  if ($('#cancel')) $('#cancel').onclick = closeModal;
  if ($('#del')) $('#del').onclick = () => confirmThen('Remove this link?', () => {
    store.deleteConnection(existing.id); toast('Link removed'); refreshCurrent();
  });
  $('#save').onclick = () => {
    const accId = accountId && !existing ? accountId : $('#f-account').value;
    const platId = platformId && !existing ? platformId : $('#f-platform').value;
    if (!existing) {
      const dup = store.connectionsForPlatform(platId).find(c => c.accountId === accId);
      if (dup) { toast('That account is already linked to this platform'); return; }
    }
    store.upsertConnection({
      id: existing?.id, accountId: accId, platformId: platId,
      loginMethod: getMethod() || 'unknown', purpose: $('#f-purpose').value.trim(),
      project: $('#f-project').value.trim(), notes: $('#f-notes').value.trim(),
    });
    closeModal(); toast(existing ? 'Link updated' : 'Linked'); refreshCurrent();
  };
}

function openChangePassModal() {
  openModal(`
    <div class="sheet-head"><h2>Change passphrase</h2></div>
    <p style="font-size:13px;color:var(--ink-soft);">Your whole vault will be re-encrypted with the new passphrase.</p>
    <div class="field"><label>New passphrase</label><input id="f-p1" type="password"></div>
    <div class="field"><label>Confirm new passphrase</label><input id="f-p2" type="password"></div>
    <div class="sheet-actions">
      <button class="btn" id="cancel">Cancel</button>
      <button class="btn btn-primary" id="save">Change</button>
    </div>
  `);
  $('#cancel').onclick = closeModal;
  $('#save').onclick = async () => {
    const p1 = $('#f-p1').value, p2 = $('#f-p2').value;
    if (p1.length < 6) { toast('Use at least 6 characters'); return; }
    if (p1 !== p2) { toast("Passphrases don't match"); return; }
    await store.changePassphrase(p1);
    closeModal(); toast('Passphrase changed');
  };
}

function openRestoreModal() {
  openModal(`
    <div class="sheet-head"><h2>Restore from backup</h2></div>
    <div class="field"><label>Backup file</label><input type="file" id="f-file" accept=".json,.accountmap"></div>
    <div class="field"><label>Passphrase for that backup</label><input type="password" id="f-pass"></div>
    <div class="field"><label>How should it be applied?</label>
      ${chipRowHTML('mode', [{id:'merge',label:'Merge with current vault'},{id:'replace',label:'Replace everything'}], 'merge')}
    </div>
    <div class="sheet-actions">
      <button class="btn" id="cancel">Cancel</button>
      <button class="btn btn-primary" id="go">Restore</button>
    </div>
  `);
  const root = $('#modal-root');
  const getMode = wireChipRow(root, 'mode');
  $('#cancel').onclick = closeModal;
  $('#go').onclick = async () => {
    const file = $('#f-file').files[0];
    const pass = $('#f-pass').value;
    if (!file || !pass) { toast('Choose a file and enter its passphrase'); return; }
    try {
      const blob = await backup.readBackupFile(file);
      const data = await store.decryptBackupBlob(blob, pass);
      if (getMode() === 'replace') store.replaceAll(data); else store.mergeIn(data);
      closeModal(); toast('Backup restored'); refreshCurrent();
    } catch (e) {
      toast('Wrong passphrase or unreadable file');
    }
  };
}

function openEraseModal() {
  openModal(`
    <div class="sheet-head"><h2>Erase this vault</h2></div>
    <p style="font-size:14px;color:var(--ink-soft);">This deletes every account, platform, and link stored on this device. If you haven't backed up, it cannot be undone. Type <b>ERASE</b> to confirm.</p>
    <div class="field"><input id="f-confirm" placeholder="ERASE"></div>
    <div class="sheet-actions">
      <button class="btn" id="cancel">Cancel</button>
      <button class="btn btn-danger" id="go">Erase everything</button>
    </div>
  `);
  $('#cancel').onclick = closeModal;
  $('#go').onclick = () => {
    if ($('#f-confirm').value.trim() !== 'ERASE') { toast('Type ERASE to confirm'); return; }
    window.__accountmap.eraseVault();
    closeModal();
  };
}

export function refreshBanner() {
  const banner = $('#backup-banner');
  if (backup.shouldNudgeBackup()) banner.classList.remove('hidden');
  else banner.classList.add('hidden');
}
