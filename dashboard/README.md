# Metro Pulse — the dashboard

A market-intelligence web app for the `real_estate` agent's published data: a
national overview, all 50 metros on a map and in a sortable table, a page per
metro, a comparison view and a methodology page. Every view and setting is
deep-linkable.

**Stack:** Vite, React 18, TypeScript (strict), Tailwind (token-driven), React
Router (hash router), Recharts (lazy), MapLibre GL with OpenFreeMap tiles (lazy),
framer-motion (async features), and self-hosted Inter Variable (`@fontsource`).
Tests use Vitest with Testing Library, plus Playwright with axe. It's deployed to
GitHub Pages at `/real-estate-agent/` by `.github/workflows/dashboard.yml`.

## Run locally

```bash
cd dashboard
npm ci
npm run fetch-data      # the data branch, else the committed sample snapshot
npm run dev             # http://localhost:5173/real-estate-agent/
```

| Command | What it does |
|---|---|
| `npm run fetch-data` | Fill `public/data/` (see "Data flow"). `RE_DATA_DIR=../public-data npm run fetch-data` uses a local agent run instead. |
| `npm run gen:schema` | Regenerate `src/data/schema.gen.ts` from `../schemas/real_estate.schema.json`. `check:schema` fails if it's stale. |
| `npm run lint` / `typecheck` / `test` | ESLint (0 warnings), `tsc -b`, Vitest + Testing Library (110 tests). |
| `npm run build` / `preview` | Production build into `dist/`. `DASHBOARD_BASE` overrides the base path. |
| `npm run check:bundle` | Performance budget: initial JS ≤ 300 KB gzipped (CI enforces it). |
| `npm run e2e` | Playwright smoke + axe: every route in light and dark, desktop and 360 px, plus the interactions and phone checks (39 checks). |
| `npm run screenshots` | Rewrite `../docs/screenshots/*.png`: every view in light, dark and mobile. |
| `npm run brand-assets` | Re-render `public/og.png` and `public/apple-touch-icon.png` from the brand config. |

`predev` and `prebuild` run `fetch-data --if-missing`, so a fresh checkout just works.

## Data flow

```
agent run ──► data branch (latest.json, metros/*.json, manifest-entry.json, history/)
                     │  npm run fetch-data (git fetch origin data → FETCH_HEAD; no branch changes)
                     ▼
sample-data/ ──► public/data/  +  source.json {source: data-branch | sample | local}
 (fallback)          │  fetched at runtime from <base>/data/
                     ▼
    src/data/api.ts ── zod (schema.gen.ts, tolerant) ──► hooks ──► view models ──► components
```

- **Contract.** The zod schemas and TS types are generated from the agent's JSON
  Schema (`scripts/gen-schema-lib.mjs`). A unit test and CI fail when they're stale.
- **Tolerant parsing** (`src/data/tolerant.ts`):
  - A missing optional field gets its default.
  - A malformed array item or map entry is dropped with a `console.warn`.
  - Numeric series coerce bad values to `null`.
  - Only a missing required top-level block fails a view, which then shows an
    illustrated error state with a retry.
- **Sample data.** `sample-data/` comes from a real agent run on 2026-09-28: Redfin
  Data Center through **August 2026**, rates as of 2026-09-24, $0.0675 of Claude
  spend. It holds the full index, all 50 metro files, the manifest entry and one
  history file, with nothing hand-edited. While it's in use, the freshness chip
  shows **Sample**.
- **Cache-busting.** Every data URL carries `?v=<content hash of public/data>`,
  computed at build time (`scripts/data-version.mjs`, injected by `vite.config.ts`).
  GitHub Pages lets browsers cache JSON for ~10 minutes, so a fixed URL could pair
  a freshly deployed app with the previous deploy's data. With the hash, each build
  fetches exactly its own data, and an unchanged dataset keeps its cache.
- **Timelines (schema 1.3.0).** `timeline/<metric>.json` holds monthly history since
  2012 for five metrics; the index's `timelines` lists which exist, and the atlas's time
  machine loads one on first scrub (Jan 2013 onward, so every month has a YoY).
- **Events, pulse, counties (schema 1.4.0).** `events.json` is the time machine's
  moments rail and the Arrival rate chart's markers (detected by the agent; the
  dashboard only places and labels them, `lib/moments.ts`); `pulse.json` feeds the
  Arrival ticker and the dossier's "last 12 weeks"; `areas/<slug>.json` feeds the
  dossier's county table and area search, which loads only the county files of metros
  near the ring. Each is fetched only when the index lists it, and a missing or
  unreadable file just hides its feature (`loadEvents` / `loadPulse` / `loadArea`).
- **Sparklines.** The Metros table draws each row's trend from the index's
  `metros[].spark` (schema 1.2.0), so it fetches no metro files.
- **Units.** Metric values and changes are ratios (0.968 → 96.8%, 0.009 → +0.9 pp).
  Mortgage rates and `key_stats` are already in percent (7.03 → 7.03%). See
  `lib/metrics.ts` (`valueScale`) and `lib/format.ts` (`scale`).

## Architecture

```
src/
├── config/brand.ts   the product name, tagline, URL and theme colors (one place)
├── data/             schema.gen.ts (generated), tolerant.ts, manifest.ts, api.ts, hooks
├── lib/              pure, unit-tested logic: format (every StatFormat), amortization,
│                     series (ranges, index-to-100, weekly→monthly), metrics, scale
│                     (diverging/sequential buckets), geo (de-overlap, bubble size),
│                     tokens (CSS-variable colors for JS), csv, exportPng, palette, labels…
├── viewmodels/       pure data → display models: overview, metros, metro, compare, map, columns
├── components/
│   ├── shell/        AppShell (sidebar, top bar, bottom nav, footer), CommandPalette, FreshnessChip
│   ├── ui/           Card (copy link + PNG export), Badge, Status, Delta, SegmentedControl,
│   │                 Select, Checkbox, Skeleton, StateViews + illustrations, Collapsible…
│   ├── charts/       TimeSeriesChart + RateStrip (Recharts, lazy), Sparkline, AnimatedNumber
│   ├── map/          MetroMap (MapLibre, lazy), MapLegend
│   └── data/         KpiCard, TemperatureGauge, TemperatureComponents, HeatGrid, RankedBars,
│                     AlertCards, AnalystNote, InvestigationCard, FlagCards, DataTable,
│                     ColumnPicker, SparkCell, AffordabilityCalculator
├── pages/            containers: URL state + data hooks → view models → components
├── hooks/            useQueryState (URL = state), useTheme, EntityColors, Toast, useInView…
└── styles/           tokens.css (the design tokens) + index.css (Tailwind layers, print CSS)
```

Every route is deep-linkable:

| Route | Query parameters |
|---|---|
| `#/` (Arrival: globe, brief, heat field, rates vs prices, movers, investigations) | none |
| `#/explore` (the atlas) | `?m=&t=YYYY-MM&style=&h=value|yoy&by=&b=0&terrain=1&pin=lat,lon&r=10-250&sel=a,b&view=table&cam=lon,lat,zoom,pitch,bearing&tier=low` |
| `#/metro/:slug` (dossier) | `?m=&range=1Y|3Y|All&mode=yoy&vs=1&section=affordability&tier=low` (v1's `?metric=` still works) |
| `#/metro/:slug/afford` (affordability studio) | `?price=&down=&rate=&term=15|20|30&tier=low` |
| `#/compare` (the arena) | `?m=a,b,c&metrics=x,y&range=1Y\|3Y\|All&indexed=1&tier=low` |
| `#/methodology` (`#/about` redirects) | `?section=<id>` |
| `#/metros`, `#/arrival`, `#/dossier/:slug` | redirects to `#/explore?view=table`, `#/`, `#/metro/:slug` |
| `#/styleguide` (v2 design system) | none |

Any view also takes `?section=<id>` to scroll to a section. "Copy link" buttons
produce these URLs.

## Metro Pulse v2 ("Night Atlas")

`docs/specs/SPEC_DASHBOARD_V2.md` replaced the presentation layer (Arrival, Atlas and
Dossier are live; Compare, Methodology and the affordability studio follow in Phases
6-7); `data/`, `lib/` and `viewmodels/` stay the contract.

- **Tokens**: `src/styles/atlas.css` (`--mp-*`, Tailwind `mp-*`), Night by default
  (`.dark`) and Dawn. **Motion**: `src/motion/presets.ts`. **Primitives**: `src/ui/`.
- **Atlas** (`#/explore`): `src/atlas/` (MapLibre + deck.gl, lazy; 2D fallback),
  `src/viewmodels/atlas.ts`, `src/lib/{area,columns,timeline,moments}.ts`,
  `src/state/timeStore.ts`. Every figure is published or read from the published
  series. Heights are proportional: value from zero, YoY centered on zero. Area
  search is a homes-sold-weighted mean of metro medians. deck.gl and MapLibre are
  pinned exactly; `src/atlas/maplibreCompat.ts` carries the MapLibre 6 patch and its
  tests.
- **Arrival** (`#/arrival`): `src/arrival/` (GlobeView globe, sections), land dots from
  `scripts/make-land-dots.mjs`, posters from `design/arrival/poster.mjs`.
- **Design captures**: `design/gate-a/` (art-direction frames), `design/gate-b/` and
  `design/arrival/` (`shots.mjs`, `record.mjs`, `poster.mjs` against `vite preview`).
- **Local e2e** can point at any Chromium with `PW_CHROMIUM=...`.

## Design system (v1)

- **Type.** Inter Variable, self-hosted, with the `cv11` and `ss01` features.
  Figures use tabular numerals (`.num`). The scale is 11/12/13/14/16/20/24/32/40 on
  a 4/8 px spacing grid.
- **Surfaces.** A calm warm-gray neutral ramp with hairline borders and three
  elevation levels.
- **One accent.** Indigo.
- **Dark mode** is its own palette, not an inversion. Surfaces step up in lightness
  with elevation, and chart and scale steps are re-chosen for the dark surface.
- **Color jobs** follow the dataviz method. Each role is validated with the palette
  validator against this app's surfaces (`#ffffff` light, `#17181b` dark):

  | Job | Tokens | Rule |
  |---|---|---|
  | Categorical (identity) | `cat-1…4` (blue, orange, aqua, yellow) | Fixed order. Adjacent pairs pass in both modes: worst CVD ΔE 9.1 light / 8.4 dark, normal-vision ≥ 19. Slots 1–3 pass *all-pairs* (ΔE 9.2 / 9.4), so Compare caps at 3 metros. A metro keeps its slot for the session (`hooks/EntityColors.tsx`). Aqua is under 3:1 on white, so lines carry direct labels and a table. |
  | Diverging (YoY) | `div-neg-3…div-pos-3` | Blue ↔ red with a gray midpoint, 7 steps. Dark mode flips the arms so near-zero recedes into the surface. |
  | Sequential (magnitude) | `seq-1…6` | One hue (orange "heat"), low → high, used for temperature. Ink on each step is chosen for ≥ 4.5:1 (`inkOnSequential`). |
  | Status | `good`, `warning`, `bad` | Reserved for state, always with an icon and a label (`ui/Status.tsx`). |

- **Charts.**
  - One y-axis only. A second measure gets a synced strip (the metro page's
    mortgage-rate strip shares the x-axis and crosshair) or an indexed-to-100
    comparison.
  - 2 px lines, soft area gradients, and hairline solid grids.
  - A custom crosshair tooltip, direct end labels (collision-resolved) for up to
    4 series, and high/low/latest annotations.
  - Transitions on range changes.
- **Motion.** Subtle: a page fade, gauge arcs drawing in, and KPI count-ups. All of
  it respects `prefers-reduced-motion` (framer-motion's `MotionConfig
  reducedMotion="user"`, CSS duration tokens that drop to 0, and the count-up is
  skipped).

## How to restyle

1. **Tokens first.** `src/styles/tokens.css` defines every color (light and
   `.dark`), font, radius, shadow and motion duration. `tailwind.config.js` maps
   them to utilities (`bg-surface`, `text-text-3`, `border-border`, `bg-seq-4`…).
   `src/lib/tokens.ts` hands them to Recharts as CSS expressions, and to MapLibre
   and the PNG export as resolved values. Change a token, and components, charts,
   the map and exports all follow in both themes.
2. **Primitives.** `@layer components` in `src/styles/index.css` (`.card`, `.btn`,
   `.input`, `.chip`, `.table-base`, `.skeleton`, `.eyebrow`, `.num`) and
   `components/ui/`.
3. **Views.** Components take preformatted props. Pages and view models own the
   data, so a restyle never touches `lib/`, `data/` or `viewmodels/`.
4. **Inline styles** are only data-driven geometry: bar widths, chart heights, a
   color picked by value, and the hover-card position.
5. If you change a categorical, diverging or sequential step, re-run the palette
   validator in both modes. Keep `npm run e2e` green: axe runs on every route in
   both themes, at 360 px too.

## How to rebrand

1. `src/config/brand.ts`: name, tagline, description, site URL, theme colors.
   `vite.config.ts` injects these into `index.html` (title, description, Open
   Graph/Twitter tags, theme-color). The UI reads them from the same object.
2. The logo: `components/brand/Logo.tsx`, `public/favicon.svg`, and the `MARK`
   geometry in `scripts/make-brand-assets.mjs` (the same path in all three).
3. The accent: `--color-accent*` in `src/styles/tokens.css`, for both themes.
4. `npm run brand-assets` re-renders `public/og.png` (1200×630) and
   `public/apple-touch-icon.png`.
5. `npm run screenshots`, then check the README.

The print one-pager (Print report on a metro page) uses the brand name in its
header and footer, so it's the starting point for a white-label PDF report.

## Performance

- **Initial JS: 110 KB gzipped**: 45 KB app + 65 KB React/Router/zod. The budget is
  300 KB, checked in CI by `npm run check:bundle`.
- **Lazy chunks:**
  - Recharts: ~110 KB, loaded when a chart nears the viewport.
  - MapLibre: ~280 KB, plus its worker, loaded when the map nears the viewport.
  - framer-motion's animation features: 15 KB, loaded asynchronously.
  - Every page except the Overview.
- **Lighthouse on the Overview** (2026-09-29, local `vite preview`, Lighthouse 12):

  | | Performance | Accessibility | Best practices | SEO |
  |---|---|---|---|---|
  | Mobile (simulated Moto G, 4× CPU) | 95 | 100 | 100 | 100 |
  | Desktop | 99 | 100 | 100 | 100 |

## Known limitations

- **Basemap in tests.** OpenFreeMap tiles are unreachable from CI and the build
  sandbox, so the e2e tests and screenshots use an offline stand-in style (U.S.
  land and state lines from `us-atlas`). The live site uses OpenFreeMap's
  `positron` and `dark` styles. If WebGL or the basemap fails, the map is replaced
  by a list, and the full table is always on the Metros page.
- **Missing sources.** Permits and ACS income are null in the current data, so those
  panels show friendly empty states and payment-to-income is unavailable.
