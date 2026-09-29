# Gate A: art-direction key frames

Three directions × four frames (Arrival, Explore, Dossier, Affordability) at 1440×900,
rendered from static HTML prototypes (spec §4.3 fallback). Every figure is computed by
`data.mjs` from `../../sample-data/`: the national counters, the column heights and colors,
the 100-mile area search around Philadelphia (homes-sold-weighted), the rate high/low
markers on the time rail, the Austin dossier, and the affordability split. The payment is
recomputed with the same formula as `src/lib/amortization.ts` and the build fails if it
doesn't match the published `payment_now` / `payment_year_ago`.

```bash
cd dashboard
node design/gate-a/build.mjs      # HTML into out/, PNGs into ../docs/screenshots/v2/gate-a/
node design/gate-a/sheets.mjs     # one 2x2 contact sheet per direction
```

No generated media: Runway has no API key here and the Everygen subscription is inactive
(DECISIONS.md, session 9). Plates, grain and the house are procedural SVG, which is also
what the fallback tier will use.
