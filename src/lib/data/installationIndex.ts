/**
 * The shape of the generated installation index.
 *
 * Kept in its own module so the generated file can import a type without
 * dragging in the loader, and so the generator stays a list of imports and
 * nothing else.
 */
export type DataFileRef = readonly [file: string, raw: unknown];
