# SPEC: Metro Pulse "Regional Desk" (v3): a local market desk for real estate teams

Status: draft 2026-09-29, from the owner's review of the live v2 atlas.

## 1. Why

v2 is a national showcase: 50 metros as columns. Zoomed into a real market (the
owner's example: Los Angeles / Orange County) it fails:

- no place names at local zoom (the basemap filter keeps only state/large-city labels,
  and even those don't match the tile style's layer ids), and every road is drawn in
  the same dark ink, so the region reads as a black web;
- one column per metro, so a whole county is one bar;
- nothing an agent works with: houses, clients, calls.

v3 turns the atlas into a **desk for a real estate team watching its own greater
area**: the market down to ZIP and city, the houses they care about, their clients and
their cold calls, on one map. **Orange County** (Redfin's Anaheim-Santa Ana-Irvine
division, our `anaheim-ca`) is the first market; others follow the same pattern.

## 2. Decisions (owner, 2026-09-29)

| Question | Decision |
|---|---|
| Where client data lives | **A private backend with sign-in**: a hosted Postgres with auth and row-level security (Supabase). Nothing personal is ever in the public site, the repo, the data branch or an LLM prompt. |
| Where houses come from | **Agents add addresses.** Geocoded with the free U.S. Census geocoder, pinned, and shown with their ZIP/city market stats. The model leaves room for a licensed listings feed later. |
| First market | **Orange County**, down to ZIP and city. |
| Users | **A team or brokerage**: a shared pipeline and territory, calls attributed to the agent who made them, a manager view. |
| Homes for sale (2026-09-29, after gate E feedback) | **The brokerage's MLS feed** (CRMLS for Orange County) through its RESO Web API, under the broker's IDX data license. No scraping of listing sites. |
| Foreclosures | **All stages:** bank-owned (REO) and short-sale listings (MLS `SpecialListingConditions`), plus **pre-foreclosure notices** (notices of default / trustee sale) and **auctions** from a paid foreclosure data provider (e.g. ATTOM or PropertyRadar; the owner picks one). |

## 3. Principles (unchanged from v1/v2)

- **Numbers come from Python.** ZIP/city market figures, changes, aggregates and ranks
  are computed by the agent, published, and only formatted by the site.
- **The site works without the extras.** The public market view renders without the
  backend; the desk (houses, clients, calls) appears only when signed in.
- **Accessibility is not traded for visuals.** Axe everywhere, keyboard paths, a text
  path for every map layer, both themes, 360 px.

## 4. Scope

### 4.1 The map, done right (all markets)

- **Labels by zoom:** states → metros/large cities → cities and towns → neighborhoods
  and ZIPs, with collision handling, halos and the v2 type. Place names in both themes.
- **Road hierarchy:** motorways and trunks faint but present, arterials fainter,
  local streets only at street zoom; never a uniform black web.
- **Local-zoom data layers:** at metro zoom and closer, the single metro column gives
  way to the finer geography (ZIP choropleth or columns by ZIP), with a legend.
- **Region jump:** "Orange County" (and later others) as a named view: framed camera,
  its layers on, its desk in the side panel.

### 4.2 Local market data (agent, schema 1.5.0, additive)

- `regions/orange-county.json`: every ZIP in the county with the §6 metrics Redfin
  publishes at ZIP level (median sale price, homes sold, new listings, inventory, days on
  market, sale-to-list, sold above list, price drops, months of supply) for the latest
  month, YoY computed in Python, and 36 months of history for the main metrics; the same
  aggregated to **cities** (homes-sold-weighted, labelled as such); ranks within the
  county. Source: Redfin's `zips_in_top_50_metros.csv` (rolling 3 months, filtered while
  streaming to the region's ZIPs), neighborhoods from `nbhds_in_top_50_metros.csv` if
  the coverage holds up.
- **1.6.0 (additive):** each ZIP's and city's `latest` also has `median_ppsf`, Redfin's
  median sale price per square foot (`MEDIAN SALE PRICE PER SQ.FT. ($)`), with YoY as a
  ratio; cities homes-sold-weighted like the other medians. Latest only, no series. It's
  a region-only metric, not in the site-wide metric registry, and the Listing Prep
  pre-feed valuation multiplies it by a home's confirmed square footage
  (SPEC_LISTING_PREP.md §5.2).
- `regions/orange-county.geo.json`: simplified ZCTA and city (Census place) boundaries,
  built once by a script from Census cartographic boundary files and committed, like
  the county centroids. ZIP→city assignment from Census ZCTA-place relationships.
- Budgets: the data file ≤ 250 KB, the geometry ≤ 400 KB (simplified), both lazy.

### 4.3 The desk (signed-in, private)

- **Team and accounts:** email sign-in (magic link), a team, members with roles
  (agent, manager). Row-level security: a member sees only their team's rows.
- **Properties:** add by address → Census geocoder → a pin with its ZIP/city stats;
  status (watching, listed, under contract, sold), notes, tags, owner/assignee;
  **favorites** per agent. Map layer and list.
- **Clients:** name, contact, type (buyer, seller, both, investor), target areas
  (ZIPs/cities drawn from the map), budget, stage (lead, active, under contract,
  closed, lost), linked properties, the assigned agent.
- **Calls (cold calls and follow-ups):** who called, whom (a client, a property owner
  or a raw number), when, outcome (no answer, voicemail, spoke, appointment, not
  interested, do-not-call), notes, next follow-up date. A **follow-up queue**, a
  per-agent log, and a map layer of where calls went.
- **Manager view:** calls per agent and outcome over time, pipeline by stage, and new
  leads by area.
- **Compliance:** a do-not-call flag that blocks logging new outbound calls to that
  contact; no auto-dialing, no bulk messaging. Export and delete a client's data on
  request.

### 4.4 Listings, price briefings and foreclosures (owner feedback at gate E)

- **Where listing data lives:** licensed to the brokerage for display, so it never goes
  into the public data branch. A scheduled job (holding the MLS credentials as
  secrets) syncs the RESO `Property` resource into the backend; the site queries it by
  map view for signed-in users (and a public IDX view later if the license allows).
- **Map and list, listing-site conventions:** homes for sale as markers on the atlas at
  city zoom (a marker sits on its address; the 3D building under it highlights), a
  list beside the map with photo cards (price, beds, baths, sq ft, days on market,
  status badges: New, Price cut, Bank-owned, Short sale, Auction), filters (price,
  beds, baths, type, status, special conditions), and a listing drawer. Conventions
  borrowed from listing sites; no copying of any site's branding or content.
- **"Why is it priced like this?"** A briefing per listing. Every number is computed in
  code first: price and price per sq ft against the listing's ZIP and city medians and
  their YoY, its days on market against the ZIP's, its price-cut history, the ZIP's
  sale-to-list and months of supply, and (when the feed allows) recent comparable
  sales. An LLM narrates those facts only, through the same number guard as the
  agent's briefs, from a backend function (the API key never reaches the browser);
  cached per listing until its facts change.
- **Foreclosures:** REO and short-sale listings come flagged in the feed; pre-foreclosure
  notices and scheduled auctions come from the paid provider as their own map layer and
  a lead list that feeds the call log (R5), with the do-not-call rule applied.
- **Compliance:** IDX attribution (listing office) and the MLS disclaimer on every
  listing view, the feed's refresh and display rules, and no listing data in exports
  beyond what the license allows.

### 4.5 Out of scope (for now)

Payments/subscriptions, email or SMS sending, auto-dialing, a native app, and LLM
features touching client data.

## 5. Phases and gates

| Phase | Work | Done when |
|---|---|---|
| **R0 Map fix** | Labels by zoom, road hierarchy, local-zoom styling in both themes; an Orange County framed view. | Screenshots at national, metro, city and street zoom in both themes, reviewed. |
| **R1 Local data** | The ZIP/city extract, geometry script, schema 1.5.0, tests, budgets, sample snapshot. | Python green; files within budget; the site still works without them. |
| **R2 Regional market view** | ZIP choropleth and city layers with labels, a region panel (county → city → ZIP drill-down), rankings, trends, the time machine at ZIP level, table view, area search over ZIPs. | **GATE E:** Orange County screenshots at 3 zooms × 2 themes + phone. |
| **R3 Backend + auth** | Supabase project (the owner creates it), schema and RLS policies as committed migrations, sign-in, team and invites, a security review of every policy with tests. | RLS tests prove cross-team isolation; no secret in the client bundle. |
| **Listing Prep Advisor** | The pre-listing ROI advisor (`SPEC_LISTING_PREP.md`, phases P1-P7, gate G), built right after R3 at the owner's direction. | See its spec. |
| **R4 Listings** | The RESO sync job (credentials as secrets), the listings table and its RLS, map markers with the building highlight, the list with photo cards and filters, the listing drawer, IDX attribution. Built and tested against a clearly labelled local fixture until the feed is live. | e2e against a local backend; the live feed verified once credentials arrive. |
| **R5 Price briefings** | Listing facts computed in code, the narrating function with the number guard and a template fallback, caching, cost caps. | Guard tests; an eval of briefings against their facts. |
| **R6 Foreclosures** | REO/short-sale flags from the feed; pre-foreclosure notices and auctions from the chosen provider; their layer and lead list. | e2e; provider data verified. |
| **R7 Properties, clients and calls** | Favorites and saved houses, clients and target areas, the call log and follow-up queue, do-not-call, the manager view. | e2e; axe; a data-export test. |
| **R8 Polish** | Performance, a11y, docs (setup, backup, privacy, the licenses), screenshots. | **GATE F:** final review; merge; verify live. |

## 6. What the owner provides

- **R3:** a Supabase project (free tier to start): its **project URL** and **anon (public)
  key** for the site, set as GitHub Actions secrets by the owner. The service-role key
  is never used by the site, never committed and never sent in chat. The first manager
  account and team name.
- **R4:** the brokerage's **MLS data license** for this site (CRMLS, through the broker):
  the RESO Web API endpoint and client credentials, set as secrets by the owner, plus the
  display rules that come with them.
- **R5:** an **Anthropic API key** for the briefing function, set as a backend secret.
- **R6:** an account with a **foreclosure data provider** for notices and auctions.
