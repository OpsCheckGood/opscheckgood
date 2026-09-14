/**
 * PDF object syntax: a tokenizer and a parser over a byte array.
 *
 * Only what a form reader needs. It reads dictionaries, arrays, names,
 * strings, numbers, references and streams; it does not interpret content
 * streams, fonts or pages. Everything else in this directory is built on it.
 */

export class PdfName {
  constructor(public readonly name: string) {}
}

export class PdfString {
  constructor(public readonly bytes: Uint8Array) {}
  /** PDFDocEncoding is close enough to Latin-1 for the names this reads. */
  get text(): string {
    const b = this.bytes;
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
      let s = '';
      for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i]! << 8) | b[i + 1]!);
      return s;
    }
    return String.fromCharCode(...b);
  }
}

export class PdfRef {
  constructor(
    public readonly num: number,
    public readonly gen: number,
  ) {}
  get key(): string {
    return `${this.num}R${this.gen}`;
  }
}

export type PdfDict = Map<string, PdfObject>;

export class PdfStream {
  constructor(
    public readonly dict: PdfDict,
    /** Bytes exactly as they sit in the file: encrypted and filtered. */
    public readonly raw: Uint8Array,
  ) {}
}

export type PdfObject =
  | null
  | boolean
  | number
  | PdfString
  | PdfName
  | PdfObject[]
  | PdfDict
  | PdfRef
  | PdfStream;

export class PdfSyntaxError extends Error {
  constructor(message: string, public readonly offset: number) {
    super(`${message} at byte ${offset}`);
    this.name = 'PdfSyntaxError';
  }
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export function isWhitespace(byte: number): boolean {
  return WHITESPACE.has(byte);
}

function isRegular(byte: number): boolean {
  return !WHITESPACE.has(byte) && !DELIMITER.has(byte);
}

export type Token =
  | { kind: 'number'; value: number; integer: boolean }
  | { kind: 'name'; value: string }
  | { kind: 'string'; value: Uint8Array }
  | { kind: 'delim'; value: '[' | ']' | '<<' | '>>' | '{' | '}' }
  | { kind: 'keyword'; value: string }
  | { kind: 'eof' };

export class Lexer {
  pos: number;

  constructor(
    public readonly bytes: Uint8Array,
    start = 0,
  ) {
    this.pos = start;
  }

  private skipWhitespaceAndComments(): void {
    const b = this.bytes;
    while (this.pos < b.length) {
      const c = b[this.pos]!;
      if (WHITESPACE.has(c)) {
        this.pos += 1;
      } else if (c === 0x25) {
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos += 1;
      } else {
        break;
      }
    }
  }

  next(): Token {
    this.skipWhitespaceAndComments();
    const b = this.bytes;
    if (this.pos >= b.length) return { kind: 'eof' };
    const c = b[this.pos]!;

    if (c === 0x2f) return this.readName();
    if (c === 0x28) return this.readLiteralString();
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return { kind: 'delim', value: '<<' };
      }
      return this.readHexString();
    }
    if (c === 0x3e) {
      if (b[this.pos + 1] === 0x3e) {
        this.pos += 2;
        return { kind: 'delim', value: '>>' };
      }
      throw new PdfSyntaxError('Unexpected ">"', this.pos);
    }
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      this.pos += 1;
      return { kind: 'delim', value: String.fromCharCode(c) as '[' | ']' | '{' | '}' };
    }
    if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) return this.readNumber();

    const start = this.pos;
    while (this.pos < b.length && isRegular(b[this.pos]!)) this.pos += 1;
    if (this.pos === start) throw new PdfSyntaxError(`Unexpected byte ${c}`, start);
    return { kind: 'keyword', value: latin1(b.subarray(start, this.pos)) };
  }

  private readNumber(): Token {
    const b = this.bytes;
    const start = this.pos;
    let integer = true;
    while (this.pos < b.length && isRegular(b[this.pos]!)) {
      if (b[this.pos] === 0x2e) integer = false;
      this.pos += 1;
    }
    const text = latin1(b.subarray(start, this.pos));
    const value = Number(text.replace(/^([+-]?)\./, '$10.'));
    if (Number.isNaN(value)) {
      // "--5" and similar malformed numbers occur in the wild; read as 0.
      return { kind: 'number', value: 0, integer };
    }
    return { kind: 'number', value, integer };
  }

  private readName(): Token {
    const b = this.bytes;
    this.pos += 1;
    let out = '';
    while (this.pos < b.length && isRegular(b[this.pos]!)) {
      const c = b[this.pos]!;
      if (c === 0x23 && this.pos + 2 < b.length) {
        const hex = latin1(b.subarray(this.pos + 1, this.pos + 3));
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 3;
          continue;
        }
      }
      out += String.fromCharCode(c);
      this.pos += 1;
    }
    return { kind: 'name', value: out };
  }

  private readLiteralString(): Token {
    const b = this.bytes;
    this.pos += 1;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      let c = b[this.pos]!;
      this.pos += 1;
      if (c === 0x5c) {
        c = b[this.pos]!;
        this.pos += 1;
        switch (c) {
          case 0x6e: out.push(0x0a); break; // n
          case 0x72: out.push(0x0d); break; // r
          case 0x74: out.push(0x09); break; // t
          case 0x62: out.push(0x08); break; // b
          case 0x66: out.push(0x0c); break; // f
          case 0x0d: if (b[this.pos] === 0x0a) this.pos += 1; break; // line continuation
          case 0x0a: break;
          default:
            if (c >= 0x30 && c <= 0x37) {
              let code = c - 0x30;
              for (let i = 0; i < 2 && b[this.pos]! >= 0x30 && b[this.pos]! <= 0x37; i += 1) {
                code = code * 8 + (b[this.pos]! - 0x30);
                this.pos += 1;
              }
              out.push(code & 0xff);
            } else {
              out.push(c);
            }
        }
      } else if (c === 0x28) {
        depth += 1;
        out.push(c);
      } else if (c === 0x29) {
        depth -= 1;
        if (depth === 0) break;
        out.push(c);
      } else {
        out.push(c);
      }
    }
    return { kind: 'string', value: new Uint8Array(out) };
  }

  private readHexString(): Token {
    const b = this.bytes;
    this.pos += 1;
    let hex = '';
    while (this.pos < b.length && b[this.pos] !== 0x3e) {
      const c = b[this.pos]!;
      if (!WHITESPACE.has(c)) hex += String.fromCharCode(c);
      this.pos += 1;
    }
    this.pos += 1;
    if (hex.length % 2 === 1) hex += '0';
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(2 * i, 2), 16) || 0;
    return { kind: 'string', value: out };
  }
}

export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]!);
  return s;
}

/**
 * Parses one object starting at the lexer's position. `resolveLength` is how
 * a stream whose /Length is an indirect reference finds its byte count; a
 * caller without a document passes nothing and the parser searches for
 * `endstream` instead.
 */
export class Parser {
  constructor(
    public readonly lexer: Lexer,
    private readonly resolveLength?: (ref: PdfRef) => number | null,
  ) {}

  get pos(): number {
    return this.lexer.pos;
  }

  parse(first?: Token): PdfObject {
    const token = first ?? this.lexer.next();
    switch (token.kind) {
      case 'eof':
        throw new PdfSyntaxError('Unexpected end of data', this.lexer.pos);
      case 'number': {
        // Lookahead for "num gen R".
        if (token.integer && token.value >= 0) {
          const save = this.lexer.pos;
          const t2 = this.lexer.next();
          if (t2.kind === 'number' && t2.integer && t2.value >= 0) {
            const save2 = this.lexer.pos;
            const t3 = this.lexer.next();
            if (t3.kind === 'keyword' && t3.value === 'R') {
              return new PdfRef(token.value, t2.value);
            }
            this.lexer.pos = save2;
            this.lexer.pos = save;
            return token.value;
          }
          this.lexer.pos = save;
        }
        return token.value;
      }
      case 'name':
        return new PdfName(token.value);
      case 'string':
        return new PdfString(token.value);
      case 'keyword':
        if (token.value === 'true') return true;
        if (token.value === 'false') return false;
        if (token.value === 'null') return null;
        throw new PdfSyntaxError(`Unexpected keyword "${token.value}"`, this.lexer.pos);
      case 'delim':
        if (token.value === '[') return this.parseArray();
        if (token.value === '<<') return this.parseDictOrStream();
        throw new PdfSyntaxError(`Unexpected "${token.value}"`, this.lexer.pos);
    }
  }

  private parseArray(): PdfObject[] {
    const out: PdfObject[] = [];
    for (;;) {
      const t = this.lexer.next();
      if (t.kind === 'delim' && t.value === ']') return out;
      if (t.kind === 'eof') throw new PdfSyntaxError('Unterminated array', this.lexer.pos);
      out.push(this.parse(t));
    }
  }

  private parseDictOrStream(): PdfDict | PdfStream {
    const dict: PdfDict = new Map();
    for (;;) {
      const t = this.lexer.next();
      if (t.kind === 'delim' && t.value === '>>') break;
      if (t.kind === 'eof') throw new PdfSyntaxError('Unterminated dictionary', this.lexer.pos);
      if (t.kind !== 'name') {
        // Tolerate junk: skip a value that has no key.
        this.parse(t);
        continue;
      }
      dict.set(t.value, this.parse());
    }
    // A stream follows its dictionary immediately.
    const save = this.lexer.pos;
    const t = this.lexer.next();
    if (t.kind === 'keyword' && t.value === 'stream') {
      return new PdfStream(dict, this.readStreamBytes(dict));
    }
    this.lexer.pos = save;
    return dict;
  }

  private readStreamBytes(dict: PdfDict): Uint8Array {
    const b = this.lexer.bytes;
    let pos = this.lexer.pos;
    // After the keyword: CRLF or LF.
    if (b[pos] === 0x0d) pos += 1;
    if (b[pos] === 0x0a) pos += 1;
    const start = pos;

    let length: number | null = null;
    const declared = dict.get('Length');
    if (typeof declared === 'number') length = declared;
    else if (declared instanceof PdfRef && this.resolveLength) length = this.resolveLength(declared);

    let end: number;
    if (length !== null && length >= 0 && start + length <= b.length && this.endstreamFollows(start + length)) {
      end = start + length;
    } else {
      // The declared length is wrong or unavailable: find the keyword.
      end = indexOf(b, ENDSTREAM, start);
      if (end < 0) throw new PdfSyntaxError('Stream without endstream', start);
      // Strip the EOL that precedes the keyword.
      if (b[end - 1] === 0x0a) end -= 1;
      if (b[end - 1] === 0x0d) end -= 1;
    }
    const raw = b.subarray(start, end);
    const keyword = indexOf(b, ENDSTREAM, end);
    this.lexer.pos = keyword < 0 ? b.length : keyword + ENDSTREAM.length;
    return raw;
  }

  private endstreamFollows(pos: number): boolean {
    const b = this.lexer.bytes;
    let p = pos;
    while (p < b.length && WHITESPACE.has(b[p]!)) p += 1;
    for (let i = 0; i < ENDSTREAM.length; i += 1) if (b[p + i] !== ENDSTREAM[i]) return false;
    return true;
  }
}

const ENDSTREAM = new Uint8Array([0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d]);

export function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = Math.max(0, from); i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function lastIndexOf(haystack: Uint8Array, needle: Uint8Array, from = haystack.length): number {
  outer: for (let i = Math.min(from, haystack.length - needle.length); i >= 0; i -= 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}
