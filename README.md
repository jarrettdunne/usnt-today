# usnt.today

Which USMNT- and USWNT-eligible players play today, and where to watch them in the U.S.

This repo is the **Free lite** tier from the spec: no live data, post-match summaries only,
match data from football-data.org's free tier (12 competitions), hosted on Cloudflare Workers
free plan, with a Neon Postgres free database.

## Layout

| Path | What it is | Local URL |
| --- | --- | --- |
| `apps/site` | Public site, usnt.today (Astro 6 on Cloudflare Workers) | http://localhost:4321 |
| `apps/admin` | Admin site, admin.usnt.today: editor tools, site analytics, monitoring | http://localhost:4322 |
| `jobs` | Scheduled ingest Worker (cron), one adapter per data provider | http://localhost:8787 |
| `packages/db` | Schema, migrations and every SQL query, shared by all three | n/a |

Site analytics (traffic, revenue, costs, data health) live only in `apps/admin`.
Player stats are public content in `apps/site`. The two never share pages or tables.

## First-time setup (WSL2)

The short version. [SETUP.md](SETUP.md) covers each account (Neon, football-data.org,
Cloudflare Workers, the domain, Access) in detail, plus troubleshooting.

1. **Node 22.12+**: `nvm install 22 && nvm use 22` (Astro 6 requires Node 22.12.0 or newer).
2. **Install dependencies**: `npm install`
3. **Neon**: create a free project at neon.com and copy its connection string.
4. **football-data.org**: register for a free API token.
5. **Environment**: `cp .env.example .env`, fill in both values, then `npm run env:sync`.
6. **Database**: `npm run db:migrate` (creates tables and seeds the 12 free competitions).
7. **Import matches**: start the jobs Worker with `npm run dev:jobs`, then in a second terminal:
   ```bash
   curl "http://localhost:8787/__scheduled?cron=0+10+*+*+*"
   ```
   That runs the daily sync (3 days back, 6 days ahead) and a metrics snapshot.
8. **Import players**: `npm run squads:import` adds everyone football-data.org lists with U.S.
   nationality, as Eligible, at their current club (about 70 seconds; the hourly job keeps
   them current after that). Then `npm run dev:admin` and http://localhost:4322/players to
   review them and add dual nationals listed under other countries.
9. **Public site**: `npm run dev:site` and open http://localhost:4321.

## Scripts

Run every script from the repo root. Each name has the form `area:action`. Root scripts
pass work to the matching workspace with `-w`, so you never need to `cd` into an app to
run, build or deploy it. Scripts that touch the database or an API read the root `.env`.

**Local development**

| Command | What it does |
| --- | --- |
| `npm run env:sync` | Copies `.env` into each app's `.dev.vars`. Rerun it after every `.env` change. |
| `npm run dev:site` | Public site at http://localhost:4321 |
| `npm run dev:admin` | Admin site at http://localhost:4322 (login check bypassed) |
| `npm run dev:jobs` | Jobs Worker at http://localhost:8787. Trigger a cron with `curl "http://localhost:8787/__scheduled?cron=0+10+*+*+*"` |

**Database** (these use the `DATABASE_URL` in `.env`, which should be the Neon `dev` branch)

| Command | What it does |
| --- | --- |
| `npm run db:migrate` | Applies any migrations in `packages/db/migrations` that haven't run yet. Safe to rerun. |
| `npm run squads:import` | Imports every player football-data.org lists as U.S., for all 10 club competitions (about 70 s). Safe to rerun. |

**Checks** (neither needs an account or a database)

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc` for `packages/db` and `jobs`, `astro check` for both sites |
| `npm test` | Vitest. The query tests apply every migration to PGlite (Postgres in WASM), so a migration that fails to apply also fails the tests. |

**Build and deploy** (production; see [Deploying to Cloudflare](#deploying-to-cloudflare))

| Command | What it does |
| --- | --- |
| `npm run build` | Builds both sites without deploying. Useful for checking that a build passes; the deploy scripts build on their own. |
| `npm run deploy:jobs` | Deploys the jobs Worker. Its crons start right away. |
| `npm run deploy:site` | Builds and deploys the public site |
| `npm run deploy:admin` | Builds and deploys the admin site |

## Changing the database (dev to production)

Neon branches can't be merged, so you can't "push" the `dev` branch into `main`. Schema
changes move through **migration files**, which are applied to each branch separately.
Data doesn't move at all.

### Schema changes

1. **Write a migration.** Add a new file with the next number, e.g.
   `packages/db/migrations/0006_player_positions.sql`. Never edit or rename a migration
   that has already run anywhere. The runner tracks files by name in `schema_migrations`,
   so it silently skips an edited file on any database that already applied it.
2. **Test it:** run `npm test`.
3. **Apply it to dev:** run `npm run db:migrate`, then try the change locally.
4. **Commit** the migration together with the code that uses it.
5. **Apply it to production** with the `main` branch connection string:
   ```bash
   DATABASE_URL="<main branch connection string>" node packages/db/scripts/migrate.mjs
   ```
6. **Deploy:** `npm run deploy:jobs`, `deploy:site`, `deploy:admin`.

Production is migrated *before* the deploy, so for a few minutes the old code runs against
the new schema. Keep migrations backward-compatible: add tables, and add columns as
nullable or with a default. To drop or rename something, first ship code that stops using
it, then remove it in a later migration.

There are no "down" migrations. To undo one, write a new migration that reverses it. If data
is lost, Neon's branch restore can roll a branch back to an earlier point in time. The free
plan keeps only a short history window, so check how far back yours goes.

### Data

- **Rows you create locally stay on `dev`**, including test players, edits and imports.
  Enter real editorial data, such as dual nationals, in the production admin.
- **Reference data every environment needs** belongs in a migration, the way
  `0002_seed_competitions.sql` adds the competitions.
- **To refresh `dev` with production data:** Neon dashboard > Branches > `dev` > **Reset
  from parent**. This throws away everything on `dev`. Afterwards, run `npm run db:migrate`
  to reapply any migrations that haven't reached production yet.

## Deploying to Cloudflare

```bash
npx wrangler login
# Secrets, once per Worker (run inside each folder):
cd jobs       && npx wrangler secret put DATABASE_URL && npx wrangler secret put FOOTBALL_DATA_TOKEN && cd ..
cd apps/site  && npx wrangler secret put DATABASE_URL && cd ../..
cd apps/admin && npx wrangler secret put DATABASE_URL && cd ../..

npm run deploy:jobs
npm run deploy:site
npm run deploy:admin
```

- **Site**: available on its workers.dev address until the domain is bought; then uncomment
  the `routes` entry in `apps/site/wrangler.jsonc`.
- **Admin**: has `workers_dev` turned off, so it is only reachable through
  `admin.usnt.today` once that custom domain exists. Until then, run it locally against
  the production database.

### Protecting the admin site

1. Cloudflare dashboard > Zero Trust > Access > Applications > add a self-hosted app
   for `admin.usnt.today` and allow only your own email(s).
2. Copy the team domain (e.g. `yourteam.cloudflareaccess.com`) and the application's
   AUD tag into `vars` in `apps/admin/wrangler.jsonc`.
3. Redeploy the admin. Every request is checked against the Access token; without a
   valid one it returns 403. `ADMIN_DEV_BYPASS="true"` only exists in local `.dev.vars`.

## Free-tier limits this code is built around

- **Workers free plan**: 10 ms CPU per request and 50 subrequests per invocation.
  Each sync uses about 4 subrequests (one API call, batched SQL).
- **Database load**: public pages are cached at the edge for 5 minutes (Cache API in
  `apps/site/src/middleware.ts`), so Neon's free compute isn't hit on every visit.
  The Cache API does nothing on workers.dev addresses, only on a custom domain.
- **football-data.org free**: 10 calls a minute, delayed scores, no lineups. The jobs
  make about 73 calls a day: one daily window sync, one recent sync every 30 minutes,
  and one squad sync an hour (rotating through the 10 club competitions).
- **Attribution**: the site footer credits football-data.org.
- **Corrections form**: 3 submissions a minute per visitor (the `CORRECTIONS_LIMITER` rate-limit
  binding in `apps/site/wrangler.jsonc`) and 30 an hour across everyone, so a flood can't fill
  the free database.

## Moving up a tier

The Lite + live data tier swaps in API-Football. Add `jobs/src/providers/api-football`,
change the provider in `jobs/src/index.ts`, and add the lineup and live-score jobs.
Pages, admin and the database schema (including `appearances` for starter/bench/injury
counts) already support it.

## Known simplifications

- Days are grouped in U.S. Eastern time; kickoff times display in each visitor's local time.
- **Players (Free lite):** anyone in a club squad that football-data.org lists as `USA` /
  `United States` is imported as Eligible. Dual nationals listed under another country, and
  players in leagues outside the free tier (MLS, NWSL), are added by hand. A club an editor
  sets is never overwritten by the import. A paid provider can apply a stricter rule by
  implementing `SquadProvider` (`jobs/src/providers/types.ts`).
- A player's club is their *current* club, so past days reflect today's club, not the club
  they played for then.
- Kickoff times football-data.org hasn't confirmed (its `SCHEDULED` status) show as
  "time to be confirmed", and calendar feeds list them as all-day events.
- A match the daily sync stops returning inside its window (usually rescheduled further out)
  is hidden from the site until a later sync finds it again. The admin dashboard counts these.
- Ads: `AdSlot` reserves space but renders nothing in production until
  `PUBLIC_ADS_ENABLED=true` is set at build time and the slot is filled.
