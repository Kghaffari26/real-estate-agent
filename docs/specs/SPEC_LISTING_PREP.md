# SPEC: Listing Prep Advisor: what to change before listing, and what it's worth

Status: draft 2026-09-29, from the owner's product brief. Part of the Regional Desk
(`SPEC_REGIONAL_DESK.md`); built right after R3 (backend + sign-in).

## 1. The question it answers

> "If I have this specific property, this much money, and this target sale price, what
> should I change before listing it to maximize my expected financial return?"

An agent enters an address, confirms the home's facts, uploads photos, sets a target
price and a preparation budget. An agent loop researches the home, its comparables, its
competition and its likely buyers; code computes every value, cost, gain, ROI and
confidence; the report explains each recommendation from that evidence, says plainly
where evidence is thin, and optimizes the spend for several budgets.

## 2. Decisions (owner, 2026-09-29)

| Question | Decision |
|---|---|
| When | **Right after R3**: the Desk's flagship, ahead of listings, foreclosures and CRM. Starts on public data + photos; sharpens when the MLS feed lands. |
| Condition, room by room | **Seller/agent photos inspected by AI vision**, then **confirmed or corrected by the agent** before anything is priced. |
| Improvement costs | **The team's contractor prices** (a cost book entered once, `docs/templates/cost_book.csv`), overridable per property with real quotes. |
| Property facts | **From the MLS feed** (the home's current or past listing), **confirmed by the agent**; the agent fills gaps. Until the feed is live, the agent enters them. |

## 3. Principles (the repo's, applied here)

- **Numbers come from code.** Valuation ranges, comparable adjustments, feature premiums,
  costs, gains, ROI, confidence and the budget optimization are deterministic Python,
  unit-tested. The LLM plans the research, reads photos into structured findings (which
  the agent confirms), and narrates; every figure it writes is checked against the tools'
  outputs by the number guard, with a template fallback.
- **Uncertainty is shown, never hidden.** Every estimate is a range with a confidence
  (High / Moderate / Low) computed from its evidence (§5.6). "Not enough evidence" is a
  valid answer and says what evidence would change it.
- **No invented precision.** A premium with no local evidence uses a documented prior and
  is labelled Low confidence; it is never presented as a finding.
- **Not an appraisal.** Every report says it is a market analysis for pricing strategy,
  not an appraisal, and not a guarantee of sale price.
- **Fair housing.** Buyer "profiles" describe **needs and preferences for the property**
  (bedrooms, schools nearby, a home office, single-level living, a yard), never race,
  color, religion, sex, national origin, disability, familial status, or (California)
  other protected classes as a preference. Demographic data sizes demand for those needs
  and is never used to target or exclude people in marketing. Generated listing copy and
  marketing guidance pass a fair-housing check (a rule list + an LLM reviewer) before
  they are shown; "great for young families" becomes "three bedrooms near highly rated
  schools, with a fenced yard".
- **Privacy.** Photos, reports and seller data live in the private backend under the
  team's row-level security; photos go to the model only for this analysis, with the
  seller's consent recorded.

## 4. The flow (what the agent does in the Desk)

1. **Address** → Census geocoder → lat/lon, ZIP, city, census tract. The Desk shows the
   ZIP/city market context immediately (R2 data).
2. **Facts** (beds, baths, sq ft, lot, year built, property type, garage, pool, last sale,
   HOA): pulled from the MLS feed when the home has a listing history; the agent confirms
   each and fills gaps. Nothing is analyzed until the facts are confirmed.
3. **Photos** by room (and exterior): the vision step returns structured findings per
   photo (room, condition 1-5, dated finishes, paint, flooring, lighting, clutter,
   storage, fixtures, curb appeal, visible repairs) with the evidence crop; the agent
   confirms, edits or rejects each finding. Missing rooms are asked for, not assumed.
4. **Goal**: target price (default: the top of the valuation range) and the seller's
   preparation budget (plus the standard scenarios $5K / $10K / $25K / $50K) and time to
   list (items that don't fit the timeline are excluded).
5. **Run**: the report agent (§6) researches until its evidence thresholds are met or its
   budget is spent, then produces the report (§7). Typical run: a few minutes.
6. **Review and share**: the agent edits notes, locks a version, exports a PDF, and can
   share a read-only link with the seller.

## 5. What gets computed, and from what

### 5.1 Data sources

| Evidence | Source | Available |
|---|---|---|
| Market context: ZIP/city prices, $/sq ft, days on market, sale-to-list, supply, trends | Redfin ZIP data (regions, schema 1.5; add ZIP median $/sq ft) | Now (Orange County) |
| Comparable sales: facts, sale price, sale-to-list, days on market, price cuts, remarks, photos | MLS closed listings (CRMLS feed) | When the license lands |
| Competing listings | MLS active/pending listings | When the license lands |
| Buyer demand by need | Census ACS 5-year by ZCTA/tract (household size, owner households by age of householder, income bands, commuting, home-office proxies) | Now (needs a free Census API key) |
| Schools | California Department of Education and NCES (school locations, public ratings/test data) | Now (public) |
| Amenities, walkability proxies | OpenStreetMap (parks, transit, groceries, dining within walking distance) | Now (public) |
| Condition | Photos + AI vision, agent-confirmed | Now |
| Improvement costs | The team's cost book + per-property quotes | Once the cost book is filled |
| Value recovery priors (when local evidence is thin) | A documented table maintained by the team, seeded from publicly reported industry survey figures with citations | Now, Low confidence |

### 5.2 Valuation range

- **With MLS comps:** select comps (same property type, within ~1 mi and 6-12 months,
  similar size/beds/baths/lot/age, weighted by similarity), adjust each for differences
  (size, beds/baths, lot, age, condition from the findings, pool/garage) with adjustments
  estimated from the local comp set (regression on $/sq ft residuals; shrunk toward
  ZIP-level rates when data is thin), time-adjust with the ZIP trend, and report the
  weighted range (interquartile of adjusted comp prices). Confidence from comp count,
  similarity and dispersion.
- **Before the feed:** ZIP median $/sq ft × confirmed sq ft, adjusted by the city/ZIP
  spread and condition, reported as a wide range with **Low** confidence and a line
  saying comps will narrow it.
- **Backtest** (when the feed lands): on closed sales, the share of actual prices inside
  the predicted range and the median error, by price band; published in the report's
  methodology note.

### 5.3 Buyer pool (needs-based segments)

Segments are defined by what buyers at this price, with this layout, in this place,
need: e.g. *space-seeking households* (3+ bedrooms, schools, yard, storage), *remote
workers* (a quiet office, fiber), *downsizers* (single-level, low maintenance,
walkability), *investors* (rentable layout, ADU potential, rent-to-price), *luxury*
(finishes, outdoor living, privacy). Each segment's weight comes from the price band's
recent buyers (MLS buyer financing/occupancy where available), ACS household composition
of the ZIP/tract, school and amenity proximity, and the home's layout. Each segment lists
its priorities with the evidence behind them. Segments inform what to fix and how to
present it; they are never marketing audiences defined by protected characteristics.

### 5.4 Improvement value (the hard part)

For each candidate improvement (a catalog of ~60: paint, flooring, lighting, landscaping,
storage/closet systems, cabinet refinishing, kitchen and bath cosmetic updates,
hardware, windows, staging, curb appeal, garage organization, office creation, built-ins,
energy and smart-home, minor repairs…):

- **Applicability** from the confirmed findings (e.g. "dated lighting in 6 rooms",
  "no closet system in the primary", "paint condition 2/5").
- **Local premium** (when comps exist): the price difference associated with the
  feature/condition among comparable sales (from structured MLS fields, remarks parsed
  into features by code + an LLM extractor whose output is validated, and photo tags),
  estimated as a residual after the valuation adjustments, with a bootstrap interval.
  Needs a minimum count on both sides; otherwise:
- **Prior**: the documented recovery ratio for the improvement (cost recovered at sale),
  scaled to the price band, always **Low** confidence.
- **Buyer relevance**: the premium is weighted by the segments that value the feature.
- **Output per item:** cost range (cost book × quantities from the findings, or quotes),
  value-increase range, net gain range, ROI, confidence, time to complete, and the
  evidence (the comps and figures behind it).

### 5.5 Budget optimization

- A 0/1 knapsack with groups (mutually exclusive options, e.g. refinish vs replace
  cabinets), dependencies (patch before paint) and a time limit, maximizing
  **risk-adjusted expected net gain**: each item's value is discounted by confidence
  (High uses the midpoint, Moderate the lower-middle, Low the lower bound), so the
  optimizer never buys uncertainty at face value.
- Items with a negative risk-adjusted net gain are never selected: they go to
  **Actions to avoid** with the reason (e.g. a full kitchen remodel recovering ~60% of
  its cost at this price).
- Scenarios at $5K / $10K / $25K / $50K / the seller's budget; a marginal table ("the
  next $5K buys…"); the expected post-improvement range and the net benefit per
  scenario. Dollars left unspent when nothing clears the bar are reported, not forced.

### 5.6 Confidence

Computed, not chosen: **High** when local comp evidence has enough observations, a
tight interval and a consistent sign; **Moderate** with fewer or noisier observations;
**Low** for priors or contradictory evidence. The report shows the counts behind each.

## 6. The report agent (agentic behavior)

An `agents_core.agent_loop.AgentLoop` (smart tier for planning and narration, a
per-report dollar budget) with read-only tools that return computed facts:
`get_property`, `get_market_context`, `find_comparables`, `get_competing_listings`,
`get_buyer_demand`, `get_schools`, `get_amenities`, `get_findings`, `estimate_items`,
`optimize_budget`, `evidence_gaps`, and `finish(report)`. It decides what to research
next (e.g. widen the comp radius, pull competing listings in the price band, check a
feature's premium), stops when `evidence_gaps` is empty or the budget is spent, and
states any remaining gaps in the report. `finish` is number-guarded against everything
the tools returned, checked for the report's structure, and fair-housing reviewed; a
failed check gets one retry, then the template report (all numbers, plain wording).
Runs as a queued job in the backend's Python worker (initially a GitHub Actions job
triggered by the queue; minutes of latency are acceptable for a research report).
Evals: fixture properties with recorded tool outputs (trajectories), graded for
evidence use, guard pass, fair-housing pass, uncertainty statements and structure.

## 7. The report (the brief's nine sections)

1. **Property snapshot**: value range (with method and confidence), likely sale range,
   target price, key strengths and weaknesses (from findings and comps).
2. **Target buyer profile**: segments with weights and their priorities, and the features
   most likely to move them (needs-based, §5.3).
3. **Competitive market analysis**: the comps used (map + table), current competition in
   the price band, and how the subject differs from the stronger performers.
4. **Improvement opportunities**: per item: cost, value increase, net gain, ROI,
   confidence, reasoning and evidence.
5. **Budget optimization**: the scenarios and the marginal allocation table.
6. **Highest-ROI actions**: gain per dollar, ranked.
7. **Actions to avoid**: with the recovery evidence.
8. **Listing preparation strategy**: staging, photography shot list, positioning and
   description angles for the segments, fair-housing reviewed.
9. **Expected outcome**: current range, investment, post-improvement range, incremental
   value, net benefit.

Plus a methodology and evidence appendix, the disclaimers, and the data sources.

## 8. Backend objects (in R3's database, team row-level security)

`properties` (address, geocode, confirmed facts, owner/assignee), `photos` (private
storage), `findings` (per photo: structured, agent status), `cost_book` (team items: unit,
low/high, notes), `quotes` (per property item), `reports` (inputs snapshot, status,
version, outputs JSON, cost), `report_items`, and a `jobs` queue.

## 9. Phases (after R3)

| Phase | Work | Done when |
|---|---|---|
| **P1 Intake** ✅ | Address → geocode and market context; facts form (MLS prefill later); photo upload by room; the cost book (import `cost_book.csv`) and quotes; consent. Built (2026-10-01): geocoding through the `geocode` Edge Function (the Census geocoder has no CORS), by ZIP when unmatched; facts validated and confirmed in the database; consent gates photos at the storage layer; photos re-encoded on the device (≤2048 px, no EXIF). | e2e on a local backend (`desk-db`: `stack.integration.test.ts`). |
| **P2 Vision findings** (in progress) | Photo → structured findings with evidence crops; agent confirm/edit/reject; coverage prompts for missing rooms. Built (2026-10-02): the worker (`agents/listing_prep/`: consent checked before every photo, EXIF/GPS rejected server-side, one `converse` call per photo with a tool, people → skipped, fair-housing screen), review UI, and the owner's safeguards (consent hides photos and withdraws findings, deletion and retention, geocode limits). Remaining: the labelled photo set and its eval. | Findings eval on a labelled photo set; agent confirmation required before use. |
| **P3 Valuation and demand** ✅ | Pre-feed valuation (ZIP $/sq ft; add it to region data), ACS demand by need, schools and amenities; the MLS comp engine behind a flag. Built (2026-10-02): `median_ppsf` in the region data (schema 1.6.0); `valuation.py` (pre-feed range, comp engine with ridge-shrunk adjustments behind `USE_COMPS`, backtest); `demand.py` (needs-based segments from fair-housing-safe ACS variables only); `places.py` (CDE schools, OSM amenities); the worker stores per-property insights and the Desk shows them. | Unit tests; backtest harness ready for the feed (`scripts/backtest_valuation.py`). |
| **P4 Value and optimizer** | The improvement catalog, priors table (cited), premium estimator, confidence rules, the knapsack and scenarios. | Property tests of the optimizer (never exceeds budget, never selects negative risk-adjusted items, monotone in budget). |
| **P5 Report agent** | Tools, loop, guard, fair-housing review, template fallback, evals with recorded trajectories. | Evals pass; guard and fair-housing tests. |
| **P6 Report UI** | The nine sections, evidence drill-down, edit/lock versions, PDF, seller share link. | **GATE G:** a full report on a real Orange County home, reviewed with the owner. |
| **P7 With the MLS feed** | Comp-based valuation and premiums, competing listings, backtest published. | Backtest within the stated coverage. |

## 10. What the owner provides

- The **cost book**: `docs/templates/cost_book.csv` filled with the team's contractor
  prices (low/high per unit), before P4.
- A free **Census API key** (for ACS demand), set as a secret, before P3.
- Consent language for sellers' photos (a default is provided; the brokerage's counsel
  should review it), before P2.
- Already requested: the Supabase project (R3), the CRMLS license (P7), the Anthropic key.
