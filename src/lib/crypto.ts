/**
 * PIN dan enkripsi kata sandi akun Lunapremium.
 * - PIN disimpan sebagai hasil PBKDF2 (bukan PIN-nya).
 * - Kata sandi akun dienkripsi AES-GCM dengan kunci turunan dari PIN, kunci hanya ada di memori.
 * PIN mengunci tampilan dan melindungi kata sandi, bukan seluruh file database.
 * Untuk file database, aktifkan BitLocker/enkripsi disk Windows.
 */
const ITER = 150_000
const enc = new TextEncoder()
const dec = new TextDecoder()

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of u) s += String.fromCharCode(b)
  return btoa(s)
}

function unb64(s: string): Uint8Array {
  const raw = atob(s)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function baseKey(pin: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits', 'deriveKey'])
}

function kdf(salt: Uint8Array) {
  return { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITER, hash: 'SHA-256' } as const
}

async function pinBits(pin: string, salt: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(kdf(salt), await baseKey(pin), 256)
}

async function pinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(kdf(salt), await baseKey(pin), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export interface PinRecord {
  hashSalt: string
  hash: string
  keySalt: string
}

export async function createPinRecord(pin: string): Promise<PinRecord> {
  const hashSalt = crypto.getRandomValues(new Uint8Array(16))
  const keySalt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pinBits(pin, hashSalt)
  return { hashSalt: b64(hashSalt), hash: b64(hash), keySalt: b64(keySalt) }
}

export async function verifyPin(pin: string, rec: PinRecord): Promise<boolean> {
  const hash = await pinBits(pin, unb64(rec.hashSalt))
  const a = b64(hash)
  if (a.length !== rec.hash.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ rec.hash.charCodeAt(i)
  return diff === 0
}

export async function deriveKey(pin: string, rec: PinRecord): Promise<CryptoKey> {
  return pinKey(pin, unb64(rec.keySalt))
}

export async function encryptText(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text))
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv)
  out.set(new Uint8Array(ct), iv.length)
  return b64(out)
}

export async function decryptText(key: CryptoKey, payload: string): Promise<string> {
  const all = unb64(payload)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12))
  return dec.decode(pt)
}
