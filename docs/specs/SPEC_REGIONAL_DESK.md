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

### 4.4 Out of scope (for now)

Licensed MLS/IDX listings, photos, payments/subscriptions, email or SMS sending, a
native app, and LLM features touching client data.

## 5. Phases and gates

| Phase | Work | Done when |
|---|---|---|
| **R0 Map fix** | Labels by zoom, road hierarchy, local-zoom styling in both themes; an Orange County framed view. | Screenshots at national, metro, city and street zoom in both themes, reviewed. |
| **R1 Local data** | The ZIP/city extract, geometry script, schema 1.5.0, tests, budgets, sample snapshot. | Python green; files within budget; the site still works without them. |
| **R2 Regional market view** | ZIP choropleth and city layers with labels, a region panel (county → city → ZIP drill-down), rankings, trends, the time machine at ZIP level, table view, area search over ZIPs. | **GATE E:** Orange County screenshots at 3 zooms × 2 themes + phone. |
| **R3 Backend + auth** | Supabase project (the owner creates it), schema and RLS policies as committed migrations, sign-in, team and invites, a security review of every policy with tests. | RLS tests prove cross-team isolation; no secret in the client bundle. |
| **R4 Properties and favorites** | Add by address (geocoder), pins, status, notes, favorites, the properties list and layer. | e2e against a local Supabase. |
| **R5 Clients and calls** | Clients, target areas, calls with outcomes, the follow-up queue, the do-not-call rule, the manager view. | e2e; axe; a data-export test. |
| **R6 Polish** | Performance, a11y, docs (setup, backup, privacy), screenshots. | **GATE F:** final review; merge; verify live. |

## 6. What the owner provides (when R3 starts)

A Supabase project (free tier): its **project URL** and **anon (public) key** for the
site, set as GitHub Actions secrets by the owner. The service-role key is never used by
the site or committed. The first manager account and team name.
