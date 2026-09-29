/**
 * The published national event rail (`events.json`, agent §6.5) placed on the
 * dashboard's time axes. The agent detects every event with documented thresholds;
 * this only positions and labels them (no detection happens in the browser).
 */
import type { EventsOutput } from '../data/schema.gen';
import { formatDelta, formatMonth } from './format';

export type NationalEvent = EventsOutput['events'][number];

export interface Moment {
  /** Index into the axis the moments were placed on. */
  index: number;
  /** Tone of the dot: rising / hot ('high') or falling / cool ('low'). */
  kind: 'high' | 'low';
  label: string;
  showLabel: boolean;
  event: NationalEvent;
}

const RISING = new Set(['rate_high', 'price_yoy_turn_up', 'price_yoy_high', 'inventory_yoy_high']);

/** A short, plain label for one event, e.g. "30-yr high 7.79% · Oct 2023". */
export function momentLabel(e: NationalEvent): string {
  const when = formatMonth(e.date);
  const yoy = formatDelta(e.value, 'percent_signed');
  switch (e.kind) {
    case 'rate_high':
      return `30-yr high ${e.value.toFixed(2)}% · ${when}`;
    case 'rate_low':
      return `30-yr low ${e.value.toFixed(2)}% · ${when}`;
    case 'price_yoy_turn_up':
      return `U.S. prices turn up (${yoy} YoY) · ${when}`;
    case 'price_yoy_turn_down':
      return `U.S. prices turn down (${yoy} YoY) · ${when}`;
    case 'price_yoy_high':
      return `Fastest U.S. price growth (${yoy} YoY) · ${when}`;
    case 'price_yoy_low':
      return `Weakest U.S. price growth (${yoy} YoY) · ${when}`;
    case 'inventory_yoy_high':
      return `Inventory's biggest rebuild (${yoy} YoY) · ${when}`;
    case 'inventory_yoy_low':
      return `Inventory's steepest drop (${yoy} YoY) · ${when}`;
  }
}

/**
 * Events on a monthly axis (month-end ISO dates): each lands on its calendar month;
 * events outside the axis are dropped. Labels show on the rail for the axis's highest
 * rate high and lowest rate low (the rest on hover/focus), so they never crowd.
 */
export function railMoments(events: readonly NationalEvent[], dates: readonly string[]): Moment[] {
  const month = new Map(dates.map((d, i) => [d.slice(0, 7), i]));
  const placed = events.flatMap((e) => {
    const index = month.get(e.date.slice(0, 7));
    return index === undefined ? [] : [{ index, kind: RISING.has(e.kind) ? ('high' as const) : ('low' as const), label: momentLabel(e), showLabel: false, event: e }];
  });
  const rates = placed.filter((m) => m.event.metric === 'mortgage30');
  const highest = rates.filter((m) => m.event.kind === 'rate_high').sort((a, b) => b.event.value - a.event.value)[0];
  const lowest = rates.filter((m) => m.event.kind === 'rate_low').sort((a, b) => a.event.value - b.event.value)[0];
  for (const m of [highest, lowest]) if (m) m.showLabel = true;
  return placed.sort((a, b) => a.index - b.index);
}

/** Rate turns inside a weekly rate window (for a rates chart's markers). */
export function rateMarkers(events: readonly NationalEvent[], rateDates: readonly string[]): Array<{ date: string; value: number; kind: 'high' | 'low'; label: string }> {
  if (!rateDates.length) return [];
  const first = rateDates[0]!;
  const last = rateDates[rateDates.length - 1]!;
  return events
    .filter((e) => e.metric === 'mortgage30' && e.date >= first && e.date <= last)
    .map((e) => ({ date: e.date, value: e.value, kind: e.kind === 'rate_high' ? ('high' as const) : ('low' as const), label: `${e.value.toFixed(2)}%` }));
}
