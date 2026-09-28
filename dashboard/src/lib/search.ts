/** Metro quick-search matching: prefix of the name, then word prefix, then substring. */
export interface SearchItem {
  slug: string;
  name: string;
}

export function matchMetros(items: readonly SearchItem[], query: string, exclude: readonly string[] = [], max = 8): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const skip = new Set(exclude);
  const scored = items
    .filter((i) => !skip.has(i.slug))
    .map((i) => {
      const name = i.name.toLowerCase();
      const score = name.startsWith(q) ? 0 : name.split(/[\s,-]+/).some((w) => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : -1;
      return { i, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.i.name.localeCompare(b.i.name));
  return scored.slice(0, max).map((x) => x.i);
}
