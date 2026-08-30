import { loadDataset, isPlaceholderString, isPlaceholderNumber } from './loader';
import {
  DataFileError,
  type Constraint,
  type Dataset,
  type FormDefinition,
  type FormField,
} from './types';

import af1206 from '../../data/forms/af1206.json';
import af910 from '../../data/forms/af910.json';
import af911 from '../../data/forms/af911.json';
import sandbox from '../../data/forms/sandbox.json';

/**
 * Form definitions.
 *
 * Adding a form is a data edit plus one line in RAW_FORMS below. If supporting
 * a new form ever needs a change to a component, the abstraction has broken --
 * see constraint 4 in CLAUDE.md.
 */

// Order drives the form picker, and the first usable entry is the default.
const RAW_FORMS: ReadonlyArray<readonly [string, unknown]> = [
  ['src/data/forms/af1206.json', af1206],
  ['src/data/forms/af910.json', af910],
  ['src/data/forms/af911.json', af911],
  ['src/data/forms/sandbox.json', sandbox],
];

function isConstraint(value: unknown): value is Constraint {
  return value === 'width' || value === 'chars';
}

function normalizeField(raw: unknown, file: string, index: number): FormField {
  if (typeof raw !== 'object' || raw === null) {
    throw new DataFileError(file, `field ${index} must be an object`);
  }
  const field = raw as Record<string, unknown>;
  if (typeof field.id !== 'string' || field.id === '') {
    throw new DataFileError(file, `field ${index} needs a non-empty id`);
  }
  if (!isConstraint(field.constraint)) {
    throw new DataFileError(
      file,
      `field "${field.id}" constraint must be "width" or "chars", got ${JSON.stringify(field.constraint)}`,
    );
  }
  const num = (key: string): number | null => {
    const value = field[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new DataFileError(file, `field "${field.id}" ${key} must be a number or null`);
    }
    return value;
  };
  return {
    id: field.id,
    label: typeof field.label === 'string' ? field.label : field.id,
    constraint: field.constraint,
    widthMm: num('widthMm'),
    maxChars: num('maxChars'),
    lines: num('lines'),
  };
}

function normalizeForm(raw: unknown, _meta: unknown, file: string): FormDefinition {
  if (typeof raw !== 'object' || raw === null) {
    throw new DataFileError(file, 'data must be an object');
  }
  const form = raw as Record<string, unknown>;
  if (typeof form.id !== 'string' || form.id === '') {
    throw new DataFileError(file, 'data.id must be a non-empty string');
  }
  const font = form.font as Record<string, unknown> | undefined;
  if (typeof font !== 'object' || font === null) {
    throw new DataFileError(file, 'data.font must be an object');
  }
  if (!Array.isArray(form.fields) || form.fields.length === 0) {
    throw new DataFileError(file, 'data.fields must be a non-empty array');
  }
  return {
    id: form.id,
    label: typeof form.label === 'string' ? form.label : form.id,
    font: {
      family: typeof font.family === 'string' ? font.family : '',
      sizePt: typeof font.sizePt === 'number' ? font.sizePt : 0,
      file: typeof font.file === 'string' ? font.file : '',
    },
    fields: form.fields.map((f, i) => normalizeField(f, file, i)),
  };
}

export const FORMS: ReadonlyArray<Dataset<FormDefinition>> = RAW_FORMS.map(
  ([file, raw]) => loadDataset(file, raw, normalizeForm),
);

export function getForm(id: string): Dataset<FormDefinition> | undefined {
  return FORMS.find((f) => f.data.id === id);
}

export function getField(
  form: FormDefinition,
  fieldId: string,
): FormField | undefined {
  return form.fields.find((f) => f.id === fieldId);
}

/** True when the field carries the value its own `constraint` says binds. */
export function isFieldPopulated(field: FormField): boolean {
  return field.constraint === 'width'
    ? !isPlaceholderNumber(field.widthMm)
    : !isPlaceholderNumber(field.maxChars);
}

/** True when the form has a real font and at least one usable field. */
export function isFormUsable(form: FormDefinition): boolean {
  return (
    !isPlaceholderString(form.font.family) &&
    !isPlaceholderNumber(form.font.sizePt) &&
    !isPlaceholderString(form.font.file) &&
    form.fields.some(isFieldPopulated)
  );
}

/** Forms that can actually measure something today. */
export function usableForms(): ReadonlyArray<Dataset<FormDefinition>> {
  return FORMS.filter((f) => isFormUsable(f.data));
}
