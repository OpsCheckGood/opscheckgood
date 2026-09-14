/**
 * Entry point for the single-file offline Promotion Script Builder.
 *
 * Astro's island loader cannot work from a file:// origin, so the offline
 * build mounts the component directly from one inlined classic script.
 *
 * See scripts/build-offline.mjs.
 */
import { createRoot } from 'react-dom/client';
import PromotionScriptBuilder from './components/PromotionScriptBuilder';

const mount = document.getElementById('promotion-script-root');
if (mount) createRoot(mount).render(<PromotionScriptBuilder />);
