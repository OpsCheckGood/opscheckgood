import type { CertificateDefinition, CitationLanguage } from '../decoration/types';
import { formatCitationDate, type CitationInput } from '../decoration/citation';
import { branding, buildFormPdf, type Field, type FormDocument, type FormPage, type StaticText } from './writer';

/**
 * The Decoration Writer as a fillable PDF.
 *
 * The same tool, carried in a file: the drop-downs hold the manual's options,
 * the text fields take the member and the assignment, and a document-level
 * script builds the opening and closing sentences, wraps the citation at the
 * certificate's 70 columns and counts its lines, exactly as the page does.
 *
 * The script is written for Acrobat's JavaScript engine, which is an old one:
 * `var` and `function`, no arrows, no template strings, no `let`. Every
 * sentence and every option comes from the same data files as the site; the
 * source below is generated from them, so the file and the page cannot say
 * different things. tests/pdfform.test.ts runs this script under Node beside
 * the site's own engine and compares them.
 */

const SITE = 'https://opscheckgood.github.io/opscheckgood/';

/** Field names, shared by the layout and the script. */
export const F = {
  award: 'award',
  number: 'awardNumber',
  service: 'service',
  basis: 'basis',
  circumstance: 'circumstance',
  closing: 'closing',
  longCareer: 'longCareer',
  grade: 'grade',
  name: 'name',
  surname: 'surname',
  pronouns: 'pronouns',
  assignment: 'assignment',
  duty: 'duty',
  squadron: 'squadron',
  group: 'group',
  wing: 'wing',
  base: 'base',
  period: 'period',
  start: 'start',
  end: 'end',
  periodInOpening: 'periodInOpening',
  approver: 'approver',
  approverTitle: 'approverTitle',
  signed: 'signed',
  narrative: 'narrative',
  // Outputs.
  opening: 'out_opening',
  closingOut: 'out_closing',
  citation: 'out_citation',
  status: 'out_status',
  certTitle: 'cert_title',
  certCluster: 'cert_cluster',
  certMember: 'cert_member',
  certBasis: 'cert_basis',
  certPeriod: 'cert_period',
} as const;

export const OUTPUTS = [
  F.opening, F.closingOut, F.citation, F.status,
  F.certTitle, F.certCluster, F.certMember, F.certBasis, F.certPeriod,
];

const YES_NO = ['No', 'Yes'];

/** The data the script carries: the language file cut down to what it uses. */
export function engineData(language: CitationLanguage, certificate: CertificateDefinition) {
  return {
    pattern: language.opening.pattern,
    assignments: language.opening.assignments,
    periods: language.opening.periods.filter((p) => p.id !== 'none'),
    services: language.services,
    pronouns: language.pronouns,
    grades: language.grades.map((g) => ({ label: g.full, full: g.full, short: g.short })),
    awards: language.awards.map((a) => ({
      id: a.id,
      label: a.label,
      pattern: a.pattern,
      title: a.certificate.title,
      bases: a.bases.map((b) => ({ label: b.label, text: b.text, forLine: b.forLine ?? b.label.toUpperCase() })),
      circumstances: a.circumstances.map((c) => ({ label: c.label, text: c.text })),
      closings: a.closings.map((c) => ({ label: c.label, text: c.text })),
    })),
    clusters: certificate.page?.clusters ?? [''],
    columns: certificate.box.columns ?? 70,
    lines: certificate.box.lines ?? 20,
    maxChars: certificate.maxChars,
  };
}

/** The site's draft as the form's field values: labels, not ids, and dates as text. */
export function decorationFieldValues(
  input: CitationInput,
  language: CitationLanguage,
  certificate: CertificateDefinition,
): Record<string, string> {
  const award = language.awards.find((a) => a.id === input.awardId) ?? language.awards[0]!;
  const grade = language.grades.find((g) => g.id === input.gradeId) ?? language.grades[0]!;
  const basis = award.bases.find((b) => b.id === input.basisId) ?? award.bases[0]!;
  const closing = award.closings.find((c) => c.id === input.closingId) ?? award.closings[0]!;
  const circumstance = award.circumstances.find((c) => c.id === input.circumstanceId);
  const labels = awardNumberLabels(certificate.page?.clusters ?? ['']);
  return {
    [F.award]: award.label,
    [F.number]: labels[Math.min(Math.max(1, input.awardNumber), labels.length) - 1]!,
    [F.service]: (language.services.find((s) => s.id === input.serviceId) ?? language.services[0]!).label,
    [F.basis]: basis.label,
    [F.circumstance]: circumstance?.label ?? '-',
    [F.closing]: closing.label,
    [F.longCareer]: input.longCareer ? 'Yes' : 'No',
    [F.grade]: grade.full,
    [F.name]: input.name,
    [F.surname]: input.surname,
    [F.pronouns]: (language.pronouns.find((p) => p.id === input.pronounId) ?? language.pronouns[0]!).label,
    [F.assignment]: (language.opening.assignments.find((a) => a.id === input.assignmentId) ?? language.opening.assignments[0]!).label,
    [F.duty]: input.duty,
    [F.squadron]: input.squadron,
    [F.group]: input.group,
    [F.wing]: input.wing,
    [F.base]: input.base,
    [F.period]: (language.opening.periods.find((p) => p.id === input.periodId && p.id !== 'none') ?? language.opening.periods[0]!).label,
    [F.start]: input.periodId === 'on' ? formatCitationDate(input.date) : formatCitationDate(input.start),
    [F.end]: input.periodId === 'on' ? '' : formatCitationDate(input.end),
    [F.periodInOpening]: input.periodInOpening ? 'Yes' : 'No',
    [F.approver]: input.approver,
    [F.approverTitle]: input.approverTitle,
    [F.signed]: formatCitationDate(input.signedDate),
  };
}

export function awardNumberLabels(clusters: readonly string[]): string[] {
  return clusters.map((word, i) => (i === 0 ? 'First award' : `${word[0]}${word.slice(1).toLowerCase()} oak leaf cluster`));
}

/**
 * The document-level script. ES5 only: Acrobat's engine.
 *
 * Everything the page's engine does, in the same order, keyed by field
 * labels rather than ids because a drop-down's value is its visible text.
 */
export function decorationEngineSource(language: CitationLanguage, certificate: CertificateDefinition): string {
  const data = JSON.stringify(engineData(language, certificate));
  const names = JSON.stringify(Object.values(F).filter((n) => !n.startsWith('out_') && !n.startsWith('cert_')));
  return `
var OCG = (function () {
  var D = ${data};
  var INPUTS = ${names};
  function trim(s) { return String(s === null || s === undefined ? '' : s).replace(/^\\s+|\\s+$/g, ''); }
  function byLabel(list, label) {
    for (var i = 0; i < list.length; i++) if (list[i].label === label) return list[i];
    return list[0];
  }
  function fill(t, vars) {
    return t.replace(/\\{(\\w+)\\}/g, function (m, k) { return vars[k] === undefined || vars[k] === null ? '' : vars[k]; });
  }
  function place(parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) { var p = trim(parts[i]); if (p) out.push(p); }
    return out.join(', ');
  }
  function award(v) { return byLabel(D.awards, v.award); }
  function grade(v) { return byLabel(D.grades, v.grade); }
  function pronoun(v) { return byLabel(D.pronouns, v.pronouns); }
  function opening(v) {
    var a = award(v), g = grade(v), pr = pronoun(v);
    var basis = byLabel(a.bases, v.basis);
    var asg = byLabel(D.assignments, v.assignment);
    var per = byLabel(D.periods, v.period);
    var chain = [v.squadron, v.group, v.wing, v.base];
    var placeText = asg.id === 'as' ? place([v.duty].concat(chain)) : asg.id === 'while' ? place(chain) : place([v.base]);
    var circ = a.circumstances.length ? byLabel(a.circumstances, v.circumstance).text : '';
    var period = v.periodInOpening === 'Yes'
      ? fill(per.text, { start: trim(v.start), end: trim(v.end), date: trim(v.start) })
      : '';
    return fill(a.pattern || D.pattern, {
      rank: g.full, name: trim(v.name), shortRank: g.short, surname: trim(v.surname),
      reflexive: pr.reflexive, basis: basis.text,
      assignment: fill(asg.text, { place: placeText }), circumstance: circ, period: period
    }).replace(/\\s+/g, ' ').replace(/ ([,.])/g, '$1');
  }
  function closing(v) {
    var a = award(v), g = grade(v), pr = pronoun(v);
    var svc = byLabel(D.services, v.service);
    var c = byLabel(a.closings, v.closing);
    return fill(c.text, {
      shortRank: g.short, surname: trim(v.surname), reflexive: pr.reflexive, possessive: pr.possessive,
      service: svc.text, longAnd: v.longCareer === 'Yes' ? 'long and ' : ''
    }).replace(/\\s+/g, ' ');
  }
  function assemble(parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) { var p = trim(parts[i]); if (p) out.push(p); }
    return out.join(' ');
  }
  function wrap(text, columns) {
    var lines = [], current = '';
    var tokens = text.split(/(\\s+)/);
    function flush() { lines.push(current.replace(/\\s+$/, '')); current = ''; }
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (token === '') continue;
      if (/^\\s+$/.test(token)) {
        if (current === '') continue;
        if (current.length + token.length <= columns) current += token; else flush();
        continue;
      }
      if (current.length + token.length <= columns) { current += token; continue; }
      if (current.replace(/\\s+$/, '') !== '') flush();
      var word = token;
      while (word.length > columns) { lines.push(word.slice(0, columns)); word = word.slice(columns); }
      current = word;
    }
    if (current !== '' || lines.length === 0) flush();
    return lines;
  }
  function citation(v) {
    return assemble([opening(v), String(v.narrative || '').replace(/\\r\\n?|\\n/g, ' '), closing(v)]);
  }
  function status(v) {
    var text = citation(v);
    if (!trim(text)) return '';
    var lines = wrap(text, D.columns);
    var over = lines.length - D.lines;
    var overChars = text.length - D.maxChars;
    var word = over > 0 ? 'CUT OFF: runs ' + over + ' line' + (over === 1 ? '' : 's') + ' past the certificate'
      : overChars > 0 ? 'OVER LIMIT: ' + overChars + ' past what myDecs accepts'
      : 'FITS';
    return text.length + ' / ' + D.maxChars + ' characters   ' + lines.length + ' / ' + D.lines + ' lines   ' + word;
  }
  function cluster(v) {
    var n = 0;
    for (var i = 0; i < D.clusters.length; i++) {
      var label = i === 0 ? 'First award' : D.clusters[i].charAt(0) + D.clusters[i].slice(1).toLowerCase() + ' oak leaf cluster';
      if (label === v.awardNumber) n = i;
    }
    return n === 0 ? '' : '(' + D.clusters[n] + ' OAK LEAF CLUSTER)';
  }
  function member(v) {
    var name = trim(v.name).replace(/\\b([A-Za-z])\\./g, '$1');
    return trim(grade(v).full + ' ' + name).toUpperCase();
  }
  function periodLine(v) {
    var per = byLabel(D.periods, v.period);
    var s = trim(v.start), e = trim(v.end);
    if (per.id === 'range') return s && e ? s + ' to ' + e : (s || e);
    return s;
  }
  function calc(name, v) {
    switch (name) {
      case '${F.opening}': return opening(v);
      case '${F.closingOut}': return closing(v);
      case '${F.citation}': return wrap(citation(v), D.columns).join('\\n');
      case '${F.status}': return status(v);
      case '${F.certTitle}': return award(v).title;
      case '${F.certCluster}': return cluster(v);
      case '${F.certMember}': return member(v);
      case '${F.certBasis}': return byLabel(award(v).bases, v.basis).forLine;
      case '${F.certPeriod}': return periodLine(v);
    }
    return '';
  }
  function read(doc) {
    var v = {};
    for (var i = 0; i < INPUTS.length; i++) {
      var f = doc.getField(INPUTS[i]);
      v[INPUTS[i]] = f ? String(f.value) : '';
    }
    return v;
  }
  function labels(list) { var out = []; for (var i = 0; i < list.length; i++) out.push(list[i].label); return out; }
  function setChoices(doc, name, items) {
    var f = doc.getField(name);
    if (!f) return;
    var keep = String(f.value);
    if (items.length === 0) items = ['-'];
    f.setItems(items);
    var found = false;
    for (var i = 0; i < items.length; i++) if (items[i] === keep) found = true;
    f.value = found ? keep : items[0];
  }
  /** After the decoration changes: the basis, circumstance and closing menus follow it. */
  function sync(doc) {
    var f = doc.getField('${F.award}');
    if (!f) return;
    var a = byLabel(D.awards, String(f.value));
    setChoices(doc, '${F.basis}', labels(a.bases));
    setChoices(doc, '${F.circumstance}', labels(a.circumstances));
    setChoices(doc, '${F.closing}', labels(a.closings));
  }
  return { data: D, opening: opening, closing: closing, citation: citation, wrap: wrap, status: status,
           cluster: cluster, member: member, periodLine: periodLine, calc: calc, read: read, sync: sync };
})();
`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 54;
const COL_W = 246;
const GUTTER = 12;
const RIGHT_COL = LEFT + COL_W + GUTTER;
const FIELD_H = 18;
const ROW = 36;

function label(x: number, y: number, text: string): StaticText {
  return { x, y: y + FIELD_H + 4, text: text.toUpperCase(), font: 'Helv', size: 6.5, gray: 0.45 };
}

function heading(page: FormPage, y: number, title: string, note: string) {
  page.texts.push({ x: LEFT, y, text: title, font: 'HeBo', size: 16 });
  page.texts.push({ x: LEFT, y: y - 14, text: note, font: 'Helv', size: 8.5, gray: 0.4 });
  page.rules.push({ x1: LEFT, y1: y - 22, x2: PAGE_W - LEFT, y2: y - 22, gray: 0.6 });
}

function calcAction(name: string): string {
  return `event.value = OCG.calc('${name}', OCG.read(this));`;
}

export function buildDecorationForm(language: CitationLanguage, certificate: CertificateDefinition): FormDocument {
  const data = engineData(language, certificate);
  const first = language.awards[0]!;
  const mark = branding(PAGE_W, SITE);

  // ---- Page 1: inputs -----------------------------------------------------
  const p1: FormPage = { texts: [], rules: [], fields: [], links: [] };
  heading(p1, 744, 'Decoration Writer', 'Fill in the fields; the citation, its line count and the certificate text build themselves on page 2.');

  let y = 690;
  const combo = (name: string, x: number, options: string[], value: string, tooltip?: string, w = COL_W): Field => ({
    name, kind: 'combo', rect: [x, y, w, FIELD_H], options, value, tooltip, size: 9,
  });
  const text = (name: string, x: number, tooltip?: string, w = COL_W, value?: string): Field => ({
    name, kind: 'text', rect: [x, y, w, FIELD_H], tooltip, size: 9, value,
  });
  const row = (a: { label: string; field: Field }, b?: { label: string; field: Field }) => {
    p1.texts.push(label(a.field.rect[0], y, a.label));
    p1.fields.push(a.field);
    if (b) {
      p1.texts.push(label(b.field.rect[0], y, b.label));
      p1.fields.push(b.field);
    }
    y -= ROW;
  };

  const awardField = combo(F.award, LEFT, data.awards.map((a) => a.label), first.label, 'The decoration. The basis, circumstance and closing menus follow it.');
  awardField.onCommit = 'OCG.sync(this);';
  row(
    { label: 'Decoration', field: awardField },
    { label: 'Award', field: combo(F.number, RIGHT_COL, awardNumberLabels(data.clusters), 'First award') },
  );
  row(
    { label: 'Basis', field: combo(F.basis, LEFT, first.bases.map((b) => b.label), first.bases[0]!.label) },
    { label: 'Closing', field: combo(F.closing, RIGHT_COL, first.closings.map((c) => c.label), first.closings[0]!.label) },
  );
  row(
    { label: 'While engaged (Bronze Star only)', field: combo(F.circumstance, LEFT, first.circumstances.length ? first.circumstances.map((c) => c.label) : ['-'], first.circumstances[0]?.label ?? '-') },
    { label: 'Service', field: combo(F.service, RIGHT_COL, data.services.map((s) => s.label), data.services[0]!.label) },
  );
  row(
    { label: 'Grade', field: combo(F.grade, LEFT, data.grades.map((g) => g.label), 'Staff Sergeant') },
    { label: 'Pronouns', field: combo(F.pronouns, RIGHT_COL, data.pronouns.map((p) => p.label), data.pronouns[0]!.label) },
  );
  row(
    { label: 'Full name', field: text(F.name, LEFT, 'First M. Last') },
    { label: 'Surname (short title)', field: text(F.surname, RIGHT_COL) },
  );
  row(
    { label: 'Assignment', field: combo(F.assignment, LEFT, data.assignments.map((a) => a.label), data.assignments[0]!.label) },
    { label: 'Duty title', field: text(F.duty, RIGHT_COL, 'a Flight Chief') },
  );
  row(
    { label: 'Squadron', field: text(F.squadron, LEFT) },
    { label: 'Group', field: text(F.group, RIGHT_COL) },
  );
  row(
    { label: 'Wing', field: text(F.wing, LEFT) },
    { label: 'Base / location', field: text(F.base, RIGHT_COL, 'Joint Base Langley-Eustis, Virginia') },
  );
  row(
    { label: 'Period', field: combo(F.period, LEFT, data.periods.map((p) => p.label), data.periods[0]!.label, undefined, 110) },
    { label: 'From (or the single date)', field: text(F.start, LEFT + 122, '1 January 2024', COL_W - 122) },
  );
  // Second half of the period row sits in the right column on the same row.
  y += ROW;
  p1.texts.push(label(RIGHT_COL, y, 'To'));
  p1.fields.push(text(F.end, RIGHT_COL, '31 December 2025', 110));
  p1.texts.push(label(RIGHT_COL + 122, y, 'Dates in opening sentence'));
  p1.fields.push(combo(F.periodInOpening, RIGHT_COL + 122, YES_NO, 'No', 'myDecs prints the dates in the header; the manual\'s examples also carry them in the sentence.', COL_W - 122));
  y -= ROW;
  row(
    { label: '30 or more years ("long and", retirement closings)', field: combo(F.longCareer, LEFT, YES_NO, 'No') },
    { label: 'Approving official', field: text(F.approver, RIGHT_COL, 'FIRST M. LAST, Lt Col, USAF') },
  );
  row(
    { label: "Official's duty title", field: text(F.approverTitle, LEFT, 'Commander, 1st Maintenance Squadron') },
    { label: 'Signature date', field: text(F.signed, RIGHT_COL, '31 July 2026') },
  );

  const narrativeTop = y + FIELD_H;
  const narrativeBottom = 70;
  p1.texts.push({ x: LEFT, y: narrativeTop + 4, text: 'NARRATIVE (between the fixed opening and closing sentences)', font: 'Helv', size: 6.5, gray: 0.45 });
  p1.fields.push({
    name: F.narrative,
    kind: 'multiline',
    rect: [LEFT, narrativeBottom, PAGE_W - 2 * LEFT, narrativeTop - narrativeBottom],
    font: 'Helv',
    size: 9.5,
    tooltip: 'During this period, ...',
  });
  p1.texts.push(...mark.texts);
  p1.links.push(...mark.links);

  // ---- Page 2: outputs ----------------------------------------------------
  const p2: FormPage = { texts: [], rules: [], fields: [], links: [] };
  heading(p2, 744, 'Citation', `Wrapped at ${data.columns} characters and held to ${data.lines} lines, as myDecs prints it. Copy the citation into myDecs.`);

  const out = (name: string, yTop: number, h: number, kind: Field['kind'] = 'output', font: Field['font'] = 'Helv', size = 9, align?: Field['align']): Field => ({
    name, kind, rect: [LEFT, yTop - h, PAGE_W - 2 * LEFT, h], font, size, calculate: calcAction(name), align,
  });

  p2.texts.push({ x: LEFT, y: 700, text: 'STATUS', font: 'Helv', size: 6.5, gray: 0.45 });
  p2.fields.push(out(F.status, 696, FIELD_H, 'output', 'HeBo', 9));

  p2.texts.push({ x: LEFT, y: 664, text: 'OPENING SENTENCE', font: 'Helv', size: 6.5, gray: 0.45 });
  p2.fields.push(out(F.opening, 660, 44, 'outputMultiline', 'Helv', 9));
  p2.texts.push({ x: LEFT, y: 604, text: 'CLOSING SENTENCE', font: 'Helv', size: 6.5, gray: 0.45 });
  p2.fields.push(out(F.closingOut, 600, 32, 'outputMultiline', 'Helv', 9));

  p2.texts.push({ x: LEFT, y: 556, text: `THE CITATION, ${data.columns} COLUMNS BY ${data.lines} LINES`, font: 'Helv', size: 6.5, gray: 0.45 });
  // Courier 10: 70 columns are 420pt; the field is 504pt wide, so no line re-wraps.
  p2.fields.push(out(F.citation, 552, 22 * 11.6, 'outputMultiline', 'Cour', 10));

  let cy = 552 - 22 * 11.6 - 30;
  p2.texts.push({ x: LEFT, y: cy + FIELD_H + 4, text: 'CERTIFICATE LINES', font: 'Helv', size: 6.5, gray: 0.45 });
  for (const name of [F.certTitle, F.certCluster, F.certMember, F.certBasis, F.certPeriod]) {
    p2.fields.push(out(name, cy + FIELD_H, FIELD_H, 'output', name === F.certMember || name === F.certBasis || name === F.certPeriod ? 'Cour' : 'TiBo', 10, 'center'));
    cy -= FIELD_H + 4;
  }
  p2.texts.push(...mark.texts);
  p2.links.push(...mark.links);

  return {
    title: 'Decoration Writer',
    subject: 'Decoration citation builder from Ops Check Good',
    pages: [p1, p2],
    script: decorationEngineSource(language, certificate) + '\nOCG.sync(this);\n',
    calcOrder: OUTPUTS,
  };
}

export function buildDecorationFormPdf(language: CitationLanguage, certificate: CertificateDefinition): Uint8Array {
  return buildFormPdf(buildDecorationForm(language, certificate));
}
