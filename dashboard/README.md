# Housing Market Dashboard

A standalone web dashboard for the `real_estate` agent's published data: a national
overview, all 50 metros (table + map), a page per metro, a comparison view and a
methodology page. Vite + React 18 + TypeScript (strict) + Tailwind + React Router
(hash router) + Recharts + react-leaflet (OSM tiles). Deployed to GitHub Pages at
`/real-estate-agent/` by `.github/workflows/dashboard.yml`.

**Phase 1 of 2** (structure, data plumbing, every view and interaction, plain styling).
Phase 2 restyles it; see [How to restyle](#how-to-restyle).

## Run locally

```bash
cd dashboard
npm ci
npm run fetch-data      # data branch → else the committed sample snapshot
npm run dev             # http://localhost:5173/real-estate-agent/
```

| Command | What it does |
|---|---|
| `npm run fetch-data` | Fill `public/data/` (see below). `RE_DATA_DIR=../public-data npm run fetch-data` uses a local agent run instead. |
| `npm run gen:schema` | Regenerate `src/data/schema.gen.ts` from `../schemas/real_estate.schema.json`. `check:schema` fails if it's stale. |
| `npm run lint` / `typecheck` / `test` | ESLint, `tsc -b`, Vitest + Testing Library (85 tests). |
| `npm run build` / `preview` | Production build into `dist/` (`DASHBOARD_BASE` overrides the `/real-estate-agent/` base path). |
| `npm run e2e` | Playwright smoke + axe on every route, desktop and 360 px wide (28 checks). |
| `npm run screenshots` | Rewrite `../docs/screenshots/*.png`. |

`predev`/`prebuild` run `fetch-data --if-missing`, so a fresh checkout just works.

## Data flow

```
agent run ──► data branch (latest.json, metros/*.json, manifest-entry.json, history/)
                     │  npm run fetch-data (git fetch origin data → FETCH_HEAD, no branch changes)
                     ▼
sample-data/ ──► public/data/  +  source.json {source: data-branch | sample | local}
 (fallback)          │  fetched at runtime from <base>/data/
                     ▼
         src/data/api.ts ── zod (schema.gen.ts, tolerant) ──► hooks ──► view models ──► components
```

- **Contract.** `schemas/real_estate.schema.json` (SPEC §6.1–6.3) is compiled into zod
  schemas and TS types by `scripts/gen-schema-lib.mjs`. A unit test and CI's
  `check:schema` fail when the generated file is stale, so types can't drift.
- **Tolerant parsing** (`src/data/tolerant.ts`): fields that aren't required fall back to
  their JSON Schema default when missing (1.0.0 data has no `investigations`,
  `alerts[].metros`, `meta.warnings`); a malformed array item or map entry is dropped
  with a `console.warn`; a malformed optional field is replaced by its default with a
  warning; numeric series coerce bad values to `null`. Only a missing required
  top-level block (e.g. `national`) fails a view, which then shows its error state with a retry.
- **Sample data.** `sample-data/` is a real run of the agent on 2026-09-28 (Redfin data
  through May 2026, rates as of 2026-09-24, $0.065 of Claude spend): the full index,
  all 50 metro files, the manifest entry and one history file. Nothing is hand-edited.
  When it's in use the header shows a **Sample data** badge.
- **Units.** Metric values and changes are ratios (0.968 → 96.8%, 0.009 → +0.9 pp);
  mortgage rates and `key_stats` are already in percent (7.03 → 7.03%). `lib/metrics.ts`
  (`valueScale`) and `lib/format.ts` (`scale: 'ratio' | 'points'`) encode this.

## Architecture

```
src/
├── data/          schema.gen.ts (generated), tolerant.ts, manifest.ts, api.ts (fetch+parse+cache),
│                  useResource.ts + hooks.ts (loading/error/ready + retry)
├── lib/           pure logic, unit-tested: format.ts (every StatFormat + registry format),
│                  amortization.ts (SPEC §5.2), series.ts (ranges, index-to-100, weekly→monthly
│                  alignment), metrics.ts (registry helpers), scale.ts (map colors), tokens.ts,
│                  theme.ts, search.ts, attribution.ts, labels.ts
├── viewmodels/    pure data → display models per page (overview, metros, metro, compare)
├── components/    presentational only (props in, JSX out): ui/ primitives, charts/, layout/,
│                  KpiTile, TemperatureGauge, BriefCard, InvestigationCard, MetroMap, …
├── pages/         containers: read URL state + data hooks, call view models, render components
├── content/       methodology copy (from the spec)
├── hooks/         useQueryState (every view setting lives in the URL), useTheme, useDocumentTitle
└── styles/        tokens.css (the design tokens) + index.css (Tailwind layers)
```

Routes (hash router, all deep-linkable): `#/` (`?metric=&range=&rates=`),
`#/metros` (`?q=&type=&temp=&flag=&sort=&dir=&metric=&view=`),
`#/metro/:slug` (`?metric=&range=&rate=1`), `#/compare?m=a,b,c` (`&metrics=&range=&indexed=1`),
`#/about`.

Numbers are never computed from narrative: everything shown is either a published
value or deterministic client code (formatting, the calculator, indexing to 100). The
calculator reproduces every metro's published `payment_now` (tested across all 50).

## How to restyle

1. **Tokens first.** `src/styles/tokens.css` defines every color (light + `.dark`),
   font, radius and shadow as CSS variables. `tailwind.config.js` maps them to Tailwind
   names (`bg-surface`, `text-text-muted`, `border-border`, `text-temp-hot`, …), and
   `src/lib/tokens.ts` hands them to Recharts/Leaflet as `rgb(var(--color-…))`. Changing a
   token restyles components, charts and map markers together, in both themes.
2. **Primitives.** `src/styles/index.css` `@layer components` holds `.card`, `.btn`,
   `.input`, `.chip`, `.table-base`…; `components/ui/` holds Card, Badge (tones),
   SegmentedControl, Select, Delta, StateViews. Restyle these before touching views.
3. **Views.** Components only take preformatted props; pages and view models own the
   data. A restyle should never need to edit `lib/`, `data/` or `viewmodels/`.
4. The only inline styles are data-driven geometry (chart height, the temperature bar
   width) and Recharts' tooltip/legend style objects, which read tokens.
5. Keep `npm run e2e` green: it runs axe (WCAG 2.1 AA) on every route in both themes
   and checks there's no horizontal scroll at 360 px.

## Known limitations (phase 1)

- OSM map tiles load from `tile.openstreetmap.org`; they're stubbed in tests and
  screenshots, so the screenshots show markers on a blank map.
- 20 metros that Redfin reports as divisions share their parent metro's centroid, so
  some markers overlap (see `STATUS.md`).
- Permits and ACS income are null in current data (sources disabled/unkeyed), so those
  panels show dashes and payment-to-income is unavailable.
