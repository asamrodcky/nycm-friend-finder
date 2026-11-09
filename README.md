# NYCM Friend Finder

**A tool that helped 73 runners find each other at the start of the 2026 TCS New York City Marathon.**

[**Live demo →**](https://nycm26friendfinder.com) · no login, read-only, real anonymised data

---

New York has the most complicated start logistics of any major marathon. 50,000 runners
are sorted into three colours, five waves and a dozen corrals, spread across Staten
Island, and sent over the Verrazzano in groups two hours apart. Someone you know can be
on the same ferry, in the same wave, even the same corral — and you will never find out,
because there is no way to see anyone else's start assignment.

This app was that way. People entered their colour, wave, corral and how they were
getting to Fort Wadsworth; it computed who overlapped with whom and ranked the overlaps
by how much of the morning you would actually spend within reach of each other.

It ran for 17 days, from first signup to race morning.

## What happened

| | |
|---|---|
| People who signed up | **73** |
| Live start assignments | 69 |
| People who followed someone | 50 follow relationships |
| People who came back and edited their entry | **18**, producing 98 versioned rows |
| Complete profiles | 63 of 69 |
| Signup window | 15 Oct – 1 Nov 2026 |

The number that taught me the most was a worse one. Mid-week, Cloudflare reported **423
unique visitors against 36 signups — 8.5%**. The app was not broken. The roster endpoint
required a profile, so roughly 390 people were asked to invent a PIN *before* being shown
a single reason to, and never learned that 56 people were already inside. Three changes
came out of that diagnosis: an explanation placed ahead of the ask, a shareable invite
link, and filters that stopped eating the whole screen on a phone.

That is the thing this project is actually about — not the stack.

## Try it

The live site is a **read-only demo of a finished race**. Identities were removed
afterwards; the structure was not. Every timestamp, every superseded row, every follow
relationship and all the real mess — the two accidental duplicate accounts, the four
people who removed themselves, the 68% who left the outfit field blank — is exactly as
people left it.

Names read `Runner 017` rather than a plausible fake, deliberately: an obvious alias says
*this was anonymised*, where an invented name says nothing.

## Run it locally

No Cloudflare account needed.

```bash
npm install
npm run db:migrate:local     # schema + seeded reference data, empty roster
npm run dev                  # http://localhost:8788
```

Local secrets live in `.dev.vars` (gitignored). Handy while poking around:

```bash
npm run db:q "SELECT * FROM v_runner_start"   # query the local database
npm run db:reset:local                        # wipe and rebuild
```

## How it is built

| | |
|---|---|
| Hosting | Cloudflare Pages |
| Database | Cloudflare D1 (SQLite) |
| API | TypeScript Pages Functions |
| Frontend | HTML, CSS and vanilla JS — **no build step, no framework, no dependencies** |
| Cost to run | $0 |

No build step was a constraint I set on purpose. Every file in `public/` is served
exactly as written, so what you read in the repo is what ran in production.

```
functions/api/      12 route handlers (TypeScript)
lib/                auth, validation, HTTP helpers — shared by the routes
public/             the whole frontend: 2 pages, 5 ES modules, 1 stylesheet
migrations/         10 migrations, applied in order, never edited after shipping
sql/                ad-hoc analysis queries
scripts/            snapshot/export tooling with drift guards
snapshots/          a loadable anonymised export of the real data
```

### The data model

A **star schema**, chosen because the project was partly an excuse to build one properly.

```
dim_color ──┐
dim_wave  ──┤
dim_corral──┼──> fct_runner_start <── dim_runner ──┐
dim_transport┘          │                    ▲     │
                        │                    └─────┘
              fct_spectator_mile      fct_runner_saved
                                    (bridge: runner → runner)
```

Both fact tables are **factless** — neither has an additive measure. `fct_runner_start`
records that a runner *is assigned* to a colour, wave, corral and transport plan;
`fct_runner_saved` records only that one person wants to find another. `COUNT(*)` is the
only measure either offers, which is the point.

`fct_runner_start` is **insert-only**. An edit supersedes the previous row
(`is_current = 0`, `valid_to_utc` stamped) rather than updating it, so the data records
who changed wave and when — 29 superseded rows survive from 18 people who came back.

**All reads go through views.** The API never touches a base table and never writes
`WHERE is_current = 1`; nine views carry that.

**→ [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)** has the rendered ERD, a table-by-table
dictionary, grain statements and the reasoning behind each modelling decision.

### API surface

| Route | Method | Needs | Purpose |
|---|---|---|---|
| `/api/mode` | GET | — | Is this deployment a read-only demo? |
| `/api/auth` | POST | — | `{passcode}` → group token |
| `/api/meta` | GET | group | Seeded dimensions, for the form dropdowns |
| `/api/invite` | GET | group | Mints a shareable link, server-side |
| `/api/profile/unclaimed` | GET | group | The "already on the roster?" picker |
| `/api/profile/claim` | POST | group | Claim an imported row, set a PIN |
| `/api/profile/onboard` | POST | group | New person: row + PIN + first assignment |
| `/api/profile/signin` | POST | group | Bib-or-name + PIN → profile token |
| `/api/runners` | GET | profile | The whole roster |
| `/api/runners/me` | POST / DELETE | profile | Edit or remove my own entry |
| `/api/saved` | GET / POST / DELETE | profile | Who I follow, and how we overlap |
| `/api/meetups` | GET | profile | Discovery tiers plus the gap list |

**There is no route for editing someone else's entry.** The runner key comes from the
signed token, never the request body.

### Access model

Two tokens, answering different questions. A **group** token comes from the shared
passcode and unlocks onboarding; a **profile** token comes from a PIN and unlocks the
roster. Both are HMAC-signed expiry stamps — stateless, with no session table to clean up.

The PIN is **identity, not security**: it answers *"this is my new phone, re-attach me to
my row"*, because `localStorage` does not travel between a laptop and a phone. It is
hashed with PBKDF2-SHA256 and a per-runner salt, because snapshots get exported and
people reuse PINs — but a 6-digit PIN behind a shared passcode is not a security boundary
and the app never pretended otherwise.

The shared passcode was **"unlisted, not private"** by design, the same posture as a link-
shared document. That was a deliberate trade for a tool helping friends find each other
on one specific morning, and it is written up honestly rather than dressed up.

## After the race

The app stopped being useful on 1 November. The data did not stop being exposed.

A display name plus a bib number is a lookup key: race results are public, so the pair
yields a finish time, splits, an age group, a hometown and photographs. Migration `0010`
removed every name, bib, handle, free-text note and password hash from the live database
in place, keeping all structure and history. The real roster lives encrypted, offline.

The write-up of that assessment — what was exposed, what the risk chain actually was, and
why anonymising in place beat keeping real data behind alias columns — is in the
engineering log below.

## Reading further

[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) is the ERD and data dictionary — start there
if you care about the modelling.

[`project_notes_public.md`](project_notes_public.md) is the **raw engineering log** —
chronological, around 25,000 words, written as working notes rather than as a document.
Every decision with its reasoning, including the ones that turned out wrong and got
reversed. It is long on purpose; skim the headings and read what looks interesting.

`sql/` holds the ad-hoc analysis queries, and `snapshots/nycm2026-anon.sql` loads the
anonymised dataset into SQLite, DuckDB or Postgres as-is if you want to poke at it:

```bash
sqlite3 nycm.db < snapshots/nycm2026-anon.sql
```

## A note on how this was built

I built this in a pair-programming loop with Claude (Anthropic's AI assistant), and the
engineering log is a record of that collaboration — which is why it reads like a
conversation with the reasoning left in.

I am flagging it because the alternative is letting someone wonder. The architecture
decisions, the product calls and the diagnosis work were mine; a great deal of the
implementation, and much of the adversarial "what breaks this" pressure, was not. The
honest summary is that it let one person ship and maintain more than one person normally
would in 17 days, and that the parts I am proudest of — the funnel diagnosis, the
decision to anonymise in place, the insert-only fact table — are decisions rather than
code.

## Licence

MIT. See [`LICENSE`](LICENSE).
