/** Command palette results (pure): regions, then metros, then pages. */
import { NAV_ITEMS } from '../components/shell/nav';
import { matchRegions } from './regions';
import { matchMetros, type SearchItem } from './search';

export interface PaletteItem {
  id: string;
  label: string;
  group: 'Go to' | 'Regions' | 'Metros';
  hint?: string;
  to: string;
}

export function paletteResults(query: string, metros: readonly SearchItem[]): PaletteItem[] {
  const q = query.trim().toLowerCase();
  const pages: PaletteItem[] = NAV_ITEMS.filter((n) => !q || n.label.toLowerCase().includes(q)).map((n) => ({
    id: `page:${n.to}`,
    label: n.label,
    group: 'Go to',
    to: n.to,
  }));
  const metroItems: PaletteItem[] = (q ? matchMetros(metros, q, [], 8) : metros.slice(0, 6)).map((m) => ({
    id: `metro:${m.slug}`,
    label: m.name,
    group: 'Metros',
    hint: 'Open metro',
    to: `/metro/${m.slug}`,
  }));
  if (q && metroItems.length) {
    const first = metroItems[0]!;
    metroItems.push({ id: `compare:${first.to}`, label: `Compare ${first.label}…`, group: 'Metros', to: `/compare?m=${first.to.split('/').pop()}` });
  }
  const regions: PaletteItem[] = matchRegions(q).map((r) => ({ id: `region:${r.slug}`, label: r.name, group: 'Regions', hint: 'Open on the atlas', to: `/explore?region=${r.slug}` }));
  return [...regions, ...metroItems, ...pages];
}
