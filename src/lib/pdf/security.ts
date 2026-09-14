import { aesCbcDecrypt, aesCbcNoPadEncrypt, concat, md5, rc4, sha } from './crypto';
import { PdfName, PdfString, type PdfDict } from './objects';

/**
 * The standard security handler, opened with the empty user password.
 *
 * e-Publishing forms are encrypted with an owner password so the form design
 * cannot be edited, and an empty user password so anyone can open them. This
 * derives the file key for that case -- revisions 2 through 4 (RC4 and
 * AES-128) and 5 and 6 (AES-256) -- and hands back a function that decrypts
 * one object's bytes. Nothing here tries any password but the empty one.
 */

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const AES_SALT = new Uint8Array([0x73, 0x41, 0x6c, 0x54]);

export type CipherMethod = 'none' | 'rc4' | 'aesv2' | 'aesv3';

export interface Decryptor {
  /** Decrypts the bytes of a string or stream belonging to object `num gen`. */
  decrypt(data: Uint8Array, num: number, gen: number, kind: 'string' | 'stream'): Uint8Array;
  readonly streamMethod: CipherMethod;
  readonly stringMethod: CipherMethod;
}

export class PdfSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfSecurityError';
  }
}

function bytesOf(value: unknown, what: string): Uint8Array {
  if (value instanceof PdfString) return value.bytes;
  throw new PdfSecurityError(`Encrypt dictionary: ${what} must be a string`);
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function cryptFilterMethod(encrypt: PdfDict, which: 'StmF' | 'StrF', v: number): CipherMethod {
  if (v < 4) return 'rc4';
  const filterName = encrypt.get(which);
  const name = filterName instanceof PdfName ? filterName.name : 'Identity';
  if (name === 'Identity') return 'none';
  const cf = encrypt.get('CF');
  const filter = cf instanceof Map ? cf.get(name) : undefined;
  const cfm = filter instanceof Map ? filter.get('CFM') : undefined;
  const method = cfm instanceof PdfName ? cfm.name : 'None';
  switch (method) {
    case 'AESV2':
      return 'aesv2';
    case 'AESV3':
      return 'aesv3';
    case 'V2':
      return 'rc4';
    case 'None':
      return 'none';
    default:
      throw new PdfSecurityError(`Unsupported crypt filter method ${method}`);
  }
}

/** Algorithm 2: the file key from the (empty) user password, revisions 2-4. */
function legacyFileKey(encrypt: PdfDict, firstId: Uint8Array): Uint8Array {
  const r = numberOf(encrypt.get('R'), 2);
  const o = bytesOf(encrypt.get('O'), 'O');
  const p = numberOf(encrypt.get('P'), -1) | 0;
  const lengthBits = r === 2 ? 40 : numberOf(encrypt.get('Length'), 40);
  const n = lengthBits / 8;
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, p, true);
  const parts = [PAD, o.subarray(0, 32), pBytes, firstId];
  const encryptMetadata = encrypt.get('EncryptMetadata');
  if (r >= 4 && encryptMetadata === false) parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  let key = md5(concat(...parts));
  if (r >= 3) {
    for (let i = 0; i < 50; i += 1) key = md5(key.subarray(0, n));
  }
  return key.subarray(0, n);
}

/** Algorithm 2.B: the hardened hash of ISO 32000-2, used by revision 6. */
async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await sha(256, concat(password, salt, udata));
  let i = 0;
  for (;;) {
    const k1Unit = concat(password, k, udata);
    const k1 = new Uint8Array(k1Unit.length * 64);
    for (let j = 0; j < 64; j += 1) k1.set(k1Unit, j * k1Unit.length);
    const e = aesCbcNoPadEncrypt(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0;
    for (let j = 0; j < 16; j += 1) sum += e[j]!;
    const mod = sum % 3;
    k = await sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, e);
    i += 1;
    if (i >= 64 && e[e.length - 1]! <= i - 32) break;
  }
  return k.subarray(0, 32);
}

/** Revisions 5 and 6: the file key unwrapped with the (empty) user password. */
async function aes256FileKey(encrypt: PdfDict): Promise<Uint8Array> {
  const r = numberOf(encrypt.get('R'), 6);
  const u = bytesOf(encrypt.get('U'), 'U');
  const ue = bytesOf(encrypt.get('UE'), 'UE');
  const keySalt = u.subarray(40, 48);
  const password = new Uint8Array(0);
  const intermediate =
    r === 5 ? await sha(256, concat(password, keySalt)) : await hash2B(password, keySalt, new Uint8Array(0));
  // AES-256 CBC, zero IV, no padding: prepend a zero IV and let the CBC
  // routine consume it; it will not strip padding that is not there.
  const withIv = concat(new Uint8Array(16), ue.subarray(0, 32));
  const key = aesCbcDecrypt(intermediate, concat(withIv, new Uint8Array(0)));
  return key.subarray(0, 32);
}

export async function openStandardSecurity(
  encrypt: PdfDict,
  firstId: Uint8Array,
): Promise<Decryptor> {
  const filter = encrypt.get('Filter');
  if (!(filter instanceof PdfName) || filter.name !== 'Standard') {
    throw new PdfSecurityError('Only the Standard security handler is supported');
  }
  const v = numberOf(encrypt.get('V'), 1);
  const r = numberOf(encrypt.get('R'), 2);

  const streamMethod = cryptFilterMethod(encrypt, 'StmF', v);
  const stringMethod = cryptFilterMethod(encrypt, 'StrF', v);

  const fileKey = r >= 5 ? await aes256FileKey(encrypt) : legacyFileKey(encrypt, firstId);

  const objectKeyCache = new Map<string, Uint8Array>();
  function objectKey(num: number, gen: number, aes: boolean): Uint8Array {
    const cacheKey = `${num}:${gen}:${aes ? 1 : 0}`;
    const cached = objectKeyCache.get(cacheKey);
    if (cached) return cached;
    const extra = new Uint8Array([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff]);
    const digest = md5(concat(fileKey, extra, aes ? AES_SALT : new Uint8Array(0)));
    const key = digest.subarray(0, Math.min(fileKey.length + 5, 16));
    objectKeyCache.set(cacheKey, key);
    return key;
  }

  return {
    streamMethod,
    stringMethod,
    decrypt(data, num, gen, kind) {
      const method = kind === 'stream' ? streamMethod : stringMethod;
      switch (method) {
        case 'none':
          return data;
        case 'rc4':
          return rc4(objectKey(num, gen, false), data);
        case 'aesv2':
          return aesCbcDecrypt(objectKey(num, gen, true), data);
        case 'aesv3':
          return aesCbcDecrypt(fileKey, data);
      }
    },
  };
}
