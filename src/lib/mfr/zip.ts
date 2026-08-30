/**
 * A minimal store-only ZIP writer.
 *
 * A .docx is a ZIP of XML parts. Stored (uncompressed) entries are valid ZIP
 * and Word opens them, which means the Word export needs no deflate
 * implementation and no library -- and so no runtime dependency that could
 * reach the network (constraint 1). A memorandum is a few kilobytes of XML; the
 * compression is not worth the code.
 */

export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[][] = [];
  let offset = 0;

  const enc = (s: string) => new TextEncoder().encode(s);
  const le = (n: number, bytes: number) => {
    const a = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) a[i] = (n >>> (8 * i)) & 0xff;
    return a;
  };
  const put = (u8: Uint8Array) => {
    parts.push(u8);
    offset += u8.length;
  };

  for (const f of files) {
    const name = enc(f.name);
    const data = typeof f.data === 'string' ? enc(f.data) : f.data;
    const crc = crc32(data);
    const localOffset = offset;

    put(le(0x04034b50, 4));
    put(le(20, 2)); // version needed
    put(le(0, 2)); // flags
    put(le(0, 2)); // method: stored
    put(le(0, 2)); // mod time
    put(le(0, 2)); // mod date
    put(le(crc, 4));
    put(le(data.length, 4));
    put(le(data.length, 4));
    put(le(name.length, 2));
    put(le(0, 2)); // extra length
    put(name);
    put(data);

    central.push([
      le(0x02014b50, 4),
      le(20, 2),
      le(20, 2),
      le(0, 2),
      le(0, 2),
      le(0, 2),
      le(0, 2),
      le(crc, 4),
      le(data.length, 4),
      le(data.length, 4),
      le(name.length, 2),
      le(0, 2),
      le(0, 2),
      le(0, 2),
      le(0, 2),
      le(0, 4),
      le(localOffset, 4),
      name,
    ]);
  }

  const directoryStart = offset;
  for (const entry of central) for (const chunk of entry) put(chunk);
  const directorySize = offset - directoryStart;

  put(le(0x06054b50, 4));
  put(le(0, 2));
  put(le(0, 2));
  put(le(files.length, 2));
  put(le(files.length, 2));
  put(le(directorySize, 4));
  put(le(directoryStart, 4));
  put(le(0, 2)); // comment length

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
