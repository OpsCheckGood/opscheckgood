/**
 * The three primitives the PDF standard security handler needs, in plain
 * TypeScript: MD5, RC4 and AES-CBC decryption.
 *
 * WebCrypto has AES-CBC but no MD5 and no RC4, and it rejects a block whose
 * PKCS#5 padding is malformed, which e-Publishing forms produce for some
 * streams (pypdf warns "Invalid padding bytes" on them). A pure implementation
 * decrypts those the way Acrobat does -- strip what padding is plausible and
 * carry on -- so everything lives here and nothing depends on the platform.
 *
 * None of this is security code in the protective sense: it opens forms that
 * carry an owner password and an empty user password, which every reader on
 * earth does silently. It is here so the form's XFA data can be read.
 */

// ---------------------------------------------------------------------------
// MD5 (RFC 1321)
// ---------------------------------------------------------------------------

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;

export function md5(input: Uint8Array): Uint8Array {
  const bitLen = input.length * 8;
  const padded = new Uint8Array(((input.length + 8) >> 6 << 6) + 64);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const m = new Uint32Array(16);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) m[i] = view.getUint32(offset + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + MD5_K[i]! + m[g]!) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << MD5_S[i]!) | (sum >>> (32 - MD5_S[i]!)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return out;
}

// ---------------------------------------------------------------------------
// RC4
// ---------------------------------------------------------------------------

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

// ---------------------------------------------------------------------------
// AES (FIPS 197), decryption only, CBC mode
// ---------------------------------------------------------------------------

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
(() => {
  // Generate the S-box from the multiplicative inverse and affine transform.
  let p = 1;
  let q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i += 1) INV_SBOX[SBOX[i]!] = i;
})();

function xtime(b: number): number {
  return ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
}

function mul(a: number, b: number): number {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = xtime(a);
    b >>= 1;
  }
  return r;
}

function expandKey(key: Uint8Array): Uint8Array[] {
  const nk = key.length / 4;
  const rounds = nk + 6;
  const w: number[][] = [];
  for (let i = 0; i < nk; i += 1) w.push([key[4 * i]!, key[4 * i + 1]!, key[4 * i + 2]!, key[4 * i + 3]!]);
  let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i += 1) {
    let temp = [...w[i - 1]!];
    if (i % nk === 0) {
      temp = [SBOX[temp[1]!]! ^ rcon, SBOX[temp[2]!]!, SBOX[temp[3]!]!, SBOX[temp[0]!]!];
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      temp = temp.map((b) => SBOX[b]!);
    }
    w.push(w[i - nk]!.map((b, j) => b ^ temp[j]!));
  }
  const roundKeys: Uint8Array[] = [];
  for (let r = 0; r <= rounds; r += 1) {
    roundKeys.push(new Uint8Array(w.slice(4 * r, 4 * r + 4).flat()));
  }
  return roundKeys;
}

function decryptBlock(block: Uint8Array, roundKeys: Uint8Array[]): Uint8Array {
  const rounds = roundKeys.length - 1;
  const state = new Uint8Array(block);
  const addRoundKey = (r: number) => {
    for (let i = 0; i < 16; i += 1) state[i]! ^= roundKeys[r]![i]!;
  };
  const invShiftRows = () => {
    for (let row = 1; row < 4; row += 1) {
      const tmp = [state[row]!, state[row + 4]!, state[row + 8]!, state[row + 12]!];
      for (let col = 0; col < 4; col += 1) state[row + 4 * ((col + row) % 4)] = tmp[col]!;
    }
  };
  const invSubBytes = () => {
    for (let i = 0; i < 16; i += 1) state[i] = INV_SBOX[state[i]!]!;
  };
  const invMixColumns = () => {
    for (let col = 0; col < 4; col += 1) {
      const a = state.subarray(4 * col, 4 * col + 4);
      const [a0, a1, a2, a3] = [a[0]!, a[1]!, a[2]!, a[3]!];
      a[0] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
      a[1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
      a[2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
      a[3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
    }
  };

  addRoundKey(rounds);
  for (let r = rounds - 1; r >= 1; r -= 1) {
    invShiftRows();
    invSubBytes();
    addRoundKey(r);
    invMixColumns();
  }
  invShiftRows();
  invSubBytes();
  addRoundKey(0);
  return state;
}

/**
 * AES-CBC with the IV in the first 16 bytes, as PDF stores it. Padding is
 * stripped when it is well formed and tolerated when it is not, because the
 * forms this exists for contain streams whose padding is wrong and Acrobat
 * opens them anyway.
 */
export function aesCbcDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 32) return new Uint8Array(0);
  const roundKeys = expandKey(key);
  const usable = data.length - (data.length % 16);
  const out = new Uint8Array(usable - 16);
  let previous = data.subarray(0, 16);
  for (let offset = 16; offset < usable; offset += 16) {
    const block = data.subarray(offset, offset + 16);
    const plain = decryptBlock(block, roundKeys);
    for (let i = 0; i < 16; i += 1) out[offset - 16 + i] = plain[i]! ^ previous[i]!;
    previous = block;
  }
  const pad = out[out.length - 1] ?? 0;
  if (pad >= 1 && pad <= 16 && pad <= out.length) {
    let ok = true;
    for (let i = out.length - pad; i < out.length; i += 1) if (out[i] !== pad) ok = false;
    if (ok) return out.subarray(0, out.length - pad);
  }
  return out;
}

/**
 * AES-CBC the way PDF stores it: a random IV first, PKCS#5 padding last.
 * The inverse of `aesCbcDecrypt`.
 */
export function aesCbcEncrypt(key: Uint8Array, data: Uint8Array, iv: Uint8Array = randomBytes(16)): Uint8Array {
  const pad = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + pad);
  padded.set(data);
  padded.fill(pad, data.length);
  return concat(iv, aesCbcNoPadEncrypt(key, iv, padded));
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** AES-CBC without an IV prefix and without padding: the R6 password hash. */
export function aesCbcNoPadEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const roundKeys = expandKey(key);
  const out = new Uint8Array(data.length);
  let previous = iv;
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) block[i] = data[offset + i]! ^ previous[i]!;
    const enc = encryptBlock(block, roundKeys);
    out.set(enc, offset);
    previous = enc;
  }
  return out;
}

function encryptBlock(block: Uint8Array, roundKeys: Uint8Array[]): Uint8Array {
  const rounds = roundKeys.length - 1;
  const state = new Uint8Array(block);
  const addRoundKey = (r: number) => {
    for (let i = 0; i < 16; i += 1) state[i]! ^= roundKeys[r]![i]!;
  };
  const shiftRows = () => {
    for (let row = 1; row < 4; row += 1) {
      const tmp = [state[row]!, state[row + 4]!, state[row + 8]!, state[row + 12]!];
      for (let col = 0; col < 4; col += 1) state[row + 4 * col] = tmp[(col + row) % 4]!;
    }
  };
  const subBytes = () => {
    for (let i = 0; i < 16; i += 1) state[i] = SBOX[state[i]!]!;
  };
  const mixColumns = () => {
    for (let col = 0; col < 4; col += 1) {
      const a = state.subarray(4 * col, 4 * col + 4);
      const [a0, a1, a2, a3] = [a[0]!, a[1]!, a[2]!, a[3]!];
      a[0] = mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3;
      a[1] = a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3;
      a[2] = a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3);
      a[3] = mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2);
    }
  };
  addRoundKey(0);
  for (let r = 1; r < rounds; r += 1) {
    subBytes();
    shiftRows();
    mixColumns();
    addRoundKey(r);
  }
  subBytes();
  shiftRows();
  addRoundKey(rounds);
  return state;
}

/** SHA-256/384/512 through WebCrypto, which every target has. */
export async function sha(bits: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(`SHA-${bits}`, data as BufferSource);
  return new Uint8Array(digest);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
