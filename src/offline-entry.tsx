/**
 * Entry point for the single-file offline build.
 *
 * Astro's island loader fetches the component chunk with a dynamic import from
 * an absolute `/_astro/` URL. Both halves of that break under `file://`: the
 * path resolves against the filesystem root, and browsers refuse module imports
 * from a file origin outright. So the offline build skips the island mechanism
 * entirely and mounts the same component from one inlined classic script.
 *
 * See scripts/build-offline.mjs.
 */
import { createRoot } from 'react-dom/client';
import BulletBench from './components/BulletBench';

const mount = document.getElementById('bullet-bench-root');
if (mount) createRoot(mount).render(<BulletBench />);
