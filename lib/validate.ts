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
  instagram: string | null;
  participant_role: 'runner' | 'spectator';
  goal_time_seconds: number | null;
  spectator_miles: number[];
  has_sign: 0 | 1;
  has_support: 0 | 1;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Mirrors the CHECK in migration 0008: 25 minutes to 13 hours. */
const GOAL_MIN = 1500, GOAL_MAX = 46800;

/**
 * A goal finish, accepted as 'h:mm' or 'h:mm:ss' and stored as seconds.
 *
 * Bounded on both ends on purpose. The projection built from this reads
 * as authoritative -- a spectator will stand on a corner because of it
 * -- so a fat-fingered "3:450" has to be refused here rather than
 * turned into a confident wrong answer at mile 18.
 */
function goalSeconds(raw: unknown, errors: string[]): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < GOAL_MIN || raw > GOAL_MAX) {
      errors.push('goal time must be between 25 minutes and 13 hours');
      return null;
    }
    return raw;
  }
  const parts = String(raw).trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(x => !/^\d+$/.test(x))) {
    errors.push(`"${String(raw)}" is not a time I understand -- use h:mm, like 3:45`);
    return null;
  }
  const [h, m, sec = '0'] = parts;
  if (Number(m) > 59 || Number(sec) > 59) {
    errors.push('minutes and seconds in a goal time have to be under 60');
    return null;
  }
  const total = Number(h) * 3600 + Number(m) * 60 + Number(sec);
  if (total < GOAL_MIN || total > GOAL_MAX) {
    errors.push('goal time must be between 25 minutes and 13 hours');
    return null;
  }
  return total;
}

/** Mile markers a spectator will be at. Deduplicated and sorted. */
function spectatorMiles(raw: unknown, errors: string[]): number[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) { errors.push('miles must be a list'); return []; }
  const out = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 26) {
      errors.push(`"${String(v)}" is not a mile on this course -- pick 1 to 26`);
      return [];
    }
    out.add(n);
  }
  if (out.size > 8) { errors.push('pick at most 8 miles'); return []; }
  return [...out].sort((a, b) => a - b);
}

const flag = (raw: unknown): 0 | 1 => (raw === true || raw === 1 || raw === '1' ? 1 : 0);

/** '' and whitespace collapse to null: an unknown bib must never be ''. */
function nullableText(v: unknown, max: number, field: string, errors: string[]): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') { errors.push(`${field} must be text`); return null; }
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) { errors.push(`${field} is too long (max ${max})`); return null; }
  return t;
}

/**
 * A bib, canonicalised so that two spellings of one number cannot both
 * be claimed.
 *
 * The live-bib unique index compares raw strings, so "04521" and "4521"
 * were two different bibs to the database and one bib to a human --
 * verified: the second one was accepted with a 201. Leading zeros are
 * stripped so the index sees what a person sees.
 *
 * Digits only, too. "not-a-bib" was also accepted. NYRR bibs are plain
 * numbers; all 29 in production are four or five digits with no leading
 * zero, so nothing existing is invalidated by requiring it.
 */
function bibNumber(v: unknown, errors: string[]): string | null {
  const t = nullableText(v, 20, 'bib number', errors);
  if (t === null) return null;
  if (!/^\d+$/.test(t)) {
    errors.push('bib number should be digits only, like 4521');
    return null;
  }
  const canon = t.replace(/^0+/, '');
  if (!canon || canon.length > 6) {
    errors.push('that does not look like a race bib number');
    return null;
  }
  return canon;
}

/**
 * An Instagram handle, stored bare.
 *
 * People paste whatever is in front of them, so a leading @ and a full
 * profile URL both normalise to the handle. Instagram allows letters,
 * numbers, periods and underscores, up to 30.
 */
function instagramHandle(v: unknown, errors: string[]): string | null {
  const t = nullableText(v, 120, 'Instagram handle', errors);
  if (t === null) return null;
  const bare = t
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
    .trim();
  if (!bare) return null;
  if (!/^[A-Za-z0-9._]{1,30}$/.test(bare)) {
    errors.push('that does not look like an Instagram handle');
    return null;
  }
  return bare;
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
    bib_number:        bibNumber(b.bib_number, errors),
    color_key:         nullableKey(b.color_key, 'color', errors),
    wave_key:          nullableKey(b.wave_key, 'wave', errors),
    corral_key:        nullableKey(b.corral_key, 'corral', errors),
    transport_key:     nullableKey(b.transport_key, 'transport', errors),
    depart_time_local,
    meetup_note:       nullableText(b.meetup_note, 140, 'outfit note', errors),
    instagram:         instagramHandle(b.instagram, errors),
    participant_role:  b.participant_role === 'spectator' ? 'spectator' : 'runner',
    goal_time_seconds: goalSeconds(b.goal_time_seconds, errors),
    spectator_miles:   spectatorMiles(b.spectator_miles, errors),
    has_sign:          flag(b.has_sign),
    has_support:       flag(b.has_support),
  };

  // A departure time with no vehicle is a time for nothing.
  if (value.depart_time_local && !value.transport_key) {
    errors.push('pick how you are getting there before setting a departure time');
  }

  // The two roles are not the same shape, and quietly storing the other
  // role's fields is how a spectator ends up on the roster as a runner
  // with everything missing -- the exact failure this feature exists to
  // remove. So each role keeps only what belongs to it.
  if (value.participant_role === 'spectator') {
    value.bib_number = null;
    value.color_key = null;
    value.wave_key = null;
    value.corral_key = null;
    value.goal_time_seconds = null;
    // Transport is "how you reach the Staten Island start" -- the ferry,
    // the Verrazzano buses, a charity coach. A spectator is not going
    // there, so the form stops asking and anything a role switch left
    // behind is dropped here rather than stored as a journey nobody is
    // making. Clearing it server-side matters because somebody can fill
    // the runner half in, switch to spectating and submit.
    value.transport_key = null;
    value.depart_time_local = null;
    if (!value.spectator_miles.length) {
      errors.push('pick at least one mile you will be watching from');
    }
  } else {
    value.spectator_miles = [];
    value.has_sign = 0;
    value.has_support = 0;
  }

  return errors.length ? { errors } : { value, errors };
}
