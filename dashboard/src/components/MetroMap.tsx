import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import { color, type ColorToken } from '../lib/tokens';

export interface MapPoint {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  color: ColorToken;
  /** Preformatted value shown in the tooltip. */
  valueText: string;
}

export interface LegendItem {
  color: ColorToken;
  label: string;
}

interface MetroMapProps {
  points: readonly MapPoint[];
  onSelect: (slug: string) => void;
  label: string;
}

// Continental U.S.; Leaflet fits the view to this box at any width.
const US_BOUNDS: [[number, number], [number, number]] = [
  [24.5, -125],
  [49.5, -66.5],
];

/** Metro markers on OSM tiles. Not keyboard-operable, so the page always offers the table. */
export function MetroMap({ points, onSelect, label }: MetroMapProps) {
  return (
    <div className="h-80 w-full overflow-hidden rounded-md border border-border sm:h-96" role="region" aria-label={label}>
      <MapContainer bounds={US_BOUNDS} scrollWheelZoom={false} className="h-full w-full" attributionControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((p) => (
          <CircleMarker
            key={p.slug}
            center={[p.lat, p.lon]}
            radius={8}
            pathOptions={{ color: color('surface'), weight: 1.5, fillColor: color(p.color), fillOpacity: 0.9 }}
            eventHandlers={{ click: () => onSelect(p.slug) }}
          >
            <Tooltip>
              <strong>{p.name}</strong>
              <br />
              {p.valueText}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

export function MapLegend({ title, items }: { title: string; items: readonly LegendItem[] }) {
  return (
    <div className="text-sm">
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-1.5">
            <svg width="12" height="12" aria-hidden="true">
              <circle cx="6" cy="6" r="5" fill={color(item.color)} stroke={color('border')} />
            </svg>
            <span className="tabular-nums">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
