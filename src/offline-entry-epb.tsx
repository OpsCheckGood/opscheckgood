/**
 * Entry point for the single-file offline EPB Worksheet.
 *
 * Astro's island loader cannot work from a file:// origin, so the offline
 * build mounts the component directly from one inlined classic script.
 *
 * See scripts/build-offline.mjs.
 */
import { createRoot } from 'react-dom/client';
import EpbWorksheet from './components/EpbWorksheet';

const mount = document.getElementById('epb-worksheet-root');
if (mount) createRoot(mount).render(<EpbWorksheet />);
