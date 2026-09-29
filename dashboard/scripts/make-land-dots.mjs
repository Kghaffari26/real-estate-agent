#!/usr/bin/env node
/**
 * Precomputes the Arrival globe's land dots (Night Atlas "hex-dot" land) from
 * world-atlas 110m + us-atlas: a near-equal-area grid over land, with U.S. dots
 * flagged. Writes src/arrival/landDots.json as [lon*10, lat*10, us] triples.
 * Run: node scripts/make-land-dots.mjs [stepDegrees=1.4]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const json = (id) => JSON.parse(readFileSync(require.resolve(id), 'utf8'));
const world = json('world-atlas/land-110m.json');
const us = json('us-atlas/nation-10m.json');
const land = feature(world, world.objects.land);
const nation = feature(us, us.objects.nation);
const step = Number(process.argv[2] ?? 1.4);
const out = [];
for (let lat = -58; lat <= 82; lat += step) {
  const lonStep = step / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  // Offset every other row for a hex-like pattern.
  const offset = (Math.round((lat + 58) / step) % 2) * (lonStep / 2);
  for (let lon = -180 + offset; lon < 180; lon += lonStep) {
    if (!geoContains(land, [lon, lat])) continue;
    out.push(Math.round(lon * 10), Math.round(lat * 10), geoContains(nation, [lon, lat]) ? 1 : 0);
  }
}
writeFileSync(new URL('../src/arrival/landDots.json', import.meta.url), JSON.stringify(out));
console.log(`${out.length / 3} land dots (${out.filter((v, i) => i % 3 === 2 && v).length} U.S.)`);
