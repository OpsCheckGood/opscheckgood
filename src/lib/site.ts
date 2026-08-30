/**
 * Where this project lives, and how much of it is reachable.
 *
 * ONE PLACE. If the repository moves or its visibility changes, edit the three
 * constants below and nothing else -- the footer, the bug report page, the
 * offline copies' shell, and package.json all resolve from here. Tests in
 * tests/report.test.ts assert the copies still agree, because two
 * hand-maintained copies of a URL drift, and the one that drifts is always the
 * one nobody clicks.
 */

/** owner/name on GitHub. */
export const REPO = 'OpsCheckGood/opscheckgood';

/**
 * Whether anyone but a collaborator can open the repository.
 *
 * While this is false the UI shows no GitHub links at all. A link to a private
 * repository is a 404 for every visitor who is not on the collaborator list,
 * and sending a would-be reporter to a 404 is worse than offering them nothing:
 * it costs them the effort and tells us nothing. The report itself still
 * assembles and still copies -- only the destination is withheld.
 *
 * Flip this to true when the repository goes public and the links appear.
 */
export const REPO_IS_PUBLIC = false;

/**
 * Optional address shown on the bug report page as a mailto link.
 *
 * Empty by default and deliberately not guessed: publishing an address is the
 * maintainer's decision, not something to infer from a git config. Set it to
 * offer a route while the repository stays private.
 */
export const CONTACT_EMAIL = '';

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
