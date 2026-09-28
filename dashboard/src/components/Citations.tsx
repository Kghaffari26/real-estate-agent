import type { Citation } from '../data/schema.gen';

export function Citations({ citations }: { citations: readonly Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3">
      <h3 className="text-sm font-semibold">Sources</h3>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {citations.map((c) => (
          <li key={c.url + c.name}>
            <a href={c.url} target="_blank" rel="noreferrer noopener">
              {c.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
