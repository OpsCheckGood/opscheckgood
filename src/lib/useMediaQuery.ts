import { useEffect, useState } from 'react';

/**
 * Tracks a media query from React.
 *
 * Server-rendered markup has no viewport, so this starts false and corrects
 * after mount. Anything it drives must therefore be a presentation choice, not
 * a correctness one -- the shaping verdict is computed from font metrics and
 * never depends on the screen.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/**
 * Narrow enough that drawing a form field at its true width would shrink the
 * text past reading.
 *
 * A 202mm line is 765px. On a 390px phone that scales to about 0.5, which is
 * six-point type -- technically accurate and no use to anyone. Below this the
 * panes reflow at a readable size instead, and the fit verdict comes from the
 * status readout, which was always the authority.
 */
export const NARROW = '(max-width: 760px)';
