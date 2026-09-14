import { PdfDocument } from './document';
import { readDatasetValues, readTemplateFields, readXfaPackets, type XfaField } from './xfa';

/**
 * An Air Force form, read from its own PDF.
 *
 * This is where the field widths come from once and for all: not typed into a
 * data file from memory, but read out of the form's XFA template, the same
 * numbers Acrobat lays the text out with. It also lifts the bullets someone
 * has already typed into the form, so a package that arrives as a filled PDF
 * goes straight into the draft.
 *
 * Only the text fields set in the form's body face matter here. Header fields
 * -- name, unit, award period -- are returned too, but the caller decides what
 * to do with them, and the Bullet Bench ignores them.
 */

export interface FormTextField extends XfaField {
  /** The width text can occupy: the box less its side insets. */
  usableWidthMm: number | null;
  /** What the form holds in this field, or null when it is empty. */
  value: string | null;
}

export interface ReadForm {
  /** "AF FORM 1206" or "DAF FORM 910", as the form prints it. */
  formNumber: string | null;
  /** The edition date printed with it, YYYYMMDD. */
  edition: string | null;
  fields: FormTextField[];
  encrypted: boolean;
}

export class NotAnXfaFormError extends Error {
  constructor(message = 'This PDF does not carry XFA form data.') {
    super(message);
    this.name = 'NotAnXfaFormError';
  }
}

const EDITION = /\b(D?AF)\s+(?:IMT\s+)?FORM\s+(\d+[A-Z]?)\s*,\s*(\d{8})/i;

export async function readForm(bytes: Uint8Array): Promise<ReadForm> {
  const doc = await PdfDocument.open(bytes);
  const packets = await readXfaPackets(doc);
  if (!packets || !packets.template) throw new NotAnXfaFormError();

  const values = packets.datasets ? readDatasetValues(packets.datasets) : new Map<string, string>();
  const fields: FormTextField[] = readTemplateFields(packets.template).map((f) => {
    const value = values.get(f.name);
    return {
      ...f,
      usableWidthMm: f.widthMm === null ? null : f.widthMm - f.insetLeftMm - f.insetRightMm,
      value: value !== undefined && value.trim() !== '' ? value : null,
    };
  });

  const editionSource = packets.template + (packets.all.get('form') ?? '');
  const m = EDITION.exec(editionSource);

  return {
    formNumber: m ? `${m[1]!.toUpperCase()} FORM ${m[2]!}` : null,
    edition: m ? m[3]! : null,
    fields,
    encrypted: doc.encrypted,
  };
}

/**
 * The fields worth shaping bullets in: multi-line text fields in a body face
 * at a body size, wide enough to hold a line of a bullet.
 */
export function bulletFields(form: ReadForm): FormTextField[] {
  return form.fields.filter(
    (f) =>
      f.widthMm !== null &&
      f.widthMm >= 100 &&
      f.sizePt !== null &&
      f.sizePt >= 9 &&
      (f.multiLine || (f.heightMm !== null && f.heightMm >= 8)),
  );
}
