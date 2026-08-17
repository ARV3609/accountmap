// crypto.js — passphrase-derived encryption for the local vault.
// Nothing here ever leaves the device. There is no server, no analytics call,
// no network request. The derived key lives only in memory for the session.

const PBKDF2_ITERATIONS = 250000;

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function randomSalt(len = 16) {
  return crypto.getRandomValues(new Uint8Array(len));
}

export function randomIv() {
  return crypto.getRandomValues(new Uint8Array(12));
}

/** Derive an AES-GCM CryptoKey from a passphrase + salt via PBKDF2-SHA256. */
export async function deriveKey(passphrase, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt a JS value. Returns a plain object safe to store/export as JSON. */
export async function encryptJSON(key, ivBytes, value) {
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, data);
  return bufToB64(cipher);
}

/** Decrypt a base64 ciphertext produced by encryptJSON. Throws if key/passphrase is wrong. */
export async function decryptJSON(key, ivBytes, cipherB64) {
  const cipherBuf = b64ToBuf(cipherB64);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, cipherBuf);
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plainBuf));
}

export const encoding = { bufToB64, b64ToBuf };
export const ITERATIONS = PBKDF2_ITERATIONS;
