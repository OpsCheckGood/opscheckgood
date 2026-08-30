/**
 * Entry point for the single-file offline PT calculator.
 *
 * Same reasoning as offline-entry.tsx: Astro's island loader cannot work from
 * a file:// origin, so the offline build mounts the component directly from
 * one inlined classic script. Each tool gets its own entry so its offline file
 * carries only its own bundle -- Bullet Bench's font data is most of its 1.5 MB
 * and has no business inside the calculator.
 *
 * See scripts/build-offline.mjs.
 */
import { createRoot } from 'react-dom/client';
import PtCalculator from './components/PtCalculator';

const mount = document.getElementById('pt-calculator-root');
if (mount) createRoot(mount).render(<PtCalculator />);
