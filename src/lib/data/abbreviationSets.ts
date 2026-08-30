import { loadDataset } from './loader';
import { normalizeAbbreviations, type AbbreviationTable } from './abbreviations';
import type { Dataset } from './types';

import hqRaw from '../../data/abbreviations/hq-approved.json';
import commonRaw from '../../data/abbreviations/common.json';

/**
 * The two shipped abbreviation tables.
 *
 * These are the defaults. The UI lets a user edit both lists and persists the
 * result to localStorage, so what is on screen may differ from what is here --
 * "reset to defaults" means going back to these.
 */

export const HQ_APPROVED: Dataset<AbbreviationTable> = loadDataset(
  'src/data/abbreviations/hq-approved.json',
  hqRaw,
  normalizeAbbreviations,
);

export const COMMON: Dataset<AbbreviationTable> = loadDataset(
  'src/data/abbreviations/common.json',
  commonRaw,
  normalizeAbbreviations,
);

/** Shown wherever Common results appear. Wording is fixed by the spec. */
export const COMMON_NOTE =
  '"Common" terms are subject to local guidance and leadership preference.';
