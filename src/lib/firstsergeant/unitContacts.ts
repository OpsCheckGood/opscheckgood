/**
 * The unit's own contacts, and which installation is selected.
 *
 * A Shirt's most-dialled numbers are their own commander, CSS, UDM and UCC --
 * which no shipped data file can ever know. So the toolkit lets them keep a
 * short local list, stored in this browser and nowhere else. Constraint 2: this
 * is somebody's chain of command, and it is not ours to collect.
 */

export const STORE_KEY = 'ocg.firstsergeant.v1';

export interface UnitContact {
  /** Free text: "Commander", "UDM", "Night shift lead". */
  role: string;
  name: string;
  phone: string;
}

export interface ToolkitState {
  /** Selected installation id, or '' for none. */
  installationId: string;
  unitContacts: UnitContact[];
}

/** The roles a Shirt is most likely to want, offered as a starting skeleton. */
export const SUGGESTED_ROLES = [
  'Commander',
  'First Sergeant',
  'CSS',
  'UDM',
  'Security Manager',
  'Unit Control Center',
] as const;

export const EMPTY_STATE: ToolkitState = { installationId: '', unitContacts: [] };

export function emptyContact(role = ''): UnitContact {
  return { role, name: '', phone: '' };
}

/** A row worth keeping. Blank rows are dropped rather than persisted. */
export function isUsable(contact: UnitContact): boolean {
  return contact.role.trim() !== '' || contact.name.trim() !== '' || contact.phone.trim() !== '';
}

function readContact(raw: unknown): UnitContact | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const contact: UnitContact = {
    role: typeof o.role === 'string' ? o.role : '',
    name: typeof o.name === 'string' ? o.name : '',
    phone: typeof o.phone === 'string' ? o.phone : '',
  };
  return isUsable(contact) ? contact : null;
}

/**
 * Reads stored state, tolerating anything.
 *
 * A parse failure or a shape from an older version has to degrade to an empty
 * toolkit rather than a broken one -- this is a page somebody opens in a hurry.
 */
export function parseState(raw: string | null): ToolkitState {
  if (raw === null) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const contacts = Array.isArray(parsed.unitContacts)
      ? parsed.unitContacts.map(readContact).filter((c): c is UnitContact => c !== null)
      : [];
    return {
      installationId: typeof parsed.installationId === 'string' ? parsed.installationId : '',
      unitContacts: contacts,
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function serializeState(state: ToolkitState): string {
  return JSON.stringify({
    installationId: state.installationId,
    unitContacts: state.unitContacts.filter(isUsable),
  });
}
