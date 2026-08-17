// db.js — thin IndexedDB wrapper. Two tiny object stores:
//   'vault'   — the single encrypted blob (id: 'main')
//   'handles' — optional File System Access API directory handle for local backup sync

const DB_NAME = 'accountmap-db';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('vault')) db.createObjectStore('vault', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode) {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

export async function getVaultRecord() {
  const store = await tx('vault', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get('main');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function putVaultRecord(record) {
  const store = await tx('vault', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ id: 'main', ...record });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearVaultRecord() {
  const store = await tx('vault', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete('main');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(handle) {
  const store = await tx('handles', 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ id: 'backup-dir', handle });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getDirHandle() {
  const store = await tx('handles', 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get('backup-dir');
    req.onsuccess = () => resolve(req.result ? req.result.handle : null);
    req.onerror = () => reject(req.error);
  });
}

export async function requestPersistence() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const already = await navigator.storage.persisted();
      if (!already) return navigator.storage.persist();
      return true;
    } catch { return false; }
  }
  return false;
}
