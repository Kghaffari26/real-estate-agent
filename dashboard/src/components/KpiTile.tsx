import type { ReactNode } from 'react';
import { Delta } from './ui/Delta';
import type { Scale } from '../lib/format';

export interface KpiDelta {
  value: number | null | undefined;
  format: string;
  label: string;
}

export interface KpiTileProps {
  label: string;
  value: string;
  deltas?: readonly KpiDelta[];
  scale?: Scale;
  goodDirection?: string;
  badges?: ReactNode;
  note?: string | null;
}

/** One headline number with its changes. Pure presentation: every string is preformatted by the caller. */
export function KpiTile({ label, value, deltas = [], scale, goodDirection, badges, note }: KpiTileProps) {
  return (
    <div className="card flex min-w-0 flex-col gap-1">
      <p className="text-sm muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {deltas.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {deltas.map((d) => (
            <li key={d.label}>
              <Delta value={d.value} format={d.format} scale={scale} goodDirection={goodDirection} suffix={d.label} />
            </li>
          ))}
        </ul>
      )}
      {badges && <div className="flex flex-wrap gap-1">{badges}</div>}
      {note && <p className="text-xs muted">{note}</p>}
    </div>
  );
}
