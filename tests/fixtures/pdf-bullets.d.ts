/** See pdf-bullets.js -- upstream's optimizer, used as a shaping oracle. */
export declare const STATUS: {
  OPTIMIZED: number;
  FAILED_OPT: number;
  NOT_OPT: number;
  MAX_UNDERFLOW: number;
};
export declare function runReference(
  line: string,
  getWidth: (text: string) => number,
  width: number,
  maxUnderflow: number,
): {
  status: number;
  text: string;
  textLines: string[];
  lines: number;
  overflow: number;
  fullWidth: number;
};
export declare function AdobeLineSplitFn(text: string): string[];
