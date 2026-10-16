// Stamps public/version.json with an id for the frontend that is about
// to be deployed, so a tab that is already open can tell "there is a new
// deploy" apart from "nothing has changed since I loaded".
//
// The id is a hash of the frontend's own bytes, not the git SHA: every
// deploy here is a manual `wrangler pages deploy` that may run against a
// dirty tree, so a commit-based id would miss changes that are live. A
// redeploy of identical files keeps its id, and `at` keeps saying when
// that build was first stamped.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public';
const STAMP = 'version.json';

const files = readdirSync(DIR)
  .filter(f => /\.(html|js|css)$/.test(f) && f !== STAMP)
  .sort();

const hash = createHash('sha256');
for (const f of files) {
  hash.update(f);                        // a rename is a change too
  hash.update(readFileSync(join(DIR, f)));
}
const build = hash.digest('hex').slice(0, 12);

let current = {};
try { current = JSON.parse(readFileSync(join(DIR, STAMP), 'utf8')); } catch { /* first run */ }

if (current.build === build) {
  console.log(`version.json unchanged (${build})`);
} else {
  const stamp = { build, at: new Date().toISOString() };
  writeFileSync(join(DIR, STAMP), JSON.stringify(stamp, null, 2) + '\n');
  console.log(`version.json ${current.build ?? '(none)'} -> ${build}, ${files.length} files`);
}
