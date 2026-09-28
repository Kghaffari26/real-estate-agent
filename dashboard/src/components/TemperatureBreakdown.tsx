export interface ComponentRow {
  key: string;
  label: string;
  z: number | null;
  /** +1 if a higher value raises the score, −1 if it lowers it. */
  sign: 1 | -1;
}

/** Each component's z-score vs the tracked metros and its signed contribution (SPEC §5.3). */
export function TemperatureBreakdown({ rows }: { rows: readonly ComponentRow[] }) {
  return (
    <table className="table-base">
      <caption className="sr-only">Temperature components (z-scores across the tracked metros)</caption>
      <thead>
        <tr>
          <th scope="col">Component</th>
          <th scope="col" className="text-right">
            z-score
          </th>
          <th scope="col">Effect on score</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const contribution = row.z === null ? null : row.z * row.sign;
          const width = contribution === null ? 0 : Math.min(Math.abs(contribution) / 3, 1) * 50;
          return (
            <tr key={row.key}>
              <th scope="row" className="font-normal">
                {row.label}
                <span className="block text-xs muted">{row.sign > 0 ? 'higher = hotter' : 'higher = cooler'}</span>
              </th>
              <td className="text-right tabular-nums">{row.z === null ? '—' : row.z.toFixed(2)}</td>
              <td className="w-2/5">
                <div className="relative h-3 rounded-sm bg-surface-muted" aria-hidden="true">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  {contribution !== null && (
                    <div
                      className={`absolute inset-y-0 ${contribution >= 0 ? 'left-1/2 bg-temp-hot' : 'right-1/2 bg-temp-cold'}`}
                      style={{ width: `${width}%` }}
                    />
                  )}
                </div>
                <span className="sr-only">
                  {contribution === null ? 'not available' : contribution >= 0 ? 'raises the score' : 'lowers the score'}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
