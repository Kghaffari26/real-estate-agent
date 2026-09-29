# SPEC: Metro Pulse v2: a cinematic, interactive housing-market experience

**Repo:** `Kghaffari26/real-estate-agent` · **Folder:** `dashboard/` · **Live:** https://kghaffari26.github.io/real-estate-agent/
**Place this file at:** `docs/specs/SPEC_DASHBOARD_V2.md`
**Supersedes:** the visual layer of dashboard phases 1–3. It keeps their data layer, tests and contract.

---

## 0. How to use this spec (read first, Claude Code)

**Kickoff prompt** (paste into Claude Code on this repo, in the session that has the design plugins):

> Read `docs/specs/SPEC_DASHBOARD_V2.md` end to end, then `docs/specs/SPEC_REAL_ESTATE.md` §6, `dashboard/README.md`, `STATUS.md` and `DECISIONS.md`. Execute the spec phase by phase. Stop at every **DESIGN GATE** and show me the frames before building further. Log every judgment call as one line in `DECISIONS.md`.

Working rules:

1. **Design before code.** Phase 1 produces visual key frames with the design tools. Nothing gets built until a direction is approved at Gate A.
2. **Stop at each DESIGN GATE.** Show screenshots or frames, say what changed and why, and wait for approval. Between gates, work autonomously.
3. **Keep what works.** Keep all of these; replace only the presentation:
   - `src/data/**` (zod schemas generated from `schemas/real_estate.schema.json`, tolerant parsing, versioned data URLs)
   - `src/lib/**` (formatters, amortization)
   - `src/viewmodels/**`
   - the fetch-data script, the deploy workflow and the test suites
4. **Screenshots are the review medium.** After each phase, capture Playwright screenshots (desktop 1440, laptop 1280, mobile 390; dark and light) into `docs/screenshots/v2/`. Look at them yourself before claiming a phase is done.
5. **When unsure, choose the more ambitious option,** as long as it keeps working on a mid-range laptop and a phone.

---

## 1. Why v2 exists (be honest about v1)

v1 is correct, fast and accessible, but it looks like every AI-generated dashboard:

- a sidebar
- a grid of same-size rounded cards
- Inter everywhere
- a Recharts line in each card
- a pastel bubble map

Nothing on screen makes you stop. v2 has to feel like a product someone would pay for and share: a place you **explore**, not a page you scroll.

**The v1 anti-patterns v2 must not repeat** (see the full checklist in §5.7):

- a uniform card grid as the primary layout
- a default Tailwind look (`rounded-xl shadow-sm border` everywhere)
- one chart per card
- a map treated as a widget instead of the canvas
- text-heavy panels competing for attention
- no single hero moment per screen

---

## 2. Product vision

**Metro Pulse is a living 3D atlas of the U.S. housing market.** You arrive at a globe, fall into America, and pull, tilt and scrub your way through 50 metros. Every number is real, computed by the agent. The AI only narrates.

### 2.1 Signature moments (each must be undeniably impressive)

| # | Moment | What the user experiences |
|---|---|---|
| M1 | **Arrival** | A dark, slowly rotating globe with a subtle atmosphere glow. Data "pulses" rise from the U.S. as light columns. On scroll or click, the camera dives from orbit into a tilted 3D map of the continental U.S. The headline and 3 national numbers count up as the camera settles. |
| M2 | **The pull** | A full-bleed 3D map you drag, rotate (right-drag or two-finger twist) and tilt. Metros are extruded light columns: height = the chosen metric's level, color = YoY on a diverging scale. At city zoom, real 3D buildings rise from the basemap. |
| M3 | **Area search** | Click anywhere and a glowing ring appears. A **radius slider** (10–250 mi) grows it live, and a floating panel aggregates every metro inside, weighted by homes sold: median price, YoY, inventory, temperature. With finer geography (§8.2) the ring also picks up counties and ZIPs. |
| M4 | **Time machine** | A scrubber along the bottom edge. Drag through months (Sep 2023 → Aug 2026 now; 2012 → now after §8.1). The columns rise and fall and the colors shift. A play button animates the whole history, a "moments" track marks rate peaks and cuts, and the date appears in large type. |
| M5 | **The house** | Each metro dossier opens on a stylized 3D house on a small plot, lit by the metro's "temperature": cold blue rim light for a cold market, warm amber for a hot one. The house scales with the median price relative to the U.S. median. It rotates slowly, can be dragged, and anchors the affordability studio. |
| M6 | **Affordability studio** | Sliders for price, down payment, rate and term. As you drag them, the house grows or shrinks, a stack of blocks (principal vs interest over the term) rebuilds itself, and a translucent "ghost house" shows the year-ago payment for comparison. Payment-to-income is a ring that fills. |
| M7 | **Compare arena** | Pick up to 3 metros; they stand side by side as three light columns or houses, each in its own entity color. The charts below share one crosshair, and the camera orbits the trio. |

### 2.2 Audience and tone

The audience is investors, agents, brokers, analysts and curious buyers. The tone is calm, precise and cinematic: **Apple keynote meets Bloomberg Terminal meets a planetarium.** It should never be cute and never cluttered.

---

## 3. Non-negotiables

- **Numbers come from data, never from design tools or the model.** Every figure on screen comes from the published JSON through the existing view models. Generated media is decorative only and never carries data.
- **Static hosting.** The site stays a static export on GitHub Pages: no runtime API calls to paid services and no secrets in the frontend. Design-tool assets (Runway video, generated images) are produced at **design time**, optimized, and committed under `dashboard/public/media/`.
- **Attribution.** Keep the Redfin, Zillow, FRED and Census attribution, plus OpenFreeMap/OpenMapTiles/OSM credits for any basemap and a terrain-source credit.
- **Honest imagery.** Never present a generated image or video as a real photo of a specific city. Use abstract, stylized or clearly illustrative visuals: skyline silhouettes, light, grids, and abstract aerials of unnamed places. Put a small "Illustrative" label on any metro-level hero media.
- **Accessibility.** Every 3D or map interaction has an equivalent accessible path: table views, keyboard controls, and text summaries announced with `aria-live`. Axe must report no serious or critical issues in both themes. Honor `prefers-reduced-motion` with static posters, no camera flights and instant transitions.
- **Performance** (§9) and **graceful degradation**: with no WebGL2, a low-end GPU or failed tiles, the site falls back to a beautiful 2D version, never a broken page.
- **Keep the green checks:**
  - lint and typecheck
  - unit tests
  - e2e + axe
  - the schema staleness check
  - the bundle budget, updated per §9
  - the 242 Python tests

---

## 4. Design tools and asset pipeline

### 4.1 Inventory first (Phase 0)

List every design-capable MCP server and skill in this Claude Code environment and record them in `DECISIONS.md`: what each does, its limits, and its cost per call. Expected, but **verify rather than assume**:

- **Runway MCP** (https://runway.com/mcp · https://github.com/runwayml/runway-api-mcp-server): text/image-to-video and image generation.
- Any image-generation, Figma, Adobe, 3D-model, icon or font tools that are present.
- Frontend-design skills, if listed.

If a tool is missing, use the fallback in §4.3. Don't stall.

### 4.2 What to make with the tools

| Asset | Tool (preferred) | Spec |
|---|---|---|
| **Key frames / mood boards** (Gate A) | Image generation, or Figma if present | 3 art directions × 4 frames each (Arrival, Explore, Dossier, Affordability) at 1440×900. Built from real layouts, not vibes: every frame shows real numbers from the sample data. |
| **Arrival ambience loop** | Runway (image → video) | 6–8 s seamless loop behind or around the globe: a starfield, a thin atmospheric haze and slow light streaks. Dark, low-contrast, no text. Export WebM (VP9/AV1) + MP4 (H.264) at ≤ 2.5 MB, with a poster JPEG ≤ 80 KB. |
| **Dossier hero plates** | Runway or image gen | One abstract "night grid" loop or still per **region** (West, Southwest, Midwest, South, Northeast), not per city, to stay honest and keep it light. Each ≤ 1.5 MB video / ≤ 120 KB poster, labeled "Illustrative". |
| **Textures** | Image gen | Subtle film grain (tileable 256 px PNG), a noise normal map for the house plot, and a soft gradient HDRI-like environment for the house lighting (or use drei's built-in environment presets). |
| **House model** | Build procedurally in React Three Fiber (preferred) or generate with a 3D tool if present | A low-poly stylized house: walls, gable roof, chimney, windows with emissive glow, a small plot with grass/ground. ≤ 60 KB as GLB (Draco/meshopt), or 0 KB if procedural. |
| **Product trailer** (Phase 9) | Playwright capture of the real UI, then optional Runway polish for the intro/outro only | 30–45 s, 1080p, ≤ 12 MB MP4 for the README and portfolio. The data shots must be real screen capture. |

### 4.3 Fallbacks if tools are unavailable

- **Ambience:** a procedural shader background (starfield plus noise) in three.js.
- **Plates:** CSS/WebGL gradient meshes with grain.
- **Frames:** build the three directions as quick static HTML prototypes and screenshot them.

### 4.4 Asset hygiene

- Store assets in `dashboard/public/media/`, with source prompts saved beside them in `media/PROMPTS.md` (for reproducibility).
- Lazy-load every video and play it only when visible and only when motion is allowed. Include a visible pause control. Decorative media is `aria-hidden`.
- Total committed media ≤ 15 MB.

---

## 5. Art direction

At **Gate A**, present these three directions as key frames. The user picks one, or a blend.

| Direction | Mood | Palette | Type |
|---|---|---|---|
| **A · Night Atlas** (recommended) | Planetarium / mission control. A deep, near-black navy canvas; data glows. | Ink `#05070D`→`#0B1020`; glass panels at 6–10% white; a single electric accent (cyan `#5CE1E6` or ice-blue); data diverging from cool blue to hot amber-red with a neutral gray midpoint. | Display: **Instrument Serif** or **Fraunces** (for big numbers and titles); UI: **Inter Tight** or **Geist**; figures: **Geist Mono** / **JetBrains Mono** with tabular nums. |
| **B · Daylight Architect** | An architectural model on white paper: soft shadows, clay-white 3D, ink linework. | Paper `#F4F2EE`; graphite ink; one saturated accent (signal orange); a muted diverging palette. | Display: a grotesk at large sizes (e.g. **Space Grotesk** / **Neue Montreal**-like free alternative); UI: **Inter Tight**. |
| **C · Signal Terminal** | A premium trading terminal: dense, sharp, monospaced accents, thin rules. | True black; phosphor green or amber accent; high-contrast data. | **Geist Mono**-led with a condensed grotesk. |

**Whatever is chosen, it must have both a designed dark mode and a designed light mode.** A (dark-first) gets a "Dawn" light variant; B (light-first) gets a "Night" variant.

### 5.1 Layout principles

- **The map/globe is the canvas.** On Explore it is full-bleed. UI floats on top as **glass panels** (backdrop-blur 16–24 px, 1 px inner highlight, subtle grain) that can be collapsed.
- **One hero per screen.** Every screen has one dominant element (globe, map, house, a giant number) and everything else stays quiet.
- **Asymmetric, editorial composition.** Use large type, generous negative space and deliberate overlaps (a number over the map, a title over a plate). No 3-column card grids as a primary layout.
- **A docked control system**, not scattered buttons:
  - a left "layer dock" (metric, layer type)
  - a bottom time scrubber
  - a right context panel (hover, selection, area search)
  - a top command bar (⌘K, theme, freshness chip)

### 5.2 Typography scale (A)

| Role | Size and style |
|---|---|
| Display | 72–120 px, tight tracking |
| Headline numbers | 48–64 px mono |
| Section titles | 28–32 px |
| Body | 15–16 px |
| Labels | 12 px, uppercase +6% tracking |

Figures always use tabular numerals, and numbers animate with an easing counter unless reduced motion is on.

### 5.3 Color and data encoding

- **Diverging YoY:** cool (declines) ↔ neutral gray ↔ hot (gains). The same scale everywhere: map, table cells, chips.
- **Sequential magnitude:** one hue, light→bright, with emissive intensity in 3D (glow encodes magnitude only when also encoded by height or size).
- **Entity colors:** a metro keeps its color across Compare, charts and 3D. Use a fixed categorical order and run the colorblind validator for both modes (the existing validated palette logic can be reused).
- **Status** (notable/major flags) uses reserved colors plus an icon and a label.
- **Market temperature → light:** cold = cool rim light, balanced = neutral, hot = warm key light. The temperature is always also shown as a number.

### 5.4 Motion language

| Interaction type | Duration and easing |
|---|---|
| Micro (hover, press) | 120–180 ms, `cubic-bezier(.2,.8,.2,1)` |
| Panels | 280–380 ms spring (stiffness ~260, damping ~30) |
| Camera moves | 1.2–2.4 s, ease-in-out (`flyTo` with `curve: 1.4`), never interrupting user input |

- Choreography: panels stagger 40 ms; numbers count up over 600–900 ms; charts draw their line left→right on first view only.
- Use GSAP (100% free, including plugins, since 2025; https://gsap.com/pricing/) for timelines and ScrollTrigger on the Arrival scroll, and Framer Motion for component state.
- Reduced motion: no flights (camera jumps), no count-ups, no autoplay video.

### 5.5 Materials and 3D look

- Light columns: emissive core plus a soft bloom (postprocessing, with the bloom threshold tuned so text stays crisp).
- Globe: a dark ocean, faint land hex-dots or coastline lines, and an atmosphere Fresnel glow.
- House: a matte clay material (direction B) or dark glass with glowing windows (direction A), with a contact shadow and slow auto-rotate (paused on reduced motion).

### 5.6 Iconography and details

Use Lucide (already installed) at 1.5 px stroke, consistently. Add custom SVG glyphs for metric types (price, inventory, days, rate). There are no emoji anywhere.

### 5.7 Anti-slop checklist (check at every gate; any "yes" must be fixed)

1. Is the primary layout a grid of same-size cards?
2. Does every panel have the same radius, shadow and border?
3. Is there a screen without one obvious hero?
4. Is there a chart that is only a line in a box, with no annotation, no crosshair and no story?
5. Are there purple-to-blue gradients on white, or glassmorphism with unreadable contrast?
6. Is there lorem, a placeholder, an emoji, or text that says "AI-powered insights"?
7. Is there any number not traceable to the JSON?
8. Is there an animation that exists only to move, rather than to explain or guide?
9. Does anything look worse at 390 px than at 1440 px?

---

## 6. Tech stack (additions to the current Vite + React 18 + TS + Tailwind)

| Need | Library | Notes |
|---|---|---|
| Globe + big data layers | **deck.gl** (`@deck.gl/core`, `layers`, `aggregation-layers`, `geo-layers`, `mapbox`) | `GlobeView` for Arrival; `ColumnLayer` / `HexagonLayer` / `ScatterplotLayer` / `ArcLayer`. Interleave with MapLibre through `MapboxOverlay` (interleaved mode) so columns sit correctly among 3D buildings. Check `GlobeView`'s current stability status and pin versions. |
| Basemap, 3D buildings, terrain | **MapLibre GL JS** (already present) + **OpenFreeMap** styles | 3D buildings from the OpenMapTiles `building` layer through `fill-extrusion` using `render_height` / `render_min_height` (MapLibre's "Display buildings in 3D" example). Terrain from a free raster-DEM (e.g. AWS Terrain Tiles / Terrarium). **Verify the URL and terms** and add the credit. Keep terrain subtle (exaggeration 1.2–1.5). |
| 3D house and scenes | **three**, **@react-three/fiber**, **@react-three/drei**, **@react-three/postprocessing** | Procedural house; `ContactShadows`, `Environment`, `Float`, `PresentationControls`. |
| Motion | **gsap** (+ ScrollTrigger), **framer-motion** (present), **lenis** (smooth scroll, only on Arrival/landing) | |
| Charts | Replace Recharts on hero charts with **visx** or custom **d3 + canvas/SVG** for annotated, animated, scrubbable charts; keep Recharts only where it's fine | Charts sync with the time scrubber (a shared `timeIndex` store). |
| Geo math | **@turf/turf** (circle, distance, pointsWithinPolygon), **d3-geo** | Radius search, lasso. |
| State | **zustand** for cross-view state (time index, selection, radius, metric, camera) | URL remains the source of truth for shareable state (existing `useQueryState`). |
| GPU tiering | **detect-gpu** | Choose the quality tier: bloom, shadows, building density, DPR cap. |

**Lazy-load everything 3D.** The Arrival route loads its globe chunk after first paint (with a poster first), and Explore loads MapLibre and deck.gl on demand.

---

## 7. Screens (information architecture)

Routes stay hash-based and deep-linkable. Every piece of state goes into the URL: camera, time, metric, radius and selection.

### 7.1 `/` Arrival (landing + overview)

1. Full-screen **globe** (M1) with the ambience loop behind it. The headline sentence from `latest.json.headline` is set in display type, with three counters (U.S. median sale price + YoY, 30-yr rate + 1-wk change, active inventory + YoY) from `key_stats` / `national`.
2. A primary CTA, **"Enter the market"**, triggers the dive animation into Explore. A secondary CTA, "Read the brief", scrolls down.
3. Scroll sections below, each with ONE hero visual:
   - **The national picture:** the AI brief as a narrated story, with key points as large pull quotes and citation chips.
   - **Market heat field:** the 50 metros as a 3D bar landscape or an animated ranked strip, sortable. Each bar lights up with its temperature; hover shows the number.
   - **Rates vs prices:** a scrubbable annotated chart pairing the mortgage-rate series with the national median. Use two stacked panels sharing the time axis, never a dual axis.
   - **Movers and alerts:** a ranked "podium" with animated bars and alert cards that fly the camera to the metro when clicked.
   - **Why these markets are moving:** the investigations as story cards.
4. A footer with sources and methodology.

### 7.2 `/explore` The atlas (M2, M3, M4)

**Full-bleed 3D map.** Default camera: continental U.S., pitch 45°, bearing −12°.

- **Layer dock (left):**
  - metric picker driven by `metric_registry`
  - layer style: Columns · Bubbles · Heat (hex aggregation of metro points, weighted) · Flat
  - value vs YoY toggle
  - 3D buildings on/off
  - terrain on/off
- **Columns:** height = the metric level, normalized per metric; color = diverging YoY. On hover: lift, an outline, and a hover card with a sparkline (`metros[].spark`) and 4 key stats. On click: select, fly to it, and open the context panel. Double-click opens the dossier.
- **Area search (M3):**
  - Click empty map (or "Search an area") to drop a pin, then use the **radius slider** (10–250 mi, logarithmic feel) with a live glowing ring (turf circle).
  - The context panel shows: metros inside, a homes-sold-weighted median price, weighted YoY, total inventory, a temperature distribution, and a mini table. The math lives in a tested pure function in `src/lib/area.ts`.
  - It's shareable via the URL (`?pin=lat,lon&r=75`).
  - Once finer geography exists (§8.2), the same ring aggregates counties/ZIPs.
- **Lasso select** (shift-drag) → "Compare selected" (up to 3).
- **Time machine (M4):**
  - A bottom scrubber over `series.dates`: 36 months now, 2012→ after §8.1.
  - Columns animate as you scrub. There's a play/pause control and a speed control (1×/4×).
  - An "event rail" shows national mortgage-rate highs and lows computed from the rates series (e.g. local maxima/minima with a prominence threshold, computed in code).
  - Scrubbing needs per-metro history for the chosen metric; load a compact `timeline/<metric>.json` (§8.1) lazily.
- **Keyboard and accessibility:**
  - arrows pan, +/- zoom, `[`/`]` rotate, `,`/`.` step the month, `T` toggles the table view
  - the table view lists exactly what the map shows, with the same filters and radius
- **Mobile:**
  - a 2D map (no terrain, low pitch)
  - bottom sheets for the dock and the context
  - a radius slider inside the sheet
  - two-finger rotate enabled

### 7.3 `/metro/:slug` The dossier (M5)

1. **Hero:** the region plate (labeled "Illustrative") plus the **3D house** in temperature light. Metro name in display type, market-type pill, temperature as a large number with a thermal arc. Three headline stats: median sale price, days on market, inventory, each with YoY. A "Fly there" button goes to Explore centered on this metro.
2. **Instrument cluster:** all KPIs as compact instruments (value, YoY, MoM, 3-mo trend glyph, 36-mo high/low marker, sparkline), in a dense, deliberate layout rather than equal cards.
3. **The story:** the metro brief and investigation shown as a narrated sequence. Clicking a **cited-metric chip** animates the relevant chart into view and highlights the matching instrument.
4. **Charts:** a scrubbable annotated main chart (metric switcher; YoY/level; 1Y/3Y/All; indexed-to-U.S. toggle) with the synced 30-yr rate strip below it. There are no dual axes.
5. **What drives the temperature:** a diverging component chart around zero with plain-language labels, animated on entry.
6. **Zillow and permits:** a designed empty state when the data is null.
7. **CTA:** "Open the affordability studio" (M6) and "Compare with…".

### 7.4 `/metro/:slug/afford` Affordability studio (M6)

- The 3D house sits center stage.
- The sliders are large, custom-styled and keyboard accessible: price (prefilled with the median), down payment %, rate (prefilled with the latest 30-yr), and term.
- House scale = price / U.S. median (clamped 0.6–1.6×), animated with a spring. A **ghost house** shows the year-ago price and rate from `affordability.assumptions`.
- A **payment stack:** 3D or 2.5D blocks for down payment, principal and total interest over the term, rebuilding as the sliders move. The existing `amortization.ts` computes every value.
- Payment-to-income is a filled ring when `median_household_income` exists; otherwise a designed "needs income data" state.
- "Reset to published" restores the agent's published assumptions. The calculator must still reproduce all 50 published `payment_now` values (the existing test stays).

### 7.5 `/compare?m=a,b,c` Compare arena (M7)

- Three columns or houses stand on a shared stage in entity colors, and the camera orbits them slowly.
- Charts with a shared crosshair, indexed-to-100 toggle and a diff table that highlights the leader per metric (keep the existing logic).
- An "Add from map" button opens Explore in selection mode.

### 7.6 `/methodology`

Keep and restyle it: sources and attribution, how temperature and flags are computed, the Redfin Data Center methodology note, the data freshness and run status, and "numbers come from code; AI only narrates". Add credits for the basemap, terrain and generated media ("Illustrative media generated with Runway").

### 7.7 Global chrome

- ⌘K command palette (keep it): metros, screens, metrics, plus actions ("Search 50 mi around Denver", "Play time machine").
- A freshness chip ("Redfin through Aug 2026 · Rates Sep 24").
- Theme toggle.
- A mute/pause-media toggle.
- A share button (copy link + download PNG of the current view; the map uses `preserveDrawingBuffer` only on export).

---

## 8. Data: what exists and what to add

### 8.1 Available now (no agent change)

The index (`latest.json`, schema 1.2.0) and the per-metro files, per `SPEC_REAL_ESTATE.md` §6.1–6.3:

- 50 metros with lat/lon, `latest` metrics with YoY, temperature, flags, `spark` (24 months of median price), movers, alerts and investigations
- metro files with 36 months of 15 series, affordability, the brief and the investigation
- national series, rates (weekly, 3 years) and construction

**Build Phases 2–7 on this data first.** The time machine starts with 36 months.

### 8.2 Contract extensions (additive; Python agent side; each with tests, schema export and a spec §6.x entry)

Do these in **Phase 8**. Keep the rules: numbers are computed in Python, there's a size budget per file, and the dashboard tolerates their absence.

| Ext | Output | Source | Budget |
|---|---|---|---|
| **E1 Timeline** | `timeline/<metric>.json`: `{dates[], metros: {slug: [values…]}}` for median_sale_price, inventory, median_dom, price_drops and months_of_supply, **monthly since 2012** | The Redfin Data Center monthly metro file (already fetched; history back to 2012) | ≤ 120 KB per metric (rounded ints / 3-decimal ratios) |
| **E2 Finer geography** | `areas/<slug>.json`: counties (and ZIPs if feasible) within each metro, with centroid lat/lon (Census Gazetteer, already used by the agent), latest median price, YoY, inventory and homes sold | The Redfin Data Center county / city / ZIP monthly files. **Check `redfin_data_center/index.json` for which geographies exist**; `counties_in_top_50_metros.csv` is listed there | ≤ 60 KB per metro; load on demand when the radius ring touches a metro |
| **E3 Weekly pulse** | `pulse.json`: the last 12 weeks (4-week rolling) for the 50 metros: median sale price, new listings, pending sales, active listings | `housing_market/weekly/top_50_metros.csv` | ≤ 80 KB |
| **E4 National event rail** | `events.json`: rate highs/lows and big national moves, detected in code with documented thresholds | FRED rates + the national series | ≤ 5 KB |

Also extend `fetch-data`, the zod generation and tolerant parsing for each new file. The site must render fully without them.

---

## 9. Performance, quality tiers and fallbacks

| Budget | Target |
|---|---|
| Initial JS (gzip) | ≤ 350 KB. The globe, map, deck.gl and three chunks are lazy |
| LCP (mid-range phone, 4G) | ≤ 2.5 s (poster first, globe after) |
| Frame rate | 60 fps on an M1-class laptop and 30+ fps on a mid-range phone during pan/tilt/scrub |
| Media | ≤ 15 MB committed; nothing autoplays on mobile data (`navigator.connection.saveData`) |
| Lighthouse (Arrival + Explore) | Performance ≥ 85 mobile / ≥ 95 desktop; Accessibility 100 |

**Quality tiers** (via `detect-gpu`):

| Tier | What it gets |
|---|---|
| **High** | Bloom, terrain, 3D buildings, DPR ≤ 2 |
| **Medium** | No bloom, buildings only at zoom ≥ 13, DPR ≤ 1.5 |
| **Low / no WebGL2** | A **designed 2D mode**: SVG/Canvas map, a static globe poster, and a 2.5D CSS house illustration. It must still look premium. |

Reduced motion uses the medium tier minus all animation.

Add CI checks for the bundle budget (update `check-bundle.mjs`), a Lighthouse run on 2 routes, and a Playwright FPS smoke that records frame timing during a scripted pan (warning only).

---

## 10. Accessibility (never traded for visuals)

- Every visual has a text path:
  - the globe/map has a table view
  - the house has a text summary
  - the time machine has a month select plus a live-region announcement ("August 2026: Austin median $447,540, −6.3% YoY")
- Keyboard maps for Explore (see §7.2) are documented in a `?` shortcut sheet.
- Glass panels must pass 4.5:1 text contrast. Add a solid-panel fallback when `prefers-reduced-transparency` is set.
- Axe runs on every route in both themes and all tiers (force the low tier in one e2e pass).

---

## 11. Phases, gates and acceptance

| Phase | Work | Done when |
|---|---|---|
| **P0 Inventory and audit** | List the design tools (§4.1); audit the current code; list what's kept vs replaced; confirm the WebGL testing approach in Playwright (e.g. `--use-gl=swiftshader` / `--enable-unsafe-swiftshader`). | `DECISIONS.md` entries; a plan posted to the user. |
| **P1 Art direction** | Make 3 directions × 4 key frames (§5) with the design tools, using real sample numbers. | **DESIGN GATE A:** the user picks a direction (or a blend). |
| **P2 Design system and motion primitives** | Tokens (color, type, spacing, radii, glass, grain, glow) for both modes; a motion library (GSAP + Framer presets); primitives (GlassPanel, Instrument, Counter, Slider, Scrubber, Dock, Chip, CommandBar); a `/styleguide` route. | The styleguide screenshots pass the anti-slop checklist. |
| **P3 Explore atlas** | M2 + M3 + M4 on current data (36 months): 3D map, columns, buildings, terrain, hover/select/fly, radius search, lasso, time scrubber, table view, mobile sheets. | **DESIGN GATE B:** a screen recording of pull/tilt/rotate, radius search and scrub. |
| **P4 Arrival** | Globe with the ambience loop, counters, dive into Explore, scroll story sections. | 60 fps on desktop; the poster-first LCP is within budget. |
| **P5 Dossier and 3D house** | The dossier layout, temperature lighting, narrated story with chip→chart linking, annotated charts + rate strip. | **DESIGN GATE C:** 3 metros (hot/balanced/cold) side by side, in screenshots. |
| **P6 Affordability studio** | Sliders, house scaling, ghost house, payment stack, income ring. | The published-payment test still passes for all 50. |
| **P7 Compare arena + heat field + methodology** | M7, the landing heat field, and the restyled methodology page. | |
| **P8 Data extensions** | E1–E4 in the Python agent (tests, schema, spec), then wire them into the time machine (2012→), area search (counties/ZIPs), the pulse ticker and the event rail. | Python tests green; each file within budget; the site still works without them. |
| **P9 Polish, perf, a11y, trailer** | Quality tiers, reduced motion, the Lighthouse/axe/bundle checks, new screenshots in `docs/screenshots/v2/`, a 30–45 s trailer, README hero (GIF/MP4 + stills), and updates to `dashboard/README.md` (architecture, how to rebrand, how to regenerate media) and `STATUS.md`. | **DESIGN GATE D:** final review; then commit, push and verify the live deploy in a real browser render. |

Commit after each phase, with a clear message. Push to `main` at the gates, after the user's approval.

---

## 12. Testing

- **Keep** all current unit and e2e tests. Update selectors, and never delete a behavioral assertion without replacing it.
- **New unit tests:**
  - `area.ts` (radius aggregation, weighting, edge cases: 0 metros, one metro, antimeridian not relevant)
  - scale normalization for columns
  - the time-index store
  - house-scale clamping
  - event detection (E4, in Python)
- **E2E:**
  - drop a pin and set the radius, then check the panel numbers equal the pure function's output
  - scrub to a month, then check the column tooltip matches the timeline JSON
  - the dossier chip → chart highlight
  - studio sliders → payment text
  - low-tier forced run
  - reduced-motion run
  - axe everywhere
- **Visual regression:** Playwright screenshots per route/tier/theme at 3 widths with a small diff threshold, reviewed by eye at each gate.

---

## 13. Out of scope for v2 (later)

Accounts, paywall/Stripe, alerts by email, watchlists, white-label PDF reports and a custom domain belong to the next spec. Design v2 so these slot in: keep the header space and a "Save" affordance stubbed but hidden. Before any paid launch, review the Redfin/Zillow terms for commercial redistribution.

---

## 14. References

- Runway MCP: https://runway.com/mcp · https://github.com/runwayml/runway-api-mcp-server · https://help.runwayml.com/hc/en-us/articles/51931843164691-Connecting-to-Runway-MCP
- GSAP is free, including plugins: https://gsap.com/pricing/ · https://webflow.com/blog/gsap-becomes-free
- MapLibre 3D buildings: https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/ · 3D terrain: https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/
- Data contract: `docs/specs/SPEC_REAL_ESTATE.md` §6 (6.1 index, 6.2 metro files, 6.3 additions incl. `spark`)
- Redfin Data Center file manifest: `https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_data_center/index.json`
