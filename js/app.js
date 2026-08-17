import * as store from './store.js';
import * as db from './db.js';
import * as backup from './backup.js';
import * as ui from './ui.js';

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ */
/* Lock screen                                                          */
/* ------------------------------------------------------------------ */
async function showLockScreen() {
  const has = await store.hasVault();
  $('#lock-setup').classList.toggle('hidden', has);
  $('#lock-unlock').classList.toggle('hidden', !has);
  $('#lock-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  (has ? $('#unlock-pass') : $('#setup-pass')).focus();
}

function showApp() {
  $('#lock-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  ui.switchView('dashboard');
  ui.refreshBanner();
}

function wireLockScreen() {
  $('#setup-submit').onclick = async () => {
    const p1 = $('#setup-pass').value, p2 = $('#setup-pass2').value;
    const err = $('#setup-error');
    if (p1.length < 6) return showErr(err, 'Use at least 6 characters.');
    if (p1 !== p2) return showErr(err, "Passphrases don't match.");
    err.classList.remove('show');
    await store.createVault(p1);
    showApp();
  };
  ['setup-pass','setup-pass2'].forEach(id => $('#'+id).addEventListener('keydown', e => { if (e.key === 'Enter') $('#setup-submit').click(); }));

  $('#unlock-submit').onclick = async () => {
    const p = $('#unlock-pass').value;
    const err = $('#unlock-error');
    const ok = await store.unlock(p);
    if (!ok) return showErr(err, 'Wrong passphrase — try again.');
    err.classList.remove('show');
    $('#unlock-pass').value = '';
    showApp();
  };
  $('#unlock-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#unlock-submit').click(); });

  $('#unlock-restore-instead').onclick = async () => {
    // Lets someone recover onto a fresh browser/profile: decrypt a backup file directly into a brand-new vault.
    const passphrase = prompt('This will set up a new vault here from a backup file.\n\nFirst, choose the passphrase that backup file was encrypted with, then pick the file.');
    if (!passphrase) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,.accountmap';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const blob = await backup.readBackupFile(file);
        const salt = blob.salt;
        // Create a temp vault under this passphrase+salt pairing by decrypting directly.
        const { deriveKey, decryptJSON, encoding } = await import('./crypto.js');
        const saltBytes = new Uint8Array(encoding.b64ToBuf(blob.salt));
        const ivBytes = new Uint8Array(encoding.b64ToBuf(blob.iv));
        const key = await deriveKey(passphrase, saltBytes, blob.iterations);
        const data = await decryptJSON(key, ivBytes, blob.cipher);
        // Persist as the new vault record so future unlocks work normally.
        await db.putVaultRecord({ salt: blob.salt, iv: blob.iv, cipher: blob.cipher, iterations: blob.iterations, createdAt: Date.now() });
        const ok = await store.unlock(passphrase);
        if (ok) { ui.toast('Vault restored from backup'); showApp(); }
      } catch (e) {
        alert('Could not read that backup with the passphrase given.');
      }
    };
    input.click();
  };
}

function showErr(el, msg) { el.textContent = msg; el.classList.add('show'); }

/* ------------------------------------------------------------------ */
/* Nav + FAB                                                            */
/* ------------------------------------------------------------------ */
function wireNav() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => ui.switchView(tab.dataset.view));
  });
  $('#btn-settings').onclick = () => ui.switchView('settings');
  $('#btn-lock').onclick = () => lockNow();
  $('#fab-add').onclick = () => {
    const view = document.querySelector('.view:not(.hidden)')?.id;
    if (view === 'view-platforms' || view === 'view-platform-detail') ui.openPlatformModal();
    else if (view === 'view-accounts' || view === 'view-account-detail') ui.openAccountModal();
    else openQuickAdd();
  };
  $('#banner-backup-now').onclick = async () => { await backup.downloadBackup(); ui.toast('Backup downloaded'); ui.refreshBanner(); };
  $('#banner-dismiss').onclick = () => $('#backup-banner').classList.add('hidden');
}

function openQuickAdd() {
  document.getElementById('modal-root').innerHTML = `
    <div class="overlay" id="qa-overlay"><div class="sheet">
      <div class="sheet-head"><h2>What are you adding?</h2></div>
      <div class="sheet-actions">
        <button class="btn btn-primary" id="qa-account">Account</button>
        <button class="btn btn-primary" id="qa-platform">Platform</button>
      </div>
    </div></div>`;
  document.getElementById('qa-overlay').addEventListener('click', (e) => { if (e.target.id === 'qa-overlay') document.getElementById('modal-root').innerHTML = ''; });
  document.getElementById('qa-account').onclick = () => { document.getElementById('modal-root').innerHTML = ''; ui.openAccountModal(); };
  document.getElementById('qa-platform').onclick = () => { document.getElementById('modal-root').innerHTML = ''; ui.openPlatformModal(); };
}

/* ------------------------------------------------------------------ */
/* Lock / erase                                                         */
/* ------------------------------------------------------------------ */
function lockNow() {
  store.lock();
  showLockScreen();
}

async function eraseVault() {
  store.lock();
  await db.clearVaultRecord();
  await db.saveDirHandle(null);
  location.reload();
}

window.__accountmap = { lockNow, eraseVault };

/* ------------------------------------------------------------------ */
/* Idle auto-lock (20 minutes of no interaction)                        */
/* ------------------------------------------------------------------ */
const IDLE_MS = 20 * 60 * 1000;
let idleTimer = null;
function resetIdle() {
  if (!store.isUnlocked()) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { lockNow(); }, IDLE_MS);
}
['click','keydown','touchstart','mousemove'].forEach(evt => document.addEventListener(evt, resetIdle, { passive: true }));

/* ------------------------------------------------------------------ */
/* Store change hooks                                                   */
/* ------------------------------------------------------------------ */
store.setPersistHook(async () => { await backup.syncOnSave(); });
store.onChange((evt) => {
  if (evt.type === 'data' || evt.type === 'saved') ui.refreshBanner();
});

/* ------------------------------------------------------------------ */
/* Boot                                                                  */
/* ------------------------------------------------------------------ */
async function boot() {
  wireLockScreen();
  wireNav();
  ui.wireSearch();
  await showLockScreen();
  resetIdle();

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch (e) { /* offline support degrades gracefully */ }
  }
}
boot();
