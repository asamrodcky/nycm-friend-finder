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

## API

All routes need `Authorization: Bearer <token>` except `POST /api/auth`.
Reads hit views only; the API never touches a base table.

| Route | Method | Purpose |
|---|---|---|
| `/api/auth` | POST | `{passcode}` -> `{token}`. HMAC-signed expiry stamp, 30-day TTL |
| `/api/meta` | GET | Seeded dimensions + departure slots, for the form dropdowns |
| `/api/runners` | GET | The whole roster, one shot; the page filters client side |
| `/api/runners` | POST | Create (no `runner_key`) or update (with one) |
| `/api/runners/:key` | DELETE | Soft delete -- supersedes the live row, keeps history |
| `/api/meetups` | GET | The four match tiers plus the gap list |

Entries are keyed by `runner_key`, not bib number: bibs are optional and
some people genuinely do not have one yet.

The passcode itself never reaches browser storage. `POST /api/auth`
exchanges it for a signed token, and that is what sits in `localStorage`.
Stateless, so there is no session table to clean up at teardown.

## Data model

A **star schema**, because the point of this project is to practise one.

```
              dim_color ──┐
              dim_wave  ──┤
              dim_corral──┼──> fct_runner_start <── dim_runner
          dim_transport ──┘
```

`fct_runner_start` is a **factless fact table** — it has no additive
measures. It exists to record that a runner *is assigned* to a color, wave,
corral and transport plan. Kimball's coverage/event pattern; `COUNT(*)` is
the only measure available, which is the point.

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

## Deploy

```bash
npx wrangler login
npx wrangler d1 create nycm-friendfinder          # paste the id into wrangler.toml
npx wrangler d1 migrations apply nycm-friendfinder --remote
npx wrangler pages project create nycm-friendfinder
npx wrangler pages secret put GROUP_PASSCODE --project-name nycm-friendfinder
npx wrangler pages secret put TOKEN_SECRET   --project-name nycm-friendfinder
npx wrangler pages deploy public
```

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
