import { loadDataset } from './loader';
import { DataFileError, type Dataset } from './types';
import type {
  AwardLanguage,
  CertificateDefinition,
  CertificateStyle,
  CitationLanguage,
  GradeTitle,
  HeaderLine,
  PageLayout,
  Phrase,
} from '../decoration/types';

import certificate from '../../data/decorations/mydecs-certificate.json';
import language from '../../data/decorations/citation-language.json';

/**
 * The two datasets behind the Decoration Writer: how the certificate holds
 * text, and what the awards manual says the text must open and close with.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNumber(file: string, obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DataFileError(file, `${key} must be a number or null`);
  }
  return value;
}

function normalizeCertificate(raw: unknown, _meta: unknown, file: string): CertificateDefinition {
  if (!isRecord(raw)) throw new DataFileError(file, 'data must be an object');
  if (typeof raw.id !== 'string' || raw.id === '') {
    throw new DataFileError(file, 'data.id must be a non-empty string');
  }
  if (!isRecord(raw.font)) throw new DataFileError(file, 'data.font must be an object');
  if (!isRecord(raw.box)) throw new DataFileError(file, 'data.box must be an object');
  if (typeof raw.maxChars !== 'number' || raw.maxChars <= 0) {
    throw new DataFileError(file, 'data.maxChars must be a positive number');
  }
  return {
    id: raw.id,
    label: typeof raw.label === 'string' ? raw.label : raw.id,
    font: {
      family: typeof raw.font.family === 'string' ? raw.font.family : '',
      sizePt: typeof raw.font.sizePt === 'number' ? raw.font.sizePt : 0,
      file: typeof raw.font.file === 'string' ? raw.font.file : '',
    },
    maxChars: raw.maxChars,
    box: {
      widthMm: optionalNumber(file, raw.box, 'widthMm'),
      columns: optionalNumber(file, raw.box, 'columns'),
      lines: optionalNumber(file, raw.box, 'lines'),
      linePitchPt: optionalNumber(file, raw.box, 'linePitchPt'),
      justified: raw.box.justified === true,
    },
    page: isRecord(raw.page) ? normalizePage(raw.page, file) : null,
  };
}

function headerLines(file: string, value: unknown, what: string): HeaderLine[] {
  if (!Array.isArray(value)) throw new DataFileError(file, `${what} must be an array`);
  return value.map((entry, i) => {
    if (!isRecord(entry) || typeof entry.text !== 'string' || typeof entry.sizePt !== 'number') {
      throw new DataFileError(file, `${what}[${i}] needs text and sizePt`);
    }
    const face = entry.face;
    if (face !== 'serif' && face !== 'serif-bold' && face !== 'mono') {
      throw new DataFileError(file, `${what}[${i}].face must be serif, serif-bold or mono`);
    }
    const line: HeaderLine = { text: entry.text, face, sizePt: entry.sizePt };
    if (typeof entry.yPt === 'number') line.yPt = entry.yPt;
    return line;
  });
}

function normalizePage(raw: Record<string, unknown>, file: string): PageLayout {
  const num = (key: string): number => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new DataFileError(file, `page.${key} must be a number`);
    }
    return value;
  };
  if (!isRecord(raw.headers)) throw new DataFileError(file, 'page.headers must be an object');
  const headers = {} as PageLayout['headers'];
  for (const style of ['daf', 'presidential'] as CertificateStyle[]) {
    const entry = raw.headers[style];
    if (!isRecord(entry)) throw new DataFileError(file, `page.headers.${style} is missing`);
    headers[style] = {
      label: typeof entry.label === 'string' ? entry.label : style,
      lines: headerLines(file, entry.lines, `page.headers.${style}.lines`),
    };
  }
  return {
    widthPt: num('widthPt'),
    heightPt: num('heightPt'),
    marginPt: num('marginPt'),
    citationTopPt: num('citationTopPt'),
    givenUnderMyHandPt: num('givenUnderMyHandPt'),
    signatureTopPt: num('signatureTopPt'),
    headers,
    closing: headerLines(file, raw.closing, 'page.closing'),
    clusters: Array.isArray(raw.clusters) ? raw.clusters.map(String) : [''],
  };
}

function phrases(file: string, value: unknown, what: string): Phrase[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DataFileError(file, `${what} must be a non-empty array`);
  }
  return value.map((entry, i) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.text !== 'string') {
      throw new DataFileError(file, `${what}[${i}] needs an id and text`);
    }
    const phrase: Phrase = {
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      text: entry.text,
    };
    if (typeof entry.forLine === 'string') phrase.forLine = entry.forLine;
    return phrase;
  });
}

function normalizeLanguage(raw: unknown, _meta: unknown, file: string): CitationLanguage {
  if (!isRecord(raw)) throw new DataFileError(file, 'data must be an object');
  if (!isRecord(raw.opening)) throw new DataFileError(file, 'data.opening must be an object');
  if (typeof raw.opening.pattern !== 'string') {
    throw new DataFileError(file, 'data.opening.pattern must be a string');
  }
  if (!Array.isArray(raw.awards) || raw.awards.length === 0) {
    throw new DataFileError(file, 'data.awards must be a non-empty array');
  }
  if (!Array.isArray(raw.grades) || raw.grades.length === 0) {
    throw new DataFileError(file, 'data.grades must be a non-empty array');
  }

  const awards: AwardLanguage[] = raw.awards.map((entry, i) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      throw new DataFileError(file, `awards[${i}] needs an id`);
    }
    const cert = isRecord(entry.certificate) ? entry.certificate : {};
    const style = cert.style === 'presidential' ? 'presidential' : 'daf';
    return {
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      ref: typeof entry.ref === 'string' ? entry.ref : '',
      pattern: typeof entry.pattern === 'string' ? entry.pattern : null,
      bases: phrases(file, entry.bases, `awards[${i}].bases`),
      circumstances: Array.isArray(entry.circumstances) && entry.circumstances.length > 0
        ? phrases(file, entry.circumstances, `awards[${i}].circumstances`)
        : [],
      closings: phrases(file, entry.closings, `awards[${i}].closings`),
      certificate: {
        style,
        title:
          typeof cert.title === 'string'
            ? cert.title
            : `THE ${String(entry.label ?? entry.id).toUpperCase()}`,
        authority: typeof cert.authority === 'string' ? cert.authority : '',
      },
    };
  });

  const grades: GradeTitle[] = raw.grades.map((entry, i) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.full !== 'string' ||
      typeof entry.short !== 'string'
    ) {
      throw new DataFileError(file, `grades[${i}] needs id, full and short`);
    }
    const service = entry.service;
    if (service !== 'usaf' && service !== 'ussf' && service !== 'both') {
      throw new DataFileError(file, `grades[${i}].service must be usaf, ussf or both`);
    }
    return {
      id: entry.id,
      abbr: typeof entry.abbr === 'string' ? entry.abbr : entry.full,
      full: entry.full,
      short: entry.short,
      service,
    };
  });

  const services = (Array.isArray(raw.services) ? raw.services : []).map((entry, i) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.text !== 'string') {
      throw new DataFileError(file, `services[${i}] needs an id and text`);
    }
    return {
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      text: entry.text,
    };
  });
  if (services.length === 0) throw new DataFileError(file, 'data.services must be non-empty');

  const pronouns = (Array.isArray(raw.pronouns) ? raw.pronouns : []).map((entry, i) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.reflexive !== 'string' ||
      typeof entry.possessive !== 'string'
    ) {
      throw new DataFileError(file, `pronouns[${i}] needs id, reflexive and possessive`);
    }
    return {
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      reflexive: entry.reflexive,
      possessive: entry.possessive,
    };
  });
  if (pronouns.length === 0) throw new DataFileError(file, 'data.pronouns must be non-empty');

  const rules = (Array.isArray(raw.rules) ? raw.rules : []).map((entry, i) => {
    if (!isRecord(entry) || typeof entry.ref !== 'string' || typeof entry.text !== 'string') {
      throw new DataFileError(file, `rules[${i}] needs a ref and text`);
    }
    return { ref: entry.ref, text: entry.text };
  });

  return {
    services,
    pronouns,
    grades,
    opening: {
      pattern: raw.opening.pattern,
      assignments: phrases(file, raw.opening.assignments, 'opening.assignments'),
      periods: phrases(file, raw.opening.periods, 'opening.periods'),
    },
    awards,
    rules,
  };
}

export const CERTIFICATE: Dataset<CertificateDefinition> = loadDataset(
  'src/data/decorations/mydecs-certificate.json',
  certificate,
  normalizeCertificate,
);

export const CITATION_LANGUAGE: Dataset<CitationLanguage> = loadDataset(
  'src/data/decorations/citation-language.json',
  language,
  normalizeLanguage,
);
