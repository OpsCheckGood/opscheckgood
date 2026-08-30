/**
 * Entry point for the single-file offline First Sergeant Toolkit.
 *
 * Same reasoning as the other offline entries: Astro's island loader cannot
 * work from a file:// origin, so the offline build mounts the component from
 * one inlined classic script.
 *
 * This tool is the one most likely to be wanted with no network at all -- a
 * directory of who to call is worth carrying on a phone or a thumb drive.
 *
 * See scripts/build-offline.mjs.
 */
import { createRoot } from 'react-dom/client';
import FirstSergeantToolkit from './components/FirstSergeantToolkit';

const mount = document.getElementById('first-sergeant-root');
if (mount) createRoot(mount).render(<FirstSergeantToolkit />);
