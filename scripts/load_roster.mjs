#!/usr/bin/env node
// Load a roster CSV export into local D1 as test data.
//
//   node scripts/load_roster.mjs "A_M FTC Athletes NYC Marathon - Sheet1.csv"
//
// Writes seed/roster_load.sql (gitignored, contains real names), which
// the db:load:local npm script then executes against the LOCAL database.
//
// Expected header: Name,Bib #,Wave,Corral,Color,Transport,Transport Time
// Blanks are loaded as NULL, never '' -- see the bib_number CHECK in
// migrations/0002_fact.sql for why that distinction matters.

import { readFileSync, writeFileSync } from 'node:fs';

const COLORS = { blue: 1, orange: 2, pink: 3 };
const CORRALS = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 };

// Maps the group's actual vocabulary onto dim_transport. Keys are
// lowercased + whitespace-collapsed. Anything unmapped is reported, not
// silently dropped.
const TRANSPORT = {
  'ferry': 1,                        // Staten Island Ferry
  'staten island ferry': 1,
  'bus from ny public library': 2,
  'bus from nypl': 2,
  'bus from new jersey': 3,
  'vip bus': 4,                      // Charity / team bus
  'charity bus': 4,
  'team bus': 4,
  'own transport': 5,
  'car': 5,
  'walking': 6,
  'bus': 7,                          // Bus - not sure which
  'bus ?': 8,                        // Still deciding
  'bus?': 8,
  'not sure': 8,
  'tbd': 8,
};

/** Minimal RFC4180-ish parser: handles quoted fields and embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const blank = v => !v || !v.trim();
const norm  = v => (v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const sql   = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

/** '5:30 AM' | '6:45 am' | '05:30' -> '05:30'. Returns null if unparseable. */
function toHHMM(raw) {
  if (blank(raw)) return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return { error: raw.trim() };
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3] ? m[3].toLowerCase() : null;
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23) return { error: raw.trim() };
  return String(h).padStart(2, '0') + ':' + min;
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('usage: node scripts/load_roster.mjs <roster.csv>');
  process.exit(1);
}

const [header, ...rows] = parseCsv(readFileSync(csvPath, 'utf8'));
const col = name => header.findIndex(h => norm(h) === norm(name));
const idx = {
  name: col('Name'), bib: col('Bib #'), wave: col('Wave'),
  corral: col('Corral'), color: col('Color'),
  transport: col('Transport'), departs: col('Transport Time'),
};
for (const [k, v] of Object.entries(idx)) {
  if (v === -1) { console.error(`missing expected column for "${k}" in: ${header.join(',')}`); process.exit(1); }
}

const warnings = [], runners = [], facts = [];
let key = 0;

for (const r of rows) {
  const display = (r[idx.name] || '').trim();
  if (!display) { warnings.push('row with no Name, skipped'); continue; }
  key++;

  const waveRaw = (r[idx.wave] || '').trim();
  const wave = /^[1-5]$/.test(waveRaw) ? Number(waveRaw) : null;
  if (!blank(waveRaw) && wave === null) warnings.push(`${display}: unrecognized Wave "${waveRaw}" -> NULL`);

  const corralRaw = (r[idx.corral] || '').trim().toUpperCase();
  const corral = CORRALS[corralRaw] ?? null;
  if (!blank(corralRaw) && corral === null) warnings.push(`${display}: unrecognized Corral "${corralRaw}" -> NULL`);

  const colorRaw = (r[idx.color] || '').trim();
  const color = COLORS[norm(colorRaw)] ?? null;
  if (!blank(colorRaw) && color === null) warnings.push(`${display}: unrecognized Color "${colorRaw}" -> NULL`);

  const transRaw = (r[idx.transport] || '').trim();
  const transport = blank(transRaw) ? null : (TRANSPORT[norm(transRaw)] ?? null);
  if (!blank(transRaw) && transport === null) warnings.push(`${display}: unmapped Transport "${transRaw}" -> NULL (add it to TRANSPORT in this script)`);

  const departParsed = toHHMM(r[idx.departs]);
  let departs = null;
  if (departParsed && typeof departParsed === 'object') {
    warnings.push(`${display}: unparseable Transport Time "${departParsed.error}" -> NULL`);
  } else departs = departParsed;

  const bibRaw = (r[idx.bib] || '').trim();
  const bib = blank(bibRaw) ? null : bibRaw;

  runners.push(`  (${key}, ${sql(display)})`);
  facts.push(`  (${key}, ${sql(bib)}, ${color ?? 'NULL'}, ${wave ?? 'NULL'}, ${corral ?? 'NULL'}, ${transport ?? 'NULL'}, ${sql(departs)})`);
}

const out = `-- GENERATED by scripts/load_roster.mjs from:
--   ${csvPath}
-- Contains real names and bib numbers. Gitignored. Do not commit.
--
-- This is a RESET + LOAD of test data: it clears the roster first.
-- Intended for the LOCAL database only.

DELETE FROM fct_runner_start;
DELETE FROM dim_runner;
DELETE FROM sqlite_sequence WHERE name IN ('dim_runner','fct_runner_start');

INSERT INTO dim_runner (runner_key, display_name) VALUES
${runners.join(',\n')};

INSERT INTO fct_runner_start
  (runner_key, bib_number, color_key, wave_key, corral_key, transport_key, depart_time_local)
VALUES
${facts.join(',\n')};
`;

writeFileSync('seed/roster_load.sql', out);
console.log(`parsed ${rows.length} rows -> ${key} runners`);
console.log(`wrote seed/roster_load.sql`);
if (warnings.length) {
  console.log(`\n${warnings.length} thing(s) worth knowing:`);
  for (const w of warnings) console.log('  - ' + w);
} else console.log('\nno warnings');
