# Agents Hub: Build Plan

Put `CLAUDE.md` in the repo root and the five specs in `docs/specs/` first; every prompt below assumes they're there. Start each phase's prompt with "Read CLAUDE.md and the relevant spec in docs/specs/." The specs are more detailed than the prompts here, and they win if the two disagree. Each spec's §14 breaks its phase into smaller prompts. Run the phases in order, one prompt per session or task, and check each phase's **Done when** before moving on. Each phase ends in a working, committable state.

## Before you start

- Create an empty GitHub repo (e.g., `agents-hub`) and add `CLAUDE.md`.
- Get free API keys: FRED (fred.stlouisfed.org) and SAM.gov (a sam.gov account is required, and approval can take a day or so, so start this now). A basic SAM key allows only about 10 requests/day, and the grants spec is designed around that. BLS is optional.
- Create a small **sandbox repo** (e.g. `agents-hub-sandbox`) for the repo agent's apply-mode demo, and a fine-grained PAT for it (`REPO_MAINT_TOKEN`).
- Add repo secrets: `ANTHROPIC_API_KEY`, `FRED_API_KEY`, `BLS_API_KEY`, `SAM_API_KEY`. `GITHUB_TOKEN` is provided automatically in Actions.
- Set a spend limit on your Anthropic API key so a runaway loop can't drain credit.

---

## Phase 1: Core framework

> Read CLAUDE.md. Scaffold the repo structure it describes and build `core/`: `llm.py` (model tiers from `config/models.toml`, prompt caching, retries, a batch helper, structured output parsed into pydantic), `http.py` (httpx with retries, rate limiting, on-disk cache keyed by URL+params with TTL), `costs.py` (log tokens/USD per call to `data/costs.jsonl`, raise if the run exceeds `MAX_RUN_USD`), `publish.py` (validate, write `latest.json` + dated history, trim history), `schema.py` (RunMeta with agent, started_at, finished_at, cost_usd, status; Citation), and `runner.py` with `--dry-run`. Add pyproject (uv), ruff, pytest, `.env.example`, and unit tests that mock the Anthropic client and HTTP. Don't build any agents yet.

**Done when:** `uv run pytest` passes, and a dummy agent run through the runner writes valid JSON and logs cost.

## Phase 2: Macro agent (spec: `docs/specs/SPEC_MACRO.md`)

> Build `agents/macro` per CLAUDE.md. Fetch from FRED: CPIAUCSL, PCEPILFE, UNRATE, PAYEMS, GDPC1, FEDFUNDS, DGS2, DGS10. Transform in Python: latest value, prior value, change, YoY, 2y–10y spread, and a 24-month series for sparklines. Fetch the latest FOMC statement, compare it with the previous one, and compute a text diff in Python. Then use the smart tier to write a short "what changed" summary and a plain-English read of the FOMC diff, using only the computed numbers passed in and citing sources. Define the output schema, add tests with fixture data, and add `evals/macro` checking that every number in the narrative appears in the input data.

**Done when:** a real run produces `site/public/data/macro/latest.json` for under $0.10, and the eval passes.

## Phase 3: Real estate agent (spec: `docs/specs/SPEC_REAL_ESTATE.md`)

> Build `agents/real_estate` per CLAUDE.md. First verify the current download URLs for Redfin's metro-level market tracker and Zillow's metro ZHVI/ZORI CSVs. Download and filter to the metros in `config/metros.toml` (seed it with the top 50 US metros). Compute per metro in Python: median sale price, inventory, days on market, % with price drops, sale-to-list, and YoY/MoM changes for each, plus up to 36 months of history. Add FRED MORTGAGE30US, HOUST, and CSUSHPINSA as national context, and Census permits where available. Use the fast tier via the Batch API to write a 3–4 sentence brief per metro, and the smart tier for a national summary. Output one `latest.json` with national data plus a compact per-metro object, split into `metros/<slug>.json` if it exceeds ~1 MB. Add tests and an eval like macro's.

**Done when:** a real run covers all 50 metros, the JSON is small, the per-run cost is logged, and the eval passes.

## Phase 4: Website shell + macro and real estate pages (spec: `docs/specs/SPEC_WEBSITE.md`)

> Build `site/` per the Website section of CLAUDE.md: Next.js App Router with `output: 'export'`, Tailwind, Recharts, and Leaflet for the map, with dark mode and mobile layouts. Build the overview page and the `/macro` and `/real-estate` pages from the JSON in `public/data`. On real estate, implement every interactive feature listed in CLAUDE.md: metro search, compare up to 3, metric toggles, time range, mortgage-rate overlay, YoY map, affordability calculator (inputs for down payment % and rate, defaulting to the current 30-yr rate), and the per-metro brief. Show source attribution and last-updated on each page. Configure `basePath` for GitHub Pages.

**Done when:** `npm run build` succeeds and both pages look right at desktop and phone widths.

## Phase 5: Grants and contracts agent + page (spec: `docs/specs/SPEC_GRANTS.md`)

> Build `agents/grants` per CLAUDE.md. Read `config/business_profile.toml` (NAICS codes, keywords, set-aside types, min/max value, excluded agencies) and seed it with an example profile for a small software consultancy. Pull opportunities posted in the last 7 days from the SAM.gov Opportunities API and Grants.gov. Dedupe, then pre-filter in Python by NAICS, keywords, and deadline. Score the survivors 0–100 for fit with the fast tier via the Batch API, returning structured reasons, and write a fit summary with the smart tier for the top 20. Build the `/grants` page with a filterable, sortable table and expandable summaries. Add tests and an eval that checks that scores are stable across two runs on the same fixture.

**Done when:** a real run lists current opportunities with scores and the page filters correctly.

## Phase 6: Repo maintenance agent + page (spec: `docs/specs/SPEC_REPO_MAINT.md`)

> Build `agents/repo_maint` per CLAUDE.md. For each repo in `config/repos.toml` (start with this repo), fetch open issues, open PRs, and merged PRs since the last run. Use the fast tier to classify issues (bug, feature, question, duplicate-candidate) and suggest labels, flag PRs with no activity in 14+ days, and use the smart tier to draft a changelog from merged PRs. It is read-only by default. With `--apply`, and only for allowlisted repos, it applies labels and posts one summary comment per issue at most. Build the `/repos` page. Add tests using recorded API fixtures.

**Done when:** a dry run on this repo produces a sensible report without writing anything to GitHub.

## Phase 7: Scheduling and deploy

> Add GitHub Actions workflows: one per agent on the schedules in CLAUDE.md (plus `workflow_dispatch` for manual runs), each running the agent, committing changed files under `site/public/data` with a bot identity, and skipping the commit if nothing changed. Add a deploy workflow that builds the site and publishes it to GitHub Pages on pushes that touch `site/`. Add a CI workflow for ruff, pytest, and evals on PRs. Use concurrency groups so two agent runs can't push at the same time. `repo_maint` runs without `--apply` in CI unless an `APPLY_CHANGES` repo variable is set to true.

**Done when:** a manual dispatch of each agent updates the live site.

## Phase 8: Portfolio polish

> Write a README with a one-paragraph pitch, a screenshot of each site section, an architecture diagram (Mermaid), the per-agent monthly cost from `data/costs.jsonl`, a link to the live site, and setup steps. Add a `docs/` page per agent covering data sources, method, limitations, and eval results. Add a cost dashboard card to the overview page, built from `costs.jsonl` aggregated at build time.

---

## Budget guide

Rough targets to keep $250 lasting months rather than weeks:

| Agent | Per run | Runs/month | Monthly |
|---|---|---|---|
| Macro | ≤ $0.05 | ~22 | ~$1 |
| Real estate (50 metros) | ≤ $0.40 | ~4 | ~$2 |
| Grants | ≤ $0.30 (typically ~$0.10 with caching) | ~30 | ~$3–5 |
| Repo maint | ≤ $0.05 | ~30 | ~$2 |

Development sessions will cost far more than scheduled runs. Use `--dry-run` and the HTTP cache while iterating, and only run the LLM step once the data pipeline is right.

## Selling later

- **Grants:** sell a per-business profile as a weekly email digest. It is the easiest to charge for.
- **Real estate:** sell white-labeled metro reports for agents and brokers. Check Redfin and Zillow commercial-use terms first, since some data may need to be swapped for licensed sources.
- **Repo maint:** package it as a GitHub App.
- **Macro:** use it as the free, public-facing section that brings traffic to the others.
