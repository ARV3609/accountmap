// backup.js — getting the encrypted vault OFF the browser's site-storage
// sandbox and onto real, durable storage the person controls.
//
// Why this matters: IndexedDB (and everything else "site data") can be wiped
// in one tap from a browser's "clear browsing data" screen, or by an OS that
// decides to reclaim space. A file saved to Downloads, or written into a
// folder the person picked, is NOT site data — clearing the browser does not
// touch it. That's the durable layer. IndexedDB is just the fast, working copy.

import * as store from './store.js';
import * as db from './db.js';

export const supportsFolderSync = 'showDirectoryPicker' in window;

function filename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `accountmap-backup-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.accountmap.json`;
}

/** Manual download — works in every browser, lands in the device's real Downloads folder. */
export async function downloadBackup() {
  const blob = await store.exportEncryptedBlob();
  const file = new Blob([JSON.stringify(blob)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  store.markBackedUp();
}

/** Desktop Chromium only: pick a real folder once, then auto-write a backup file into it on every change. */
export async function connectFolder() {
  if (!supportsFolderSync) throw new Error('unsupported');
  const handle = await window.showDirectoryPicker({ id: 'accountmap-backups', mode: 'readwrite' });
  await db.saveDirHandle(handle);
  await writeToFolder(handle);
  return handle;
}

export async function getConnectedFolder() {
  if (!supportsFolderSync) return null;
  const handle = await db.getDirHandle();
  if (!handle) return null;
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return handle;
    return { needsPermission: true, handle };
  } catch {
    return null;
  }
}

export async function reconnectFolder(handle) {
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  return perm === 'granted';
}

async function writeToFolder(handle) {
  const blob = await store.exportEncryptedBlob();
  const fh = await handle.getFileHandle(filename(), { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(blob));
  await writable.close();
  store.markBackedUp();
}

/** Wired up in app.js: called automatically after every save, if a folder is connected. */
export async function syncOnSave() {
  const handle = await db.getDirHandle();
  if (!handle) return;
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return; // silently skip; person can reconnect from Settings
    await writeToFolder(handle);
  } catch {
    // best-effort — never block the UI on backup sync
  }
}

export async function disconnectFolder() {
  await db.saveDirHandle(null);
}

/** Parse + decrypt a backup file the person selected via a file input. */
export async function readBackupFile(file) {
  const text = await file.text();
  const blob = JSON.parse(text);
  if (blob.format !== 'accountmap-backup') throw new Error('bad-format');
  return blob;
}

export function shouldNudgeBackup() {
  const meta = store.getMeta();
  if (!meta) return false;
  if (!meta.dirtySinceBackup) return false;
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  if (!meta.lastBackupAt) return true;
  return (Date.now() - meta.lastBackupAt) > threeDays;
}
