import { PdfDocument } from './document';
import {
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  type PdfDict,
  type PdfObject,
} from './objects';
import { FORM_ONLY, lockStandardSecurity, type Permissions } from './security';
import { randomBytes } from './crypto';

/**
 * Rewriting a PDF: open it, change a few things, save it -- locked.
 *
 * The site ships two fillable forms that began life elsewhere: the PT
 * calculator and the promotion script builder. They have to go out with
 * their document info scrubbed, their unit-specific text replaced, their
 * script matched to the site's, their fields filled from what the user typed
 * on the page, and locked so the form itself cannot be edited, only filled.
 * That is a rewrite, not a build, and this is the rewriter.
 *
 * Every object the source file knows is loaded, decrypted and re-emitted as a
 * plain top-level object in a new file with a classic cross-reference table.
 * Streams keep their filters and their bytes; the ones this touches -- page
 * content, the document script -- are written back uncompressed. The new
 * file is encrypted with the standard security handler, AES-128, an owner
 * password nobody keeps and an empty user password, so it opens anywhere and
 * edits nowhere.
 */

export interface LockOptions {
  /** Defaults to a random password that is never stored. */
  ownerPassword?: string;
  permissions?: Permissions;
}

export class PdfRewriter {
  private objects = new Map<number, PdfObject>();
  private trailer: PdfDict;

  private constructor(
    private readonly doc: PdfDocument,
    trailer: PdfDict,
  ) {
    this.trailer = trailer;
  }

  static async open(bytes: Uint8Array): Promise<PdfRewriter> {
    const doc = await PdfDocument.open(bytes);
    const rewriter = new PdfRewriter(doc, new Map(doc.trailer));
    for (const num of doc.objectNumbers()) {
      const object = await doc.resolve(new PdfRef(num, doc.generationOf(num)));
      if (object === null) continue;
      if (object instanceof PdfStream) {
        const type = object.dict.get('Type');
        const name = type instanceof PdfName ? type.name : '';
        // Cross-reference streams and object streams describe the old file's
        // layout; the new file has its own.
        if (name === 'XRef' || name === 'ObjStm') continue;
        const dict: PdfDict = new Map(object.dict);
        rewriter.objects.set(num, new PdfStream(dict, doc.rawDecrypted(object, num, doc.generationOf(num))));
      } else {
        rewriter.objects.set(num, object);
      }
    }
    // The old encryption belongs to the old file.
    rewriter.trailer.delete('Encrypt');
    rewriter.trailer.delete('XRefStm');
    rewriter.trailer.delete('Prev');
    return rewriter;
  }

  get catalog(): PdfDict {
    const root = this.trailer.get('Root');
    const cat = root instanceof PdfRef ? this.objects.get(root.num) : root;
    if (!(cat instanceof Map)) throw new Error('No catalog');
    return cat;
  }

  /** Follows a reference to the object in this rewriter's table. */
  deref(value: PdfObject | undefined): PdfObject {
    let current: PdfObject = value ?? null;
    for (let i = 0; i < 32 && current instanceof PdfRef; i += 1) current = this.objects.get(current.num) ?? null;
    return current;
  }

  /** Adds a new object and returns a reference to it. */
  add(object: PdfObject): PdfRef {
    const num = Math.max(0, ...this.objects.keys()) + 1;
    this.objects.set(num, object);
    return new PdfRef(num, 0);
  }

  /** The decoded bytes of a stream in this table: already decrypted, filters applied. */
  async decode(ref: PdfObject | undefined): Promise<Uint8Array | null> {
    const stream = this.deref(ref);
    if (!(stream instanceof PdfStream)) return null;
    return this.doc.decodeDecrypted(stream);
  }

  // -------------------------------------------------------------------------
  // Edits
  // -------------------------------------------------------------------------

  /** Replaces the document information dictionary entirely. */
  setInfo(info: Record<string, string>): void {
    const dict: PdfDict = new Map();
    for (const [k, v] of Object.entries(info)) dict.set(k, new PdfString(latin1(v)));
    const existing = this.trailer.get('Info');
    if (existing instanceof PdfRef) this.objects.set(existing.num, dict);
    else this.trailer.set('Info', this.add(dict));
  }

  /** Every terminal form field, with its fully qualified name. */
  fields(): Array<{ name: string; dict: PdfDict; ref: PdfRef }> {
    const acro = this.deref(this.catalog.get('AcroForm'));
    if (!(acro instanceof Map)) return [];
    const out: Array<{ name: string; dict: PdfDict; ref: PdfRef }> = [];
    const walk = (refs: PdfObject, prefix: string) => {
      if (!Array.isArray(refs)) return;
      for (const ref of refs) {
        if (!(ref instanceof PdfRef)) continue;
        const dict = this.deref(ref);
        if (!(dict instanceof Map)) continue;
        const t = dict.get('T');
        const name = prefix + (t instanceof PdfString ? t.text : '');
        const kids = dict.get('Kids');
        if (Array.isArray(kids) && kids.length && !dict.has('FT')) walk(kids, `${name}.`);
        else out.push({ name, dict, ref });
      }
    };
    walk(this.deref(acro.get('Fields')), '');
    return out;
  }

  /**
   * Sets field values by name. A field not named is left alone; with
   * `clearOthers`, every text and choice field not named is emptied. Stale
   * appearance streams are dropped so the reader draws the new value.
   */
  fill(values: Record<string, string>, clearOthers = false): void {
    for (const { name, dict } of this.fields()) {
      const ft = dict.get('FT');
      const kind = ft instanceof PdfName ? ft.name : '';
      if (kind !== 'Tx' && kind !== 'Ch') continue;
      if (name in values) {
        dict.set('V', new PdfString(latin1(values[name]!)));
        dict.delete('AP');
      } else if (clearOthers) {
        dict.delete('V');
        dict.delete('AP');
      }
    }
    const acro = this.deref(this.catalog.get('AcroForm'));
    if (acro instanceof Map) acro.set('NeedAppearances', true);
  }

  /** Removes every field the predicate accepts, from the form and from its page. */
  removeFields(accept: (field: { name: string; dict: PdfDict }) => boolean): number {
    const acro = this.deref(this.catalog.get('AcroForm'));
    if (!(acro instanceof Map)) return 0;
    const doomed = new Set<number>();
    for (const { name, dict, ref } of this.fields()) if (accept({ name, dict })) doomed.add(ref.num);
    if (doomed.size === 0) return 0;
    const prune = (list: PdfObject) => (Array.isArray(list) ? list.filter((r) => !(r instanceof PdfRef && doomed.has(r.num))) : list);
    acro.set('Fields', prune(this.deref(acro.get('Fields'))));
    for (const page of this.pages()) {
      const annots = this.deref(page.get('Annots'));
      if (Array.isArray(annots)) page.set('Annots', prune(annots));
    }
    for (const num of doomed) this.objects.delete(num);
    return doomed.size;
  }

  /** Replaces the document-level JavaScript with one script. */
  setDocumentScript(name: string, source: string): void {
    const stream = new PdfStream(new Map<string, PdfObject>([['Length', source.length]]), latin1(source));
    const streamRef = this.add(stream);
    const action = this.add(new Map<string, PdfObject>([['S', new PdfName('JavaScript')], ['JS', streamRef]]));
    const tree = new Map<string, PdfObject>([['Names', [new PdfString(latin1(name)), action]]]);
    const names = this.deref(this.catalog.get('Names'));
    if (names instanceof Map) names.set('JavaScript', tree);
    else this.catalog.set('Names', new Map<string, PdfObject>([['JavaScript', tree]]));
  }

  /** Page dictionaries in order. */
  pages(): PdfDict[] {
    const out: PdfDict[] = [];
    const walk = (node: PdfObject) => {
      const dict = this.deref(node);
      if (!(dict instanceof Map)) return;
      const type = dict.get('Type');
      if (type instanceof PdfName && type.name === 'Page') out.push(dict);
      else for (const kid of (this.deref(dict.get('Kids')) as PdfObject[]) ?? []) walk(kid);
    };
    walk(this.catalog.get('Pages') ?? null);
    return out;
  }

  /**
   * Edits every page's content stream as text. `edit` gets the decoded
   * content and returns the new content, written back uncompressed.
   */
  async editContent(edit: (content: string, pageIndex: number) => string): Promise<void> {
    const pages = this.pages();
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i]!;
      const contents = page.get('Contents');
      const refs = (Array.isArray(contents) ? contents : [contents]).filter((r): r is PdfRef => r instanceof PdfRef);
      let text = '';
      for (const ref of refs) {
        const bytes = await this.decode(ref);
        if (bytes) text += `${new TextDecoder('latin1').decode(bytes)}\n`;
      }
      const next = edit(text, i);
      if (next === text) continue;
      const bytes = latin1(next);
      const stream = new PdfStream(new Map<string, PdfObject>([['Length', bytes.length]]), bytes);
      if (refs.length === 1) this.objects.set(refs[0]!.num, stream);
      else page.set('Contents', this.add(stream));
    }
  }

  // -------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------

  /** Writes the file, locked. */
  save(options: LockOptions = {}): Uint8Array {
    const firstId = randomBytes(16);
    const secondId = randomBytes(16);
    const encryptor = lockStandardSecurity(
      options.ownerPassword ?? bytesToHex(randomBytes(24)),
      options.permissions ?? FORM_ONLY,
      firstId,
    );

    // Renumber densely, in the old order, so references stay valid via a map.
    const numbers = [...this.objects.keys()].sort((a, b) => a - b);
    const renumber = new Map<number, number>();
    numbers.forEach((old, i) => renumber.set(old, i + 1));
    const encryptRef = numbers.length + 1;

    const chunks: Uint8Array[] = [];
    let length = 0;
    const put = (bytes: Uint8Array) => {
      chunks.push(bytes);
      length += bytes.length;
    };
    put(latin1('%PDF-1.6\n%\xe2\xe3\xcf\xd3\n'));

    const offsets: number[] = [];
    for (const old of numbers) {
      const num = renumber.get(old)!;
      offsets[num] = length;
      const object = this.objects.get(old)!;
      put(latin1(`${num} 0 obj\n`));
      put(serialize(object, renumber, (data) => encryptor.encrypt(data, num, 0)));
      put(latin1('\nendobj\n'));
    }
    offsets[encryptRef] = length;
    put(latin1(`${encryptRef} 0 obj\n`));
    put(serialize(encryptor.dict, renumber, null));
    put(latin1('\nendobj\n'));

    const trailer: PdfDict = new Map();
    for (const [k, v] of this.trailer) {
      if (k === 'Size' || k === 'ID') continue;
      trailer.set(k, v);
    }
    trailer.set('Size', encryptRef + 1);
    // The trailer's references go through the same renumbering as everything
    // else, so the /Encrypt reference is entered under a number no old object
    // can have had. Writing `encryptRef` directly collided with an old object
    // of that number whenever the old numbering had a gap.
    const encryptKey = Math.max(0, ...numbers) + 1_000_000;
    renumber.set(encryptKey, encryptRef);
    trailer.set('Encrypt', new PdfRef(encryptKey, 0));
    trailer.set('ID', [new PdfString(firstId), new PdfString(secondId)]);

    const xref = length;
    let table = `xref\n0 ${encryptRef + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= encryptRef; i += 1) table += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
    put(latin1(table));
    put(latin1('trailer\n'));
    put(serialize(trailer, renumber, null));
    put(latin1(`\nstartxref\n${xref}\n%%EOF\n`));

    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------

export function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexString(bytes: Uint8Array): string {
  return `<${bytesToHex(bytes)}>`;
}

function nameToken(name: string): string {
  return `/${name.replace(/[^!-~]|[#()<>[\]{}/%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;
}

function numberToken(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Serialises one object. Strings and stream bodies go through `encrypt`
 * when one is given; the /Encrypt dictionary and the trailer pass null.
 */
export function serialize(
  object: PdfObject,
  renumber: Map<number, number>,
  encrypt: ((data: Uint8Array) => Uint8Array) | null,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const text = (s: string) => parts.push(latin1(s));

  const write = (value: PdfObject): void => {
    if (value === null || value === undefined) text('null');
    else if (typeof value === 'boolean') text(value ? 'true' : 'false');
    else if (typeof value === 'number') text(numberToken(value));
    else if (value instanceof PdfName) text(nameToken(value.name));
    else if (value instanceof PdfString) text(hexString(encrypt ? encrypt(value.bytes) : value.bytes));
    else if (value instanceof PdfRef) text(`${renumber.get(value.num) ?? value.num} 0 R`);
    else if (Array.isArray(value)) {
      text('[');
      value.forEach((v, i) => {
        if (i) text(' ');
        write(v);
      });
      text(']');
    } else if (value instanceof PdfStream) {
      const body = encrypt ? encrypt(value.raw) : value.raw;
      const dict: PdfDict = new Map(value.dict);
      dict.set('Length', body.length);
      write(dict);
      text('\nstream\n');
      parts.push(body);
      text('\nendstream');
    } else if (value instanceof Map) {
      text('<<');
      for (const [k, v] of value) {
        text(`${nameToken(k)} `);
        write(v);
        text(' ');
      }
      text('>>');
    }
  };
  write(object);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
