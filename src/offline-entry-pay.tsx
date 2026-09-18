/**
 * Entry point for the single-file offline pay calculator.
 *
 * Same reasoning as offline-entry.tsx: Astro's island loader cannot work from
 * a file:// origin, so the offline build mounts the component directly from
 * one inlined classic script. See scripts/build-offline.mjs.
 */
import { createRoot } from 'react-dom/client';
import PayCalculator from './components/PayCalculator';

const mount = document.getElementById('pay-calculator-root');
if (mount) createRoot(mount).render(<PayCalculator />);
