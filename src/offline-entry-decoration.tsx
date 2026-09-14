/**
 * Entry point for the single-file offline Decoration Writer.
 *
 * Same reasoning as the others: Astro's island loader cannot work from a
 * file:// origin, so the offline build mounts the component directly from one
 * inlined classic script.
 *
 * See scripts/build-offline.mjs.
 */
import { createRoot } from 'react-dom/client';
import DecorationWriter from './components/DecorationWriter';

const mount = document.getElementById('decoration-writer-root');
if (mount) createRoot(mount).render(<DecorationWriter />);
