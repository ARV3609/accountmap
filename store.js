// store.js — the in-memory vault + all business logic.
// Plaintext data lives ONLY in memory (in `state`) for as long as the vault
// is unlocked. Everything persisted to disk goes through crypto.js first.

import { deriveKey, encryptJSON, decryptJSON, randomSalt, randomIv, encoding, ITERATIONS } from './crypto.js';
import * as db from './db.js';

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(evt) { listeners.forEach(fn => fn(evt)); }

let cryptoKey = null;   // CryptoKey, memory-only, cleared on lock
let saltBytes = null;   // Uint8Array, from the stored record (not secret)
let state = null;       // decrypted vault contents while unlocked
let saveTimer = null;
let onAfterPersist = null; // hook set by backup.js for folder sync

export function setPersistHook(fn) { onAfterPersist = fn; }

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function emptyVault() {
  return {
    meta: { version: 1, createdAt: Date.now(), lastBackupAt: null, dirtySinceBackup: false },
    accounts: [],
    platforms: [],
    connections: [],
  };
}

export async function hasVault() {
  const rec = await db.getVaultRecord();
  return !!rec;
}

export async function createVault(passphrase) {
  const salt = randomSalt();
  const iv = randomIv();
  const key = await deriveKey(passphrase, salt);
  const data = emptyVault();
  const cipher = await encryptJSON(key, iv, data);
  await db.putVaultRecord({
    salt: encoding.bufToB64(salt),
    iv: encoding.bufToB64(iv),
    cipher,
    iterations: ITERATIONS,
    createdAt: Date.now(),
  });
  cryptoKey = key;
  saltBytes = salt;
  state = data;
  await db.requestPersistence();
  emit({ type: 'unlocked' });
}

/** Attempt to unlock with a passphrase. Returns true/false — never throws to caller. */
export async function unlock(passphrase) {
  const rec = await db.getVaultRecord();
  if (!rec) throw new Error('no-vault');
  const salt = new Uint8Array(encoding.b64ToBuf(rec.salt));
  const iv = new Uint8Array(encoding.b64ToBuf(rec.iv));
  const key = await deriveKey(passphrase, salt, rec.iterations || ITERATIONS);
  try {
    const data = await decryptJSON(key, iv, rec.cipher);
    cryptoKey = key;
    saltBytes = salt;
    state = data;
    if (!state.meta) state.meta = emptyVault().meta;
    await db.requestPersistence();
    emit({ type: 'unlocked' });
    return true;
  } catch (e) {
    return false;
  }
}

export function isUnlocked() { return !!cryptoKey && !!state; }

export function lock() {
  cryptoKey = null;
  saltBytes = null;
  state = null;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  emit({ type: 'locked' });
}

/** Change the passphrase: re-derive a new key + salt and re-encrypt everything. */
export async function changePassphrase(newPassphrase) {
  if (!isUnlocked()) throw new Error('locked');
  const salt = randomSalt();
  const iv = randomIv();
  const key = await deriveKey(newPassphrase, salt);
  const cipher = await encryptJSON(key, iv, state);
  await db.putVaultRecord({
    salt: encoding.bufToB64(salt),
    iv: encoding.bufToB64(iv),
    cipher,
    iterations: ITERATIONS,
    createdAt: Date.now(),
  });
  cryptoKey = key;
  saltBytes = salt;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 350);
}

async function doSave() {
  if (!isUnlocked()) return;
  const iv = randomIv();
  state.meta.dirtySinceBackup = true;
  const cipher = await encryptJSON(cryptoKey, iv, state);
  const rec = await db.getVaultRecord();
  await db.putVaultRecord({ ...rec, iv: encoding.bufToB64(iv), cipher });
  emit({ type: 'saved' });
  if (onAfterPersist) {
    try { await onAfterPersist(getExportPayload()); } catch (e) { /* folder sync is best-effort */ }
  }
}

function touch() { scheduleSave(); emit({ type: 'data' }); }

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */
export function listAccounts() { return isUnlocked() ? [...state.accounts] : []; }
export function getAccount(id) { return state.accounts.find(a => a.id === id) || null; }

export function upsertAccount(input) {
  const now = Date.now();
  if (input.id) {
    const a = getAccount(input.id);
    if (!a) throw new Error('not-found');
    Object.assign(a, input, { updatedAt: now });
    touch();
    return a;
  }
  const a = {
    id: uid(), email: input.email || '', name: input.name || '', type: input.type || 'work',
    organization: input.organization || '', tags: input.tags || [], notes: input.notes || '',
    favorite: !!input.favorite, createdAt: now, updatedAt: now,
  };
  state.accounts.push(a);
  touch();
  return a;
}

export function deleteAccount(id) {
  state.accounts = state.accounts.filter(a => a.id !== id);
  state.connections = state.connections.filter(c => c.accountId !== id);
  touch();
}

/* ------------------------------------------------------------------ */
/* Platforms                                                           */
/* ------------------------------------------------------------------ */
export function listPlatforms() { return isUnlocked() ? [...state.platforms] : []; }
export function getPlatform(id) { return state.platforms.find(p => p.id === id) || null; }

export function upsertPlatform(input) {
  const now = Date.now();
  if (input.id) {
    const p = getPlatform(input.id);
    if (!p) throw new Error('not-found');
    Object.assign(p, input, { updatedAt: now });
    touch();
    return p;
  }
  const p = {
    id: uid(), name: input.name || '', url: input.url || '', category: input.category || '',
    tags: input.tags || [], notes: input.notes || '', favorite: !!input.favorite,
    createdAt: now, updatedAt: now,
  };
  state.platforms.push(p);
  touch();
  return p;
}

export function deletePlatform(id) {
  state.platforms = state.platforms.filter(p => p.id !== id);
  state.connections = state.connections.filter(c => c.platformId !== id);
  touch();
}

/* ------------------------------------------------------------------ */
/* Connections (account <-> platform)                                  */
/* ------------------------------------------------------------------ */
export function listConnections() { return isUnlocked() ? [...state.connections] : []; }
export function connectionsForPlatform(platformId) { return state.connections.filter(c => c.platformId === platformId); }
export function connectionsForAccount(accountId) { return state.connections.filter(c => c.accountId === accountId); }

export function upsertConnection(input) {
  const now = Date.now();
  if (input.id) {
    const c = state.connections.find(x => x.id === input.id);
    if (!c) throw new Error('not-found');
    Object.assign(c, input, { updatedAt: now });
    touch();
    return c;
  }
  const c = {
    id: uid(), accountId: input.accountId, platformId: input.platformId,
    loginMethod: input.loginMethod || 'unknown', purpose: input.purpose || '',
    project: input.project || '', notes: input.notes || '',
    createdAt: now, updatedAt: now,
  };
  state.connections.push(c);
  touch();
  return c;
}

export function deleteConnection(id) {
  state.connections = state.connections.filter(c => c.id !== id);
  touch();
}

/* ------------------------------------------------------------------ */
/* Search                                                               */
/* ------------------------------------------------------------------ */
export function search(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return { accounts: [], platforms: [] };

  const matchAccount = (a) => [a.email, a.name, a.organization, a.notes, ...(a.tags||[])]
    .join(' ').toLowerCase().includes(q);
  const matchPlatform = (p) => [p.name, p.url, p.category, p.notes, ...(p.tags||[])]
    .join(' ').toLowerCase().includes(q);
  const matchConn = (c) => [c.purpose, c.project, c.notes, c.loginMethod].join(' ').toLowerCase().includes(q);

  const accounts = state.accounts.filter(matchAccount);
  const platforms = state.platforms.filter(p => matchPlatform(p) ||
    connectionsForPlatform(p.id).some(c => matchConn(c) || matchAccount(getAccount(c.accountId) || {})));

  const accountsViaConn = state.accounts.filter(a =>
    !accounts.includes(a) && connectionsForAccount(a.id).some(c => matchConn(c) ||
      matchPlatform(getPlatform(c.platformId) || {})));

  return { accounts: [...accounts, ...accountsViaConn], platforms };
}

/* ------------------------------------------------------------------ */
/* Stats / dashboard                                                    */
/* ------------------------------------------------------------------ */
export function stats() {
  const accounts = listAccounts();
  const platforms = listPlatforms();
  const connections = listConnections();

  const recent = [...connections].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map(c => ({
    connection: c, account: getAccount(c.accountId), platform: getPlatform(c.platformId),
  })).filter(r => r.account && r.platform);

  const countByAccount = {};
  connections.forEach(c => { countByAccount[c.accountId] = (countByAccount[c.accountId] || 0) + 1; });
  const mostUsed = Object.entries(countByAccount)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, count]) => ({ account: getAccount(id), count }))
    .filter(r => r.account);

  return { accountCount: accounts.length, platformCount: platforms.length, connectionCount: connections.length, recent, mostUsed };
}

/* ------------------------------------------------------------------ */
/* Export / import (used by backup.js)                                  */
/* ------------------------------------------------------------------ */
export function getExportPayload() {
  // A snapshot of current plaintext state, for backup.js to encrypt & write out.
  return JSON.parse(JSON.stringify(state));
}

export function markBackedUp() {
  if (!isUnlocked()) return;
  state.meta.lastBackupAt = Date.now();
  state.meta.dirtySinceBackup = false;
  touch();
}

export function getMeta() { return isUnlocked() ? { ...state.meta } : null; }

export function getSaltB64() { return saltBytes ? encoding.bufToB64(saltBytes) : null; }

/** Encrypt the current state with the live session key, for writing to a backup file. */
export async function exportEncryptedBlob() {
  if (!isUnlocked()) throw new Error('locked');
  const rec = await db.getVaultRecord();
  const iv = randomIv();
  const cipher = await encryptJSON(cryptoKey, iv, state);
  return {
    format: 'accountmap-backup', version: 1,
    salt: encoding.bufToB64(saltBytes), iv: encoding.bufToB64(iv), cipher,
    iterations: rec?.iterations || ITERATIONS,
    exportedAt: Date.now(),
    counts: { accounts: state.accounts.length, platforms: state.platforms.length, connections: state.connections.length },
  };
}

/** Decrypt a backup file's contents with a (possibly different) passphrase. */
export async function decryptBackupBlob(blob, passphrase) {
  const salt = new Uint8Array(encoding.b64ToBuf(blob.salt));
  const iv = new Uint8Array(encoding.b64ToBuf(blob.iv));
  const key = await deriveKey(passphrase, salt, blob.iterations || ITERATIONS);
  return decryptJSON(key, iv, blob.cipher); // throws if passphrase is wrong
}

/** Replace the entire in-memory vault (used by "Restore — replace everything"). */
export function replaceAll(data) {
  state = data;
  if (!state.meta) state.meta = emptyVault().meta;
  touch();
}

/** Merge an imported vault into the current one (id collisions are skipped). */
export function mergeIn(data) {
  const existingAccountIds = new Set(state.accounts.map(a => a.id));
  const existingPlatformIds = new Set(state.platforms.map(p => p.id));
  const existingConnIds = new Set(state.connections.map(c => c.id));
  (data.accounts || []).forEach(a => { if (!existingAccountIds.has(a.id)) state.accounts.push(a); });
  (data.platforms || []).forEach(p => { if (!existingPlatformIds.has(p.id)) state.platforms.push(p); });
  (data.connections || []).forEach(c => { if (!existingConnIds.has(c.id)) state.connections.push(c); });
  touch();
}
