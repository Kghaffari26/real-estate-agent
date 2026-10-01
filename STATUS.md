# Status

Last updated 2026-09-28 by an unattended Claude Code session. Judgment calls
are logged one per line in `DECISIONS.md` ("Session 4", "Session 6", "Session 7").

## Session 9 (2026-09-28): dashboard v2 "Night Atlas", phases 0-3 (branch `dashboard-v2`)

Spec: `docs/specs/SPEC_DASHBOARD_V2.md`. v1 pages still serve `/`, `/metros`, `/metro/:slug`, `/compare` and `/about` until each v2 screen replaces them.

- **Gate A:** the owner picked A, Night Atlas (frames in `docs/screenshots/v2/gate-a/`, built from the sample data by `dashboard/design/gate-a/`).
- **Phase 2:** Night/Dawn tokens (`src/styles/atlas.css`), motion presets, primitives in `src/ui/`, `#/styleguide`.
- **Phase 3:** `#/explore`: 3D columns/bubbles/heat/flat on a restyled OpenFreeMap basemap, 3D buildings and terrain toggles, hover card, select and fly, area search with a log radius slider, lasso to Compare, the time machine (36 months, rate moments detected in code, 1x/4x playback), table view, keyboard map, phone bottom sheet, and a designed 2D fallback (`?tier=low`). Gate B recording: `docs/screenshots/v2/gate-b-explore.webm`.
- **Checks (Phase 3):** 133/135 unit tests, 58 e2e including 13 new atlas checks (area numbers = the pure function, scrub = published history, table, low tier, reduced motion, axe in both themes), lint clean, initial JS 110.6 KB gz. Python unchanged in Phase 3.
- **Local-only issue on this Windows machine:** Smart App Control blocks Rollup's native binary, so `node_modules/rollup/dist` was swapped for `@rollup/wasm-node` 4.63.5 (not committed; a fresh `npm ci` here needs the same swap). The CRLF and flaky-test issues are fixed (see Gate B changes).
- **Not generated:** Runway (no API key) and Everygen (inactive subscription), so all imagery is procedural. Figma, Canva and Adobe need the owner to sign in.
- **Gate B approved with changes (applied):** proportional heights (value from zero; YoY centered on zero around a floating zero plane), `.gitattributes` + LF normalization, deterministic pages test, exact deck.gl/MapLibre/luma pins with patch guards. 139/139 unit tests, 60 e2e. `dashboard-v2` is pushed as a backup; no merge until after Phase 5.
- **Phase 4 (Arrival, `#/arrival`):** a GlobeView globe with dotted land and proportional light columns, three counters, and the "Enter the market" dive into the atlas. Sections: the brief, the heat field, rates vs prices, movers and alerts, the investigations, sources. Poster-first LCP 1.8-1.9 s on a throttled phone profile; 60 fps rotation on the laptop GPU. 11 new e2e checks. Stills: `docs/screenshots/v2/p4-arrival-*`.
- **Phase 8 E1 (timeline since 2012):** the agent publishes `timeline/<metric>.json` x 5 (schema 1.3.0, spec section 6.4), and the time machine runs Jan 2013 to Aug 2026 with a real YoY in every month. The sample snapshot gained the timelines from the real Redfin files, verified month-for-month against its metro files. Python 250 tests (was 242), dashboard 142 unit / 72 e2e.
- **Phase 5 (dossier, `#/dossier/:slug`):** the R3F house sized by price / U.S. median and lit by the temperature, region plates, the instrument cluster, chips that drive the chart (1Y/3Y/All to 2012, Level/YoY, index to U.S., rate strip), temperature drivers, Zillow/permits states, affordability. Gate C sheet: `docs/screenshots/v2/gate-c/sheet.png`. 150 unit / 89 e2e / 250 Python.
- **Swap (merged to main):** `/` = Arrival, `/metro/:slug` = dossier, `/explore` = atlas; old links redirect; v1 Overview/Metros/Metro retired (the CSV export and print one-pager went with them). Initial JS 98.6 KB gz.
- **Phase 6 (affordability studio, `#/metro/:slug/afford`):** the house scaled by your price with the year-ago ghost, log-price/down/rate/term sliders in the URL, the payment vs a year ago, the 2.5D payment stack, the income ring ("needs income data" for now), Reset to published. All 50 published payments reproduce to the cent. On `dashboard-v2`; not yet on `main`.
- **Phase 7 (compare arena + methodology):** `#/compare` is the three-house arena with entity-colored plots, linked-crosshair charts (up to 2 metrics, 1Y/3Y/All with timelines, indexed) and the leaders table; `#/methodology` is v2, with map, terrain and type credits and the procedural-visuals note; the v1 shell is retired. On `dashboard-v2`; not yet on `main`.
- **Phases 6-7 merged to `main`.**
- **Phase 8 (E2-E4, schema 1.4.0):** `events.json` (the national event rail, detected in Python; the dashboard's own detector is gone), `pulse.json` (12 weekly windows for all 50 metros, with agent-computed YoY) and `areas/<slug>.json` (330 counties with Gazetteer centroids; ZIPs skipped, 364 MB). Wired into the time machine's rail, an Arrival ticker, the dossier and county-level area search. Each file is optional and size-capped; the site renders without them. On `dashboard-v2`; not yet on `main`.
- **Phase 8 merged to `main`.**
- **Phase 9 (polish, performance, accessibility, trailer):** quality tiers (high/medium/low, `?tier=`), a pre-JS globe poster (applied-throttling mobile LCP 2.2 s), Lighthouse in CI (accessibility 100 on Arrival and Explore, enforced; performance reported: software WebGL in CI dominates it), an FPS smoke (60 fps on an integrated GPU), local visual regression (42 views), v1 pruned (38 modules, recharts), CSV export on the atlas table, a ~45 s trailer and a README hero GIF, and rewritten READMEs. On `dashboard-v2` awaiting **design gate D**.
- **Phase 9 merged and live** (691f8ff).
- **v3 Regional Desk** (`docs/specs/SPEC_REGIONAL_DESK.md`): **R0 done** on `regional-desk`: place names at every zoom in both themes (Dawn had none), a road hierarchy, metro divisions at their own counties (Orange County's column had stood in Los Angeles), and an Orange County region view. R0 merged. **R1 done** (schema 1.5.0): `regions/orange-county.json` (87 ZIPs, 37 cities, 36 months, agent-computed YoY and ranks) and its ZIP/city shapes. R1 merged. **R2 done** on `regional-desk`: the Orange County market view in the atlas (ZIP choropleth, city outlines and labels, county → city → ZIP panel with ranks and trends, region table with CSV, ZIPs in area search, low-sample handling). R2 merged (513f72d). **R3 done** on `regional-desk`: the Desk (`#/desk`): Supabase schema with row-level security (teams, members, invites, properties, favorites), PKCE email-link sign-in, team creation, invites and roles. RLS is tested on PGlite and, in the `desk-db` workflow, on a real local Supabase stack. The build refuses anything but the anon key, and `check:secrets` scans `dist/`. Supabase's email rate limit gets a clear message. **Blocked on the owner:** the hosted Supabase project and the `SUPABASE_URL`/`SUPABASE_ANON_KEY` secrets (`docs/DESK_SETUP.md`). Until then the live Desk says "not configured". R3 merged (0ad2798). **Listing Prep P1 (intake) done** on `regional-desk`: add a property by address (Census geocoder via the `geocode` Edge Function; by ZIP when unmatched), the ZIP/city market around it, facts validated and confirmed in the database, seller consent, room photos in a private bucket (consent-gated, resized and metadata-stripped on the device), coverage prompts, the team cost book (CSV import, managers edit) and quotes. Proven on PGlite, against the real local stack's APIs in `desk-db`, and in e2e. **Owner, before P2:** the consent text needs counsel's review, and the cost book needs prices (`docs/templates/cost_book.csv`). Next: P2 (vision findings).

## Session 8 (2026-09-29): dashboard phase 3 polish + sparkline contract

- **Contract (schema 1.2.0, additive).** `metros[].spark` holds the last 24 month-end
  median sale prices in whole dollars (spec §6.3). The index grows from 86 to
  95 KB, under the 150 KB limit. `fit_index` drops `spark` before failing if the
  index is ever too large.
- **Snapshot.** Regenerated from the existing run state for **$0** (every brief and
  the investigation were reused).
- **Metros table sparklines.** They now come from `spark`: the Metros page makes no
  metro-file requests (an e2e test checks this). This closes gap 1 below.
- **Stale data after deploys (fixed).** Every data URL now carries `?v=<content
  hash of public/data>`, computed at build time (`scripts/data-version.mjs`). Pages'
  ~10-minute browser cache can no longer pair a new app with old JSON, and an
  unchanged dataset keeps its cache. Unit and e2e tests cover it.
- **Layout fixes.**
  - Sidebar: its background runs the full page, and its contents are sticky.
  - KPI cards: every card has the same header; titles wrap before the trend chip
    moves, and 36-month badges move under the deltas.
  - Tables (Metros, Compare, Methodology): sticky header row and first column, a
    right-edge fade while more columns are hidden, and a shadow on the pinned
    column once scrolled.
  - Overview: a single investigation spans two columns beside an "Explore the
    metro" panel.
- **Methodology.** The About page has a "Data sources and methodology changes"
  note on the Redfin Data Center relaunch.
- **Mobile.** Safe-area padding and scroll padding clear the bottom nav. New e2e
  checks: the calculator's last control and the footer end above the nav at
  360px, and the ⌘K palette opens by tap.
- **Checks.** 110 unit tests, 39 e2e checks, 242 Python tests. Lighthouse on the
  Overview: 95 mobile / 99 desktop performance, accessibility 100. Initial JS is
  110 KB.

## Session 7 (2026-09-28): Redfin Data Center + dashboard phase 2 (Metro Pulse)

**Data freshness (fixed).**
- **Symptom.** The published data ended at May 2026.
- **Cause.** Redfin stopped updating the `redfin_market_tracker/` S3 exports on
  2026-06-02, when it relaunched its Data Center. It wasn't our cache, filter or
  file choice.
- **Fix.** The fetcher now reads `redfin_data_center/housing_market/monthly/*.csv`
  plus `price_drops/monthly/*.csv`, joined by name for all 50 metros; the legacy
  export is kept only as a fallback (spec §3.1).
- **Result.** Data runs through **August 2026**. Our YoY matches Redfin's within
  rounding.
- **New methodology.** The files define several metrics differently (e.g. the
  national median is $399,900 vs $449,846 for May 2026). Series are never
  spliced; see DECISIONS.
- **Staleness warning.** Runs now warn in `meta.warnings` when Redfin's latest month
  is older than 75 days.
- **Snapshot and checks.** The sample snapshot was regenerated from a real run
  ($0.0675). 241 Python tests; ruff clean.

**Dashboard phase 2 (Metro Pulse).**
- **Brand.** One brand config, logo and wordmark, favicon, OG image.
- **Design.** Inter with tabular figures, and token-driven light and dark palettes
  with validated chart colors.
- **Maps and charts.**
  - MapLibre + OpenFreeMap bubble map with hover cards and fly-to, overlapping
    division metros spread out, and a list fallback.
  - Charts have crosshair tooltips, end labels and high/low annotations; the metro
    page gets a synced rate strip instead of a dual axis.
  - Sparklines in KPI cards and table rows.
- **Navigation.** ⌘K command palette, sidebar/bottom-nav shell, freshness chip,
  breadcrumbs.
- **Page features.**
  - Heat grid, ranked movers, and alert cards.
  - Diverging temperature components and severity cards.
  - Slider calculator with a cost breakdown.
  - Compare leaders.
- **Sharing.** Copy link, Download PNG, Export CSV, and a print one-pager.
- **States and motion.** Skeletons, illustrated empty/error states, and
  reduced-motion-aware motion.
- **Checks.** 106 unit tests, 35 Playwright smoke + axe checks (every route in
  light and dark, desktop and 360 px), lint, typecheck, and a CI performance
  budget.
- **Performance.** Initial JS is 109 KB gzipped (budget 300 KB). Lighthouse on the
  Overview: performance 96 mobile / 99 desktop, accessibility, best practices and
  SEO 100.
- **Screenshots.** `docs/screenshots/{overview,metros,metro-detail,compare,about}{,-dark,-mobile}.png`
  (15 files).

**Data-contract gaps still open** (the dashboard works around each):
1. ~~The index has no per-metro series~~ (closed in session 8: `metros[].spark`).
2. The `percent`/`pp_signed` unit ambiguity between metrics (ratios) and
   `key_stats`/rates (percent) is unchanged from session 6.
3. `flags[].facts` carry no formats, and index flags are ids only.
4. National `temperature` has no components.
5. `sources[].attribution` is null for FRED and Census.

## Dashboard, phase 1 (2026-09-28, session 6)

`dashboard/` (Vite + React 18 + TS strict + Tailwind + Recharts + react-leaflet),
deployed by `.github/workflows/dashboard.yml`. The Python agent is unchanged.

- **Done:** all five views (Overview, Metros table + map, Metro detail, Compare,
  About), each deep-linkable; header quick-search combobox; light/dark/system theme;
  loading/empty/error states; zod schemas + types generated from
  `schemas/real_estate.schema.json` with a staleness check; tolerant parsing;
  `npm run fetch-data` (data branch → sample fallback + badge); client calculator
  that reproduces all 50 published `payment_now` values (§13's "site calculator"
  criterion, now ✅ against the sample).
- **Checks:** 85 Vitest tests, ESLint, `tsc -b`, 28 Playwright smoke + axe checks
  (every route, desktop and 360 px, light and dark), all passing; 232 Python tests
  and ruff still pass.
- **Sample data:** `dashboard/sample-data/` is a live run into a scratch publish dir
  on 2026-09-28: status ok, **$0.0647** Claude spend (50 metro briefs, national brief,
  1 investigation: Pittsburgh), index 86.8 KB. Committed state (`data/`) untouched.
- **Screenshots:** `docs/screenshots/{overview,metros,metro-detail,compare,about,overview-dark,metro-detail-mobile}.png`.
- **By hand:** Settings → Pages → Source: **GitHub Actions** (the workflow can't turn
  Pages on). The `github-pages` environment must allow deploys from `main`.
- **Not verifiable here:** OSM tiles are blocked by this sandbox's egress policy, so
  tiles are stubbed in tests/screenshots; the workflow itself hasn't run yet.
- **Data-contract gaps** (dashboard works around each; see DECISIONS "Session 6"):
  1. `percent`/`pp_signed` mean different units in different places: metric values
     are ratios (0.968), but `key_stats` and the rate series are in percent (7.03,
     +0.08 pp), and the registry lists `mortgage30` as `format: "percent"`.
  2. Index `metros[].flags` are ids only, with no labels for `info` flags.
  3. `flags[].facts` carry no formats; units are inferred from key suffixes.
  4. `sources[].attribution` is null for FRED and Census.
  5. Unrounded ratios in `latest`/`series` (known item 3 below).
  6. National `temperature` has no components, so only metros show a breakdown.
  7. Metro series start with nulls in the first months while `dates` is shared.

## agents-core v0.3.1 (2026-09-27, session 5)

- Pinned `tag = "v0.3.1"` (locked to `dba5e86`); workflows use
  `run-agent.yml@v0.3.1` and `run-evals.yml@v0.3.1`.
- `evals.yml` adds `total_max_usd: "0.40"` across all three suites (keeps
  `max_usd: "0.25"` per suite), so a worst-case gate run is $0.40, not $0.75.
- Nothing else to remove: this repo never set a `temperature` (tier, call or
  judge) and never had a spend-splitting eval wrapper, so no fake asserted
  `kwargs["temperature"]` and no live smoke call was needed ($0 spent).
- 232 tests and ruff pass; the replayed investigator trajectories still match.

## Summary

**Done this session:**

- **agents-core v0.3.0** (`tag = "v0.3.0"`, locked to `bcfb9c5`). Every local
  workaround v0.2.0 made unnecessary is gone:
  - warnings: `ctx.warn` → `meta.warnings`
  - downloads: `Http.download`; `download.py` deleted
  - ACS: `get_json`, no `ttl_seconds=0`
  - batch timeout: `on_timeout="sync"`, 5 at a time
  - data-branch restore: briefs are reused from the previous published output;
    `briefs.json` deleted
  - workflow: `run-agent.yml@v0.3.0`, with the calling job granting
    `contents: write`
  - no HTTP caps, token passthrough or per-tier temperature existed here to
    remove
- **agents-hub fixes:**
  - With no Anthropic key the run publishes templates, `status: ok` and a
    warning. It used to crash. Covered by a test, and a live no-key run published
    at $0.
  - Every `delta_format` is an agents-core `StatFormat`: `median_dom` is
    `count_signed`, `months_of_supply` is `decimal1`.
- **STATUS/agents-hub items:**
  - Alert groups: the label is the threshold ("Inventory down ≥20% YoY") and
    each metro has its own figure in `alerts[].metros`.
  - Index size: the check counts `meta.warnings`, and §10 trimming is tested.
    The live overflow was fixed by making `metros[].latest` match §6.1 exactly:
    **85 KB**, down from 147.5 KiB.
  - The state file is under the configured data dir.
- **(A) Tracing.** The runner publishes `trace.json` and `trace.schema.json`,
  and `manifest-entry.json` has a `trace_summary`. The agent adds spans:
  `fetch:redfin`, `metro_briefs`, `national_brief`, `investigations`. The loop,
  LLM, tool, HTTP and guard spans come from agents-core.
- **(B) Evals on `agents_core.evals`.** Three suites in
  `evals/real_estate/suites.py` append to `evals/history.jsonl`, and
  `.github/workflows/evals.yml` calls `run-evals.yml@v0.3.0` with
  `contents: read`, a $0.25 cap per suite, and a 0.10 regression threshold.
- **(C) Metro investigator** (`agents/real_estate/investigate.py`, spec §6.3):
  - Runs an `AgentLoop` for up to 3 new-major-flag metros, else the top mover.
  - 5 tools plus `finish`; 8 steps and $0.05 per investigation.
  - Guards: number guard over all tool outputs, 4–6 sentences, known metric keys,
    no computed multiples; template fallback.
  - Published additively: `metros/<slug>.json` → `investigation` and
    `latest.json` → `investigations`.
  - Trajectory evals on 6 fixture metros, with the 6 recorded trajectories
    replayed in pytest.
- **(D)** `docs/case-studies.md`: 5 incidents with commit links.
- **(E)** README: Highlights and Demo sections.
- Tests: **232 passed**, ruff clean (200 before this session).

**Anthropic spend this session: $0.599**, under the $1.50 cap. From
`data/costs.jsonl` and `data/eval_costs.jsonl`, entries dated 2026-09-27:

| What | Cost |
|---|---:|
| Live agent runs | $0.158 |
| Eval suites (incl. one single-case smoke run) | $0.441 |

Live runs:
- Failed size check (see case study 1): $0.060
- Full regeneration: $0.059
- Reuse run: $0
- 2 investigation-only reruns after prompt changes: $0.020 + $0.019

Eval runs:
- Smoke: $0.025
- LLM briefs: $0.033
- Investigator: 3 × ~$0.13

## Live run report (2026-09-27)

`uv run agents-run real_estate` against live Redfin, Zillow and FRED data (Redfin
data through 2026-05-31; 30-yr rate 7.03% as of 2026-09-24):

- **Full regeneration** (no previous output locally): 55 calls, **$0.0586**.
  - 50 metro briefs through the Batch API; 1 guard retry (`oakland-ca` quoted
    "4" and "6")
  - the national brief, smart tier
  - 1 investigation: Pittsburgh, top mover, 3 steps, $0.0136
- **Immediate second run:** 0 LLM calls, $0, `data_changed: false`. All 50
  briefs, the national brief and the investigation were reused (SPEC §13 ✅).
- **After an investigator prompt change**, only the investigation regenerated:
  4 steps, 8 tool calls, $0.0192. Everything else was reused.
- **No new major flags this month** (the only major-capable flags,
  `inventory_surge` ≥50% and `price_decline` ≤−8%, fired nowhere), so the top
  mover was investigated.
- **Output sizes:** `latest.json` 87,097 B (limit 150 KiB), metro files
  8.7–11.9 KB (limit 40 KB), `trace.json` 15.9 KB.
- **`meta.warnings`** (both expected):
  - permits skipped (the Census BPS monthly file is unverified)
  - ACS income unavailable (needs `CENSUS_API_KEY`)
- **No-key run** (a separate publish dir): status ok, $0, template briefs and
  investigation, plus the no-key warning.

## Evals

Latest scores (`evals/history.jsonl`, `evals/results/2026-09-27.json`):

| Suite | Cases | Pass rate | Scores | Cost |
|---|---:|---:|---|---:|
| `real_estate-template-briefs` | 14 | 1.000 | number_fidelity, units, no_advice_style, length, flag_coverage_keyword: all 1.000 | $0 |
| `real_estate-llm-briefs` | 12 | 1.000 | the above, plus guard_first_try 1.000 and flag_coverage_judge 1.000 | $0.033 |
| `real_estate-investigator` | 6 | 1.000 | required_tools_called, forbidden_tools_not_called, max_steps, stop_reason, guard_passed, sentences_4_to_6, cites_trigger_metric: all 1.000; quality_judge **0.833** | $0.123 |

Investigator history across the three prompt versions (`.2` → `.3` → `.4`):
quality_judge 0.917 → 0.833 → 0.833, with the trajectory scores at 1.000 each
time. With 6 cases on a 1–5 scale, one case moving a step changes the mean by
0.042, so that change is noise-level. The judge also missed the two reasoning
problems that a person reading the output caught (case studies 3–4).

## Known gaps and next steps

1. **The LLM judge isn't calibrated.** `LLMJudge.calibrate()` needs human-scored
   examples, and none exist yet (see DECISIONS). The judge also scored a
   backwards-reasoning explanation 0.75.
2. **No eval case invites a computed multiple** (case study 3). `finish` rejects
   multiples now, but a case where "N times" is tempting would lock that in.
3. **§6 rule "round ratios to 4 decimals at publish time"** isn't applied to
   `latest`/`series` values (e.g. `yoy: 0.022072973728276324`). This predates
   this session and would cut the payload further. Alert values are rounded.
4. **Checking size before spending.** The size check runs after the LLM calls,
   so an oversized run still pays for its briefs. The index now has ~63 KB of
   headroom.
5. **The first CI run will regenerate every brief** (about $0.06): this repo has
   no `data` branch yet, so there's no previous output to reuse.
6. The spec's ≥48 Zillow IDs, permits and ACS income are unchanged from
   Session 3 (see below).

## Network verification (`scripts/verify_re_sources.py`)

```
[OK] redfin_metro       200  106.3MB  last_modified=2026-06-02
[OK] redfin_national    200    0.5MB  last_modified=2026-06-02
[OK] zillow_zhvi        200    4.3MB  last_modified=2026-09-16
[OK] zillow_zori        200    1.0MB  last_modified=2026-09-16
[OK] census_bps_index   200
[OK] census_acs_api     200  (data calls now need CENSUS_API_KEY)
[OK] fred_api           200  (FRED_API_KEY set)
[OK] census_gazetteer   200
```

## `config/metros.toml`: remaining `# REVIEW` lines (29)

Every metro now has a Gazetteer-matched `cbsa`, `lat` and `lon`. There are
two kinds of REVIEW line left.

**20 lines of the form "Redfin code != CBSA".** Redfin reports these metros
as metro *divisions*, or with a pre-2023 CBSA code (Cleveland). The `cbsa`,
`lat` and `lon` shown are the parent metro's. That's right for ACS income,
which is CBSA-level. On a map, though, metros that share a parent will
share a centroid.

| slug | Redfin code | cbsa used (parent) |
|---|---|---|
| chicago-il | 16984 | 16980 Chicago-Naperville-Elgin |
| dallas-tx | 19124 | 19100 Dallas-Fort Worth-Arlington |
| fort-worth-tx | 23104 | 19100 Dallas-Fort Worth-Arlington |
| new-york-ny | 35614 | 35620 New York-Newark-Jersey City |
| new-brunswick-nj | 35154 | 35620 New York-Newark-Jersey City |
| nassau-county-ny | 35004 | 35620 New York-Newark-Jersey City |
| washington-dc | 47894 | 47900 Washington-Arlington-Alexandria |
| los-angeles-ca | 31084 | 31080 Los Angeles-Long Beach-Anaheim |
| anaheim-ca | 11244 | 31080 Los Angeles-Long Beach-Anaheim |
| boston-ma | 14454 | 14460 Boston-Cambridge-Newton |
| seattle-wa | 42644 | 42660 Seattle-Tacoma-Bellevue |
| detroit-mi | 19804 | 19820 Detroit-Warren-Dearborn |
| warren-mi | 47664 | 19820 Detroit-Warren-Dearborn |
| miami-fl | 33124 | 33100 Miami-Fort Lauderdale-West Palm Beach |
| fort-lauderdale-fl | 22744 | 33100 Miami-Fort Lauderdale-West Palm Beach |
| west-palm-beach-fl | 48424 | 33100 Miami-Fort Lauderdale-West Palm Beach |
| philadelphia-pa | 37964 | 37980 Philadelphia-Camden-Wilmington |
| montgomery-county-pa | 33874 | 37980 Philadelphia-Camden-Wilmington |
| oakland-ca | 36084 | 41860 San Francisco-Oakland-Fremont |
| cleveland-oh | 17460 (pre-2023) | 17410 Cleveland |

**9 lines of the form `# zillow_region_id = 0`.** Zillow publishes these at
the CBSA level only, so no RegionID was matched and ZHVI/ZORI are null for:
warren-mi, fort-worth-tx, new-brunswick-nj, west-palm-beach-fl,
nassau-county-ny, anaheim-ca, montgomery-county-pa, oakland-ca,
fort-lauderdale-fl.

There's also a related, unflagged mismatch. For division metros that *did*
match by name (Chicago, Dallas, New York, and others), the Zillow series
covers the whole CBSA while the Redfin series covers the division.

## Needed from agents-core

Nothing is blocked. Every gap listed in Session 3 was fixed in v0.2.0:
`RunMeta.warnings`, `Http.download`, no cached error pages, and concurrent sync
fallback. One observation for upstream:

- **The number guard matches values, not provenance.** A computed "4.3 times"
  passed because 4.3 appeared elsewhere in the facts (case study 3). This agent
  now rejects multiples in its own `finish` validator. An optional
  "no multiples/ratios" check in `agents_core.guards` would help every agent.

## §13 acceptance criteria

| Criterion | Status |
|---|---|
| `build_metro_config.py` → 50 metros with Redfin region + CBSA, ≥48 with Zillow ID | **Partial**, unchanged: 50/50 Redfin, 50/50 CBSA and centroid, Zillow 41/50 (the 9 are Redfin divisions Zillow doesn't publish). |
| `--dry-run` fetches/filters/computes, prints per-metro table, zero LLM calls | ✅ (live, and in `test_agent_run.py`); it now also prints the investigation targets. |
| Real run publishes index ≤150KB + 50 metro files ≤40KB, all validated | ✅ 87 KB / 8.7–11.9 KB. |
| Immediate second run makes zero LLM calls | ✅ Live: 0 calls, $0 (briefs *and* investigations reused). |
| Mortgage-rate change regenerates only the national brief | ✅ for briefs, by construction. Investigations also rerun on a rate change, by design (DECISIONS). |
| Affordability numbers match the site calculator | ✅ `dashboard/` reproduces all 50 published `payment_now` values with default inputs (`viewmodels.test.ts`), plus the shared vectors. |
| Tests pass, evals meet §11 thresholds | ✅ 232 tests, ruff clean, all three suites at pass rate 1.000. |
| `/real-estate` page renders | N/A (site out of scope). |

## Things you must do by hand

1. **Repo secrets** (Settings → Secrets → Actions): `ANTHROPIC_API_KEY` (also used
   by the eval PR gate), `FRED_API_KEY`, `CENSUS_API_KEY` (free, needed for ACS
   income), and optionally `SITE_DISPATCH_TOKEN`. Without `ANTHROPIC_API_KEY` the
   weekly run still publishes templates with a warning, but the LLM eval suites
   fail (score 0), so the PR gate goes red.
2. **Actions permissions.** The workflows now declare their own grants
   (`contents: write` for the agent, `contents: read` for evals). The repo's
   Actions setting must still allow `contents: write` for `GITHUB_TOKEN`, and
   branch protection on `main` must let the bot push `data/`.
3. **Tag check.** agents-core's README says `v0.3.0` must be tagged by a human.
   It is (`uv` resolved it to `bcfb9c5`), so nothing to do unless it's moved.
4. **Review the 29 `# REVIEW` lines** above.
5. **Census permits** stay disabled until the monthly BPS CBSA file URL/layout is
   verified (`agents/real_estate/fetch_permits.py`).
6. **Optionally label ~10 investigator outputs** (1–5) so the LLM judge can be
   calibrated (`LLMJudge.calibrate`).
