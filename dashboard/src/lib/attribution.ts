/**
 * Attribution text for each source (SPEC: "attribute Redfin, Zillow, FRED and the
 * Census Bureau wherever the data is shown"). The index's `sources[].attribution`
 * wins when the agent publishes one; these fill the ones it leaves null.
 */
import type { Citation } from '../data/schema.gen';

const FALLBACKS: ReadonlyArray<{ match: RegExp; text: string }> = [
  { match: /redfin/i, text: 'Data: Redfin, a national real estate brokerage.' },
  { match: /zillow/i, text: 'Zillow Home Value Index (ZHVI) and Zillow Observed Rent Index (ZORI), Zillow Research.' },
  {
    match: /fred|federal reserve/i,
    text: 'Source: FRED, Federal Reserve Bank of St. Louis. Mortgage rates: Freddie Mac Primary Mortgage Market Survey. Home price index: S&P CoreLogic Case-Shiller U.S. National Home Price Index. Starts and permits: U.S. Census Bureau and HUD.',
  },
  { match: /census/i, text: 'Source: U.S. Census Bureau.' },
];

export function attributionFor(source: Pick<Citation, 'name' | 'attribution'>): string {
  if (source.attribution) return source.attribution;
  return FALLBACKS.find((f) => f.match.test(source.name))?.text ?? '';
}

export function withAttribution(sources: readonly Citation[]): Citation[] {
  return sources.map((s) => ({ ...s, attribution: attributionFor(s) || null }));
}
