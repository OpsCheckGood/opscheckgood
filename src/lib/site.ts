/**
 * Where this project lives.
 *
 * ONE PLACE. If the repository moves, change `REPO` here and nothing else --
 * the footer link, the bug report page, the offline copies' footer, and the
 * `repository`/`bugs` fields in package.json all resolve from it. A test in
 * tests/report.test.ts asserts this file and package.json still agree, because
 * two hand-maintained copies of a URL drift and the one that drifts is always
 * the one nobody clicks.
 */

/** owner/name on GitHub. */
export const REPO = 'ops-check-good/opscheckgood';

export const REPO_URL = `https://github.com/${REPO}`;
export const ISSUES_URL = `${REPO_URL}/issues`;

/**
 * Opens the issue form. Deliberately carries no prefilled body: the report is
 * built on the page and copied to the clipboard, and stuffing it through a URL
 * would truncate it at the browser's length limit and quietly lose the end.
 */
export const NEW_ISSUE_URL = `${ISSUES_URL}/new`;

/** Kept in step with package.json by the same test. */
export const VERSION = '0.1.0';
