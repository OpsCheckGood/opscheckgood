/**
 * Entry point for the single-file offline BTZ calculator.
 *
 * Same reasoning as the other two: Astro's island loader cannot work from a
 * file:// origin, so the offline build mounts the component directly from one
 * inlined classic script. Each tool gets its own entry so its offline file
 * carries only its own bundle.
 *
 * See scripts/build-offline.mjs.
 */
import { createRoot } from 'react-dom/client';
import BtzCalculator from './components/BtzCalculator';

const mount = document.getElementById('btz-calculator-root');
if (mount) createRoot(mount).render(<BtzCalculator />);
