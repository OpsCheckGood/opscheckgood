import type { CeremonyData } from '../data/ceremony';
import type { CeremonyInput } from '../promotion/ceremony';
import type { CertificateDefinition, CitationLanguage } from '../decoration/types';
import type { CitationInput } from '../decoration/citation';
import { decodeBase64 } from '../metrics/registry';
import { PdfRewriter } from '../pdf/rewrite';
import { buildDecorationFormPdf, decorationFieldValues } from './decoration-form';
import { promotionFieldValues } from './promotion-form';
import { documentTitle } from './version';
export { downloadName } from './version';

/**
 * The fillable PDFs the site hands out, each locked at the moment of
 * download: an owner password nobody keeps, an empty user password so it
 * opens anywhere, and permissions that allow filling and printing and
 * nothing else. Filled from what the user typed on the page when asked,
 * blank otherwise.
 *
 * The two files that began life elsewhere are embedded as prepared by
 * scripts/embed-forms.mjs and loaded only when a download is asked for, so
 * a page that never downloads never pays for them.
 */

async function lock(bytes: Uint8Array, values: Record<string, string> | null, tool: string): Promise<Uint8Array> {
  const rw = await PdfRewriter.open(bytes);
  if (values) rw.fill(values);
  rw.setInfo({ Title: documentTitle(tool), Author: 'Ops Check Good', Creator: 'Ops Check Good', Producer: 'Ops Check Good' });
  return rw.save();
}

/** The PT calculator, always blank: the page keeps no draft to fill it from. */
export async function ptCalculatorPdf(): Promise<Uint8Array> {
  const mod = await import('./embedded/pt-calculator');
  return lock(new Uint8Array(decodeBase64(mod.base64)), null, 'PT Calculator');
}

/** The promotion script builder, blank or carrying the page's entries. */
export async function promotionBuilderPdf(input: CeremonyInput | null, data: CeremonyData): Promise<Uint8Array> {
  const mod = await import('./embedded/promotion-script');
  return lock(new Uint8Array(decodeBase64(mod.base64)), input ? promotionFieldValues(input, data) : null, 'Promotion Script Builder');
}

/** The decoration writer, built fresh, blank or carrying the page's entries. */
export async function decorationBuilderPdf(
  input: CitationInput | null,
  language: CitationLanguage,
  certificate: CertificateDefinition,
): Promise<Uint8Array> {
  const bytes = buildDecorationFormPdf(language, certificate);
  return lock(bytes, input ? decorationFieldValues(input, language, certificate) : null, 'Decoration Writer');
}

/** Hands the browser a file. Object URLs need no network and no server. */
export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/pdf'): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
