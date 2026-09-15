import type { CertificateDefinition, CitationLanguage } from '../decoration/types';
import { formatCitationDate, type CitationInput } from '../decoration/citation';
import { INK, MUTED, PANEL, branding, buildFormPdf, type Field, type FormDocument, type FormPage, type StaticText } from './writer';

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
  // The preview page.
  previewCitation: 'preview_citation',
  previewSigned: 'preview_signed',
  previewSignature: 'preview_signature',
} as const;

/** A preview header slot: one line of one header style. */
export const previewLine = (style: 'daf' | 'presidential', i: number) => `preview_${style}_${i}`;

export const OUTPUTS = [
  F.opening, F.closingOut, F.citation, F.status,
  F.certTitle, F.certCluster, F.certMember, F.certBasis, F.certPeriod,
  F.previewCitation, F.previewSigned, F.previewSignature,
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
      style: a.certificate.style,
      authority: a.certificate.authority,
      bases: a.bases.map((b) => ({ label: b.label, text: b.text, forLine: b.forLine ?? b.label.toUpperCase() })),
      circumstances: a.circumstances.map((c) => ({ label: c.label, text: c.text })),
      closings: a.closings.map((c) => ({ label: c.label, text: c.text })),
    })),
    clusters: certificate.page?.clusters ?? [''],
    headers: {
      daf: (certificate.page?.headers.daf.lines ?? []).map((l) => l.text),
      presidential: (certificate.page?.headers.presidential.lines ?? []).map((l) => l.text),
    },
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
  function style(v) { return award(v).style; }
  /** One line of the certificate header, or '' when its placeholders are all empty. */
  function certLine(which, i, v) {
    var lines = D.headers[which] || [];
    var text = lines[i];
    if (!text) return '';
    var a = award(v);
    var vars = {
      decoration: a.title, cluster: cluster(v), member: member(v),
      basis: byLabel(a.bases, v.basis).forLine, period: periodLine(v), authority: a.authority
    };
    var keys = [], m, re = /\\{(\\w+)\\}/g;
    while ((m = re.exec(text)) !== null) keys.push(m[1]);
    if (keys.length) {
      var any = false;
      for (var k = 0; k < keys.length; k++) if (vars[keys[k]]) any = true;
      if (!any) return '';
    }
    return fill(text, vars).replace(/\\s+/g, ' ').replace(/^\\s+|\\s+$/g, '');
  }
  function calc(name, v) {
    if (name.indexOf('preview_daf_') === 0) return certLine('daf', Number(name.slice(12)), v);
    if (name.indexOf('preview_presidential_') === 0) return certLine('presidential', Number(name.slice(21)), v);
    switch (name) {
      case '${F.previewCitation}': return wrap(citation(v), D.columns).join('\\n');
      case '${F.previewSigned}': return trim(v.signed);
      case '${F.previewSignature}': return [trim(v.approver), trim(v.approverTitle)].join('\\n').replace(/^\\n|\\n$/g, '');
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
           cluster: cluster, member: member, periodLine: periodLine, style: style, certLine: certLine,
           calc: calc, read: read, sync: sync };
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
  return { x, y: y + FIELD_H + 4, text: text.toUpperCase(), font: 'Helv', size: 6.5, color: MUTED };
}

/**
 * The site's chrome, shared with the other two builders once they are
 * recoloured: an ink band across the top with the tool's name in white and
 * the site's name beside it, and a note beneath.
 */
function heading(page: FormPage, y: number, title: string, note: string) {
  page.fills = page.fills ?? [];
  page.fills.push({ x: 0, y: PAGE_H - 64, w: PAGE_W, h: 64, color: INK });
  page.texts.push({ x: LEFT, y: PAGE_H - 40, text: title.toUpperCase(), font: 'HeBo', size: 18, color: '1 1 1' });
  page.texts.push({ x: PAGE_W - LEFT, y: PAGE_H - 40, text: 'OPS CHECK GOOD', font: 'Helv', size: 8, color: '0.75 0.75 0.73', align: 'right' });
  page.fills.push({ x: LEFT, y: y - 20, w: PAGE_W - 2 * LEFT, h: 22, color: PANEL });
  page.texts.push({ x: LEFT + 8, y: y - 13, text: note, font: 'Helv', size: 8, color: MUTED });
}

/** A section band, as the original builders draw them. */
function section(page: FormPage, y: number, title: string) {
  page.fills = page.fills ?? [];
  page.fills.push({ x: LEFT, y: y - 4, w: PAGE_W - 2 * LEFT, h: 14, color: INK });
  page.texts.push({ x: LEFT + 6, y, text: title.toUpperCase(), font: 'HeBo', size: 8, color: '1 1 1' });
}

function calcAction(name: string): string {
  return `event.value = OCG.calc('${name}', OCG.read(this));`;
}

export function buildDecorationForm(language: CitationLanguage, certificate: CertificateDefinition): FormDocument {
  const data = engineData(language, certificate);
  const first = language.awards[0]!;
  const mark = branding(PAGE_W, SITE);

  // ---- Page 1: inputs -----------------------------------------------------
  const p1: FormPage = { texts: [], rules: [], fields: [], links: [], fills: [] };
  heading(p1, 710, 'Decoration Writer', 'Fill in the fields. The citation, its line count and the certificate text build themselves on page 2.');
  section(p1, 664, 'Decoration');

  let y = 622;
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
  y -= 22;
  section(p1, y + FIELD_H + 18, 'Member and assignment');
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

  y -= 22;
  section(p1, y + FIELD_H + 18, 'Narrative');
  const narrativeTop = y + FIELD_H - 2;
  const narrativeBottom = 56;
  p1.texts.push({ x: LEFT, y: narrativeTop + 4, text: 'BETWEEN THE FIXED OPENING AND CLOSING SENTENCES; START WITH "DURING THIS PERIOD, ..."', font: 'Helv', size: 6.5, color: MUTED });
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
  const p2: FormPage = { texts: [], rules: [], fields: [], links: [], fills: [] };
  heading(p2, 710, 'Decoration Writer', `The citation, wrapped at ${data.columns} characters and held to ${data.lines} lines as myDecs prints it. Copy it into myDecs.`);
  section(p2, 664, 'Citation');

  const out = (name: string, yTop: number, h: number, kind: Field['kind'] = 'output', font: Field['font'] = 'Helv', size = 9, align?: Field['align']): Field => ({
    name, kind, rect: [LEFT, yTop - h, PAGE_W - 2 * LEFT, h], font, size, calculate: calcAction(name), align,
  });

  p2.texts.push({ x: LEFT, y: 640, text: 'STATUS', font: 'Helv', size: 6.5, color: MUTED });
  p2.fields.push(out(F.status, 636, FIELD_H, 'output', 'HeBo', 9));

  p2.texts.push({ x: LEFT, y: 606, text: 'OPENING SENTENCE', font: 'Helv', size: 6.5, color: MUTED });
  p2.fields.push(out(F.opening, 602, 42, 'outputMultiline', 'Helv', 9));
  p2.texts.push({ x: LEFT, y: 548, text: 'CLOSING SENTENCE', font: 'Helv', size: 6.5, color: MUTED });
  p2.fields.push(out(F.closingOut, 544, 30, 'outputMultiline', 'Helv', 9));

  p2.texts.push({ x: LEFT, y: 502, text: `THE CITATION, ${data.columns} COLUMNS BY ${data.lines} LINES`, font: 'Helv', size: 6.5, color: MUTED });
  // Courier 10: 70 columns are 420pt; the field is 504pt wide, so no line re-wraps.
  p2.fields.push(out(F.citation, 498, 22 * 11.6, 'outputMultiline', 'Cour', 10));

  let cy = 498 - 22 * 11.6 - 30;
  section(p2, cy + 4, 'Certificate lines');
  cy -= 24;
  for (const name of [F.certTitle, F.certCluster, F.certMember, F.certBasis, F.certPeriod]) {
    p2.fields.push(out(name, cy + FIELD_H, FIELD_H, 'output', name === F.certMember || name === F.certBasis || name === F.certPeriod ? 'Cour' : 'TiBo', 10, 'center'));
    cy -= FIELD_H + 4;
  }
  p2.texts.push(...mark.texts);
  p2.links.push(...mark.links);

  // ---- Page 3: the certificate, as the site previews it ---------------------
  const p3: FormPage = { texts: [], rules: [], fields: [], links: [] };
  const layout = certificate.page;
  const calcOrder: string[] = [...OUTPUTS];
  if (layout) {
    const faceOf = (face: string): Field['font'] => (face === 'mono' ? 'Cour' : face === 'serif-bold' ? 'TiBo' : 'TiRo');
    for (const style of ['daf', 'presidential'] as const) {
      layout.headers[style].lines.forEach((line, i) => {
        const h = line.sizePt * 1.35;
        const name = previewLine(style, i);
        calcOrder.push(name);
        p3.fields.push({
          name,
          kind: 'output',
          rect: [layout.marginPt, PAGE_H - (line.yPt ?? 0) - h + 2, PAGE_W - 2 * layout.marginPt, h],
          font: faceOf(line.face),
          size: line.sizePt,
          align: 'center',
          plain: true,
          calculate:
            `var v = OCG.read(this); event.value = OCG.calc('${name}', v); ` +
            `if (typeof display !== 'undefined') event.target.display = OCG.style(v) === '${style}' ? display.visible : display.hidden;`,
        });
      });
    }
    const pitch = certificate.box.linePitchPt ?? 13.38;
    const lines = certificate.box.lines ?? 20;
    const top = PAGE_H - layout.citationTopPt + 3;
    p3.fields.push({
      name: F.previewCitation,
      kind: 'outputMultiline',
      rect: [layout.marginPt, top - lines * pitch - 4, PAGE_W - 2 * layout.marginPt, lines * pitch + 4],
      font: 'Cour',
      size: certificate.font.sizePt,
      plain: true,
      calculate: calcAction(F.previewCitation),
    });
    p3.texts.push({ x: PAGE_W / 2, y: PAGE_H - layout.givenUnderMyHandPt - 9, text: 'GIVEN UNDER MY HAND', font: 'TiRo', size: 11, align: 'center' });
    p3.fields.push({
      name: F.previewSigned,
      kind: 'output',
      rect: [layout.marginPt, PAGE_H - layout.givenUnderMyHandPt - 30, PAGE_W - 2 * layout.marginPt, 15],
      font: 'Cour',
      size: 11,
      align: 'center',
      plain: true,
      calculate: calcAction(F.previewSigned),
    });
    p3.fields.push({
      name: F.previewSignature,
      kind: 'outputMultiline',
      rect: [layout.marginPt, PAGE_H - layout.signatureTopPt - 34, 260, 34],
      font: 'TiRo',
      size: 7,
      plain: true,
      calculate: calcAction(F.previewSignature),
    });
  }
  p3.texts.push(...mark.texts);
  p3.links.push(...mark.links);

  return {
    title: 'Decoration Writer',
    subject: 'Decoration citation builder from Ops Check Good',
    pages: [p1, p2, p3],
    script: decorationEngineSource(language, certificate) + '\nOCG.sync(this);\n',
    calcOrder,
  };
}

export function buildDecorationFormPdf(language: CitationLanguage, certificate: CertificateDefinition): Uint8Array {
  return buildFormPdf(buildDecorationForm(language, certificate));
}
