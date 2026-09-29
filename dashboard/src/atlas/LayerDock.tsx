import { Building2, Keyboard, Mountain, Table2 } from 'lucide-react';
import { useId } from 'react';
import type { MetricRegistryEntry } from '../data/schema.gen';
import { Segmented, Toggle } from '../ui/controls';
import { DivergingLegend } from '../ui/dataviz';
import type { ColorBy, HeightBy, LayerStyle } from '../viewmodels/atlas';

export interface LayerDockProps {
  metrics: readonly MetricRegistryEntry[];
  metric: string;
  onMetric: (key: string) => void;
  style: LayerStyle;
  onStyle: (s: LayerStyle) => void;
  colorBy: ColorBy;
  onColorBy: (c: ColorBy) => void;
  heightBy: HeightBy;
  onHeightBy: (h: HeightBy) => void;
  buildings: boolean;
  onBuildings: (v: boolean) => void;
  terrain: boolean;
  onTerrain: (v: boolean) => void;
  /** Formatted ends of the legend. */
  legend: { min: string; max: string; valueMax: string; note: string | null };
  canTerrain: boolean;
  onTable: () => void;
  onShortcuts: () => void;
}

export function LayerDockBody(p: LayerDockProps) {
  const name = useId();
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mp-label mb-2">Metric</legend>
        <div className="max-h-[228px] space-y-0.5 overflow-y-auto pr-1">
          {p.metrics.map((m) => (
            <label
              key={m.key}
              className={`block cursor-pointer rounded-control px-2.5 py-1.5 text-sm transition-colors duration-micro ease-mp has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-mp-focus ${
                m.key === p.metric ? 'bg-mp-accent/[.12] text-mp-ink shadow-[inset_2px_0_0_rgb(var(--mp-accent))]' : 'text-mp-ink-2 hover:text-mp-ink'
              }`}
            >
              <input type="radio" className="sr-only" name={name} value={m.key} checked={m.key === p.metric} onChange={() => p.onMetric(m.key)} />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Segmented
        label="Layer style"
        size="sm"
        className="w-full"
        value={p.style}
        onChange={p.onStyle}
        options={[
          { value: 'columns', label: 'Columns' },
          { value: 'bubbles', label: 'Bubbles' },
          { value: 'heat', label: 'Heat' },
          { value: 'flat', label: 'Flat' },
        ]}
      />
      <div className="flex items-center justify-between gap-2 text-[13px] text-mp-ink-2">
        <span>Height</span>
        <Segmented
          label="Column height"
          size="sm"
          value={p.heightBy}
          onChange={p.onHeightBy}
          options={[
            { value: 'value', label: 'Value' },
            { value: 'yoy', label: 'YoY' },
          ]}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-[13px] text-mp-ink-2">
        <span>Color by</span>
        <Segmented
          label="Color by"
          size="sm"
          value={p.colorBy}
          onChange={p.onColorBy}
          options={[
            { value: 'yoy', label: 'YoY' },
            { value: 'value', label: 'Value' },
          ]}
        />
      </div>
      {p.colorBy === 'yoy' ? (
        <div>
          <DivergingLegend min={p.legend.min} max={p.legend.max} />
          {p.legend.note && (
            <p className="mt-1.5 text-xs text-mp-ink-2" role="status">
              {p.legend.note}
            </p>
          )}
        </div>
      ) : (
        <div>
          <div className="h-2 rounded-full" style={{ background: 'linear-gradient(90deg, rgb(var(--mp-ink) / .18), rgb(var(--mp-accent)))' }} aria-hidden="true" />
          <div className="mp-num mt-1 flex justify-between text-[11px] text-mp-ink-3">
            <span>0</span>
            <span>{p.legend.valueMax}</span>
          </div>
        </div>
      )}
      <p className="text-xs text-mp-ink-3" data-testid="height-legend">
        {p.heightBy === 'yoy' ? (
          <>
            Height: YoY from zero. Up = rising, down = falling; full height = {p.legend.max.replace('+', '±')}.
          </>
        ) : (
          <>Height: from zero to {p.legend.valueMax}, proportional.</>
        )}
      </p>
      <div className="space-y-2.5 border-t border-mp-line pt-3">
        <Toggle label="3D buildings" hint="At city zoom" checked={p.buildings} onChange={p.onBuildings} icon={<Building2 size={15} strokeWidth={1.5} aria-hidden="true" />} />
        {p.canTerrain && <Toggle label="Terrain" checked={p.terrain} onChange={p.onTerrain} icon={<Mountain size={15} strokeWidth={1.5} aria-hidden="true" />} />}
      </div>
      <div className="flex items-center gap-2 border-t border-mp-line pt-3 text-xs">
        <button type="button" onClick={p.onTable} className="flex items-center gap-1.5 rounded-control px-1.5 py-1 text-mp-ink-2 hover:text-mp-ink">
          <Table2 size={14} strokeWidth={1.5} aria-hidden="true" /> Table view <kbd className="rounded border border-mp-line px-1 font-figure text-[10px]">T</kbd>
        </button>
        <span className="flex-1" />
        <button type="button" onClick={p.onShortcuts} className="flex items-center gap-1.5 rounded-control px-1.5 py-1 text-mp-ink-2 hover:text-mp-ink">
          <Keyboard size={14} strokeWidth={1.5} aria-hidden="true" /> Keys <kbd className="rounded border border-mp-line px-1 font-figure text-[10px]">?</kbd>
        </button>
      </div>
    </div>
  );
}
