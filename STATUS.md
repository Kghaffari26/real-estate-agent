# Status

Last updated 2026-09-27 by an unattended Claude Code session. Judgment calls
are logged one per line in `DECISIONS.md` ("Session 4").

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
| Affordability numbers match the site calculator | N/A (no site yet). The shared vector passes. |
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
