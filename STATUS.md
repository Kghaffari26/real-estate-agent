# Status

Last updated 2026-09-26 by an unattended Claude Code session. Judgment calls
are logged one per line in `DECISIONS.md` (see "Session 3").

## Summary

**Done this session** (every task that was blocked on agents-core):

- **(a) agents-core v0.1.0 replaces the local stand-ins.** The vendored
  `agents-core/` folder is deleted. The agent now depends on
  `agents-core @ git+https://github.com/Kghaffari26/agents-core@v0.1.0`
  (tag; locked to `b0a292d`). HTTP (`agents_core.http`), LLM
  (`agents_core.llm`), costs, guards, publish and the runner all come from it.
  Python moved to 3.12 because agents-core requires it. Large-file conditional
  GETs are a thin helper (`agents/real_estate/download.py`) built on
  `agents_core.http.Http`.
- **(b) Registered through the `agents_core.agents` entry point.**
  `real_estate = "agents.real_estate.agent:AGENT"`, where `AGENT` is a
  `RealEstateAgent(agents_core.agent.Agent)` with fetch, transform and
  analyze steps. `uv run agents-run --list`, `agents-run real_estate
  --dry-run` and `agents-run real_estate` all work against live data.
- **(c) LLM briefs through `agents_core.llm`.**
  - Metro briefs: fast tier (Haiku 4.5) through the Batch API, using
    `ctx.llm.batch` and then `ctx.llm.guard_batch`.
  - National brief: smart tier (Sonnet 5), synchronous.
  - Both use `guard=fields_guard(facts, ["text", "key_points"])`. A failing
    brief gets one retry, then falls back to the existing `templates.py`
    brief.
  - The brief-hash caching is kept. Briefs are now also cached in
    `data/real_estate/briefs.json`, so a fresh CI checkout can reuse them.
  - If the batch times out, the requests run synchronously instead (§7.4).
- **(d) Publishes the agents-core data-branch contract to `public-data/`**:
  `latest.json`, `metros/<slug>.json`, `history/YYYY-MM-DD.json`,
  `manifest-entry.json`, `costs-summary.json` and `schema.json`. The §6 body
  shapes are unchanged. `meta` is now agents-core's shared `RunMeta`, which
  is what §6.1's "shared meta block" means.
- **(e) Workflow.** `.github/workflows/agent-real-estate.yml` calls
  `Kghaffari26/agents-core/.github/workflows/run-agent.yml@v0.1.0` with
  `agent: real_estate`, `max_run_usd: "0.50"`,
  `site_repo: Kghaffari26/agents-hub`, `cache_path: data/cache/real_estate`
  and `secrets: inherit`. The `force_briefs` dispatch input maps to
  `extra_args: --force-briefs`. The local `.github/workflows/run-agent.yml`
  was already gone; it isn't in the tree.
- **Name-based CBSA matching is kept and tightened.** Candidates must now be
  Metropolitan areas and match on both state and principal city. The old
  `startswith` match would have mapped Columbus, OH to Columbus, GA-AL.
- **Sources re-verified and `build_metro_config.py` re-run.** All sources are
  reachable now. Results: CBSA and centroid 50/50, Zillow RegionID 41/50,
  REVIEW lines down from 200 to 29 (listed below).
- **One real run with LLM briefs**, then an immediate second run. Details
  below.
- Tests: **200 passed**, ruff clean, evals 100% on all SPEC §11 checks
  (template path).

**Anthropic spend this session: $0.048**, under the $1 cap:

- $0.0457 for the real run (`data/costs.jsonl`).
- $0.0022 for a one-call-per-tier smoke test before the run.

## Real run report (2026-09-26)

`uv run agents-run real_estate` against live Redfin, Zillow and FRED data,
starting from an empty brief cache:

- **Cost: $0.0457**, 53 calls, 3m14s wall time, most of it waiting on the
  batch. From `data/costs.jsonl`:
  - 50 metro briefs, fast tier, Batch API: **$0.0367**
  - 2 guard retries, fast tier, synchronous: **$0.0031**
  - 1 national brief, smart tier: **$0.0059**
- **Tokens (`meta.model_usage`):**
  - fast: 36,503 in / 8,010 out
  - smart: 1,219 in / 348 out
- **Number guard:** 48 of 50 metro briefs passed on the first attempt. The
  other 2 passed after one retry:
  - north-port-fl wrote "$420,000" for $419,990.
  - oklahoma-city-ok wrote a rent figure that wasn't in the facts.

  Both are logged in `data/guard_failures.jsonl`. All 51 published briefs
  are `narrative_source: "llm"`.
- **Output sizes:**

  | File | Size | Limit |
  |---|---|---|
  | `latest.json` | 151,014 B (147.5 KiB) | 150 KiB (**tight**) |
  | `metros/*.json` (50 files) | 8.7–10.4 KB each | 40 KB |
  | `history/2026-09-26.json` | 151,014 B (copy of the index) | — |
  | `manifest-entry.json` | 684 B | — |
  | `costs-summary.json` | 114 B | — |
  | `schema.json` | 11.9 KB | — |

  The index grew from 140KB, mostly because of Zillow data and
  `meta.sources`. The next addition will trigger §10's trimming.
- **Second run:** 0 LLM calls, $0.00, `data_changed: false`. Every brief was
  `reused: true` (SPEC §13 ✅).
- **Warnings on both runs:**
  - Permits were skipped: the Census BPS monthly file is still unverified.
  - ACS income was unavailable. The Census API now redirects keyless
    requests, and there's no `CENSUS_API_KEY` here, so `payment_to_income`
    is null.
- **Data freshness:** Redfin's tracker files were last modified 2026-06-02,
  so `data_through` is 2026-05-31. FRED rates are current (30-yr 7.03% as of
  2026-09-24).

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

Nothing blocked the migration. These gaps were worked around, and would be
better fixed upstream (agents-core wasn't modified):

1. **`RunMeta` has no `warnings` (or `batch_fallback`) field.** It's
   `extra="forbid"`, so SPEC §10's "log a warning in meta" can't be
   published. For now warnings go to the run log and to
   `data/real_estate/state.json` → `last_run`, which run-agent.yml commits.
   A `warnings: list[str] = []` on `RunMeta` would fix this.
2. **`Http` has no conditional-GET download.** Its cache stores bodies as
   base64 inside JSON, which doesn't suit a 106MB file, and a 304 surfaces
   as `HttpError(status=304)`. `download.py` works around it; a
   `Http.download(url, dest)` upstream would let other agents share it.
3. **`Http`'s TTL cache excludes secret params from the cache key.** An
   error page cached while a key was missing is therefore served after the
   key is added. ACS works around this with `ttl_seconds=0`. A fix upstream
   would be to not cache non-JSON responses to `get_json`, or to key on
   whether a secret is present.
4. **The batch-timeout fallback runs sequentially.** `LLM` is synchronous,
   so SPEC §7.4's "concurrency 5" isn't available. Minor: it only matters
   when a batch times out.

## Evals (SPEC §11)

`uv run python -m evals.real_estate.run` runs offline and free against the
template briefs, which are the fallback behind every LLM brief. Results:
100% on number fidelity, units, style/no-advice, length, flag coverage
(keyword proxy), and both national checks.

The LLM path is covered two ways:

- **Mocked:** `tests/test_analyze_batch.py` covers batch success, partial
  failure, guard retry, guard fallback, batch timeout, and the national
  brief. `tests/test_agent_run.py` runs the agent end to end through
  agents-core's runner offline: every data-branch file, second run with zero
  calls, and `--force-briefs`.
- **Live:** the number guard checks every live brief (see the run report).

The spec's LLM-judge flag-coverage eval is still a keyword proxy, to keep
the eval suite free.

## §13 acceptance criteria

| Criterion | Status |
|---|---|
| `build_metro_config.py` → 50 metros with Redfin region + CBSA, ≥48 with Zillow ID | **Partial.** 50/50 Redfin, 50/50 CBSA and centroid. Zillow 41/50: the 9 gaps are Redfin divisions that Zillow doesn't publish, so the spec's ≥48 isn't reachable for this metro set. |
| `--dry-run` fetches/filters/computes, prints per-metro table, zero LLM calls | ✅ (live, and in `test_agent_run.py`) |
| Real run publishes index ≤150KB + 50 metro files ≤40KB, all validated | ✅ 147.5 KiB / 8.7–10.4 KB. The runner validates against `IndexOutput`, and `MetroDetailOutput` models are what gets written. |
| Immediate second run makes zero LLM calls | ✅ Live: 0 calls, $0. |
| Mortgage-rate change regenerates only the national brief | ✅ by construction: metro hashes and prompts exclude rates, the national hash includes them. Not exercised live, since the rate didn't move between the two runs. |
| Affordability numbers match the site calculator | N/A (no site yet). The shared vector ($400k @ 6.5%/30y → $2,528.27) passes. |
| Tests pass, evals meet §11 thresholds | ✅ 200 tests, ruff clean, evals 100%. |
| `/real-estate` page renders | N/A (site is out of scope). |

## Things you must do by hand

1. **Repo secrets** (Settings → Secrets → Actions on `real-estate-agent`):
   - `ANTHROPIC_API_KEY`. The reusable workflow passes this exact name; it
     doesn't read `AGENTS_ANTHROPIC_API_KEY`.
   - `FRED_API_KEY`.
   - `CENSUS_API_KEY`: free at https://api.census.gov/data/key_signup.html,
     and now required for ACS income.
   - Optionally `SITE_DISPATCH_TOKEN`, if `Kghaffari26/agents-hub` should be
     notified.
2. **Give Actions push rights.** run-agent.yml pushes to this branch
   (`data/`) and force-pushes the `data` branch. Actions needs "Read and
   write permissions", and branch protection on `main` must allow the bot's
   commit.
3. **Review the 29 `# REVIEW` lines** above, especially whether division
   metros sharing a parent centroid is acceptable for the map.
4. **Census permits** stay disabled until someone verifies the monthly BPS
   CBSA file URL and layout (`agents/real_estate/fetch_permits.py`).
5. **Watch `latest.json`'s size.** It's at 147.5 of 150 KiB.
6. **Alert labels are per-flag, not per-group.** An alert's label is taken
   from the first flagged metro, e.g. "Inventory -24.2% YoY" for a group of
   4 metros. The national brief then says things like "4 metros recorded
   inventory declines of 24%". This predates this session; worth a
   group-neutral label in `flags.py` later (it would change the published
   `alerts[].label` text, not the shape).
