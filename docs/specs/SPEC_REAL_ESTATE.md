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
- Columns used (uppercase at the time of writing; normalize to lowercase on read): `PERIOD_BEGIN, PERIOD_END, REGION, STATE_CODE, TABLE_ID, MEDIAN_SALE_PRICE, HOMES_SOLD, NEW_LISTINGS, INVENTORY, MONTHS_OF_SUPPLY, MEDIAN_DOM, AVG_SALE_TO_LIST, SOLD_ABOVE_LIST, PRICE_DROPS, OFF_MARKET_IN_TWO_WEEKS, LAST_UPDATED`. **Assert the expected columns exist** and fail loudly with a list of any missing ones.
- Redfin also publishes precomputed `_MOM` and `_YOY` columns. **Ignore them** and compute changes yourself (§5), so every number comes from one consistent method.
- **Attribution required:** "Data: Redfin, a national real estate brokerage." Link to `https://www.redfin.com/news/data-center/`.

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
