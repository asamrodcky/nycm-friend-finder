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
const HEADERS = '_headers';

const files = readdirSync(DIR)
  .filter(f => /\.(html|js|css)$/.test(f) && f !== STAMP)
  .sort();

const hash = createHash('sha256');
for (const f of files) {
  hash.update(f);                        // a rename is a change too
  hash.update(readFileSync(join(DIR, f)));
}
const build = hash.digest('hex').slice(0, 12);

// Every asset needs an exact rule in _headers, because the splat
// patterns that would have covered them are ignored by the production
// edge without complaining -- the bug this whole mechanism exists to fix
// shipped that way once already. Pages serves foo.html at /foo (and
// index.html at /), so the served path is not just '/' + filename.
const served = f =>
  f === 'index.html' ? '/' : '/' + f.replace(/\.html$/, '');

const rules = new Set(
  readFileSync(join(DIR, HEADERS), 'utf8')
    .split('\n')
    .filter(l => l.startsWith('/'))
    .map(l => l.trim()),
);

const uncovered = [...files, STAMP].map(served).filter(path => !rules.has(path));
if (uncovered.length) {
  console.error(
    `${HEADERS} has no rule for ${uncovered.join(', ')}.\n` +
    `Without one, Pages serves it with max-age=14400 and a deploy will not ` +
    `reach anyone who already loaded the site. Add an exact path.`,
  );
  process.exit(1);
}

let current = {};
try { current = JSON.parse(readFileSync(join(DIR, STAMP), 'utf8')); } catch { /* first run */ }

if (current.build === build) {
  console.log(`version.json unchanged (${build})`);
} else {
  const stamp = { build, at: new Date().toISOString() };
  writeFileSync(join(DIR, STAMP), JSON.stringify(stamp, null, 2) + '\n');
  console.log(`version.json ${current.build ?? '(none)'} -> ${build}, ${files.length} files`);
}
