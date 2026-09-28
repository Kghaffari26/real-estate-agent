export type Tone =
  | 'neutral'
  | 'accent'
  | 'positive'
  | 'negative'
  | 'warning'
  | 'info'
  | 'severity-info'
  | 'severity-notable'
  | 'severity-major'
  | 'temp-hot'
  | 'temp-warm'
  | 'temp-balanced'
  | 'temp-cool'
  | 'temp-cold';

export function severityTone(severity: string): Tone {
  return severity === 'major' ? 'severity-major' : severity === 'notable' ? 'severity-notable' : 'severity-info';
}
