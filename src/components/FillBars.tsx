/**
 * The signature element: one bar per line, showing how close each bullet sits
 * to its target.
 *
 * Twenty of these have to be readable at a glance, so every bar shares one
 * scale, the target sits at the same x on every row, and colour carries exactly
 * three meanings -- short, in tolerance, over. The tolerance band is drawn as a
 * shaded strip just inside the target line, which is what a user is aiming for.
 *
 * The component is deliberately unaware of millimetres. The form's `constraint`
 * decides whether the binding metric is width or characters, and the caller
 * turns that into rows -- so a character-limited EPB block gets the same bars
 * as a width-driven 1206 block with no branching down here.
 */

export type LineState = 'ok' | 'short' | 'over';

export interface BarRow {
  /** Index of the line in the document, for labelling and selection. */
  index: number;
  /** Fraction of target, where 1 is exactly flush. */
  ratio: number;
  /** Tolerance as a fraction of target. */
  tolerance: number;
  state: LineState;
  /** Binding metric, e.g. "178.2/180mm". Rendered in the accent colour. */
  primary: string;
  /** Informational metric, e.g. "96ch". Rendered muted. */
  secondary: string;
  /** Screen-reader description of the row. */
  description: string;
}

/** The bar spans 115% of target, leaving room to show an overflow. */
const SCALE = 1.15;
const TARGET_X = (1 / SCALE) * 100;

const STATE_COLOR: Record<LineState, string> = {
  ok: 'var(--state-ok)',
  short: 'var(--state-short)',
  over: 'var(--state-over)',
};

export function FillBars({
  rows,
  caption,
  activeLine,
  onSelectLine,
}: {
  rows: BarRow[];
  caption: string;
  activeLine: number | null;
  onSelectLine?: (index: number) => void;
}) {
  return (
    <section aria-label="Fill against target" className="panel">
      <header
        className="flex flex-wrap items-baseline justify-between gap-x-3 border-b px-3 py-2"
        style={{ borderColor: 'var(--rule)' }}
      >
        <h2 className="label m-0">Fill against target</h2>
        <p className="tabular m-0 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          {caption}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="m-0 px-3 py-4 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
          Type a bullet to see how it measures.
        </p>
      ) : (
        <ol className="m-0 list-none p-0">
          {rows.map((row) => {
            const color = STATE_COLOR[row.state];
            const fillPct = Math.min(row.ratio, SCALE) * TARGET_X;
            const overflows = row.ratio > SCALE;
            const tolPct = row.tolerance * TARGET_X;
            const isActive = activeLine === row.index;

            return (
              <li key={row.index} style={{ borderTop: '1px solid var(--rule)' }}>
                <button
                  type="button"
                  onClick={() => onSelectLine?.(row.index)}
                  aria-label={row.description}
                  aria-current={isActive || undefined}
                  className="flex w-full items-center gap-2 px-3 py-[5px] text-left"
                  style={{ background: isActive ? 'var(--panel-sunk)' : 'transparent' }}
                >
                  <span
                    className="tabular w-6 shrink-0 text-[10px]"
                    style={{ color: 'var(--ink-faint)' }}
                  >
                    {row.index + 1}
                  </span>

                  <span
                    className="relative h-[14px] min-w-0 flex-1 overflow-hidden"
                    style={{
                      background: 'var(--panel-sunk)',
                      border: '1px solid var(--rule)',
                    }}
                  >
                    {/* Tolerance band: the strip short of target that counts as flush. */}
                    <span
                      aria-hidden
                      className="absolute inset-y-0"
                      style={{
                        left: `${Math.max(0, TARGET_X - tolPct)}%`,
                        width: `${Math.min(tolPct, TARGET_X)}%`,
                        background: 'var(--state-ok-bg)',
                      }}
                    />
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0"
                      style={{ width: `${fillPct}%`, background: color, opacity: 0.85 }}
                    />
                    {/* Target line: same x on every row, which is what makes the
                        column scannable down twenty bullets. */}
                    <span
                      aria-hidden
                      className="absolute inset-y-0"
                      style={{
                        left: `${TARGET_X}%`,
                        width: '1px',
                        background: 'var(--rule-strong)',
                      }}
                    />
                    {overflows && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 right-0 w-[3px]"
                        style={{ background: 'var(--state-over)' }}
                      />
                    )}
                  </span>

                  <span
                    className="tabular w-[104px] shrink-0 text-right text-[11px]"
                    style={{ color }}
                  >
                    {row.primary}
                  </span>
                  <span
                    className="tabular hidden w-[56px] shrink-0 text-right text-[11px] sm:inline"
                    style={{ color: 'var(--ink-faint)' }}
                  >
                    {row.secondary}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
