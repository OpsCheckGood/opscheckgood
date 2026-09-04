/** See baseDirectory.js -- parsing and mapping for installation-run websites. */

export interface DirectoryEntry {
  label: string;
  phone: string;
  dsn: string;
}

export interface CategoryRule {
  id: string;
  labels: string[];
  exclude?: string[];
}

export interface DirectoryPage {
  url: string;
  entries: DirectoryEntry[];
}

export interface ChosenContact extends DirectoryEntry {
  categoryId: string;
  url: string;
}

export declare function decodeEntities(text: string): string;
export declare function textLines(html: string): string[];
export declare function phoneDigits(value: string): string;
export declare function samePhone(a: string, b: string): boolean;
export declare function parseDirectoryLine(line: string): DirectoryEntry | null;
export declare function parseDirectory(html: string): DirectoryEntry[];
export declare function normalizeLabel(label: string): string;
export declare function matchCategory(label: string, rules: CategoryRule[]): string | null;
export declare function chooseContacts(
  pages: DirectoryPage[],
  rules: CategoryRule[],
): Map<string, ChosenContact>;
export declare function directoryLinks(html: string, pageUrl: string, hints: string[]): string[];
export declare function pageTitle(html: string): string;
export declare function pageIdentity(html: string): string;
export declare function siteMatchesInstallation(title: string, label: string): boolean;
