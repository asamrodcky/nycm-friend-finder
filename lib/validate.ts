// Request validation for runner entries.
//
// The database has its own CHECKs and foreign keys as a backstop, but
// those produce SQLite error strings. These checks exist to give a
// person a sentence they can act on.

export interface RunnerInput {
  display_name: string;
  bib_number: string | null;
  color_key: number | null;
  wave_key: number | null;
  corral_key: number | null;
  transport_key: number | null;
  depart_time_local: string | null;
  meetup_note: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** '' and whitespace collapse to null: an unknown bib must never be ''. */
function nullableText(v: unknown, max: number, field: string, errors: string[]): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') { errors.push(`${field} must be text`); return null; }
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) { errors.push(`${field} is too long (max ${max})`); return null; }
  return t;
}

function nullableKey(v: unknown, field: string, errors: string[]): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) { errors.push(`${field} must be a positive whole number`); return null; }
  return n;
}

export function parseRunner(body: unknown): { value?: RunnerInput; errors: string[] } {
  const errors: string[] = [];
  if (typeof body !== 'object' || body === null) return { errors: ['expected a JSON object'] };
  const b = body as Record<string, unknown>;

  const display_name = nullableText(b.display_name, 60, 'name', errors);
  if (!display_name) errors.push('name is required');

  // Generous max so the format check below owns the error message:
  // someone typing "5:30 AM" should be told the format, not the length.
  let depart_time_local = nullableText(b.depart_time_local, 20, 'departure time', errors);
  if (depart_time_local && !HHMM.test(depart_time_local)) {
    errors.push(`"${depart_time_local}" is not a time I understand -- use 24-hour, like 05:30`);
    depart_time_local = null;
  }

  const value: RunnerInput = {
    display_name:      display_name ?? '',
    bib_number:        nullableText(b.bib_number, 20, 'bib number', errors),
    color_key:         nullableKey(b.color_key, 'color', errors),
    wave_key:          nullableKey(b.wave_key, 'wave', errors),
    corral_key:        nullableKey(b.corral_key, 'corral', errors),
    transport_key:     nullableKey(b.transport_key, 'transport', errors),
    depart_time_local,
    meetup_note:       nullableText(b.meetup_note, 140, 'outfit note', errors),
  };

  // A departure time with no vehicle is a time for nothing.
  if (value.depart_time_local && !value.transport_key) {
    errors.push('pick how you are getting there before setting a departure time');
  }

  return errors.length ? { errors } : { value, errors };
}
