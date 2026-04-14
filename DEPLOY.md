# Deploy Runbook

Last updated: 2026-04-14 (v5 model + injury signal in v5+v4-spread + scraper hardening)

## Topology

| Component | Host | Deploy Path |
|-----------|------|-------------|
| Frontend (static SPA) | Cloudflare Pages — `sportsdata.pages.dev` | GitHub Actions → wrangler (`deploy-pages.yml`) |
| API (Node + SQLite) | Fly.io DFW — `sportsdata-api.fly.dev` | GitHub Actions → flyctl (`deploy-fly.yml`) |
| Cron workflows | GitHub Actions | YAML-defined schedules |

**Push-to-main ships both.** Frontend path changes trigger `deploy-pages.yml`; API path changes (`src/**`, `Dockerfile`, `fly.toml`, `package*.json`) trigger `deploy-fly.yml`. Manual `fly deploy` from a terminal is still supported as a fallback — see "Deploying the API" below.

## Live URLs

- **Frontend:** https://sportsdata.pages.dev
- **API:** https://sportsdata-api.fly.dev
- **Health:** https://sportsdata-api.fly.dev/api/health

## GitHub Actions Secrets (REQUIRED)

The Cloudflare Pages deploy workflow (`.github/workflows/deploy-pages.yml`) needs these secrets. If they are missing, every deploy fails silently with a 31-second exit. This already happened once (Sprint 6 through Sprint 10) and went unnoticed for four days because the live site kept serving stale content from an unknown fallback path.

```
gh secret list
```

Required:

| Secret | Purpose | Where to get it |
|--------|---------|-----------------|
| `CLOUDFLARE_API_TOKEN` | wrangler auth (Pages deploy) | https://dash.cloudflare.com/profile/api-tokens — custom token with `Pages:Edit` scope |
| `CLOUDFLARE_ACCOUNT_ID` | target Pages project | Cloudflare dashboard → any zone → right sidebar |
| `FLY_API_TOKEN` | flyctl auth (Fly API deploy) | https://fly.io/user/personal_access_tokens — scope to `sportsdata-api` app |
| `PREDICT_TRIGGER_TOKEN` | bearer auth on `/api/trigger/predict` + `/api/trigger/scrape` | any random hex string, also set in Fly env |

Set via:
```
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set FLY_API_TOKEN
```

## Deploying the Frontend

### Automatic (preferred)

Push to `main` with changes under `web/`, `vite.config.ts`, or `package.json` → the `Deploy Frontend to Cloudflare Pages` workflow runs automatically.

```
git push origin main
gh run watch            # follow the most recent run
```

### Manual re-run

If a push happened without a deploy (e.g. secrets were just added), or a deploy failed and you fixed the cause:

```
gh run list --workflow=deploy-pages.yml --limit 5
gh run rerun <run-id>
gh run watch <run-id>
```

**Note:** the workflow does NOT have a `workflow_dispatch` trigger, so you cannot run it from a clean state — you need an existing run to rerun.

### Verify live

```
curl -s -o /dev/null -w "pages: %{http_code}\n" https://sportsdata.pages.dev/
curl -s https://sportsdata.pages.dev/ | grep -oE "Does the model mean|Best and worst 5"
```

If the expected Sprint content is missing, the deploy didn't work — check `gh run list` for a recent failure.

## Deploying the API (Fly.io)

### Automatic (preferred — Sprint 10.6)

Push to `main` with changes under `src/**`, `Dockerfile`, `fly.toml`, or `package*.json` → the `Deploy API to Fly.io` workflow runs `flyctl deploy --remote-only`, which builds the image on Fly's infrastructure (no local Docker required).

```
git push origin main
gh run list --workflow=deploy-fly.yml --limit 1
gh run watch <run-id>
```

The workflow also includes a post-deploy curl against `/api/health` that retries up to 5× over ~25 seconds, so the job stays red if the new machine isn't serving traffic.

### Manual fallback

Still supported for one-off deploys, rollbacks from a clean state, or when `FLY_API_TOKEN` isn't configured:

```
~/.fly/bin/fly auth whoami            # confirm authed
~/.fly/bin/fly deploy                 # builds Docker image locally, pushes, rolls the machine
```

Typical deploy time: 60-90 seconds. The build pushes ~200 MB of image layers. Fly does a smoke check and health check before marking the machine `good`.

### Verify live

```
curl -s -o /dev/null -w "api: %{http_code}\n" https://sportsdata-api.fly.dev/api/health
curl -s https://sportsdata-api.fly.dev/api/health | python3 -m json.tool
```

The `/api/health` response now includes a `last_scrape_at` field (MAX of `games.updated_at`). **If `last_scrape_at` is more than 24 hours old while the `predict-cron` is green, the scrape→resolve pipeline is broken** — that's exactly the failure mode that caused Sprint 10.6. Add this to your on-call / weekly-check ritual.

Spot-check endpoints:
```
curl -s https://sportsdata-api.fly.dev/api/predictions/calibration?sport=nba | python3 -m json.tool | head
curl -s https://sportsdata-api.fly.dev/api/spread-picks/upcoming?sport=nba | python3 -m json.tool | head
curl -s https://sportsdata-api.fly.dev/api/spread-picks/track-record?sport=nba | python3 -m json.tool
```

### Spread model (v4-spread)

The API generates spread predictions alongside v2 winner predictions when `/api/trigger/predict` is called. Spread picks require odds data on the game (`odds_json IS NOT NULL`). The cron handles this automatically: `/api/trigger/scrape` writes odds to games via `writeOddsToGames()`, then `/api/trigger/predict` generates both v2 and v4-spread predictions.

**If spread picks are empty**, check:
1. Does `/api/health` show `last_scrape_at` within 24h? (scrape pipeline working)
2. Do games have odds data? `curl .../api/games?sport=nba | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for g in d if g.get('odds_json')))"` — should be > 0
3. Is `THE_ODDS_API_KEY` set on Fly? `~/.fly/bin/fly secrets list` — odds scraper is skipped without it

### Manually trigger a scrape + resolver sweep

Use after deploying scraper fixes, or any time you see stale data on the site. Default window is today + 3 prior days; override with `?backfillDays=N` up to 14.

```
curl -sSf -X POST "https://sportsdata-api.fly.dev/api/trigger/scrape?sport=nba&backfillDays=7" \
  -H "Authorization: Bearer $PREDICT_TRIGGER_TOKEN" | python3 -m json.tool
```

The endpoint runs `scheduler.runCycle()` — ESPN teams + scoreboard per day in the window + odds (if enabled) + `resolveGameOutcomes()` — and returns per-sport `{ teams, games }` counts. Idempotent: upserts are keyed on natural keys, so re-running is safe.

### Rollback

```
~/.fly/bin/fly releases                        # list versions
~/.fly/bin/fly releases rollback <version>     # preferred: rollback to a prior version
# or, if you need to pin a specific image:
~/.fly/bin/fly machine update <machine-id> --image registry.fly.io/sportsdata-api:deployment-<tag>
```

`fly deploy --image` is not a valid flag; don't use it.

## Verification ritual (after any deploy)

Always run this short sequence and paste the output into the PRD before marking a sprint complete:

```bash
# 1. Commit landed on main
git log --oneline -1

# 2. GH Actions deploy green
gh run list --workflow=deploy-pages.yml --limit 1

# 3. Pages serving new content (grep for something from this sprint)
curl -s https://sportsdata.pages.dev/ | grep -oE "<your-new-headline-here>"

# 4. API reachable + returns expected shape
curl -s -o /dev/null -w "%{http_code}\n" https://sportsdata-api.fly.dev/api/health

# 5. (If API changed) new endpoint responds
curl -s https://sportsdata-api.fly.dev/api/<your-new-route> | python3 -m json.tool | head
```

**If any step fails, the sprint is not shipped — even if the commit is on main.**

## Local dev

```
npm run dev        # vite dev server on :4000
npm run api        # data API on :3001 (set SQLITE_PATH if needed)
npm run viz        # both of the above in parallel
```

For local screenshots against real data:
```
VITE_API_URL=http://localhost:3001 npx vite build
npx vite preview --port 4173
```

## Cron workflows

One scheduled workflow runs in GitHub Actions:

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `predict-cron.yml` | 05:00 + 22:00 UTC | Hit `/api/trigger/scrape` (rolling 3-day backfill + resolver) then `/api/trigger/predict` |

The old `scrape-cron.yml` was removed in Sprint 10.6 — it had been dead since day one because it hit a nonexistent `/api/trigger-cycle` route behind `continue-on-error: true`, so its failures were invisible. `predict-cron` now covers both scrape and predict in sequence and its failures fail the workflow loudly (no more `|| echo "non-fatal"`).

**Check cron health:**
```
gh run list --workflow=predict-cron.yml --limit 5
```

Any run older than 36 hours or marked `failure` needs investigation. Cross-check with `/api/health`'s `last_scrape_at` field — if the cron is green but `last_scrape_at` is stale, the scrape *ran* but wrote zero rows (ESPN schema drift, empty scoreboard, etc.). The `predict-cron` uses `PREDICT_TRIGGER_TOKEN` (GH secret) to hit `/api/trigger/scrape` + `/api/trigger/predict` on the Fly API — that token must ALSO be set on Fly:

```
~/.fly/bin/fly secrets list
~/.fly/bin/fly secrets set PREDICT_TRIGGER_TOKEN=<hex>
```

The token must match between GH Actions and Fly, otherwise the cron 401s.

## SQLite volume (Fly)

The API uses SQLite at `/app/data/sqlite/sportsdata.db`, mounted from the Fly volume `sportsdata_vol` defined in `fly.toml`. This is the single source of truth for games, predictions, player stats, injury history, and scrape history. **If this volume is lost, you lose 21,516 games + 12,813 backfilled predictions + all injury/scrape history.** Daily SQLite backup to GitHub Releases (3am UTC, 7-day retention) provides the recovery path — see `.github/workflows/backup-db.yml`.

**Inspect:**
```
~/.fly/bin/fly volumes list
~/.fly/bin/fly ssh console -C "ls -lah /app/data/sqlite"
```

**Manual backup (until automated backup is wired up):**
```
~/.fly/bin/fly ssh console -C "cat /app/data/sqlite/sportsdata.db" > sportsdata.db.bak
```

**TODO (filed as a council debt, Sprint 11+):** automated nightly snapshot of the SQLite file to R2 or S3. Currently there is NO backup discipline — a volume failure loses everything. Fly volumes are single-host and not replicated unless explicitly configured.

## Known deploy hazards

1. **Silent workflow failures.** The Pages workflow exits 1 when secrets are missing but GitHub still marks the push as "pushed." Always verify with `gh run list` + a content curl after pushing. See Sprint 10.5.
2. **Stale Cloudflare direct-git integration.** The Pages project may still have a leftover direct git connection from before the Actions workflow was added. It was serving old content during the Sprint 6-10 outage. Disable it in the Cloudflare dashboard → Pages → sportsdata → Settings → Builds & deployments.
3. **`fly deploy` without auth.** `fly auth login` opens a browser. In headless contexts (including the new `deploy-fly.yml` workflow), use `FLY_API_TOKEN`.
4. **tsx cold-start bug (historical, fixed).** Sprint 8 hit a problem where `tsx` wasn't bundled in the Docker image and the cold start failed silently. The `Dockerfile` now installs tsx globally. Don't remove that.
5. **Silent scrape failures (fixed in Sprint 10.6).** The `predict-cron` used to hit a nonexistent `/api/trigger/scrape` route behind `|| echo "non-fatal"` + `continue-on-error: true`, so ESPN data went unrefreshed for days while the cron reported green. The route now exists, the `|| echo` masks are gone, and `/api/health` exposes `last_scrape_at` so staleness is visible without having to read logs.
