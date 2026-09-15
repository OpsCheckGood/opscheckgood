/**
 * When the PDF builders were last changed.
 *
 * Every page of every downloadable PDF carries this in its footer as a
 * "current as of" date beside the site's address, so someone holding a copy
 * from a shared drive can tell whether the site has moved on. Bump it when
 * a builder's script, layout or embedded original changes; nothing derives
 * it automatically because a build date would change without meaning.
 */
export const BUILDERS_UPDATED = '2026-09-15';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "CAO 15 SEP 2026", the way a date is stamped on a form. */
export function caoStamp(iso: string = BUILDERS_UPDATED): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return `CAO ${iso}`;
  return `CAO ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export const SITE_URL = 'https://opscheckgood.github.io/opscheckgood/';
export const SITE_HOST = 'opscheckgood.github.io/opscheckgood';

/** "OpsCheckGood-Decoration-Writer-Builder.pdf", or "-filled" when it carries the page's entries. */
export function downloadName(tool: string, variant: 'blank' | 'filled' | 'word' = 'blank'): string {
  const stem = `OpsCheckGood-${tool.replace(/\s+/g, '-')}`;
  if (variant === 'word') return `${stem}-Word-draft.docx`;
  return `${stem}-Builder${variant === 'filled' ? '-filled' : ''}.pdf`;
}

/** The title every builder's document information carries. */
export function documentTitle(tool: string): string {
  return `Ops Check Good - ${tool} - fillable PDF builder`;
}

/** The footer every page carries: the site's address beside the current-as-of stamp, and nothing else. */
export function footerText(iso: string = BUILDERS_UPDATED): string {
  return `${SITE_HOST}   ${caoStamp(iso)}`;
}
