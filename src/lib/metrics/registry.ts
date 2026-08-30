import { createFontMetrics, type FontMetrics } from './font';
import { EMBEDDED_FONTS, type EmbeddedFontPath } from './embedded';

/**
 * Resolves the font path in a form definition to a parsed, measurable font.
 *
 * Fonts come from the generated embedded modules rather than `fetch()`, so the
 * measurement core works identically served over HTTP, opened from disk, and
 * under Vitest in Node. Each font is its own dynamic-import chunk: only the font
 * the selected form actually needs is downloaded.
 */

/** Decodes base64 in the browser and in Node without branching at the callsite. */
export function decodeBase64(base64: string): ArrayBuffer {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  const buffer = Buffer.from(base64, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export function isEmbeddedFontPath(path: string): path is EmbeddedFontPath {
  return path in EMBEDDED_FONTS;
}

export function embeddedFontPaths(): EmbeddedFontPath[] {
  return Object.keys(EMBEDDED_FONTS) as EmbeddedFontPath[];
}

/** Parsing a TTF is not cheap; one parse per font per session. */
const cache = new Map<string, Promise<FontMetrics>>();

export function loadFontMetrics(path: string, family?: string): Promise<FontMetrics> {
  const key = `${path}::${family ?? ''}`;
  const cached = cache.get(key);
  if (cached) return cached;

  if (!isEmbeddedFontPath(path)) {
    return Promise.reject(
      new Error(
        `No embedded font for "${path}". Add the .ttf to public/fonts and run ` +
          `\`npm run embed:fonts\`. Available: ${embeddedFontPaths().join(', ')}`,
      ),
    );
  }

  const promise = EMBEDDED_FONTS[path]
    .load()
    .then((module) => createFontMetrics(decodeBase64(module.base64), { family }));

  cache.set(key, promise);
  return promise;
}
