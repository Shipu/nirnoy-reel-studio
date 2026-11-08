/**
 * AES-GCM encryption for platform tokens at rest, keyed by the TOKEN_KEY Worker secret
 * (32 random bytes, base64). Output: base64(iv ‖ ciphertext).
 */

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const keys = new Map<string, Promise<CryptoKey>>();
function key(secret: string | undefined) {
  if (!secret) throw new Error("TOKEN_KEY secret is not set on the Worker.");
  let k = keys.get(secret);
  if (!k) {
    const raw = unb64(secret);
    if (raw.length !== 32) throw new Error("TOKEN_KEY must be 32 bytes, base64-encoded.");
    k = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keys.set(secret, k);
  }
  return k;
}

export async function encrypt(secret: string | undefined, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + data.length);
  out.set(iv);
  out.set(data, iv.length);
  return b64(out);
}

export async function decrypt(secret: string | undefined, sealed: string) {
  const raw = unb64(sealed);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await key(secret), raw.slice(12));
  return new TextDecoder().decode(plain);
}

export const randomToken = (bytes = 24) => b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
