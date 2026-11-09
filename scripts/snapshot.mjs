// Exports the race-day database to a committable snapshot.
//
// §8 says teardown is `d1 export` straight into `git add snapshots/`.
// That command exports the WHOLE database, and the whole database is not
// the thing worth keeping:
//
//   dim_runner        pin_hash + pin_salt for every claimed runner
//   fct_runner_start  bib numbers -- a name plus a bib is enough to look
//                     somebody up on NYRR live tracking
//   fct_runner_saved  who starred whom, which is a social graph
//   auth_throttle     client IP addresses
//   d1_migrations     wrangler bookkeeping with no analytical value
//
// `.gitignore` already argues this case in its own words -- the roster
// CSV is out of git because "a name + bib is enough to look someone up
// on NYRR tracking" -- and then §8 planned to commit the same names and
// bibs back in, with password hashes attached. The input was treated as
// sensitive and the output was not. This script closes that gap.
//
// What the snapshot is actually FOR is the dimensional model and the
// shape of the data: a real factless fact table with real lumpy
// distributions in it, loadable into SQLite, DuckDB or Postgres with no
// Cloudflare account. None of that needs anybody's identity, so almost
// all of the exposure can go while keeping all of the value.
//
//   node scripts/snapshot.mjs --remote              # scrubbed, real names kept
//   node scripts/snapshot.mjs --remote --anonymise  # names and bibs replaced too
//   node scripts/snapshot.mjs --local               # rehearse against local D1
//
// Scrubbing happens in SQL against a real SQLite database rather than by
// rewriting the dump text: names contain apostrophes, and a regex over
// INSERT statements is exactly the kind of thing that works until the
// one row where it does not.

import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DB = 'nycm-friendfinder';

// Kept: the model and the facts. Everything here ends up in the file.
const KEEP = [
  'dim_color', 'dim_wave', 'dim_corral', 'dim_transport',
  'dim_runner', 'fct_runner_start', 'fct_runner_saved',
  // 0008. Carries no identity of its own -- a mile marker against a
  // start row -- and it is half of what makes a spectator a spectator.
  'fct_spectator_mile',
];

// Dropped, each for a stated reason. A table in neither list aborts the
// run -- see the drift check below.
const DROP = {
  auth_throttle: 'operational state, and it holds client IP addresses',
  d1_migrations: 'wrangler bookkeeping, rebuilt by `migrations apply`',
  _cf_KV:        'Cloudflare internal',
  // Appears in local D1 but not in production, which is the first thing
  // this check caught and a fair demonstration of why it exists.
  _cf_METADATA:  'Cloudflare internal (local miniflare only)',
};

// The columns each table is expected to have. This is the part that
// earns its keep over time: auth_throttle did not exist when §8 was
// written, and nothing would have told anyone to reconsider the plan.
// If a column or table appears that this script has never been told
// about, it stops rather than quietly publishing it.
const EXPECTED = {
  dim_runner: ['runner_key', 'display_name', 'first_name', 'last_name',
               'pin_hash', 'pin_salt', 'claimed_at_utc',
               'instagram'],                      // 0007
  fct_runner_start: ['runner_start_key', 'bib_number', 'runner_key', 'color_key',
                     'wave_key', 'corral_key', 'transport_key', 'depart_time_local',
                     'meetup_note', 'is_current', 'valid_from_utc', 'valid_to_utc',
                     'created_at_utc',
                     'participant_role', 'goal_time_seconds',   // 0008
                     'has_sign', 'has_support'],
  fct_runner_saved: ['saved_key', 'runner_key', 'saved_runner_key', 'created_at_utc'],
  fct_spectator_mile: ['runner_start_key', 'mile_marker'],
};

// Always. A PIN here is an identity mechanism, but people reuse PINs,
// and PBKDF2 at the 10k iterations the Workers CPU budget allows is
// minutes of offline work over a six-digit space. §16 already said to
// do this; now it is not a thing anyone has to remember at 11pm.
const SCRUB = [
  ['password hashes', 'UPDATE dim_runner SET pin_hash = NULL, pin_salt = NULL'],
];

// Opt-in. Keeps every distribution the analysis cares about -- the same
// people, the same waves, the same overlaps -- with nobody identifiable.
const ANONYMISE = [
  ['names', `UPDATE dim_runner
                SET display_name = 'Runner ' || printf('%03d', runner_key),
                    first_name = NULL, last_name = NULL`],
  // THE ONE THIS SCRIPT USED TO MISS. A handle skips the inference step
  // entirely: a name plus a bib has to be looked up on NYRR, where a
  // handle just is the person. 39 of them were live. Before this line,
  // --anonymise wrote a file labelled "synthetic" with every one intact.
  ['instagram handles', 'UPDATE dim_runner SET instagram = NULL'],
  // Unique per runner, so the live-bib unique index still holds. Every
  // superseded row for a runner keeps the same synthetic bib, which is
  // what you want: the history stays followable.
  ['bib numbers', `UPDATE fct_runner_start
                      SET bib_number = CASE WHEN bib_number IS NULL THEN NULL
                                            ELSE printf('%05d', 90000 + runner_key) END`],
  ['meetup notes', 'UPDATE fct_runner_start SET meetup_note = NULL'],
];

// ---------------------------------------------------------------------

const args = process.argv.slice(2);
const has = f => args.includes(f);
const remote = has('--remote');
const anonymise = has('--anonymise');
const force = has('--force');
const out = (args.find(a => a.startsWith('--out=')) ?? '').slice(6)
  || `snapshots/nycm2026-${anonymise ? 'anon' : 'final'}.sql`;

if (remote === has('--local')) {
  die('pass exactly one of --remote or --local');
}
if (existsSync(out) && !force) {
  die(`${out} already exists. Move it aside, or pass --force to overwrite.`);
}

function die(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

const wrangler = (...a) =>
  execFileSync('npx', ['wrangler', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const where = remote ? '--remote' : '--local';
const work = mkdtempSync(join(tmpdir(), 'nycm-snapshot-'));

try {
  // ---- 1. what is actually in there? -------------------------------
  // Asked of the database, not assumed from this file, so a table added
  // later is a decision somebody has to make rather than an accident.
  const listed = JSON.parse(wrangler(
    'd1', 'execute', DB, where, '--json', '--command',
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ))[0].results.map(r => r.name);

  const unknown = listed.filter(t => !KEEP.includes(t) && !(t in DROP));
  if (unknown.length) {
    die(`unrecognised table(s): ${unknown.join(', ')}\n`
      + '    This script will not guess whether they are safe to publish.\n'
      + '    Add each to KEEP or DROP in scripts/snapshot.mjs, with a reason.');
  }

  const present = KEEP.filter(t => listed.includes(t));
  if (!present.length) die('none of the expected tables exist -- wrong database?');

  // ---- 2. export only the kept tables ------------------------------
  const raw = join(work, 'raw.sql');
  wrangler('d1', 'export', DB, where, '-y',
    ...present.flatMap(t => ['--table', t]), '--output', raw);

  // ---- 3. load it, so the scrub can be SQL -------------------------
  const db = new DatabaseSync(join(work, 'snap.db'));
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(readFileSync(raw, 'utf8'));

  // Column drift, per table, before anything is written out.
  for (const [table, expected] of Object.entries(EXPECTED)) {
    if (!present.includes(table)) continue;
    const actual = db.prepare(`SELECT name FROM pragma_table_info('${table}')`)
      .all().map(r => r.name);
    const added = actual.filter(c => !expected.includes(c));
    if (added.length) {
      die(`${table} has column(s) this script has never seen: ${added.join(', ')}\n`
        + '    Decide whether they belong in a committed file, then update\n'
        + '    EXPECTED (and SCRUB/ANONYMISE if they are personal).');
    }
  }

  // Captured before scrubbing, to prove afterwards that it actually
  // happened -- a scrub that silently did nothing is the whole risk.
  const before = {
    names: db.prepare('SELECT display_name FROM dim_runner').all().map(r => r.display_name),
    bibs: db.prepare('SELECT DISTINCT bib_number FROM fct_runner_start WHERE bib_number IS NOT NULL')
      .all().map(r => r.bib_number),
    handles: db.prepare("SELECT instagram FROM dim_runner WHERE instagram IS NOT NULL AND instagram <> ''")
      .all().map(r => r.instagram),
    runners: db.prepare('SELECT COUNT(*) n FROM dim_runner').get().n,
    pins: db.prepare('SELECT COUNT(*) n FROM dim_runner WHERE pin_hash IS NOT NULL').get().n,
  };

  // ---- 4. scrub ----------------------------------------------------
  const did = [];
  for (const [what, sql] of [...SCRUB, ...(anonymise ? ANONYMISE : [])]) {
    db.exec(sql);
    did.push(what);
  }

  const leftovers = db.prepare(
    'SELECT COUNT(*) n FROM dim_runner WHERE pin_hash IS NOT NULL OR pin_salt IS NOT NULL',
  ).get().n;
  if (leftovers) die(`${leftovers} rows still hold a PIN hash after scrubbing`);

  // ---- 5. write it back out ----------------------------------------
  const lit = v => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'bigint') return String(v);
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
    return `'${String(v).replace(/'/g, "''")}'`;
  };

  const ddl = kind => db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ).all(kind).map(r => r.sql.trim() + ';');

  // Views come from the live database, not the export: `--table` selects
  // tables only, and §8's revival path loads this file straight into a
  // fresh D1. The app reads nothing but views, so a snapshot without
  // them restores a database the app cannot use.
  const views = JSON.parse(wrangler(
    'd1', 'execute', DB, where, '--json', '--command',
    "SELECT sql FROM sqlite_master WHERE type='view' AND sql IS NOT NULL ORDER BY name",
  ))[0].results.map(r => r.sql.trim() + ';');

  const lines = [
    `-- NYCM Friend Finder — race-day snapshot`,
    `-- taken ${new Date().toISOString()} from ${remote ? 'production' : 'local'} D1`,
    `--`,
    `-- Scrubbed before committing: ${did.join(', ')}.`,
    `-- Excluded: ${Object.entries(DROP).map(([t, why]) => `${t} (${why})`).join('; ')}.`,
    anonymise
      ? '-- Names and bib numbers are synthetic. Distributions are real.'
      : '-- NOTE: real names and bib numbers. Think before making this repo public.',
    `--`,
    `-- Loads into SQLite, DuckDB or Postgres as-is: sqlite3 new.db < this-file`,
    '',
    'PRAGMA foreign_keys = OFF;',
    'BEGIN TRANSACTION;',
    '',
    ...ddl('table'),
    '',
  ];

  let rows = 0;
  for (const table of present) {
    const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map(r => r.name);
    const data = db.prepare(`SELECT * FROM "${table}"`).all();
    if (!data.length) continue;
    lines.push(`-- ${table}: ${data.length} rows`);
    for (const row of data) {
      lines.push(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) `
        + `VALUES (${cols.map(c => lit(row[c])).join(', ')});`);
      rows++;
    }
    lines.push('');
  }

  lines.push(...ddl('index'), '', ...views, '', 'COMMIT;', '');
  const sql = lines.join('\n');

  // ---- 6. prove it, against the text that will be committed --------
  // Looks for real schema or data, not any mention of the name -- the
  // header comment above lists the dropped tables on purpose, and a bare
  // substring search flags its own provenance note.
  for (const [table, why] of Object.entries(DROP)) {
    const defined = new RegExp(`CREATE\\s+(TABLE|INDEX|VIEW)[^;]*\\b${table}\\b`, 'i');
    const written = new RegExp(`INSERT\\s+INTO\\s+"?${table}"?\\b`, 'i');
    if (defined.test(sql) || written.test(sql)) die(`"${table}" (${why}) leaked into the output`);
  }
  if (/pin_hash\s*,?\s*['"][A-Za-z0-9_-]{10,}/.test(sql)) die('a PIN hash value survived into the output');
  if (anonymise) {
    // PROVE THE SCRUB RAN, POSITIVELY. The old check was a substring
    // scan of the output for every original value, which cannot work:
    // one person registered a ONE-CHARACTER display name, and a
    // one-character string occurs in any SQL text -- it matched the "G"
    // inside "INTEGER" and failed a run whose data was in fact perfectly
    // anonymised. A single-letter name would equally collide with a
    // corral letter. Short values are unscannable this way.
    //
    // So assert the end state directly instead: every row must now hold
    // a synthetic value. This is exact, has no false positives, and says
    // what we actually mean -- that nothing original survived.
    const residue = [
      ['names', "SELECT COUNT(*) n FROM dim_runner WHERE display_name NOT LIKE 'Runner %'"],
      ['instagram handles', 'SELECT COUNT(*) n FROM dim_runner WHERE instagram IS NOT NULL'],
      ['first/last names', 'SELECT COUNT(*) n FROM dim_runner WHERE first_name IS NOT NULL OR last_name IS NOT NULL'],
      ['bib numbers', "SELECT COUNT(*) n FROM fct_runner_start WHERE bib_number IS NOT NULL AND bib_number NOT LIKE '9____'"],
      ['meetup notes', 'SELECT COUNT(*) n FROM fct_runner_start WHERE meetup_note IS NOT NULL'],
    ];
    for (const [what, q] of residue) {
      const n = db.prepare(q).get().n;
      if (n) die(`${n} original ${what} survived --anonymise`);
    }

    // Belt and braces over the text that actually gets written, as SQL
    // string literals rather than bare substrings, and only for values
    // long enough for a match to mean something.
    const asLiteral = v => `'${String(v).replace(/'/g, "''")}'`;
    const leaked = [...before.names, ...before.bibs, ...before.handles]
      .filter(v => v && String(v).length >= 3 && sql.includes(asLiteral(v)));
    if (leaked.length) die(`${leaked.length} original value(s) written as literals despite --anonymise`);
  }

  writeFileSync(out, sql);

  // ---- 7. say what happened ----------------------------------------
  const kb = (sql.length / 1024).toFixed(1);
  console.log(`\n  Snapshot written: ${out}  (${rows} rows, ${kb} KB)\n`);
  console.log(`    kept      ${present.join(', ')}`);
  console.log(`    dropped   ${Object.keys(DROP).join(', ')}`);
  console.log(`    scrubbed  ${did.join(', ')}  (${before.pins} PIN hashes removed)`);
  console.log(anonymise
    ? `    names     synthetic — ${before.runners} runners, distributions intact`
    : `    names     REAL, for ${before.runners} runners, with real bib numbers`);
  if (!anonymise) {
    console.log(`\n    A name plus a bib looks someone up on NYRR tracking, and git`);
    console.log(`    history outlives the reason it felt fine to commit. If this repo`);
    console.log(`    might ever be public or shared, re-run with --anonymise.`);
  }
  console.log('');
} finally {
  rmSync(work, { recursive: true, force: true });   // never leave the unscrubbed export on disk
}
