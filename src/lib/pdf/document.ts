import {
  Lexer,
  Parser,
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  PdfSyntaxError,
  ascii,
  indexOf,
  lastIndexOf,
  type PdfDict,
  type PdfObject,
} from './objects';
import { openStandardSecurity, type Decryptor } from './security';

/**
 * A PDF file opened far enough to read its objects.
 *
 * Cross-reference tables and cross-reference streams, incremental updates
 * (`/Prev`, `/XRefStm`), object streams, Flate with PNG predictors, and the
 * standard security handler with an empty user password. That is the set an
 * e-Publishing form needs, and a form saved from Acrobat with an incremental
 * update on the end. Nothing here renders anything.
 *
 * When the cross-reference data is unusable the whole file is scanned for
 * `N G obj` headers instead, which is what every reader falls back to.
 */

type XrefEntry =
  | { kind: 'offset'; offset: number; gen: number }
  | { kind: 'in-stream'; streamNum: number; index: number };

export class PdfDocument {
  private readonly xref = new Map<number, XrefEntry>();
  readonly trailer: PdfDict = new Map();
  private readonly cache = new Map<number, PdfObject>();
  private readonly objectStreams = new Map<number, Promise<Map<number, PdfObject>>>();
  private decryptor: Decryptor | null = null;
  private encryptRef: PdfRef | null = null;
  private scanned = false;

  private constructor(readonly bytes: Uint8Array) {}

  static async open(bytes: Uint8Array): Promise<PdfDocument> {
    const doc = new PdfDocument(bytes);
    try {
      await doc.readXref();
    } catch {
      doc.scanForObjects();
    }
    if (!doc.trailer.has('Root')) doc.scanForObjects();
    await doc.openSecurity();
    return doc;
  }

  // -------------------------------------------------------------------------
  // Cross-reference
  // -------------------------------------------------------------------------

  private async readXref(): Promise<void> {
    const tail = lastIndexOf(this.bytes, ascii('startxref'));
    if (tail < 0) throw new PdfSyntaxError('No startxref', this.bytes.length);
    const lexer = new Lexer(this.bytes, tail + 9);
    const t = lexer.next();
    if (t.kind !== 'number') throw new PdfSyntaxError('Bad startxref', tail);

    const seen = new Set<number>();
    let offset: number | null = t.value;
    while (offset !== null && offset >= 0 && offset < this.bytes.length && !seen.has(offset)) {
      seen.add(offset);
      const trailer = await this.readXrefSection(offset);
      for (const [k, v] of trailer) if (!this.trailer.has(k)) this.trailer.set(k, v);
      // Hybrid files: the stream's entries override the table's.
      const hybrid = trailer.get('XRefStm');
      if (typeof hybrid === 'number' && !seen.has(hybrid)) {
        seen.add(hybrid);
        await this.readXrefSection(hybrid);
      }
      const prev = trailer.get('Prev');
      offset = typeof prev === 'number' ? prev : null;
    }
  }

  /** Reads one section (table or stream) and returns its trailer dictionary. */
  private async readXrefSection(offset: number): Promise<PdfDict> {
    const lexer = new Lexer(this.bytes, offset);
    const t = lexer.next();
    if (t.kind === 'keyword' && t.value === 'xref') return this.readXrefTable(lexer);
    // Otherwise "N G obj" introducing a cross-reference stream.
    lexer.pos = offset;
    const { object } = this.parseIndirectAt(offset);
    if (!(object instanceof PdfStream)) throw new PdfSyntaxError('Expected xref stream', offset);
    await this.readXrefStream(object);
    return object.dict;
  }

  private readXrefTable(lexer: Lexer): PdfDict {
    for (;;) {
      const save = lexer.pos;
      const t = lexer.next();
      if (t.kind === 'keyword' && t.value === 'trailer') {
        const parser = new Parser(lexer);
        const dict = parser.parse();
        if (!(dict instanceof Map)) throw new PdfSyntaxError('Bad trailer', lexer.pos);
        return dict;
      }
      if (t.kind !== 'number') throw new PdfSyntaxError('Bad xref table', save);
      const start = t.value;
      const count = lexer.next();
      if (count.kind !== 'number') throw new PdfSyntaxError('Bad xref table', lexer.pos);
      for (let i = 0; i < count.value; i += 1) {
        const off = lexer.next();
        const gen = lexer.next();
        const type = lexer.next();
        if (off.kind !== 'number' || gen.kind !== 'number' || type.kind !== 'keyword') {
          throw new PdfSyntaxError('Bad xref entry', lexer.pos);
        }
        const num = start + i;
        if (type.value === 'n' && !this.xref.has(num)) {
          this.xref.set(num, { kind: 'offset', offset: off.value, gen: gen.value });
        }
      }
    }
  }

  private async readXrefStream(stream: PdfStream): Promise<void> {
    // The xref stream is never encrypted, and its /Length is direct.
    const data = await decodeStream(stream, null, 0, 0);
    const w = stream.dict.get('W');
    if (!Array.isArray(w)) throw new PdfSyntaxError('Xref stream without /W', 0);
    const widths = w.map((x) => (typeof x === 'number' ? x : 0));
    const size = stream.dict.get('Size');
    const indexRaw = stream.dict.get('Index');
    const index =
      Array.isArray(indexRaw) && indexRaw.length >= 2
        ? indexRaw.map((x) => (typeof x === 'number' ? x : 0))
        : [0, typeof size === 'number' ? size : 0];
    const rowLen = widths.reduce((a, b) => a + b, 0);
    let pos = 0;
    for (let i = 0; i + 1 < index.length; i += 2) {
      const start = index[i]!;
      const count = index[i + 1]!;
      for (let k = 0; k < count && pos + rowLen <= data.length; k += 1) {
        const fields = widths.map((width) => {
          let v = 0;
          for (let j = 0; j < width; j += 1) v = v * 256 + data[pos + j]!;
          pos += width;
          return v;
        });
        const type = widths[0] === 0 ? 1 : fields[0]!;
        const num = start + k;
        if (this.xref.has(num)) continue;
        if (type === 1) this.xref.set(num, { kind: 'offset', offset: fields[1]!, gen: fields[2] ?? 0 });
        else if (type === 2) this.xref.set(num, { kind: 'in-stream', streamNum: fields[1]!, index: fields[2] ?? 0 });
      }
    }
  }

  /** Last resort: every "N G obj" in the file, later ones winning. */
  private scanForObjects(): void {
    if (this.scanned) return;
    this.scanned = true;
    this.xref.clear();
    this.cache.clear();
    const b = this.bytes;
    const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
    // Latin-1 view is fine: we only need the positions of ASCII tokens.
    let text = '';
    const CHUNK = 1 << 16;
    for (let i = 0; i < b.length; i += CHUNK) text += String.fromCharCode(...b.subarray(i, i + CHUNK));
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const before = m.index === 0 ? 0x20 : text.charCodeAt(m.index - 1);
      if (before >= 0x30 && before <= 0x39) continue;
      this.xref.set(Number(m[1]), { kind: 'offset', offset: m.index, gen: Number(m[2]) });
    }
    if (!this.trailer.has('Root')) {
      const trailerPattern = /trailer\s*<</g;
      let last = -1;
      while ((m = trailerPattern.exec(text)) !== null) last = m.index;
      if (last >= 0) {
        const lexer = new Lexer(b, last + 7);
        try {
          const dict = new Parser(lexer).parse();
          if (dict instanceof Map) for (const [k, v] of dict) if (!this.trailer.has(k)) this.trailer.set(k, v);
        } catch {
          /* fall through to the object search below */
        }
      }
    }
    if (!this.trailer.has('Root')) {
      // Object streams and xref streams carry the trailer keys on themselves.
      for (const [num, entry] of this.xref) {
        if (entry.kind !== 'offset') continue;
        try {
          const { object } = this.parseIndirectAt(entry.offset);
          const dict = object instanceof PdfStream ? object.dict : object instanceof Map ? object : null;
          if (!dict) continue;
          const type = dict.get('Type');
          if (type instanceof PdfName && type.name === 'XRef') {
            for (const [k, v] of dict) if (!this.trailer.has(k)) this.trailer.set(k, v);
          }
          if (type instanceof PdfName && type.name === 'Catalog') {
            if (!this.trailer.has('Root')) this.trailer.set('Root', new PdfRef(num, entry.gen));
          }
        } catch {
          /* skip unparseable objects */
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  private async openSecurity(): Promise<void> {
    const encrypt = this.trailer.get('Encrypt');
    if (encrypt === undefined || encrypt === null) return;
    let dict: PdfObject;
    if (encrypt instanceof PdfRef) {
      this.encryptRef = encrypt;
      dict = await this.fetch(encrypt, false);
    } else {
      dict = encrypt;
    }
    if (!(dict instanceof Map)) throw new PdfSyntaxError('Bad /Encrypt', 0);
    const ids = this.trailer.get('ID');
    const firstId =
      Array.isArray(ids) && ids[0] instanceof PdfString ? ids[0].bytes : new Uint8Array(0);
    this.decryptor = await openStandardSecurity(dict, firstId);
  }

  get encrypted(): boolean {
    return this.decryptor !== null;
  }

  /** Every object number the cross-reference knows, ascending. */
  objectNumbers(): number[] {
    return [...this.xref.keys()].sort((a, b) => a - b);
  }

  /** The generation of an object that sits directly in the file (0 for members of object streams). */
  generationOf(num: number): number {
    const entry = this.xref.get(num);
    return entry?.kind === 'offset' ? entry.gen : 0;
  }

  /** A stream's bytes with the encryption removed but its filters left in place. */
  rawDecrypted(stream: PdfStream, num: number, gen: number): Uint8Array {
    const type = stream.dict.get('Type');
    const isXref = type instanceof PdfName && type.name === 'XRef';
    if (!this.decryptor || isXref) return stream.raw;
    return this.decryptor.decrypt(stream.raw, num, gen, 'stream');
  }

  // -------------------------------------------------------------------------
  // Objects
  // -------------------------------------------------------------------------

  private parseIndirectAt(offset: number): { num: number; gen: number; object: PdfObject } {
    const lexer = new Lexer(this.bytes, offset);
    const n = lexer.next();
    const g = lexer.next();
    const kw = lexer.next();
    if (n.kind !== 'number' || g.kind !== 'number' || kw.kind !== 'keyword' || kw.value !== 'obj') {
      throw new PdfSyntaxError('Expected "N G obj"', offset);
    }
    const parser = new Parser(lexer, (ref) => this.lengthOf(ref));
    const object = parser.parse();
    return { num: n.value, gen: g.value, object };
  }

  /** Resolves a stream's indirect /Length synchronously, or gives up. */
  private lengthOf(ref: PdfRef): number | null {
    const cached = this.cache.get(ref.num);
    if (typeof cached === 'number') return cached;
    const entry = this.xref.get(ref.num);
    if (!entry || entry.kind !== 'offset') return null;
    try {
      const { object } = this.parseIndirectAt(entry.offset);
      return typeof object === 'number' ? object : null;
    } catch {
      return null;
    }
  }

  /** Follows references until a direct object comes back. */
  async resolve(value: PdfObject | undefined): Promise<PdfObject> {
    let current: PdfObject = value ?? null;
    for (let i = 0; i < 32 && current instanceof PdfRef; i += 1) current = await this.fetch(current, true);
    return current;
  }

  private async fetch(ref: PdfRef, decryptStrings: boolean): Promise<PdfObject> {
    const cached = this.cache.get(ref.num);
    if (cached !== undefined) return cached;

    const entry = this.xref.get(ref.num);
    let object: PdfObject = null;
    if (entry?.kind === 'offset') {
      try {
        const parsed = this.parseIndirectAt(entry.offset);
        if (parsed.num !== ref.num) throw new PdfSyntaxError('Wrong object at offset', entry.offset);
        object = parsed.object;
      } catch {
        if (!this.scanned) {
          this.scanForObjects();
          const again = this.xref.get(ref.num);
          if (again?.kind === 'offset') object = this.parseIndirectAt(again.offset).object;
        }
      }
      if (decryptStrings && this.decryptor && !(this.encryptRef && this.encryptRef.num === ref.num)) {
        object = this.decryptStringsIn(object, ref.num, ref.gen);
      }
    } else if (entry?.kind === 'in-stream') {
      const members = await this.objectStream(entry.streamNum);
      object = members.get(ref.num) ?? null;
    }
    this.cache.set(ref.num, object);
    return object;
  }

  private decryptStringsIn(object: PdfObject, num: number, gen: number): PdfObject {
    if (object instanceof PdfString) {
      return new PdfString(this.decryptor!.decrypt(object.bytes, num, gen, 'string'));
    }
    if (Array.isArray(object)) return object.map((o) => this.decryptStringsIn(o, num, gen));
    if (object instanceof PdfStream) {
      const dict: PdfDict = new Map();
      for (const [k, v] of object.dict) dict.set(k, this.decryptStringsIn(v, num, gen));
      return new PdfStream(dict, object.raw);
    }
    if (object instanceof Map) {
      const dict: PdfDict = new Map();
      for (const [k, v] of object) dict.set(k, this.decryptStringsIn(v, num, gen));
      return dict;
    }
    return object;
  }

  private objectStream(streamNum: number): Promise<Map<number, PdfObject>> {
    let pending = this.objectStreams.get(streamNum);
    if (!pending) {
      pending = (async () => {
        const stream = await this.resolve(new PdfRef(streamNum, 0));
        if (!(stream instanceof PdfStream)) throw new PdfSyntaxError('Missing object stream', 0);
        const data = await this.streamData(stream, streamNum, 0);
        const n = await this.resolve(stream.dict.get('N'));
        const first = await this.resolve(stream.dict.get('First'));
        if (typeof n !== 'number' || typeof first !== 'number') {
          throw new PdfSyntaxError('Bad object stream header', 0);
        }
        const header = new Lexer(data, 0);
        const offsets: Array<[number, number]> = [];
        for (let i = 0; i < n; i += 1) {
          const num = header.next();
          const off = header.next();
          if (num.kind !== 'number' || off.kind !== 'number') break;
          offsets.push([num.value, off.value]);
        }
        const members = new Map<number, PdfObject>();
        for (const [num, off] of offsets) {
          try {
            members.set(num, new Parser(new Lexer(data, first + off)).parse());
          } catch {
            /* a broken member does not take the others down */
          }
        }
        return members;
      })();
      this.objectStreams.set(streamNum, pending);
    }
    return pending;
  }

  /** The decoded bytes of a stream that lives in indirect object `num gen`. */
  async streamData(stream: PdfStream, num: number, gen: number): Promise<Uint8Array> {
    const type = stream.dict.get('Type');
    const isXref = type instanceof PdfName && type.name === 'XRef';
    return decodeStream(stream, isXref ? null : this.decryptor, num, gen, (v) => this.resolve(v));
  }

  /** Filters only, for a stream whose bytes are already decrypted. */
  async decodeDecrypted(stream: PdfStream): Promise<Uint8Array> {
    return decodeStream(stream, null, 0, 0, (v) => this.resolve(v));
  }

  /** Convenience: resolve a reference expected to be a stream and decode it. */
  async streamOf(ref: PdfObject | undefined): Promise<Uint8Array | null> {
    const target = ref instanceof PdfRef ? ref : null;
    const object = await this.resolve(ref);
    if (!(object instanceof PdfStream)) return null;
    return this.streamData(object, target?.num ?? 0, target?.gen ?? 0);
  }

  /** The document catalog. */
  async catalog(): Promise<PdfDict> {
    const root = await this.resolve(this.trailer.get('Root'));
    if (!(root instanceof Map)) throw new PdfSyntaxError('No catalog', 0);
    return root;
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

async function decodeStream(
  stream: PdfStream,
  decryptor: Decryptor | null,
  num: number,
  gen: number,
  resolve: (v: PdfObject | undefined) => Promise<PdfObject> = async (v) => v ?? null,
): Promise<Uint8Array> {
  let data = stream.raw;
  if (decryptor) data = decryptor.decrypt(data, num, gen, 'stream');

  const filterValue = await resolve(stream.dict.get('Filter'));
  const filters = (Array.isArray(filterValue) ? filterValue : [filterValue]).filter(
    (f): f is PdfName => f instanceof PdfName,
  );
  const parmsValue = await resolve(stream.dict.get('DecodeParms'));
  const parms = Array.isArray(parmsValue) ? parmsValue : [parmsValue];

  for (let i = 0; i < filters.length; i += 1) {
    const name = filters[i]!.name;
    const parm = await resolve(parms[i]);
    const parmDict = parm instanceof Map ? parm : null;
    switch (name) {
      case 'FlateDecode':
      case 'Fl':
        data = await inflate(data);
        break;
      case 'ASCIIHexDecode':
      case 'AHx':
        data = asciiHexDecode(data);
        break;
      case 'ASCII85Decode':
      case 'A85':
        data = ascii85Decode(data);
        break;
      case 'Crypt':
        break;
      default:
        throw new PdfSyntaxError(`Unsupported stream filter ${name}`, 0);
    }
    if (parmDict) {
      const predictor = await resolve(parmDict.get('Predictor'));
      if (typeof predictor === 'number' && predictor > 1) {
        const columns = (await resolve(parmDict.get('Columns'))) as number | null;
        const colors = (await resolve(parmDict.get('Colors'))) as number | null;
        const bpc = (await resolve(parmDict.get('BitsPerComponent'))) as number | null;
        data = unpredict(data, predictor, columns ?? 1, colors ?? 1, bpc ?? 8);
      }
    }
  }
  return data;
}

/** zlib-wrapped deflate, which is what /FlateDecode carries. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // Skip leading whitespace some writers leave before the zlib header.
  let start = 0;
  while (start < data.length && (data[start] === 0x0a || data[start] === 0x0d || data[start] === 0x20)) start += 1;
  const input = data.subarray(start);
  const tryFormat = async (format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> => {
    const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } catch (error) {
      // Corrupt tail: keep what decoded, which is how Acrobat treats it.
      if (chunks.length === 0) throw error;
    }
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  };
  try {
    return await tryFormat('deflate');
  } catch {
    return tryFormat('deflate-raw');
  }
}

function unpredict(data: Uint8Array, predictor: number, columns: number, colors: number, bpc: number): Uint8Array {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((columns * colors * bpc) / 8);
  if (predictor === 2) {
    // TIFF predictor, 8-bit only.
    if (bpc !== 8) return data;
    const out = new Uint8Array(data);
    for (let r = 0; r + rowLen <= out.length; r += rowLen) {
      for (let i = bpp; i < rowLen; i += 1) out[r + i] = (out[r + i]! + out[r + i - bpp]!) & 0xff;
    }
    return out;
  }
  // PNG predictors: each row is preceded by a filter-type byte.
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let previous = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r += 1) {
    const type = data[r * (rowLen + 1)]!;
    const row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const current = new Uint8Array(rowLen);
    for (let i = 0; i < rowLen; i += 1) {
      const raw = row[i]!;
      const left = i >= bpp ? current[i - bpp]! : 0;
      const up = previous[i]!;
      const upLeft = i >= bpp ? previous[i - bpp]! : 0;
      let value: number;
      switch (type) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + up; break;
        case 3: value = raw + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default: value = raw;
      }
      current[i] = value & 0xff;
    }
    out.set(current, r * rowLen);
    previous = current;
  }
  return out;
}

function asciiHexDecode(data: Uint8Array): Uint8Array {
  let hex = '';
  for (const c of data) {
    if (c === 0x3e) break;
    const ch = String.fromCharCode(c);
    if (/[0-9A-Fa-f]/.test(ch)) hex += ch;
  }
  if (hex.length % 2) hex += '0';
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(2 * i, 2), 16);
  return out;
}

function ascii85Decode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let tuple: number[] = [];
  let i = 0;
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2;
  for (; i < data.length; i += 1) {
    const c = data[i]!;
    if (c === 0x7e) break;
    if (c === 0x7a && tuple.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 0x21 || c > 0x75) continue;
    tuple.push(c - 33);
    if (tuple.length === 5) {
      let v = 0;
      for (const t of tuple) v = v * 85 + t;
      out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
      tuple = [];
    }
  }
  if (tuple.length > 0) {
    const n = tuple.length;
    while (tuple.length < 5) tuple.push(84);
    let v = 0;
    for (const t of tuple) v = v * 85 + t;
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    out.push(...bytes.slice(0, n - 1));
  }
  return new Uint8Array(out);
}

export { indexOf };
