import type { CeremonyData } from '../data/ceremony';
import { GREETINGS, PRONOUNS, type CeremonyInput } from '../promotion/ceremony';

/**
 * The promotion script builder as a fillable PDF: the script it carries and
 * the mapping between the site's inputs and the file's fields.
 *
 * The file itself was built before the site was, with its own fields and its
 * own script. The site's script builder was written from it and then
 * generalised -- every role optional, any unit -- and the file has to say
 * the same things the site says. So the file's script is replaced with this
 * one, generated from the same data the site uses (`ceremony.json`) and
 * ported line for line from `promotion/ceremony.ts`. tests/pdfform.test.ts
 * runs it under Node beside the site's builder and compares every line.
 *
 * ES5 only: it runs in Acrobat.
 */

/** The file's field names, as built. */
export const PF = {
  unit: 'unit',
  team: 'team',
  date: 'cdate',
  time: 'ctime',
  greeting: 'greeting',
  promotee: 'promotee_full',
  pronoun: 'pronoun',
  currentRank: 'cur_rank',
  newRank: 'new_rank',
  chargeIndicator: 'charge_ind',
  emcee: 'emcee',
  presiding: 'cdr',
  chief: 'chief',
  firstSergeant: 'first_sgt',
  remarks: 'remarks',
  chargeReader: 'charge_reader',
  tacker1: 'tacker1',
  tacker2: 'tacker2',
  refreshments: 'refresh',
  spouseRelation: 'sp_rel',
  spouseName: 'sp_name',
  children: 'kids',
  mother: 'mom_name',
  father: 'dad_name',
  dv: [
    ['dv1_name', 'dv1_role'],
    ['dv2_name', 'dv2_role'],
    ['dv3_name', 'dv3_role'],
  ],
  main: 'F_main',
  charge: 'F_charge',
  closing: 'F_closing',
} as const;

/** The spouse menu the file offers. */
export const SPOUSE_OPTIONS = ['(none)', 'Wife', 'Husband', 'Spouse'];

/** Every input field name the script reads. */
export const PROMOTION_INPUT_FIELDS: string[] = [
  PF.unit, PF.team, PF.date, PF.time, PF.greeting, PF.promotee, PF.pronoun, PF.currentRank, PF.newRank,
  PF.emcee, PF.presiding, PF.chief, PF.firstSergeant, PF.remarks, PF.chargeReader, PF.tacker1, PF.tacker2,
  PF.refreshments, PF.spouseRelation, PF.spouseName, PF.children, PF.mother, PF.father,
  ...PF.dv.flat(),
];

/** The site's input as the file's field values. */
export function promotionFieldValues(input: CeremonyInput, data: CeremonyData): Record<string, string> {
  const abbr = (id: string) => data.grades.find((g) => g.id === id)?.abbr ?? '';
  const pronoun = PRONOUNS.find((p) => p.id === input.pronounId)?.subject ?? 'he';
  const relation = input.spouseRelation.trim();
  const option = SPOUSE_OPTIONS.find((o) => o.toLowerCase() === relation.toLowerCase());
  const values: Record<string, string> = {
    [PF.unit]: input.unit,
    [PF.team]: input.team,
    [PF.date]: input.date,
    [PF.time]: input.time,
    [PF.greeting]: GREETINGS.includes(input.greeting) ? input.greeting : GREETINGS[1]!,
    [PF.promotee]: input.promoteeName,
    [PF.pronoun]: pronoun.charAt(0).toUpperCase() + pronoun.slice(1),
    [PF.currentRank]: abbr(input.currentGradeId),
    [PF.newRank]: abbr(input.newGradeId),
    [PF.emcee]: input.emcee,
    [PF.presiding]: input.presiding,
    [PF.chief]: input.seniorEnlisted,
    [PF.firstSergeant]: input.firstSergeant,
    [PF.remarks]: input.remarksBy,
    [PF.chargeReader]: input.chargeReader,
    [PF.tacker1]: input.tackers[0] ?? '',
    [PF.tacker2]: input.tackers[1] ?? '',
    [PF.refreshments]: input.refreshments,
    // A relation the menu does not offer still names a spouse.
    [PF.spouseRelation]: relation === '' ? '(none)' : (option ?? 'Spouse'),
    [PF.spouseName]: input.spouseName,
    [PF.children]: input.children,
    [PF.mother]: input.mother,
    [PF.father]: input.father,
  };
  PF.dv.forEach(([name, role], i) => {
    values[name] = input.visitors[i]?.name ?? '';
    values[role] = input.visitors[i]?.role ?? '';
  });
  return values;
}

/**
 * The document-level script: `promotion/ceremony.ts` in ES5, reading the
 * file's fields and writing the three script fields and the charge
 * indicator. Output lines are joined with carriage returns, which is what
 * Acrobat's multi-line fields expect.
 */
export function promotionEngineSource(data: CeremonyData): string {
  const D = JSON.stringify({
    grades: data.grades.map((g) => ({ id: g.id, abbr: g.abbr, full: g.full, tier: g.tier })),
    tiers: data.tiers.map((t) => ({ id: t.id, corps: t.corps ?? null, chargeId: t.chargeId ?? null })),
    charges: data.charges.map((c) => ({ id: c.id, title: c.title, standFor: c.standFor, paragraphs: c.paragraphs })),
    pronouns: PRONOUNS,
    fields: PF,
  });
  return `
var OCG = (function () {
  var D = ${D};
  var F = D.fields;
  var CUE = '\\u00bb  ';
  function trim(s) { return String(s === null || s === undefined ? '' : s).replace(/^\\s+|\\s+$/g, ''); }
  function gradeByAbbr(abbr) {
    for (var i = 0; i < D.grades.length; i++) if (D.grades[i].abbr === abbr) return D.grades[i];
    return D.grades[0];
  }
  function tierOf(g) {
    for (var i = 0; i < D.tiers.length; i++) if (D.tiers[i].id === g.tier) return D.tiers[i];
    return D.tiers[0];
  }
  function chargeFor(next) {
    var t = tierOf(next);
    if (!t.chargeId) return null;
    var first = null;
    for (var i = 0; i < D.grades.length; i++) if (D.grades[i].tier === t.id) { first = D.grades[i]; break; }
    if (!first || first.id !== next.id) return null;
    for (var j = 0; j < D.charges.length; j++) if (D.charges[j].id === t.chargeId) return D.charges[j];
    return null;
  }
  function surname(name) {
    var words = trim(name).split(/\\s+/);
    var out = [];
    for (var i = 0; i < words.length; i++) if (words[i]) out.push(words[i]);
    while (out.length > 1 && /^(jr\\.?|sr\\.?|i{2,3}|iv)$/i.test(out[out.length - 1])) out.pop();
    return out.length ? out[out.length - 1] : '';
  }
  function oxford(parts) {
    var items = [];
    for (var i = 0; i < parts.length; i++) { var p = trim(parts[i]); if (p) items.push(p); }
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + ' and ' + items[1];
    return items.slice(0, items.length - 1).join(', ') + ', and ' + items[items.length - 1];
  }
  function pronounOf(label) {
    var id = trim(label).toLowerCase();
    for (var i = 0; i < D.pronouns.length; i++) if (D.pronouns[i].id === id) return D.pronouns[i];
    return D.pronouns[0];
  }
  /** The file's fields as the site's input. */
  function read(doc) {
    function g(n) { var f = doc.getField(n); return f ? String(f.value) : ''; }
    var visitors = [];
    for (var i = 0; i < F.dv.length; i++) visitors.push({ name: g(F.dv[i][0]), role: g(F.dv[i][1]) });
    var rel = trim(g(F.spouseRelation));
    return {
      unit: g(F.unit), team: g(F.team), greeting: g(F.greeting), date: g(F.date), time: g(F.time),
      promoteeName: g(F.promotee), pronounId: pronounOf(g(F.pronoun)).id,
      currentGradeId: gradeByAbbr(g(F.currentRank)).id, newGradeId: gradeByAbbr(g(F.newRank)).id,
      emcee: g(F.emcee), presiding: g(F.presiding), seniorEnlisted: g(F.chief), firstSergeant: g(F.firstSergeant),
      remarksBy: g(F.remarks), chargeReader: g(F.chargeReader), readCharge: true,
      tackers: [g(F.tacker1), g(F.tacker2)],
      spouseRelation: rel === '(none)' ? '' : rel, spouseName: g(F.spouseName), children: g(F.children),
      mother: g(F.mother), father: g(F.father), visitors: visitors, refreshments: g(F.refreshments)
    };
  }
  function isEmpty(input) {
    var strings = [input.unit, input.team, input.promoteeName, input.emcee, input.presiding, input.seniorEnlisted,
      input.firstSergeant, input.remarksBy, input.chargeReader, input.refreshments, input.spouseRelation,
      input.spouseName, input.children, input.mother, input.father].concat(input.tackers);
    for (var i = 0; i < input.visitors.length; i++) strings.push(input.visitors[i].name);
    for (var j = 0; j < strings.length; j++) if (trim(strings[j]) !== '') return false;
    return true;
  }
  function grade(id) {
    for (var i = 0; i < D.grades.length; i++) if (D.grades[i].id === id) return D.grades[i];
    return D.grades[0];
  }
  /** promotion/ceremony.ts buildScript, line for line. Blocks are [kind, text]. */
  function build(input) {
    var pr = pronounOf(input.pronounId);
    var last = surname(input.promoteeName) || '(promotee)';
    var cur = grade(input.currentGradeId).full;
    var next = grade(input.newGradeId);
    var newFull = next.full;
    var newTier = tierOf(next);
    var charge = input.readCharge ? chargeFor(next) : null;
    var team = trim(input.team) || (trim(input.unit) ? 'the ' + trim(input.unit) : 'our unit');
    var emcee = trim(input.emcee);
    var presiding = trim(input.presiding);
    var chief = trim(input.seniorEnlisted);
    var shirt = trim(input.firstSergeant);
    var remarks = trim(input.remarksBy);
    var reader = trim(input.chargeReader) || chief || presiding;
    var greeting = trim(input.greeting) || 'Good afternoon';

    var open = [];
    function say(list, text) { list.push(['say', text]); }
    function cue(list, text) { list.push(['cue', text]); }

    cue(open, 'Approximately three minutes prior to start:');
    say(open, 'Ladies and gentlemen, the ceremony is about to begin.');
    cue(open, 'Slight pause.');
    say(open, greeting + ", ladies and gentlemen. Welcome to today's promotion ceremony. Today we will recognize " + cur + ' ' + last + ' as ' + pr.subject + ' promote' + pr.s + ' to the rank of ' + newFull + '.');
    cue(open, 'Slight pause.');
    if (emcee) {
      say(open, 'I am ' + emcee + ', and I will be your emcee.');
      cue(open, 'Slight pause.');
    }
    say(open, "Before we begin today's ceremony, we would like to extend a special welcome to the family, friends, peers, and all of " + team + ' here with us today. Without your patience, trust, and understanding, there would be a great void in the significance of this ceremony.');
    cue(open, 'Slight pause.');

    var visitors = [];
    for (var v = 0; v < input.visitors.length; v++) {
      var name = trim(input.visitors[v].name), role = trim(input.visitors[v].role);
      if (name) visitors.push(role ? name + ', ' + role : name);
    }
    if (visitors.length === 1) {
      say(open, 'We would also like to recognize our distinguished visitor today, ' + visitors[0] + '.');
      cue(open, 'Slight pause.');
    } else if (visitors.length > 1) {
      say(open, 'We would also like to recognize our distinguished visitors today: ' + oxford(visitors) + '.');
      cue(open, 'Slight pause.');
    }

    var leadership = oxford([presiding, chief]);
    if (leadership) {
      say(open, 'We are also honored to be joined by ' + leadership + ' today.');
      cue(open, 'Slight pause.');
    }

    var family = [];
    var rel = trim(input.spouseRelation);
    var spouse = trim(input.spouseName);
    if (rel) family.push(pr.possessive + ' ' + rel.toLowerCase() + (spouse ? ', ' + spouse : ''));
    else if (spouse) family.push(pr.possessive + ' spouse, ' + spouse);
    if (trim(input.mother)) family.push(pr.possessive + ' mother, ' + trim(input.mother));
    if (trim(input.father)) family.push(pr.possessive + ' father, ' + trim(input.father));
    if (trim(input.children)) family.push(pr.possessive + ' children, ' + trim(input.children));
    if (family.length) {
      say(open, cur + ' ' + last + ' is also joined today by ' + oxford(family) + '.');
      cue(open, 'Slight pause.');
    }

    say(open, "Promotion ceremonies are an age-old tradition in which leaders recognize their Airmen in front of their supervisors, peers, and subordinates. The promotion signifies the promotee's ability to handle increased responsibility and is a reflection of their dedication to the profession of arms.");
    cue(open, 'Slight pause.');

    var corps = charge && newTier.corps ? ', and into ' + newTier.corps : '';
    var forward = presiding ? presiding + ' and ' + cur + ' ' + last + ', please come forward.' : cur + ' ' + last + ', please come forward.';
    say(open, 'We will now recognize ' + cur + ' ' + last + ' as ' + pr.subject + ' transition' + pr.s + ' to the next rank' + corps + '. ' + forward);
    cue(open, 'Slight pause.');
    say(open, 'Being promoted to the rank of ' + newFull + '... ' + cur + ' ' + last + '!');
    cue(open, 'Proffer: present the certificate toward the audience. Presiding official and promotee shake, take a photo, and salute.');
    if (presiding) cue(open, 'Presiding official steps to stage right, next to the podium.');
    cue(open, last + ' faces the audience and takes one step forward.');

    var tackers = [];
    for (var t = 0; t < input.tackers.length; t++) if (trim(input.tackers[t])) tackers.push(trim(input.tackers[t]));
    if (tackers.length === 1) {
      say(open, 'Assisting with tacking on ' + last + "'s new stripes is " + tackers[0] + '.');
      cue(open, 'Pause to allow for the tacking of the stripes.');
    } else if (tackers.length > 1) {
      say(open, 'Assisting with tacking on ' + last + "'s new stripes are " + oxford(tackers) + '.');
      cue(open, 'Pause to allow for the tacking of the stripes.');
    }

    if (remarks) {
      say(open, 'At this time, ' + remarks + ' will give a few remarks about ' + newFull + ' ' + last + '.');
      cue(open, remarks + ' speaks, then returns to formation.');
      say(open, 'Thank you, ' + remarks + '.');
    }

    var chargeBlocks = [];
    if (charge) {
      if (reader) {
        say(open, 'Following Air Force tradition, ' + reader + ' will now come forward to deliver the ' + charge.title + '. ' + charge.standFor);
      } else {
        say(open, 'Following Air Force tradition, we will now deliver the ' + charge.title + '. ' + charge.standFor);
      }
      cue(chargeBlocks, 'Reader delivers the charge below verbatim, then returns to formation.');
      chargeBlocks.push(['title', charge.title.toUpperCase()]);
      for (var p = 0; p < charge.paragraphs.length; p++) chargeBlocks.push(['para', charge.paragraphs[p]]);
      cue(chargeBlocks, 'Reader returns to formation.');
      cue(chargeBlocks, 'Applause.');
    } else {
      cue(open, 'No formal charge is read for this promotion. Proceed to closing.');
    }

    var close = [];
    say(close, newFull + ' ' + last + ', the floor is yours.');
    cue(close, 'Promotee says a few words.');
    say(close, 'Thank you, ' + newFull + ' ' + last + '.');
    cue(close, 'Promotee returns to formation.');
    var speakers = [];
    if (shirt) speakers.push([shirt, 'to share a few words', false]);
    if (chief) speakers.push([chief, 'to share a few words', false]);
    if (presiding) speakers.push([presiding, 'for closing remarks', true]);
    for (var s = 0; s < speakers.length; s++) {
      say(close, speakers[s][0] + ', please come forward ' + speakers[s][1] + '.');
      cue(close, speakers[s][0] + ' speaks.');
      say(close, 'Thank you, ' + speakers[s][0] + '.');
      if (speakers[s][2]) cue(close, 'Lead applause.');
    }
    cue(close, 'Pause.');
    var refresh = trim(input.refreshments);
    say(close, 'Thank you to everyone for attending and for showing your support and encouragement. This concludes today\\'s ceremony. Please come forward to congratulate our newest ' + newFull + '.' + (refresh ? ' Light refreshments are in the ' + refresh + '.' : ''));

    return { opening: open, charge: chargeBlocks, closing: close, chargeName: charge ? charge.title : null };
  }
  /** Blocks as the file shows them: EMCEE lines, » cues, a blank line before each spoken line. */
  function format(blocks) {
    var out = [];
    var first = true;
    for (var i = 0; i < blocks.length; i++) {
      var kind = blocks[i][0], text = blocks[i][1];
      if (kind === 'say') { if (!first) out.push(''); out.push('EMCEE: ' + text); }
      else if (kind === 'cue') out.push(CUE + text);
      else if (kind === 'title') { if (!first) out.push(''); out.push(text); }
      else { out.push(''); out.push(text); }
      first = false;
    }
    return out.join('\\r');
  }
  function calc(name, input) {
    if (isEmpty(input)) return '';
    var s = build(input);
    switch (name) {
      case F.main: return format(s.opening);
      case F.charge: return s.charge.length ? format(s.charge) : 'No formal charge applies to this promotion. Skip to the closing on the next page.';
      case F.closing: return format(s.closing);
      case F.chargeIndicator: return s.chargeName ? s.chargeName.toUpperCase() : 'NONE';
    }
    return '';
  }
  return { data: D, read: read, build: build, format: format, calc: calc, isEmpty: isEmpty };
})();
/* The file's output fields call these by name; they route to the engine above. */
function _I(doc) { return OCG.read(doc); }
function buildMain(input) { return OCG.calc('${PF.main}', input); }
function buildCharge(input) { return OCG.calc('${PF.charge}', input); }
function buildClosing(input) { return OCG.calc('${PF.closing}', input); }
function buildInd(input) { return OCG.calc('${PF.chargeIndicator}', input); }
`;
}

/** The calculate actions the file's output fields carry after the rewrite. */
export function promotionCalcActions(): Record<string, string> {
  const action = (name: string) => `event.value = OCG.calc('${name}', OCG.read(this));`;
  return {
    [PF.main]: action(PF.main),
    [PF.charge]: action(PF.charge),
    [PF.closing]: action(PF.closing),
    [PF.chargeIndicator]: action(PF.chargeIndicator),
  };
}
