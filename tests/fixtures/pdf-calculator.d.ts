/** See pdf-calculator.js -- the PDF's own script, used as a scoring oracle. */
export declare function runReference(
  inputs: Record<string, string>,
): Record<string, string> & { __highlighted: string[] };
