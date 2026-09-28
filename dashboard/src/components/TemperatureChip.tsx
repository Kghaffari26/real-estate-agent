import { temperatureBand } from '../lib/metrics';
import { Badge, type Tone } from './ui/Badge';

const TONE: Record<ReturnType<typeof temperatureBand>, Tone> = {
  hot: 'temp-hot',
  warm: 'temp-warm',
  balanced: 'temp-balanced',
  cool: 'temp-cool',
  cold: 'temp-cold',
  unknown: 'neutral',
};

export function TemperatureChip({ score, label }: { score: number | null; label: string | null }) {
  if (score === null) return <span className="muted">—</span>;
  return (
    <Badge tone={TONE[temperatureBand(label)]} title="Competitiveness vs the other tracked metros (0–100)">
      <span className="tabular-nums">{score}</span>&nbsp;{label}
    </Badge>
  );
}
