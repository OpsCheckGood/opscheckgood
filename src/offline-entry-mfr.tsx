/**
 * Entry point for the single-file offline MFR generator.
 *
 * Same reasoning as the other tools: Astro's island loader cannot work from a
 * file:// origin, so the offline build mounts the component directly from one
 * inlined classic script. Each tool gets its own entry so its offline file
 * carries only its own bundle.
 *
 * See scripts/build-offline.mjs.
 */
import { createRoot } from 'react-dom/client';
import MfrGenerator from './components/MfrGenerator';

const mount = document.getElementById('mfr-generator-root');
if (mount) createRoot(mount).render(<MfrGenerator />);
