import { loadDataset } from './loader';
import { DataFileError, type Dataset } from './types';
import ceremony from '../../data/promotion/ceremony.json';

/**
 * Enlisted grades, their tiers, and the charge each tier reads at the
 * ceremony that inducts a member into it.
 */

export type TierId = 'junior' | 'nco' | 'snco';

export interface CeremonyGrade {
  id: string;
  abbr: string;
  full: string;
  tier: TierId;
}

export interface CeremonyTier {
  id: TierId;
  label: string;
  /** "the Noncommissioned Officer Corps", or null when the tier has no corps line. */
  corps: string | null;
  chargeId: string | null;
}

export interface Charge {
  id: string;
  title: string;
  /** The emcee's line asking the room to stand before the reading. */
  standFor: string;
  paragraphs: string[];
}

export interface CeremonyData {
  grades: CeremonyGrade[];
  tiers: CeremonyTier[];
  charges: Charge[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTier(value: unknown): value is TierId {
  return value === 'junior' || value === 'nco' || value === 'snco';
}

function normalize(raw: unknown, _meta: unknown, file: string): CeremonyData {
  if (!isRecord(raw)) throw new DataFileError(file, 'data must be an object');
  if (!Array.isArray(raw.grades) || raw.grades.length === 0) {
    throw new DataFileError(file, 'data.grades must be a non-empty array');
  }
  if (!Array.isArray(raw.tiers) || raw.tiers.length === 0) {
    throw new DataFileError(file, 'data.tiers must be a non-empty array');
  }
  if (!Array.isArray(raw.charges)) throw new DataFileError(file, 'data.charges must be an array');

  const grades: CeremonyGrade[] = raw.grades.map((g, i) => {
    if (!isRecord(g) || typeof g.id !== 'string' || typeof g.full !== 'string' || !isTier(g.tier)) {
      throw new DataFileError(file, `grades[${i}] needs id, full and a known tier`);
    }
    return { id: g.id, abbr: typeof g.abbr === 'string' ? g.abbr : g.full, full: g.full, tier: g.tier };
  });

  const tiers: CeremonyTier[] = raw.tiers.map((t, i) => {
    if (!isRecord(t) || !isTier(t.id)) throw new DataFileError(file, `tiers[${i}] needs a known id`);
    return {
      id: t.id,
      label: typeof t.label === 'string' ? t.label : t.id,
      corps: typeof t.corps === 'string' ? t.corps : null,
      chargeId: typeof t.chargeId === 'string' ? t.chargeId : null,
    };
  });

  const charges: Charge[] = raw.charges.map((c, i) => {
    if (
      !isRecord(c) ||
      typeof c.id !== 'string' ||
      typeof c.title !== 'string' ||
      typeof c.standFor !== 'string' ||
      !Array.isArray(c.paragraphs) ||
      c.paragraphs.length === 0
    ) {
      throw new DataFileError(file, `charges[${i}] needs id, title, standFor and paragraphs`);
    }
    return {
      id: c.id,
      title: c.title,
      standFor: c.standFor,
      paragraphs: c.paragraphs.map(String),
    };
  });

  // Every tier that names a charge must have one; a dangling id would print
  // an empty page at the ceremony.
  for (const tier of tiers) {
    if (tier.chargeId && !charges.some((c) => c.id === tier.chargeId)) {
      throw new DataFileError(file, `tier "${tier.id}" names charge "${tier.chargeId}", which does not exist`);
    }
  }
  for (const grade of grades) {
    if (!tiers.some((t) => t.id === grade.tier)) {
      throw new DataFileError(file, `grade "${grade.id}" names tier "${grade.tier}", which does not exist`);
    }
  }

  return { grades, tiers, charges };
}

export const CEREMONY: Dataset<CeremonyData> = loadDataset(
  'src/data/promotion/ceremony.json',
  ceremony,
  normalize,
);
