# NYCM Friend Finder

Find your friends at the start of the TCS New York City Marathon.
**Race day: Sunday, November 1, 2026.**

Friends enter their start assignment (color, wave, corral) and how they're
getting to Fort Wadsworth. The app then surfaces the overlaps — same corral,
same ferry, same bus slot — so you can actually find a familiar face at 5am.

Built to cost $0 to run and to be torn down after the race, leaving a
committed SQL snapshot behind.

## Stack

| | |
|---|---|
| Hosting | Cloudflare Pages |
| Database | Cloudflare D1 (SQLite) |
| Frontend | Plain HTML + CSS + vanilla JS, no build step |
| API | TypeScript Cloudflare Pages Functions |
| Auth | One shared group passcode |

## Quick start (local — no Cloudflare account needed)

```bash
npm install
npm run db:migrate:local     # build the schema + seed the dimensions
npm run dev                  # http://localhost:8788
```

Local secrets live in `.dev.vars` (gitignored). The local passcode is
`verrazzano` unless you change it.

### Handy

```bash
npm run db:q "SELECT * FROM v_runner_start"   # query local
npm run db:reset:local                         # wipe + rebuild local
```

## Access model

Two layers, because they answer different questions.

| Token | How you get it | What it unlocks |
|---|---|---|
| **group** | the shared group password | the onboarding form and sign-in |
| **profile** | claim / onboard / sign in with a PIN | the roster, your own entry, your saved list |

A profile token is only issued after group auth, so it implies group
membership and satisfies both checks. Both are HMAC-signed expiry stamps
with a 30-day TTL — stateless, no session table to clean up at teardown.

**The PIN is identity, not security.** It answers "this is my new phone,
re-attach me to my row" — `localStorage` does not travel between a laptop
and a phone, so without it you would onboard twice and end up as two
people in different corrals. It is hashed (PBKDF2-SHA256, per-runner
salt) because snapshots get committed and people reuse PINs, but a
4-digit PIN behind a shared password is not a security boundary and the
app does not pretend otherwise.

Sign-in accepts **a bib number or a name**, both with the PIN. Bib is the
fast path, but some people have no bib yet, and anyone who corrects a
wrong bib would otherwise lock themselves out.

PINs are **4 to 6 digits**. Length costs nothing — PBKDF2 is priced per
iteration, not per character, so a 6-digit PIN hashes in the same time as
a 4-digit one while being 100x harder to brute-force out of a leaked
snapshot. The form accepts either and nudges toward 6.

### Resetting a forgotten PIN

There is no automated recovery — no email, no phone number. If someone
forgets their PIN or typos it when claiming, clear it and they can
re-claim their row with their data intact:

```bash
npm run db:q:remote "UPDATE dim_runner SET pin_hash=NULL, pin_salt=NULL, claimed_at_utc=NULL WHERE display_name='Runner V'"
```

They reappear in the "already on the roster?" picker and set a new PIN.
Bib, wave, corral and transport are all untouched. Use `db:q` instead of
`db:q:remote` against the local database.

## API

| Route | Method | Needs | Purpose |
|---|---|---|---|
| `/api/auth` | POST | — | `{passcode}` -> group token |
| `/api/meta` | GET | group | Seeded dimensions + departure slots, for the dropdowns |
| `/api/profile/unclaimed` | GET | group | The "already on the roster?" picker |
| `/api/profile/claim` | POST | group | Claim an imported row, set its PIN |
| `/api/profile/onboard` | POST | group | Brand-new person: row + PIN + first assignment |
| `/api/profile/signin` | POST | group | Bib-or-name + PIN -> profile token |
| `/api/runners` | GET | profile | The whole roster, one shot |
| `/api/runners/me` | POST | profile | Update my own entry |
| `/api/runners/me` | DELETE | profile | Take myself off the roster |
| `/api/saved` | GET | profile | People I saved, and how we overlap |
| `/api/saved` | POST | profile | Save someone |
| `/api/saved` | DELETE | profile | Unsave someone (`?key=N`) |
| `/api/meetups` | GET | profile | The four discovery tiers plus the gap list |

Reads hit views only; the API never touches a base table.

**There is no route for editing someone else's entry.** The runner key
comes from the profile token, never the request body — otherwise the PIN
would be guarding nothing.

## Data model

A **star schema**, because the point of this project is to practise one.

```
              dim_color ──┐
              dim_wave  ──┤
              dim_corral──┼──> fct_runner_start <── dim_runner ──┐
          dim_transport ──┘                              ▲       │
                                                         └───────┘
                                              fct_runner_saved
                                           (bridge, runner to runner)
```

**Both fact tables are factless.** Neither has an additive measure.
`fct_runner_start` records that a runner *is assigned* to a color, wave,
corral and transport plan; `fct_runner_saved` records only that one person
wants to find another. Kimball's coverage/event pattern twice over, and
`COUNT(*)` is the only measure either one offers — which is the point.

`fct_runner_saved` is also a **many-to-many bridge** from `dim_runner` back
to itself. Unlike the start table it is *not* insert-only: unsaving someone
is a correction, not history, and keeping it would turn the snapshot into a
record of who changed their mind about whom.

The payoff view is `v_saved_overlap` — for each person you saved, *how* do
you line up? Every comparison is NULL-guarded, since `NULL = NULL` is NULL
rather than true, and two people who both have no corral must not read as
sharing one.

Two design notes worth knowing before you change anything:

- **Start time is not stored on the fact.** It's an attribute of `dim_wave`,
  because NYRR fully determines start time from your wave. The input form
  derives and displays it rather than asking.
- **The fact table is insert-only.** An edit supersedes the previous row
  (`is_current = 0`, `valid_to_utc` stamped) instead of updating it, so the
  snapshot records who moved wave and when. NYRR allows moving to a later
  wave, so this happens for real. Reads go through views that hide the
  filter — the API never writes `WHERE is_current = 1`.

All reads go through views (`v_runner_start`, `v_meetup_transport`,
`v_meetup_corral`); the API never touches a base table. Ad-hoc analysis
queries are in `sql/`.

## Seed data caveat

NYRR's site sits behind a queue during race week, so two seeded things come
from secondary sources and are marked `-- VERIFY` in
`migrations/0001_dims.sql`:

1. **Bridge decks** — blue + orange upper, pink lower. Corroborated across
   several course guides. Display-only; no logic depends on it.
2. **Transport options** — the standard set. The input form builds its
   dropdown from `dim_transport` via `/api/meta`, so correcting these rows
   needs no code change and no redeploy of app logic.

For 2026 the start colors are **blue, orange, pink**. Green was retired.

## Test data vs production data

These are deliberately separate, and the separation is structural rather
than a matter of remembering.

**Migrations seed only reference data** — colors, waves, corrals and
transport options. There is no `INSERT INTO dim_runner` or
`fct_runner_start` anywhere in `migrations/`, so applying them to a
remote database produces a correct, completely empty roster. That is
what production should start as: everyone adds themselves.

**Roster data only ever arrives through `seed/roster_load.sql`**, which
is generated from a gitignored CSV, is itself gitignored, and is applied
by `db:load:local` — a `--local` command with no remote counterpart.

Confirm before going live:

```bash
npm run db:check:remote
# expect: colors 3, waves 5, transports 8, runners 0, assignments 0
```

If you ever *do* want the spreadsheet roster in production — so your
group claims rows instead of retyping — generate it and apply it
explicitly:

```bash
npm run roster:build -- am_ftc_athletes_nycm.csv
npx wrangler d1 execute nycm-friendfinder --remote --file=seed/roster_load.sql
```

Note that this is a **reset and load**: it clears the roster first, so
never run it against a production database people have already used.

## Deploy

```bash
npx wrangler login
npx wrangler d1 create nycm-friendfinder          # paste the id into wrangler.toml
npx wrangler d1 migrations apply nycm-friendfinder --remote
npx wrangler pages project create nycm-friendfinder
npx wrangler pages secret put GROUP_PASSCODE --project-name nycm-friendfinder
npx wrangler pages secret put TOKEN_SECRET   --project-name nycm-friendfinder
npm run deploy
```

`npm run deploy` stamps `public/version.json` with a hash of the frontend before handing
off to `wrangler pages deploy`. That stamp is how a tab that is already open notices a new
build and reloads itself; `public/_headers` is what stops the browser holding the old
modules for four hours. Deploying with bare `wrangler pages deploy` works, it just skips
the stamp.

## Teardown

Snapshot **before** deleting anything:

```bash
npm run db:snapshot                               # -> snapshots/nycm2026-final.sql
git add snapshots/ && git commit -m "Final race-day snapshot"

npx wrangler pages project delete nycm-friendfinder
npx wrangler d1 delete nycm-friendfinder
```

The snapshot is plain SQL, so it loads into local SQLite, DuckDB or Postgres
for analysis later without any Cloudflare account at all.
