# Setup guide

Every account, key and setting usnt.today needs, in the order to set them up. The
[README](README.md) has the short version; this is the detailed one.

| Service | What it's for | Plan | Needed for |
| --- | --- | --- | --- |
| [Node.js](#1-nodejs) | Running everything locally | n/a | Everything |
| [Neon](#2-neon-postgres) | The Postgres database | Free | Local dev and production |
| [football-data.org](#3-football-dataorg-match-data) | Fixtures and results | Free | Importing matches |
| [Cloudflare Workers](#4-cloudflare-workers) | Hosting the site, admin and jobs | Free | Production only |
| [Domain on Cloudflare](#5-custom-domain) | usnt.today and admin.usnt.today | Paid domain | Edge caching, the admin site |
| [Cloudflare Access](#6-cloudflare-access-admin-login) | Login for the admin site | Zero Trust free | The admin site in production |

Local development needs only sections 1 to 3 and [7](#7-local-development). Cloudflare
comes in when you deploy.

---

## 1. Node.js

Astro 6 needs Node 22.12 or newer. The repo pins 22 in `.nvmrc`.

```bash
nvm install 22
nvm use 22
node -v        # v22.12.0 or newer
npm install    # from the repo root; installs every workspace
```

npm may say it skipped install scripts (for `esbuild`, `workerd` and `sharp`). The tools
used here work without them. Run `npm install-scripts ls` to see what was skipped.

---

## 2. Neon (Postgres)

### Create the project

1. Sign up at [neon.com](https://neon.com) and create a project.
2. **Region:** pick a U.S. East region (e.g. AWS `us-east-1` or `us-east-2`). Visitors are
   mostly in the U.S., and Workers run close to them, so every query crosses that distance.
3. **Postgres version:** the newest one offered. The migrations use nothing version-specific.

### Get the connection string

Neon dashboard > your project > **Connect**. Copy the string, which looks like:

```
postgresql://USER:PASSWORD@ep-something-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

- Keep `?sslmode=require` on the end.
- The **pooled** and **direct** strings both work for the apps, since the Neon driver
  connects over HTTPS either way. For `npm run db:migrate`, which uses a normal Postgres
  connection and runs each migration in a transaction, the **direct** string is the safer
  choice.
- The string contains the password. It goes in `.env` (git ignores it) and in Cloudflare
  secrets, nowhere else.

### Use a separate branch for development (recommended)

Without this, local dev and production share one database, and anything you do locally
(test players, migrations) happens in production right away.

1. Neon dashboard > **Branches** > **Create branch**, named e.g. `dev`, from `main`.
2. Use the `dev` branch's connection string in your local `.env`.
3. Use the `main` branch's string only for the Cloudflare secrets and production migrations.

Branches are copy-on-write, so a new one is instant and starts with production's data. To
start over, reset the branch from `main` in the dashboard.

### Free plan behavior to know about

- **Scale to zero:** compute suspends after a few minutes idle, and the next query wakes it
  (usually well under a second). The site's 5-minute edge cache hides most of this from
  visitors once the custom domain is live.
- **Storage and compute hours are capped.** Check Neon's pricing page for current numbers.
  The corrections form's rate limits exist so spam can't use up the storage.

### Create the tables

With `DATABASE_URL` in `.env` (see [section 7](#7-local-development)):

```bash
npm run db:migrate
```

This applies every file in `packages/db/migrations` that hasn't run yet, in name order, and
records each one in `schema_migrations`. Running it again does nothing. The first run also
adds the 12 free-tier competitions.

**To migrate production**, pass its URL directly. The npm script loads `.env`, which holds
your dev URL:

```bash
DATABASE_URL="<main branch connection string>" node packages/db/scripts/migrate.mjs
```

Always migrate production **before** deploying code that needs the new schema.

---

## 3. football-data.org (match data)

1. Register at [football-data.org/client/register](https://www.football-data.org/client/register).
   Your API token is shown on your account page (and emailed to you).
2. Put it in `.env` as `FOOTBALL_DATA_TOKEN`.
3. Check that it works:

   ```bash
   curl -s -H "X-Auth-Token: YOUR_TOKEN" \
     "https://api.football-data.org/v4/matches?competitions=PL" | head -c 400
   ```

   A JSON body with `"matches"` means the token works. `403` usually means the token is
   wrong or the competition isn't in your plan.

### Free tier limits

- **12 competitions:** PL, ELC, BL1, SA, PD, FL1, DED, PPL, BSA, CL, EC, WC. No MLS, NWSL
  or women's leagues, so the Women pool has almost nothing to show on this tier.
- **10 requests a minute.** The jobs make about 73 a day (one window sync daily, one
  recent sync every 30 minutes, one squad sync an hour), one request each.
- **Squads are included**, with one nationality per player. That's what the player import
  uses (see [section 7](#first-run)).
- **Date ranges of up to 10 days** per request, which is why the daily sync covers 3 days
  back to 6 days ahead.
- **Scores are delayed**, and there are no lineups.
- **Attribution is required.** The site footer already credits football-data.org.

The token only goes to the **jobs** Worker. The site and admin never call the API.

---

## 4. Cloudflare Workers

Three Workers, each deployed from its own folder:

| Worker | Folder | Public URL | Secrets |
| --- | --- | --- | --- |
| `usnt-site` | `apps/site` | workers.dev until the domain exists | `DATABASE_URL` |
| `usnt-admin` | `apps/admin` | None (`workers_dev: false`); only `admin.usnt.today` | `DATABASE_URL` |
| `usnt-jobs` | `jobs` | None; runs on cron only | `DATABASE_URL`, `FOOTBALL_DATA_TOKEN` |

### Account and login

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com). The Workers **Free** plan
   is enough.
2. Workers & Pages > pick a **workers.dev subdomain** (e.g. `yourname.workers.dev`).
3. Log in from the terminal:

   ```bash
   npx wrangler login
   npx wrangler whoami   # confirms the account
   ```

   On WSL2, if no browser opens, copy the printed URL into your Windows browser. The
   callback goes to `localhost`, which WSL2 forwards.

### Secrets

Set once per Worker, from inside its folder. Each command prompts for the value, so it
stays out of your shell history. Use the **production** (`main` branch) Neon URL.

```bash
cd jobs       && npx wrangler secret put DATABASE_URL && npx wrangler secret put FOOTBALL_DATA_TOKEN && cd ..
cd apps/site  && npx wrangler secret put DATABASE_URL && cd ../..
cd apps/admin && npx wrangler secret put DATABASE_URL && cd ../..
```

`npx wrangler secret list` (in a folder) shows which secrets are set, without values.

### Deploy

Order matters the first time and whenever a release includes a migration:

```bash
DATABASE_URL="<production url>" node packages/db/scripts/migrate.mjs   # 1. schema first
npm run deploy:jobs                                                    # 2. starts importing
npm run deploy:site                                                    # 3. public site
npm run deploy:admin                                                   # 4. after section 6
# 5. First players, instead of waiting ~10 hours for the hourly job to cover every competition:
DATABASE_URL="<production url>" FOOTBALL_DATA_TOKEN="<token>" npx tsx jobs/scripts/import-squads.ts
```

What to expect:

- **Jobs:** the cron triggers in `jobs/wrangler.jsonc` start on their own: daily at 10:00
  UTC (about 6 a.m. Eastern) and every 30 minutes. The 30-minute sync only covers yesterday
  and today, so the full 10-day window first arrives at the next 10:00 UTC run. To fill it
  sooner, run the daily sync once from your machine against production: temporarily put
  the production URL in `jobs/.dev.vars`, run `npm run dev:jobs` and the `curl` from
  [section 7](#first-run), then run `npm run env:sync` to switch back to the dev branch.
- **Site:** the first deploy should create a KV namespace for the `SESSION` binding. The
  Astro Cloudflare adapter adds that binding; this app doesn't use sessions, and an unused
  namespace costs nothing.
- **Rate limiting:** the corrections form uses the `CORRECTIONS_LIMITER` binding
  (`apps/site/wrangler.jsonc`, 3 per minute per visitor). `namespace_id` (`"1001"`) only
  has to be unique among rate limiters in your Cloudflare account; change it if another
  Worker already uses 1001. If the binding is ever missing, the form still works, and the
  hourly cap in the database (30 an hour) is the backstop.

### Free plan limits the code is built around

- **10 ms CPU per request.** Pages are plain server-rendered HTML; the database does the
  heavy work.
- **50 subrequests per invocation.** A sync uses about 4 (one API call and a few batched
  queries).
- **The Cache API only works on a custom domain.** On workers.dev, every page view queries
  Neon.

### Logs

`observability` is on for all three Workers: dashboard > Workers > a Worker > **Logs**.
For a live stream: `npx wrangler tail usnt-jobs` (or `usnt-site`, `usnt-admin`).

---

## 5. Custom domain

Needed for edge caching (section 4) and for the admin site, which has no workers.dev
address.

1. Buy `usnt.today` from any registrar, or through Cloudflare Registrar.
2. Cloudflare dashboard > **Add a domain**, then switch the domain's nameservers at the
   registrar to the two Cloudflare gives you. Wait until the dashboard says the domain is
   active (minutes to hours).
3. Uncomment the routes:

   ```jsonc
   // apps/site/wrangler.jsonc
   "routes": [{ "pattern": "usnt.today", "custom_domain": true }]

   // apps/admin/wrangler.jsonc
   "routes": [{ "pattern": "admin.usnt.today", "custom_domain": true }],
   ```

4. Redeploy both. Wrangler creates the DNS records and certificates for you.

---

## 6. Cloudflare Access (admin login)

The admin site checks every request for a valid Cloudflare Access token
(`apps/admin/src/middleware.ts`) and returns 403 without one. Set this up **before**
deploying the admin.

1. Cloudflare dashboard > **Zero Trust**. The first time, pick a team name (this becomes
   `yourteam.cloudflareaccess.com`) and the **Free** plan (up to 50 users). Cloudflare may
   ask for a payment method even on the free plan.
2. Zero Trust > **Access** > **Applications** > **Add an application** > **Self-hosted**.
   - Domain: `admin.usnt.today`
   - Policy: **Allow**, with an **Emails** rule listing only the editors' addresses.
   - Login method: the default one-time PIN by email is fine.
3. Open the application's overview and copy the **Application Audience (AUD) Tag**.
4. Fill in `vars` in `apps/admin/wrangler.jsonc`:

   ```jsonc
   "vars": {
     "ACCESS_TEAM_DOMAIN": "yourteam.cloudflareaccess.com",   // no https://
     "ACCESS_AUD": "<the AUD tag>",
     "ADMIN_DEV_BYPASS": "false"
   }
   ```

   Neither value is secret, so they can live in the repo.

5. `npm run deploy:admin`, then open `https://admin.usnt.today`. You should get the Access
   login, and after it, the dashboard.

**Never set `ADMIN_DEV_BYPASS` to `"true"` in `wrangler.jsonc`.** It turns the login check
off. It's only meant for the local `apps/admin/.dev.vars`, which `npm run env:sync` writes.

If you see "Forbidden. Sign in through Cloudflare Access." after logging in, the AUD tag
or team domain doesn't match the application. Re-copy both and redeploy.

---

## 7. Local development

### Environment files

Settings for local dev live in one place, the root `.env`:

```bash
cp .env.example .env
# Fill in DATABASE_URL (Neon dev branch) and FOOTBALL_DATA_TOKEN
npm run env:sync
```

`env:sync` copies them into each Worker's `.dev.vars`, which `wrangler dev` and `astro dev`
read:

| File | Contents |
| --- | --- |
| `apps/site/.dev.vars` | `DATABASE_URL` |
| `apps/admin/.dev.vars` | `DATABASE_URL`, `ADMIN_DEV_BYPASS="true"` |
| `jobs/.dev.vars` | `DATABASE_URL`, `FOOTBALL_DATA_TOKEN` |

`.env` and `.dev.vars` are git-ignored. Rerun `env:sync` whenever you change `.env`.

### First run

```bash
npm run db:migrate                      # tables and competitions
npm run dev:jobs                        # terminal 1: jobs Worker on :8787
curl "http://localhost:8787/__scheduled?cron=0+10+*+*+*"   # terminal 2: daily sync + metrics
npm run squads:import                   # players listed as U.S. nationals, ~70 seconds
npm run dev:admin                       # http://localhost:4322: review players, add dual nationals
npm run dev:site                        # http://localhost:4321
```

The `cron` value must match one of the schedules in `jobs/src/index.ts`. The other one is
`cron=*/30+*+*+*+*` (the recent-results sync).

Clubs show up in the admin's player form only after the first sync, because teams come
from match and squad data.

The jobs Worker also syncs one competition's squads each hour (`cron=15+*+*+*+*`), so
after the first import, new U.S. players and club moves are picked up within about a day.
`squads:import` runs all 10 competitions at once and is safe to rerun.

### Checks

```bash
npm run typecheck   # needs no accounts
npm test            # needs no accounts; database tests use an in-memory Postgres
```

---

## 8. Optional

- **Traffic:** Cloudflare Web Analytics (dashboard > Analytics & Logs > Web Analytics) is
  free and cookieless. Add the site, and include the snippet in
  `apps/site/src/layouts/Base.astro`.
- **Ads:** `AdSlot` renders nothing until the site is built with `PUBLIC_ADS_ENABLED=true`
  and each slot is filled in. Locally, it shows a placeholder box.
- **API-Football (paid tier):** see "Moving up a tier" in the README. It needs an
  `API_FOOTBALL_KEY` secret on the jobs Worker, plus an implementation of
  `jobs/src/providers/api-football`.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `DATABASE_URL is not set` | `.env` missing or still has the `USER:PASSWORD` placeholder. Fill it in and rerun `npm run env:sync`. |
| Pages error with `column "kickoff_confirmed" does not exist` | Code is newer than the database. Run the migration against that database. |
| Jobs log `football-data.org returned 403` | Wrong token, or a competition outside the free plan. |
| Jobs log `returned 429` | Over 10 calls a minute, usually from triggering syncs by hand repeatedly. Wait a minute. |
| Admin dashboard says fixtures haven't refreshed in 26 hours | Cron isn't running or is failing. Check `usnt-jobs` logs and the "Recent job runs" table. |
| A job shows "Didn't finish" | The invocation was cut off (e.g. by the CPU limit) before recording its result. Check the logs from that time. |
| Admin returns 403 in production | Access isn't in front of the domain, or the `ACCESS_*` vars don't match the application. |
| Every site page hits the database | You're on workers.dev, where the Cache API does nothing. It starts working on the custom domain. |
