import { EMBEDDED_FONTS, decodeBase64, isEmbeddedFontPath } from './registry';

/**
 * Registers a bundled font with the document so the panes can be rendered at
 * the form's real width in the form's real face.
 *
 * This is what makes wrapping mean something: a pane set to 202.321mm in
 * Liberation Serif at 12pt breaks lines where the actual 1206 field breaks
 * them, so "this is two lines" is visible rather than asserted.
 *
 * The bytes come from the same embedded module the measurement core parses, so
 * what you see and what we measure cannot come from different fonts -- and it
 * still works from file://, where a fetched @font-face would not.
 */

const faces = new Map<string, Promise<string>>();

export function ensureFontFace(path: string): Promise<string> {
  const cached = faces.get(path);
  if (cached) return cached;

  if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
    return Promise.reject(new Error('No document to register a font with.'));
  }
  if (!isEmbeddedFontPath(path)) {
    return Promise.reject(new Error(`No embedded font for "${path}".`));
  }

  const entry = EMBEDDED_FONTS[path];
  // Namespaced so it can never collide with a locally installed family and
  // silently substitute -- the exact failure the metrics module exists to avoid.
  const family = `OCG-${entry.slug}`;

  const promise = entry
    .load()
    .then((module: { base64: string }) =>
      new FontFace(family, decodeBase64(module.base64)).load(),
    )
    .then((face: FontFace) => {
      document.fonts.add(face);
      return family;
    });

  faces.set(path, promise);
  return promise;
}
