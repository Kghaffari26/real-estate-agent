# Spec: Real Estate Market Agent (`agents/real_estate`)

> **Status:** Build spec for Claude Code · **Version:** 1.0
> **Location in repo:** `agents/real_estate/`, `config/metros.toml`, `config/real_estate.toml`, `evals/real_estate/`
> **Website section:** `/real-estate` and `/real-estate/[slug]` (see `SPEC_WEBSITE.md` §7.2). This is the flagship interactive page.
> **Depends on:** `core/` (llm, http, costs, publish, schema) and `core/guards.py` (defined in `SPEC_MACRO.md` §7.4)

---

## 1. Purpose

Track the U.S. housing market nationally and across the **50 largest metros**. For each metro the agent covers sales, prices, inventory, speed, price cuts, rents and new construction permits, set against mortgage rates. It computes the numbers in code, flags notable shifts, and writes a short plain-English brief for each metro plus a national summary.

### Users and value

| User | What they get |
|---|---|
| Portfolio visitor | A polished, interactive market explorer that visibly updates itself |
| Home buyer / seller | "Is my market heating up or cooling down?" with an affordability calculator |
| Agent / broker (future customer) | A shareable metro page and a weekly brief they could white-label for clients |
| Investor | Movers, inventory surges and rent-vs-price divergence across 50 metros at a glance |

### Goals

- Cover 50 metros plus national, with up to 36 months of history and 10+ metrics per metro.
- Produce deterministic **flags** (inventory surge, price decline, buyer's market…) and a **market temperature** score.
- Write a 3–4 sentence brief per metro with the fast tier through the Batch API, and a national summary with the smart tier.
- Regenerate briefs **only when the source data changes**. Redfin and Zillow publish monthly; mortgage rates change weekly.
- Keep total published JSON small: an index of about 150KB or less, and each metro file about 40KB or less.
- Cost: under **$0.50/month** scheduled.

### Non-goals (v1)

- Property-level data, listings, or anything that needs scraping Redfin or Zillow web pages. Use **only the public research downloads**.
- Price predictions or "buy now" advice.
- ZIP-code or neighborhood granularity (possible later, see §15).

---

## 2. Metrics

A single **metric registry** (`agents/real_estate/metrics.py`) defines every metric once. It is exported into the output so the site uses the same labels, formats and directions.

| Key | Label | Source | Format | Good direction | Notes |
|---|---|---|---|---|---|
| `median_sale_price` | Median sale price | Redfin | `currency` | neutral | Not seasonally adjusted, so compare YoY |
| `homes_sold` | Homes sold | Redfin | `count` | up | Monthly count |
| `new_listings` | New listings | Redfin | `count` | neutral | |
| `inventory` | Active inventory | Redfin | `count` | neutral | |
| `months_of_supply` | Months of supply | Redfin | `decimal1` | neutral | < 3 favors sellers, > 6 favors buyers |
| `median_dom` | Median days on market | Redfin | `days` | neutral | |
| `avg_sale_to_list` | Sale-to-list ratio | Redfin | `percent` (ratio × 100) | neutral | e.g. 98.7% |
| `sold_above_list` | Sold above list | Redfin | `percent` | neutral | Share of sales |
| `price_drops` | Listings with price drops | Redfin | `percent` | neutral | Share of active listings |
| `off_market_in_two_weeks` | Off market in 2 weeks | Redfin | `percent` | neutral | Speed signal |
| `zhvi` | Zillow Home Value Index | Zillow | `currency` | neutral | Smoothed and seasonally adjusted, mid-tier |
| `zori` | Zillow Observed Rent Index | Zillow | `currency` | neutral | Monthly rent |
| `permits_total` | Building permits (units) | Census BPS | `count` | neutral | Monthly units authorized |
| `permits_1unit` | Single-family permits | Census BPS | `count` | neutral | |
| `permits_5plus` | 5+ unit permits | Census BPS | `count` | neutral | Multifamily pipeline |

"Neutral" is deliberate. Higher prices are good for sellers and bad for buyers, so the site colors these amber rather than red or green.

### National-only series (FRED)

| Key | Series | Frequency |
|---|---|---|
| `mortgage30` | `MORTGAGE30US` (Freddie Mac PMMS) | Weekly (Thu) |
| `mortgage15` | `MORTGAGE15US` | Weekly |
| `housing_starts` | `HOUST` (thousands, SAAR) | Monthly |
| `permits_national` | `PERMIT` (thousands, SAAR) | Monthly |
| `case_shiller` | `CSUSHPINSA` (index, NSA) | Monthly, about a 2-month lag |
| `median_price_new_and_existing` | `MSPUS` | Quarterly |

---

## 3. Data sources: access details

> Verify each URL during setup with `scripts/verify_re_sources.py`, which does a HEAD request and prints status, size and `Last-Modified`. Public dataset URLs change occasionally.

### 3.1 Redfin Data Center (primary, market metrics)

**Updated 2026-09-28.** Redfin relaunched its Data Center and stopped updating the
`redfin_market_tracker/` exports on 2026-06-02 (last month: May 2026). The current
files are CSVs in the same public bucket under `redfin_data_center/` (manifest:
`redfin_data_center/index.json`), refreshed around the 3rd week of each month:

| Use | Path under `https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_data_center/` |
|---|---|
| Metro metrics | `housing_market/monthly/all_metros.csv` (~44MB; one row per metro and month, back to 2012) |
| National metrics | `housing_market/monthly/country.csv` |
| Metro price-drop share | `price_drops/monthly/all_metros.csv` (~20MB) |
| National price-drop share | `price_drops/monthly/country.csv` |

- **Why `all_metros` and not `top_50_metros`:** Redfin's top 50 omits 5 tracked metros
  (North Port, Raleigh, Oklahoma City, Cape Coral, Myrtle Beach).
- **Format:** CSV with a quoted header, `NA` for missing values. Keys: `LAST UPDATED,
  FREQUENCY` (`Monthly`), `PERIOD BEGIN, PERIOD END, REGION ID` (housing files only;
  same codes as the legacy `PARENT_METRO_REGION_METRO_CODE`), `REGION TYPE` (`Metro` /
  `Country`), `REGION NAME` (`"Houston, TX metro area"`, matching `redfin_region` in
  `config/metros.toml`). Then value / `MOM` / `YOY` triplets per metric.
- **Columns used → published metric:** `MEDIAN SALE PRICE NSA ($)` → `median_sale_price`,
  `HOMES SOLD`, `NEW LISTINGS`, `INVENTORY`, `MONTHS OF SUPPLY`, `MEDIAN DAYS ON MARKET
  (DAYS)` → `median_dom`, `AVERAGE SALE TO LIST RATIO (%)` → `avg_sale_to_list`, `SHARE
  SOLD ABOVE ORIGINAL LIST (%)` → `sold_above_list`, `PERCENT OFF MARKET IN TWO WEEKS
  (%)` → `off_market_in_two_weeks`, and from the price-drops file `PERCENT ACTIVE WITH
  PRICE DROPS (%)` → `price_drops`. **Percent columns are percents (97.09); divide by
  100** so the published contract keeps ratios (§6 rules). Assert the columns exist and
  fail loudly with a list of missing ones.
- **The price-drops files have no `REGION ID`**, so they're joined on (`REGION NAME`,
  `PERIOD END`). All 50 tracked names match exactly (a test checks a snapshot of the
  live names; `scripts/verify_re_sources.py --names` checks the live files). A metro
  without a price-drop row gets `price_drops: null`; if the price-drops file itself is
  unavailable, the run warns and publishes `price_drops: null`.
- **Ignore Redfin's `MOM`/`YOY` columns** and compute changes ourselves (§5). Checked on
  the 2026-09 file: our YoY matches theirs within rounding for all 50 metros.
- **New methodology, not a continuation.** Several definitions and the national coverage
  changed (e.g. May 2026 national median sale price $399,900 vs $449,846 in the old
  export; "sold above list" is now above the *original* list price; the price-drop share
  is of active listings). Every series therefore comes from one source; old and new rows
  are never spliced.
- **Fallback:** if any Data Center file above fails to download or parse, both metro and
  national data come from the legacy exports below (never a mix), with a
  `meta.warnings` line. If those fail too, the run fails.
- **Staleness:** when the latest month is older than `redfin_stale_after_days` (75,
  `config/real_estate.toml`), the run still publishes and adds a `meta.warnings` line.

**Legacy exports (fallback only; frozen since 2026-06-02):**

- Metro: `https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/redfin_metro_market_tracker.tsv000.gz`
- National: `https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/us_national_market_tracker.tsv000.gz`
- The format is gzipped TSV. **The metro file is large** (hundreds of MB uncompressed), so:
  1. Download to `data/cache/real_estate/` with a **conditional GET** (`If-None-Match` / `If-Modified-Since`). If the server returns 304, skip reprocessing entirely.
  2. Read lazily with **polars** (`pl.scan_csv(..., separator="\t")` on the decompressed file) and filter early:
     - `REGION_TYPE == "metro"`
     - `PROPERTY_TYPE == "All Residential"`
     - `PERIOD_DURATION == 30` (monthly rows)
     - `IS_SEASONALLY_ADJUSTED == false` (or `"f"`; check the actual encoding)
     - `REGION` in the tracked set
     - `PERIOD_END >= today − 40 months`
  3. Write the filtered result to `data/cache/real_estate/redfin_metro.parquet` (small), and use that for everything else.
- Columns used (uppercase at the time of writing; normalize to lowercase on read): `PERIOD_BEGIN, PERIOD_END, REGION, STATE_CODE, TABLE_ID, MEDIAN_SALE_PRICE, HOMES_SOLD, NEW_LISTINGS, INVENTORY, MONTHS_OF_SUPPLY, MEDIAN_DOM, AVG_SALE_TO_LIST, SOLD_ABOVE_LIST, PRICE_DROPS, OFF_MARKET_IN_TWO_WEEKS, LAST_UPDATED`. Ratios are already ratios in this format.
- `scripts/build_metro_config.py` still ranks metros from the legacy file (a one-time setup step).

**Attribution required:** "Data: Redfin, a national real estate brokerage." Link to `https://www.redfin.com/news/data-center/`.

### 3.2 Zillow Research (home values and rents)

- ZHVI (metro, mid-tier, smoothed, SA): `https://files.zillowstatic.com/research/public_csvs/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`
- ZORI (metro, smoothed): `https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv`. Confirm the exact filename on the Zillow Research data page.
- The format is wide CSV, with one row per region and one column per month (`YYYY-MM-DD`). Melt it to long format and keep the last 40 months.
- Join key: Zillow `RegionID`, stored per metro in `metros.toml` (§8). **Don't join on names at runtime.**
- **Attribution required:** "Zillow Home Value Index (ZHVI) and Zillow Observed Rent Index (ZORI), Zillow Research." Link to `https://www.zillow.com/research/data/`.
- Check Zillow's terms before any commercial use (§15).

### 3.3 FRED (national context and rates)

The same client as the macro agent (`SPEC_MACRO.md` §3), with `last_updated` change detection. Series are in §2.

### 3.4 Census Building Permits Survey (new construction by metro)

- CBSA-level monthly ASCII files are under `https://www2.census.gov/econ/bps/`, with the layout documented in `https://www2.census.gov/econ/bps/Documentation/cbsaasc.pdf`. There are "current month" and "year-to-date" variants.
- Parse the total units, 1-unit, 2-unit, 3–4-unit and 5+-unit columns per the documentation. Match on the **CBSA code** stored in `metros.toml`.
- This source is **optional** (`use_permits = true` by default). If the fetch or parse fails, set permits to `null` and continue.
- Attribution: "U.S. Census Bureau, Building Permits Survey."

### 3.5 Census reference data (static, refreshed yearly)

- **CBSA centroids** (lat/lon for the map) from the Census Gazetteer CBSA file, e.g. `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cbsa_national.zip` (check the latest year). These are written into `metros.toml` once by the setup script, not fetched on every run.
- **Median household income** by metro from the ACS 1-year API: `https://api.census.gov/data/<year>/acs/acs1?get=NAME,B19013_001E&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*`. The optional key goes in `CENSUS_API_KEY`. This is refreshed once a year, cached as `data/real_estate/acs_income.json`, and used for affordability ratios.

---

## 4. Pipeline

```
fetch (conditional) ─▶ filter/normalize ─▶ compute metrics ─▶ flags + temperature ─▶ movers
      │                                                                              │
      └─ unchanged? ── yes ─▶ refresh rates only, reuse briefs ─────────────────────┤
                                                                                     ▼
                                     briefs (fast, Batch API) + national (smart) ─▶ guard ─▶ validate ─▶ publish
```

### Module layout

```
agents/real_estate/
├── __init__.py            # registers the agent
├── config.py              # loads metros.toml + real_estate.toml
├── metrics.py             # metric registry (§2)
├── fetch_redfin.py        # conditional download, lazy filter → parquet
├── fetch_zillow.py        # ZHVI/ZORI download, melt, filter by RegionID
├── fetch_fred.py          # thin wrapper around the shared FRED client
├── fetch_permits.py       # Census BPS CBSA parser
├── transform.py           # join sources → tidy frame keyed by (slug, month)
├── compute.py             # latest, YoY, MoM, 3-mo trend, highs/lows, percentiles
├── flags.py               # deterministic flags (§5.4)
├── temperature.py         # market temperature score (§5.3)
├── movers.py              # top/bottom lists
├── analyze.py             # prompts, batch submission/polling, fallback
├── templates.py           # deterministic fallback briefs + headline
├── schema.py              # pydantic output models (§6)
└── state.py               # data/real_estate/state.json (source versions, brief hashes)
scripts/
├── build_metro_config.py  # one-time: propose top-50 metros + IDs for review
└── verify_re_sources.py
```

### State (`data/real_estate/state.json`, committed, not published)

```json
{
  "sources": {
    "redfin_metro": { "etag": "…", "last_modified": "…", "data_through": "2026-08-31" },
    "zillow_zhvi": { "etag": "…", "data_through": "2026-08-31" },
    "zillow_zori": { "etag": "…", "data_through": "2026-08-31" },
    "permits": { "data_through": "2026-07-31" },
    "fred": { "MORTGAGE30US": "2026-09-18 …" }
  },
  "brief_hashes": { "austin-tx": "sha256 of the facts dict used for the last brief" }
}
```

**Brief caching:** each metro's facts dict (§7.2) is hashed. If the hash is unchanged since the last run, the previous brief is reused and no LLM call is made. This is the main cost control.

---

## 5. Computations (all in Python)

### 5.1 Changes

For each metric and metro, at the latest month `t`:

| Field | Formula |
|---|---|
| `value` | `x_t` |
| `yoy` | `(x_t / x_{t−12} − 1)` as a ratio for levels. For **shares and ratios** (price_drops, sold_above_list, avg_sale_to_list, off_market_in_two_weeks) it is `x_t − x_{t−12}` in **pp**, and for `median_dom` it is a difference in **days**. |
| `mom` | The same rules against `t−1`, labeled "not seasonally adjusted" |
| `trend_3m` | The slope sign of the last 3 months: `up`, `down` or `flat` (flat if the relative change is < 0.5%) |
| `high_36m` / `low_36m` | Whether `x_t` is the max or min of the last 36 months |
| `pct_rank` | Percentile rank of `x_t` (and separately of `yoy`) among the tracked metros |

Every metric declares its `change_kind` (`ratio | pp | diff`) in the registry, and the output carries the correct `delta_format` for the site. **Never publish a percent change of a percentage.**

Permits use **rolling 12-month sums** for YoY, because monthly permits are noisy.

### 5.2 Affordability (for the calculator and briefs)

- `payment_now`: monthly P&I on `median_sale_price × (1 − 0.20)` at the latest `mortgage30`, over a 30-year term.
- `payment_year_ago`: the same using the price 12 months ago and the rate 52 weeks ago.
- `payment_change_pct`: the change between the two.
- `payment_to_income`: `payment_now × 12 / median_household_income`, when income is available.
- Use the same amortization function as the site (`M = P·r(1+r)^n / ((1+r)^n − 1)`), with shared test vectors. The site's calculator should reproduce these numbers exactly with default inputs.

### 5.3 Market temperature

This measures how **competitive** a metro is **relative to the other tracked metros**, and the site's tooltip says so.

1. Components, each z-scored across the 50 metros at the latest month:
   - `+ avg_sale_to_list`
   - `+ sold_above_list`
   - `+ off_market_in_two_weeks`
   - `− median_dom`
   - `− price_drops`
   - `− months_of_supply`
2. `score_raw` is the mean of the available component z-scores. At least 4 of the 6 are required, otherwise the score is `null`.
3. `score = round(100 × Φ(score_raw))`, where Φ is the standard normal CDF, giving 0–100.
4. Labels: ≥ 80 **Hot**, 60–79 **Warm**, 40–59 **Balanced**, 20–39 **Cool**, < 20 **Cold**.
5. Separately, `market_type` is an absolute measure from months of supply: < 3 **Seller's market**, 3–6 **Balanced**, > 6 **Buyer's market**.
6. The output includes each component's z-score, so the tooltip can explain the score.

National gets a temperature computed from the national Redfin series against its own 36-month history (a time z-score) and labeled "vs its own 3-year history".

### 5.4 Flags (deterministic, configurable)

The thresholds live in `config/real_estate.toml`. Each flag has an `id`, a `label`, a `severity` (`info | notable | major`) and a `facts` dict.

| Flag id | Rule (default) | Severity |
|---|---|---|
| `inventory_surge` | `inventory.yoy ≥ +25%` | notable (major if ≥ +50%) |
| `inventory_drop` | `inventory.yoy ≤ −20%` | notable |
| `price_decline` | `median_sale_price.yoy ≤ −3%` | notable (major if ≤ −8%) |
| `price_surge` | `median_sale_price.yoy ≥ +8%` | notable |
| `price_36m_high` / `price_36m_low` | §5.1 | info |
| `price_cuts_high` | `price_drops` is at a 36-month high **and** `price_drops.yoy ≥ +3 pp` | notable |
| `slowing` | `median_dom.yoy ≥ +10 days` | info |
| `buyers_market` | `months_of_supply` crossed above 6 this month | notable |
| `sellers_market` | `months_of_supply` crossed below 3 this month | notable |
| `rent_outpacing` | `zori.yoy − zhvi.yoy ≥ 3 pp` | info |
| `permits_boom` / `permits_bust` | 12-month permits YoY ≥ +30% or ≤ −30% | info |
| `payment_jump` | `payment_change_pct ≥ +10%` | notable |

The **alerts strip** on the site shows `notable` and `major` flags, grouped by flag id across metros.

### 5.5 Movers

- Top and bottom 5 by `median_sale_price.yoy`.
- Top 5 by `inventory.yoy`.
- Top 5 by temperature, and bottom 5 (optional on the site).
- Exclude metros where the metric is null. Tie-break by `homes_sold` (larger market first).

### 5.6 Headline and key stats (manifest)

Both are deterministic, from `templates.py`:

- Headline example: "Inventory up {x}% YoY nationally; {n} of 50 metros have more price cuts than a year ago." The template picks between 4 patterns based on which national change is largest in absolute z-terms.
- `key_stats`: the US median sale price (YoY) and the 30-yr rate (weekly change in pp).

---

## 6. Output schema (the site contract)

The pydantic models in `agents/real_estate/schema.py` are the source of truth, exported to `schemas/real_estate.schema.json`.

### 6.1 `site/public/data/real_estate/latest.json` (index, ≤ ~150KB)

```json
{
  "meta": { "...": "shared meta block, SPEC_WEBSITE §3" },
  "headline": "Inventory up 14% YoY nationally; 31 of 50 metros have more price cuts than a year ago.",
  "key_stats": [
    { "label": "US median sale price", "value": 431200, "format": "currency_compact", "delta": 0.021, "delta_format": "percent_signed", "good_direction": "neutral" },
    { "label": "30-yr mortgage", "value": 6.18, "format": "percent", "delta": -0.07, "delta_format": "pp_signed", "good_direction": "neutral" }
  ],
  "data_through": "2026-08-31",
  "rates_as_of": "2026-09-18",
  "metric_registry": [
    { "key": "median_sale_price", "label": "Median sale price", "format": "currency", "change_kind": "ratio", "good_direction": "neutral", "source": "redfin", "note": "Not seasonally adjusted" }
  ],
  "national": {
    "latest": {
      "median_sale_price": { "value": 431200, "yoy": 0.021, "mom": -0.004, "delta_format": "percent_signed", "trend_3m": "flat" },
      "inventory": { "value": 1612000, "yoy": 0.14, "mom": 0.01, "delta_format": "percent_signed", "trend_3m": "up" },
      "price_drops": { "value": 0.071, "yoy": 0.009, "delta_format": "pp_signed" }
    },
    "temperature": { "score": 41, "label": "Balanced", "basis": "vs own 3-year history" },
    "series": {
      "dates": ["2023-09-30", "…", "2026-08-31"],
      "median_sale_price": ["…"], "inventory": ["…"], "median_dom": ["…"], "price_drops": ["…"],
      "avg_sale_to_list": ["…"], "months_of_supply": ["…"], "homes_sold": ["…"], "new_listings": ["…"]
    },
    "rates": {
      "dates": ["weekly, 3 years"],
      "mortgage30": ["…"],
      "mortgage15": ["…"],
      "latest": { "mortgage30": 6.18, "mortgage30_change_1w_pp": -0.07, "mortgage30_year_ago": 6.35 }
    },
    "construction": {
      "housing_starts": { "value": 1342, "mom": -0.021, "units": "thousands, SAAR", "period": "2026-08-01" },
      "permits": { "value": 1398, "mom": 0.012, "units": "thousands, SAAR", "period": "2026-08-01" },
      "series": { "dates": ["…"], "housing_starts": ["…"], "permits": ["…"] }
    },
    "case_shiller": { "value": 331.2, "yoy": 0.018, "period": "2026-06-01" },
    "brief": {
      "text": "4–6 sentences",
      "key_points": ["…", "…", "…"],
      "citations": [{ "name": "Redfin Data Center", "url": "https://www.redfin.com/news/data-center/" }],
      "narrative_source": "llm",
      "model": "claude-sonnet-5",
      "generated_at": "…"
    }
  },
  "metros": [
    {
      "slug": "austin-tx",
      "name": "Austin, TX",
      "cbsa": "12420",
      "lat": 30.26,
      "lon": -97.75,
      "homes_sold_12m": 31240,
      "latest": {
        "median_sale_price": { "value": 441000, "yoy": -0.031 },
        "inventory": { "value": 12880, "yoy": 0.21 },
        "median_dom": { "value": 61, "yoy": 9 },
        "price_drops": { "value": 0.112, "yoy": 0.018 },
        "avg_sale_to_list": { "value": 0.968, "yoy": -0.004 },
        "months_of_supply": { "value": 5.8, "yoy": 0.7 },
        "homes_sold": { "value": 2410, "yoy": -0.05 },
        "new_listings": { "value": 3905, "yoy": 0.03 },
        "zhvi": { "value": 452300, "yoy": -0.041 },
        "zori": { "value": 1705, "yoy": -0.012 },
        "permits_total": { "value": 2210, "yoy_12m": -0.18 }
      },
      "temperature": { "score": 18, "label": "Cold" },
      "market_type": "Balanced",
      "flags": ["inventory_surge", "price_decline"],
      "brief_excerpt": "First sentence of the metro brief (≤ 160 chars)."
    }
  ],
  "movers": {
    "price_gains": [{ "slug": "…", "name": "…", "value": 0.071 }],
    "price_declines": [{ "slug": "…", "name": "…", "value": -0.052 }],
    "inventory_growth": [{ "slug": "…", "name": "…", "value": 0.44 }]
  },
  "alerts": [
    { "flag": "inventory_surge", "label": "Inventory +25% YoY", "severity": "notable", "slugs": ["austin-tx", "tampa-fl", "denver-co"] }
  ],
  "sources": [
    { "name": "Redfin Data Center", "url": "https://www.redfin.com/news/data-center/", "attribution": "Data: Redfin, a national real estate brokerage." },
    { "name": "Zillow Research", "url": "https://www.zillow.com/research/data/", "attribution": "Zillow Home Value Index (ZHVI) and Zillow Observed Rent Index (ZORI)" },
    { "name": "FRED, Federal Reserve Bank of St. Louis", "url": "https://fred.stlouisfed.org/" },
    { "name": "U.S. Census Bureau, Building Permits Survey", "url": "https://www.census.gov/construction/bps/" }
  ]
}
```

### 6.2 `site/public/data/real_estate/metros/<slug>.json` (≤ ~40KB each)

```json
{
  "slug": "austin-tx",
  "name": "Austin, TX",
  "cbsa": "12420",
  "lat": 30.26,
  "lon": -97.75,
  "data_through": "2026-08-31",
  "latest": {
    "median_sale_price": {
      "value": 441000, "yoy": -0.031, "mom": 0.004, "delta_format": "percent_signed",
      "trend_3m": "down", "high_36m": false, "low_36m": false, "pct_rank": 0.62, "yoy_pct_rank": 0.08
    }
  },
  "temperature": {
    "score": 18, "label": "Cold",
    "components": { "avg_sale_to_list": -1.1, "sold_above_list": -0.9, "off_market_in_two_weeks": -1.0, "median_dom": -1.3, "price_drops": -0.8, "months_of_supply": -0.6 }
  },
  "market_type": "Balanced",
  "flags": [
    { "id": "inventory_surge", "label": "Inventory +21% YoY", "severity": "notable", "facts": { "inventory_yoy": 0.21 } }
  ],
  "affordability": {
    "median_household_income": 97100,
    "income_year": 2024,
    "payment_now": 2156.12,
    "payment_year_ago": 2291.40,
    "payment_change_pct": -0.059,
    "payment_to_income": 0.266,
    "assumptions": { "down_payment_pct": 0.20, "term_years": 30, "rate_now": 6.18, "rate_year_ago": 6.35, "price_year_ago": 455100 }
  },
  "series": {
    "dates": ["2023-09-30", "…", "2026-08-31"],
    "median_sale_price": ["…"], "homes_sold": ["…"], "new_listings": ["…"], "inventory": ["…"],
    "months_of_supply": ["…"], "median_dom": ["…"], "avg_sale_to_list": ["…"], "sold_above_list": ["…"],
    "price_drops": ["…"], "off_market_in_two_weeks": ["…"], "zhvi": ["…"], "zori": ["…"],
    "permits_total": ["…"], "permits_1unit": ["…"], "permits_5plus": ["…"]
  },
  "brief": {
    "text": "3–4 sentences, ≤ 90 words",
    "key_points": ["≤ 3 short items"],
    "citations": [{ "name": "Redfin Data Center", "url": "https://www.redfin.com/news/data-center/" }],
    "narrative_source": "llm",
    "model": "claude-haiku-4-5-20251001",
    "generated_at": "…",
    "reused": false
  }
}
```

### Rules

- All series share one `dates` array per file (month-end dates). Missing values are `null`.
- Ratios are published as ratios (0.968), not percents. The site formats them.
- Round at publish time: currency to whole dollars, ratios to 4 decimals, counts to integers.
- `history/YYYY-MM-DD.json` stores **only the index file** (not the metro files), and at most 52 are kept.
- Slugs are stable once created (`<city>-<state>`, lowercase, ASCII). If a metro is renamed, keep the old slug.

### Manifest entry

`id: "real_estate"`, `route: "/real-estate"`, `expected_interval_hours: 168`, `next_run_hint: "Fridays 08:00 PT"`, `items_count: 50`.

### 6.3 Additive fields (schema 1.1.0–1.2.0): metro investigations, alert figures, warnings, sparklines

Added 2026-09-27 (`schema_version` 1.0.0 → 1.1.0). **Every field here is additive and
has a default**, so an index or metro file published under 1.0.0 still validates and
no §6.1/§6.2 field changed meaning. The models are `Investigation`,
`InvestigationSummary` and `AlertMetro` in `agents/real_estate/schema.py`, exported to
`schemas/real_estate.schema.json`.

**Metro investigations.** Each run, the metro investigator
(`agents/real_estate/investigate.py`, an `agents_core.agent_loop.AgentLoop`) explains
*why* up to 3 metros are moving:

- **Targets:** metros with a **new `major` flag** (major in the latest month, not
  major a month earlier), largest market (`homes_sold_12m`) first; if there are none,
  the **top mover** (largest absolute median-sale-price YoY).
- **Tools** (read-only, over the same computed series the metro files publish, in the
  facts dicts' human units): `get_metro_series(slug, metrics, months)`,
  `compare_to_peers(slug, metric)` (the 5 metros closest by `homes_sold_12m` in the
  same Census region), `get_national_context(series)`, `get_rate_history(weeks)`
  (offered only when rate data exists), `find_similar_episodes(slug, metric)` (past
  36 months), and `finish(explanation, cited_metrics)`.
- **Budget:** 8 model calls and $0.05 per investigation (fast tier), inside the run's
  `MAX_RUN_USD`. A budget stop is a graceful partial result: the template is
  published and the stop reason recorded.
- **Guards:** `finish` must be 4–6 sentences, cite known metric keys, and state no
  computed multiples ("3 times", "twice"); the explanation then goes through the number
  guard against everything the tools returned in that run. One retry, then the
  deterministic template (`narrative_source: "template"`). Citations of metrics the
  model never looked at are dropped.
- **Reuse:** like briefs, an investigation is reused (`reused: true`, zero LLM calls)
  while its inputs' hash (the whole investigator snapshot + target + prompt version,
  in `state.json`) is unchanged. Without an API key it's the template, and not cached.

`metros/<slug>.json` gains `investigation` (`null` for metros not investigated this run):

```json
"investigation": {
  "slug": "pittsburgh-pa",
  "name": "Pittsburgh, PA",
  "trigger": "top_mover",              // or "new_major_flag"
  "trigger_flag": null,                // the flag id, for new_major_flag
  "trigger_label": "Median price +7.8% YoY",
  "explanation": "4-6 sentences on why this is happening",
  "cited_metrics": ["median_sale_price", "homes_sold", "inventory"],
  "narrative_source": "llm",           // "template" when the guard/budget/key fell back
  "model": "claude-haiku-4-5-20251001",
  "stop_reason": "finished",           // agents_core LoopResult.stop_reason, or "not_run"
  "steps": 4,
  "tools_called": ["get_metro_series", "compare_to_peers", "get_national_context"],
  "cost_usd": 0.0192,
  "prompt_version": "investigator-2026-09-27.4",
  "generated_at": "2026-09-27T00:45:45Z",
  "reused": false
}
```

`latest.json` gains `investigations` (`[]` when there are no targets), in target order:

```json
"investigations": [
  {
    "slug": "pittsburgh-pa",
    "name": "Pittsburgh, PA",
    "trigger": "top_mover",
    "trigger_label": "Median price +7.8% YoY",
    "summary": "The explanation's first sentence (≤ 240 chars).",
    "cited_metrics": ["median_sale_price", "homes_sold", "inventory"],
    "narrative_source": "llm",
    "stop_reason": "finished"
  }
]
```

**Alert figures.** `alerts[].label` is now the group's **threshold** ("Inventory down
≥20% YoY"), not the first metro's figure, and `alerts[].severity` is the highest in the
group. Each alert gains `metros`, one entry per slug (same order as `slugs`) with the
metro's own figure:

```json
{ "flag": "inventory_drop", "label": "Inventory down ≥20% YoY", "severity": "notable",
  "slugs": ["jacksonville-fl", "miami-fl"],
  "metros": [
    { "slug": "jacksonville-fl", "name": "Jacksonville, FL", "label": "Inventory -24% YoY", "value": -0.2416, "severity": "notable" },
    { "slug": "miami-fl", "name": "Miami, FL", "label": "Inventory -20% YoY", "value": -0.2036, "severity": "notable" }
  ] }
```

**Metro sparklines (schema 1.2.0, added 2026-09-29).** Each `metros[]` entry in the
index gains `spark`: the last 24 month-end **median sale prices**, oldest first, rounded
to whole dollars, `null` for a missing month (default `[]`). It lets a site draw a trend
sparkline per metro without fetching 50 metro files (~7 KB for 50 metros). If the index
is still over `max_index_kb` after §10's national-series trim, `spark` is dropped next
(with a `meta.warnings` line) before the run fails.

```json
{ "slug": "austin-tx", "...": "...", "spark": [441000, 438500, null, 452000] }
```

**Shared meta.** `meta.warnings` (agents-core ≥ 0.2.0) lists this run's degraded
sources, stale metros, trimming and fallbacks in plain language (§10's "log a warning
in meta"); `meta.meta_schema_version` is `"1.1.0"`.

**Conformance notes (no shape change).** `metros[].latest.<metric>` in the index is
exactly §6.1's `{value, yoy}` (it had been serializing 7 extra always-null keys), and
every `delta_format` is one of agents-core's standard `StatFormat`s: day differences
(`median_dom`) are `count_signed`, month differences (`months_of_supply`) `decimal1`.

**Tracing.** Not part of `latest.json`: agents-core writes `trace.json` (+
`trace.schema.json`) next to it after every run, with spans for each phase, this
agent's `fetch:redfin`/`metro_briefs`/`national_brief`/`investigations` steps, every
LLM call, tool call and guard check, and `manifest-entry.json` carries a
`trace_summary`.

### 6.4 Additive (schema 1.3.0): `timeline/<metric>.json` and `timelines`

Added 2026-09-29 for the dashboard's time machine (dashboard v2 spec §8.2 E1).
Additive with defaults: a 1.2.0 index still validates, and the site works without
any timeline file (it falls back to the metro files' 36 months).

- **Files:** `timeline/<metric>.json` for `median_sale_price`, `inventory`,
  `median_dom`, `price_drops` and `months_of_supply`. Body (`TimelineOutput`):
  `{metric, dates: [month-end, ...], metros: {slug: [value | null, ...]}}`, with every
  series aligned to the shared `dates`, oldest first, from `timeline_since`
  (config, default `2012-01`) through the latest month.
- **Values** are Redfin Data Center levels, the same columns and ratio conversion as
  §3.1, only rounded: prices, counts and days to whole numbers; `price_drops` to 3
  decimals; `months_of_supply` to 1 decimal. A month a metro doesn't report is
  `null`. No changes are published here: the site derives YoY for past months from
  these levels with §5.1's rule (ratio metrics: value / value 12 months earlier − 1;
  others: the difference). The latest month's published YoY stays the source for
  the latest month.
- **Source:** the same downloaded `all_metros.csv` / price-drops CSVs, re-read with
  a `since` window (`fetch_redfin.fetch_metro_timeline` → a separate parquet; the
  36-month computations are unchanged). Only Data Center runs publish timelines: the
  legacy export is never spliced in.
- **Budget:** each file ≤ `max_timeline_kb` (120 KB). An oversized file is not
  published that run (a `meta.warnings` line); history is never trimmed silently.
  50 metros × 176 months measures ~60 KB for prices.
- **Index:** `timelines: [{metric, path, start, end, months}]` lists exactly the files
  this run published, so the site requests only those.
- **Optional:** a failed extract warns and publishes no timelines; it never fails
  the run.

### 6.5-6.7 Additive (schema 1.4.0): `events.json`, `pulse.json`, `areas/<slug>.json`

Added 2026-09-29 for the dashboard's event rail, weekly pulse and county-level area
search (dashboard v2 spec §8.2 E2-E4). Additive with defaults: a 1.3.0 index still
validates (`events: null`, `pulse: null`, `areas: []`), and the site renders fully
without any of these files. Each is optional: a failed download or extract warns in
`meta.warnings` and that file isn't published; it never fails the run. Each has a
size budget in `config/real_estate.toml`; a file over budget isn't published that
run (with a warning) rather than trimmed silently.

**§6.5 `events.json`** (`EventsOutput`, ≤ `max_events_kb` = 5 KB; ~2.5 KB with 25
events) - the national moments on the time machine's rail, detected in
`events.py` from the weekly 30-yr rate (FRED `MORTGAGE30US`) and Redfin's national
monthly series, from `timeline_since` (2012-01) through the later of `data_through`
and `rates_as_of`:

```json
{ "since": "2012-01-01", "through": "2026-09-24",
  "rules": { "rate_min_prominence_pp": 0.5, "rate_window_weeks": 8, "turn_hold_before_months": 3, "turn_hold_after_months": 3 },
  "events": [ { "date": "2023-10-26", "kind": "rate_high", "metric": "mortgage30", "value": 7.79, "prominence": 1.81 },
              { "date": "2023-03-31", "kind": "price_yoy_turn_down", "metric": "median_sale_price", "value": -0.0189, "prominence": null } ] }
```

- `rate_high` / `rate_low`: a week no week within 8 on either side beats (ties go to
  the first week of a plateau) with topographic prominence ≥ 0.5 pp; the window's
  overall high and low are always included. `value` is the rate in percent.
- `price_yoy_turn_up` / `price_yoy_turn_down`: the national median sale price's YoY
  (§5.1's ratio rule) crosses zero: the turn month is strictly the new sign, the 3
  months before are never the new sign (at least one is the old), and it plus the next
  2 are never the old sign. An exact zero sides with neither; a missing month breaks
  the window. `value` is that month's YoY ratio.
- `price_yoy_high` / `price_yoy_low`, `inventory_yoy_high` / `inventory_yoy_low`: the
  window's single highest and lowest national YoY.
- Over budget, the least prominent rate turns are dropped first (never the window's
  rate high/low or the other kinds). Runs without FRED rates or on the legacy Redfin
  source publish no events.

**§6.6 `pulse.json`** (`PulseOutput`, ≤ `max_pulse_kb` = 80 KB; ~24 KB) - the last
`pulse_weeks` (12) rolling 4-week windows for every tracked metro from Redfin's
weekly metro file (`housing_market/weekly/all_metros.csv`; the top-50 file ranks by
population and misses 5 of our 50):

```json
{ "window_weeks": 4, "weeks": ["2026-07-05", "...", "2026-09-20"],
  "metros": { "austin-tx": { "median_sale_price": [441000, "..."], "new_listings": [], "pending_sales": [], "active_listings": [] } },
  "yoy": { "austin-tx": { "median_sale_price": -0.021, "new_listings": 0.04, "pending_sales": null, "active_listings": 0.08 } } }
```

Values are Redfin's not-seasonally-adjusted levels (like the monthly pipeline),
rounded to whole numbers. `yoy` is computed here, never copied from Redfin's YoY
columns: the latest window / the window ending exactly 364 days earlier - 1, or null.

**§6.7 `areas/<slug>.json`** (`AreasOutput`, ≤ `max_area_kb` = 60 KB each; the
largest is ~6 KB) - the counties in each metro, from Redfin's monthly county file
(`housing_market/monthly/all_counties.csv`, whose `METRO` column is our
`redfin_region`), for the metro's latest month:

```json
{ "slug": "philadelphia-pa", "level": "county", "data_through": "2026-08-31",
  "areas": [ { "name": "Philadelphia County, PA", "geoid": "42101", "lat": 40.00761, "lon": -75.134,
               "median_sale_price": 282000, "median_sale_price_yoy": 0.053, "inventory": 5210,
               "inventory_yoy": 0.12, "homes_sold": 1103, "homes_sold_yoy": -0.02 } ] }
```

Counties are ordered by homes sold. YoY uses §5.1's ratio rule against the same county
12 months earlier. Centroids are Census Gazetteer internal points from the committed
`config/county_centroids.csv` (`scripts/build_county_centroids.py`, 2024 Gazetteer,
2020 for Connecticut's former counties, independent cities by their Gazetteer
spelling); a weekly run never fetches the Gazetteer. ZIP codes are not published:
Redfin's ZIP file is 364 MB, too large for a weekly run.

**Index:** `events` and `pulse` are `{path, count, through}` or null; `areas` is
`[{slug, path, count}]`, listing exactly the files this run published.

### 6.8 Additive (schema 1.5.0): `regions/<slug>.json`, `regions/<slug>.geo.json`

Added 2026-09-29 for the Regional Desk (`SPEC_REGIONAL_DESK.md` §4.2). Additive with a
default (`regions: []`); the site works without them. Regions are configured in
`config/regions.toml` (Orange County = the `anaheim-ca` metro's ZIPs).

- **Source:** Redfin's `housing_market/monthly/zips_in_top_50_metros.csv` (~360 MB,
  streamed and filtered lazily to the region's metros and the last ~50 months). Each
  value is a **rolling 3-month window** ending that month (`window: "rolling_3_months"`).
- **`regions/<slug>.json`** (`RegionOutput`, ≤ `max_region_kb` = 250 KB; Orange County
  ~159 KB): `zips[]` (every ZIP reporting in the latest month), `cities[]` and a region
  `summary`, each a `RegionArea` `{id, name, kind, city, zips, lat, lon, latest:
  {metric: {value, yoy}}, series: {metric: [36 values]}, ranks}` with `dates` shared.
  Metrics: median sale price, homes sold, new listings, inventory, days on market,
  sale-to-list, sold above list, off market in two weeks, months of supply (percents as
  ratios). **YoY** uses §5.1's rule per the registry's `change_kind` (ratio for levels,
  pp for shares, a difference for days and months). **Cities and the summary** are
  built per month from their ZIPs: sums for homes sold, new listings and inventory;
  **homes-sold-weighted means** of the ZIP values for the rest (labelled as weighted on
  the site), then changed with the same rule. **Ranks** (1 = highest price, fastest price
  growth, fewest days on market) are within the region.
- **`regions/<slug>.geo.json`** (`RegionGeometry`, ≤ `max_region_geo_kb` = 450 KB;
  Orange County ~219 KB): GeoJSON features `{kind: "zip", id, city, city_id, lat, lon}`
  (2020 ZCTAs) and `{kind: "city", id (place GEOID), name, lat, lon}`. Built once by
  `scripts/build_region_geometry.py` from Census TIGERweb (server-generalized, ~40 m) and
  the ZCTA-place relationship file (a ZIP's city is the incorporated place with the most
  land overlap, or the census-designated place when incorporated places cover under a
  quarter of it), committed under `config/regions/`, and copied by each run.
- **Index:** `regions: [{slug, name, path, geometry, zips, cities, through}]`.

---

## 7. LLM usage

### 7.1 Calls per run

| Call | Tier | Mode | When | Est. tokens (each) | Est. cost per full refresh |
|---|---|---|---|---|---|
| Metro brief ×50 | fast | **Batch API** | Only metros whose facts hash changed | ~1.2k in / ~150 out | ~$0.05 (batch discount) |
| National brief | smart | Sync | Any national input changed | ~5k in / ~600 out | ~$0.025 |

Redfin and Zillow update monthly, so a full metro refresh happens about once a month. On the other weekly runs, usually only the national brief regenerates, because the mortgage rate changed.

**Verify model pricing and batch discount at docs.claude.com**, and keep them in `config/models.toml`.

### 7.2 Facts dict (the only thing the model sees)

```json
{
  "metro": "Austin, TX",
  "data_through": "August 2026",
  "metrics": {
    "median_sale_price": { "value": 441000, "yoy_pct": -3.1 },
    "inventory": { "value": 12880, "yoy_pct": 21.0 },
    "median_dom": { "value": 61, "yoy_days": 9 },
    "price_drops_share_pct": { "value": 11.2, "yoy_pp": 1.8 },
    "sale_to_list_pct": { "value": 96.8, "yoy_pp": -0.4 },
    "months_of_supply": { "value": 5.8, "yoy": 0.7 },
    "zori_rent": { "value": 1705, "yoy_pct": -1.2 }
  },
  "temperature": { "label": "Cold", "score": 18, "relative_to": "50 largest metros" },
  "market_type": "Balanced",
  "flags": ["Inventory +21% YoY", "Median price down 3.1% YoY"],
  "rates": { "mortgage30_pct": 6.18, "mortgage30_year_ago_pct": 6.35 },
  "affordability": { "payment_now": 2156, "payment_change_pct": -5.9 }
}
```

The facts are **pre-formatted into human units** (percents as 3.1, not 0.031) so the model doesn't convert anything, and the guard compares against exactly these numbers.

### 7.3 Metro brief prompt (sketch)

**System (cached):**

> You write short, neutral housing market briefs for a public dashboard.
> - Use only numbers from the facts JSON, written exactly as given (you may round to fewer decimals). Never calculate new numbers.
> - Write 3–4 sentences, at most 90 words. Lead with the most important change. Mention mortgage rates only if they're relevant.
> - Use "pp" for changes in shares or rates and "days" for days on market.
> - No predictions, no advice, no hype words. Say "relative to the 50 largest metros" when you mention temperature.
> - Return JSON: `{ "text": str, "key_points": [str] }` with at most 3 key points of 12 words or fewer each.

**User:** the facts JSON.

Citations are attached by code (Redfin always, Zillow if a Zillow metric is mentioned, which the code detects by metric keys in the facts).

### 7.4 Batch flow (`analyze.py`)

1. Build requests for the metros whose facts hash changed, with `custom_id = slug`.
2. Submit through `core.llm.batch_submit(requests, tier="fast")`.
3. Poll every 30s for up to **40 minutes** (`batch_poll_timeout_min`).
4. When the batch ends, parse each result, run the guard, and retry failures **synchronously** (fast tier). If a retry also fails, use the template.
5. If the batch hasn't finished by the timeout: cancel it, run the remaining requests synchronously (fast tier, concurrency 5), and log `batch_fallback: true` in meta.
6. Record cost per request through `core/costs.py`, applying the batch discount rate.

### 7.5 National brief

Smart tier, synchronous. The input is the national facts, plus the top 5 alerts, the movers and the counts ("31 of 50 metros have higher price_drops YoY"). The output is `{ text (4–6 sentences), key_points (3) }`, with the same guard and rules.

### 7.6 Guard and fallback

Use `core.guards.verify_numbers(text, facts_numbers)`, where `facts_numbers` is every number in the facts dict plus the count values. The template fallback is something like: "{metro}'s median sale price was {price} in {month}, {up/down} {x}% from a year earlier. Inventory {rose/fell} {y}% YoY, and homes spent a median {d} days on market. The market is {label} relative to the 50 largest metros."

---

## 8. Configuration

### `config/metros.toml` (generated once, then hand-reviewed)

```toml
# Generated by scripts/build_metro_config.py on 2026-09-24, then reviewed by hand.
[[metro]]
slug = "austin-tx"
name = "Austin, TX"
redfin_region = "Austin, TX metro area"   # exact REGION string in the Redfin file
zillow_region_id = 394355                  # Zillow RegionID (fill from the Zillow CSV)
cbsa = "12420"                             # Census CBSA code (permits, ACS, centroid)
lat = 30.26
lon = -97.75
```

**`scripts/build_metro_config.py`:**

1. Loads the Redfin metro file and picks the **top 50 metros by homes sold over the last 12 months**.
2. Proposes Zillow `RegionID`s by normalized name match against the ZHVI CSV (e.g., "Austin, TX" to "Austin, TX").
3. Proposes CBSA codes and centroids by matching against the Census Gazetteer CBSA names.
4. Writes `config/metros.toml` with `# REVIEW` comments on any fuzzy or missing match.
5. Prints a table of match confidence.

Matching is done **once at setup and reviewed by hand**, never at runtime.

### `config/real_estate.toml`

```toml
[settings]
history_months = 36
use_permits = true
use_acs_income = true
batch_poll_timeout_min = 40
max_index_kb = 150
max_metro_kb = 40

[flags]
inventory_surge_yoy = 0.25
inventory_surge_major_yoy = 0.50
inventory_drop_yoy = -0.20
price_decline_yoy = -0.03
price_decline_major_yoy = -0.08
price_surge_yoy = 0.08
price_cuts_yoy_pp = 0.03
slowing_dom_days = 10
rent_outpacing_pp = 3.0
permits_swing_12m = 0.30
payment_jump = 0.10

[temperature]
min_components = 4
bands = [80, 60, 40, 20]
```

---

## 9. Scheduling (`.github/workflows/agent-real-estate.yml`)

| Trigger | Cron (UTC) | Why |
|---|---|---|
| Weekly | `0 15 * * 5` | Friday 08:00 PT, after Thursday's Freddie Mac rate release |
| Manual | `workflow_dispatch` with an input `force_briefs: boolean` | Regenerate every brief regardless of hashes |

Job steps:
1. Checkout.
2. `uv sync`.
3. Restore `data/cache/real_estate/` with `actions/cache`, keyed by week, to avoid re-downloading the big Redfin file when nothing changed.
4. `uv run python -m core.runner real_estate`.
5. Commit changes under `site/public/data/real_estate` and `data/real_estate`.
6. Call `deploy-site.yml`.

Settings:
- `timeout-minutes: 60` (to allow for the batch wait).
- Shared concurrency group `agents-data-push`.
- `MAX_RUN_USD=0.50`.

---

## 10. Errors and edge cases

| Situation | Behavior |
|---|---|
| Redfin 304 Not Modified and no rate change | Nothing to do. Update `meta.last_run_at` and `data_changed: false`, with zero LLM calls. |
| Redfin 304, rate changed | Recompute affordability, update rates, regenerate the national brief only, and reuse metro briefs. Metro affordability numbers change but briefs are reused, so briefs never quote payment figures that would go stale. |
| Redfin columns missing or renamed | Fail with a list of the missing columns. Don't publish; the previous data stays. |
| A tracked metro is missing from the latest Redfin month | Keep its last available data and set `stale_metro: true`. The site shows "Data through Jul 2026". |
| Zillow download fails | Set `zhvi`/`zori` to null for this run, publish the rest, and log a warning in meta. |
| Permits parse fails | Set permits to null, publish the rest, and log a warning. |
| Batch API timeout | Synchronous fallback (§7.4). |
| Guard failure | Retry once, then use the template. |
| Index > `max_index_kb` | Drop `national.series` metrics beyond the core 6, then fail if it's still too large. |
| Metro file > `max_metro_kb` | Reduce to 24 months of history and log it. |
| Huge Redfin file on the Actions runner | The lazy polars scan keeps memory low. Delete the decompressed TSV after writing the parquet. |

---

## 11. Testing

| Test | What it covers |
|---|---|
| `test_fetch_redfin.py` | Filtering on a small fixture TSV (100 rows covering several metros, property types and durations), column assertion, conditional GET 304 path |
| `test_fetch_zillow.py` | Wide-to-long melt, RegionID filter |
| `test_permits_parse.py` | A fixture ASCII file parsed per the documented layout |
| `test_compute.py` | YoY/MoM for each `change_kind` (ratio, pp, diff), 36-month highs and lows, percentile ranks, permits rolling 12-month |
| `test_affordability.py` | Shared test vectors with the site (e.g., $400,000 at 6.5% over 30 years = $2,528.27) |
| `test_temperature.py` | Z-scores, the min-components rule, band edges |
| `test_flags.py` | Every flag at its threshold ±ε |
| `test_movers.py` | Nulls excluded, tie-break |
| `test_analyze_batch.py` | Batch success, partial failure, timeout fallback (mocked client) |
| `test_brief_cache.py` | Unchanged facts hash means no request is built |
| `test_schema.py` | Fixture output validates, size limits are enforced, the JSON Schema snapshot is stable |

HTTP is always mocked in CI (`respx`), and fixtures live in `tests/fixtures/real_estate/`.

### Evals (`evals/real_estate/`)

| Eval | Fixture | Pass criteria |
|---|---|---|
| Number fidelity | 12 metro facts dicts covering hot, cold, flat, missing Zillow and a big inventory surge | 100% of final briefs pass the guard, and the first-attempt pass rate is ≥ 90% |
| Flag coverage | The same fixtures | Every `major` flag is mentioned in its brief. A fast-tier LLM judge with a yes/no rubric checks this, with ≥ 90% agreement. |
| No-advice / style | All | No banned phrases ("buy now", "great time to", "will rise", "crash") and ≤ 90 words |
| Units correctness | All | No "%" directly after a number that is a pp change in the facts. A regex over tokens checked against `yoy_pp` facts handles this. |
| National summary | 2 national fixtures | Guard passes, the top 2 alerts are covered, and it's 6 sentences or fewer |

Results go to `evals/results/real_estate-<date>.json`.

---

## 12. Cost budget

| Item | Frequency | Est. per month |
|---|---|---|
| Metro briefs (50, batch) | About 1 full refresh/month, plus a few partial | ~$0.06 |
| National brief | ~4/month | ~$0.10 |
| Evals (dev) | As needed | ~$0.50 |
| **Total scheduled** |  | **≈ $0.20/month** |

The per-run cap is `MAX_RUN_USD=0.50`.

---

## 13. Acceptance criteria

- [ ] `scripts/build_metro_config.py` produces a reviewed `metros.toml` with 50 metros, all with a Redfin region and CBSA, and at least 48 with a Zillow ID.
- [ ] `--dry-run` downloads, filters and computes everything, printing a per-metro table of latest values, YoY, temperature and flags with no LLM calls.
- [ ] A real run publishes an index of ≤ 150KB and 50 metro files each ≤ 40KB, all validated.
- [ ] An immediate second run makes **zero** LLM calls (every hash matches, and Redfin returns 304 or is unchanged).
- [ ] Forcing a mortgage rate change in a fixture regenerates only the national brief.
- [ ] The affordability numbers match the site calculator exactly with default inputs.
- [ ] Every unit test passes and evals meet §11 thresholds.
- [ ] The `/real-estate` page renders with real data, and `/real-estate/austin-tx` (or any slug) works.

---

## 14. Build order (prompts for Claude Code)

1. **Sources and config:** "Read `docs/specs/SPEC_REAL_ESTATE.md`. Implement `scripts/verify_re_sources.py` and `scripts/build_metro_config.py` (§3, §8). Run them and show me the proposed `metros.toml` with the matches flagged for review."
2. **Fetchers:** "Implement `fetch_redfin.py` (conditional GET, lazy polars filter to parquet), `fetch_zillow.py`, `fetch_fred.py` and `fetch_permits.py`, with fixture-based tests."
3. **Compute:** "Implement the metric registry and §5.1–§5.5 (`compute`, `affordability`, `temperature`, `flags`, `movers`) with tests. Add `--dry-run` output as a readable table."
4. **Schema and publish:** "Implement the §6 schema, size checks and JSON Schema export. Publish the index and metro files with template briefs only."
5. **LLM:** "Implement §7: facts dicts, prompts, the batch flow with polling and synchronous fallback, brief hash caching, national brief and guard."
6. **Evals:** "Build `evals/real_estate` per §11."
7. **Workflow:** "Add `agent-real-estate.yml` per §9 with the cache step and a `force_briefs` input."

---

## 15. Future and monetization

- **ZIP-level or county-level drill-down** using the Redfin ZIP and county trackers (much larger files, so it would need a separate job and on-demand per-metro files).
- **Weekly Redfin data** (a separate weekly dataset) for a faster-moving pulse.
- **Local development news:** a per-metro digest of city council and planning agendas (zoning changes, large projects). This is a natural extension.
- **White-label reports:** a PDF or email per metro for agents and brokers, with their logo. **Before selling,** review the Redfin and Zillow terms for commercial redistribution. Some metrics may need a licensed source, such as MLS data through a broker partner or a paid data vendor.
- **Alerts:** email or webhook when a metro gets a new `major` flag.
