import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MetricRegistryEntry } from '../data/schema.gen';
import { formatValue } from '../lib/format';
import { MiniSpark } from '../ui/dataviz';
import { GlassPanel } from '../ui/Glass';
import type { AtlasMetro } from '../viewmodels/atlas';
import { fmtChange, fmtMetric, toneClass } from './format';

// ---------- hover card ----------
export function HoverCard({ metro, metric, value, change, x, y, bounds }: { metro: AtlasMetro; metric: MetricRegistryEntry; value: number | null; change: number | null; x: number; y: number; bounds: { w: number; h: number } }) {
  const W = 236;
  const left = x + 18 + W > bounds.w ? x - W - 18 : x + 18;
  const top = Math.min(Math.max(72, y - 90), bounds.h - 210);
  return (
    <GlassPanel className="pointer-events-none absolute z-20 p-3.5" style={{ left, top, width: W }} role="tooltip" data-testid="hover-card">
      <div className="flex items-baseline justify-between gap-2">
        <b className="truncate font-semibold">{metro.name}</b>
        {metro.temperatureLabel && (
          <span className="mp-num whitespace-nowrap text-[11px] text-mp-ink-3">
            {metro.temperatureLabel} {metro.temperature}
          </span>
        )}
      </div>
      <div className="mp-label mt-2 text-[10px]">{metric.label}</div>
      <div className="mp-num text-[22px] leading-tight">
        {fmtMetric(metric, value)} <span className={`text-xs ${toneClass(change)}`}>{fmtChange(metric, change)}</span>
      </div>
      {metro.spark.length > 1 && (
        <div className="mt-1.5">
          <MiniSpark values={metro.spark} width={W - 30} height={34} stroke="rgb(var(--mp-accent))" />
        </div>
      )}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 whitespace-nowrap text-[11.5px] text-mp-ink-2">
        <div className="flex gap-1">
          <dt>Median</dt>
          <dd className="mp-num text-mp-ink">{formatValue(metro.latest.median_sale_price?.value, 'currency_compact')}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Supply</dt>
          <dd className="mp-num text-mp-ink">{formatValue(metro.latest.months_of_supply?.value, 'decimal1')} mo</dd>
        </div>
        <div className="flex gap-1">
          <dt>Inventory</dt>
          <dd className="mp-num text-mp-ink">{formatValue(metro.latest.inventory?.value, 'count_signed_thousands').replace('+', '')}</dd>
        </div>
        <div className="flex gap-1">
          <dt>DOM</dt>
          <dd className="mp-num text-mp-ink">{formatValue(metro.latest.median_dom?.value, 'count')} d</dd>
        </div>
      </dl>
    </GlassPanel>
  );
}

// ---------- table view ----------
export interface TableRow {
  slug: string;
  name: string;
  value: number | null;
  change: number | null;
  temperature: number | null;
  temperatureLabel: string | null;
  miles: number | null;
}

type SortKey = 'name' | 'value' | 'change' | 'temperature' | 'miles';

export function AtlasTable({ rows, metric, monthLabel, caption, selected, onSelect, onClose }: { rows: readonly TableRow[]; metric: MetricRegistryEntry; monthLabel: string; caption: string; selected: readonly string[]; onSelect: (slug: string) => void; onClose: () => void }) {
  const hasMiles = rows.some((r) => r.miles != null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(() => ({ key: hasMiles ? 'miles' : 'value', dir: hasMiles ? 1 : -1 }));
  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    if (av == null) return 1;
    if (bv == null) return -1;
    return (typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)) * sort.dir;
  });
  const th = (key: SortKey, label: string, right = true) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>
      <button type="button" className="uppercase tracking-[.06em] hover:text-mp-ink" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' || key === 'miles' ? 1 : -1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
  return (
    <GlassPanel solid className="flex max-h-full min-h-0 flex-col" role="region" aria-labelledby="atlas-table-h" data-testid="atlas-table">
      <div className="flex items-center gap-3 border-b border-mp-line px-4 py-3">
        <h2 id="atlas-table-h" className="mp-display text-[24px]">
          Table view
        </h2>
        <span className="text-sm text-mp-ink-3">{caption}</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="rounded-control p-1.5 text-mp-ink-3 hover:text-mp-ink" aria-label="Back to the map (T)">
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 overflow-auto" tabIndex={0} role="group" aria-label="Metros table, scrollable">
        <table className="w-full text-[13px]">
          <caption className="sr-only">
            {metric.label}, {monthLabel}: {caption}
          </caption>
          <thead className="sticky top-0 bg-mp-panel text-[11px] text-mp-ink-3">
            <tr>
              {th('name', 'Metro', false)}
              {hasMiles && th('miles', 'mi')}
              {th('value', `${metric.label} · ${monthLabel}`)}
              {th('change', 'YoY')}
              {th('temperature', 'Temp.')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.slug} className={`border-t border-mp-line ${selected.includes(r.slug) ? 'bg-mp-accent/[.08]' : ''}`} data-slug={r.slug}>
                <th scope="row" className="px-3 py-1.5 text-left font-normal">
                  <button type="button" onClick={() => onSelect(r.slug)} className="text-mp-ink hover:text-mp-accent">
                    {r.name}
                  </button>
                </th>
                {hasMiles && <td className="mp-num px-3 text-right text-mp-ink-3">{r.miles == null ? '—' : Math.round(r.miles)}</td>}
                <td className="mp-num px-3 text-right" data-col="value">
                  {fmtMetric(metric, r.value)}
                </td>
                <td className={`mp-num px-3 text-right ${toneClass(r.change)}`} data-col="change">
                  {fmtChange(metric, r.change)}
                </td>
                <td className="mp-num px-3 text-right text-mp-ink-2">
                  {r.temperature ?? '—'} <span className="font-ui text-[11px] text-mp-ink-3">{r.temperatureLabel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}

// ---------- modal sheet (shortcuts) ----------
export function Dialog({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      restore.current?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="mp-page fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" style={{ background: 'rgb(0 0 0 / .45)' }} onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="dlg-h" tabIndex={-1} className="mp-glass w-full max-w-md p-5 outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 id="dlg-h" className="mp-display text-[26px]">
            {title}
          </h2>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-control p-1.5 text-mp-ink-3 hover:text-mp-ink" aria-label="Close">
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['← ↑ → ↓', 'Pan the map'],
  ['+  −', 'Zoom in / out'],
  ['[  ]', 'Rotate the view'],
  [',  .', 'Previous / next month'],
  ['Space', 'Play or pause the time machine'],
  ['T', 'Table view on / off'],
  ['Esc', 'Clear the selection or area'],
  ['Shift + drag', 'Lasso metros to compare'],
  ['⌘K / Ctrl K', 'Search metros and actions'],
  ['?', 'This sheet'],
];

export function ShortcutList() {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
      {SHORTCUTS.map(([k, v]) => (
        <div key={k} className="contents">
          <dt>
            <kbd className="rounded border border-mp-line px-1.5 py-0.5 font-figure text-xs text-mp-ink">{k}</kbd>
          </dt>
          <dd className="text-mp-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- mobile bottom sheet ----------
export function BottomSheet({ tabs, active, onTab, open, onToggle }: { tabs: ReadonlyArray<{ id: string; label: string; body: ReactNode }>; active: string; onTab: (id: string) => void; open: boolean; onToggle: () => void }) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0]!;
  return (
    // Solid on phones: the sheet sits over busy map pixels with no room to blur them away.
    <GlassPanel as="section" solid aria-label="Atlas controls" className="absolute inset-x-2 bottom-2 z-20 flex max-h-[62vh] flex-col rounded-[22px] pb-[env(safe-area-inset-bottom)]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-mp-ink/25" aria-label={open ? 'Collapse the panel' : 'Expand the panel'} />
      <div role="tablist" aria-label="Panels" className="flex gap-1 px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={t.id === current.id}
            onClick={() => {
              onTab(t.id);
              if (!open) onToggle();
            }}
            className={`flex-1 rounded-control py-2 text-sm font-medium text-mp-ink ${t.id === current.id ? 'bg-mp-ink/[.1] shadow-[inset_0_-2px_0_rgb(var(--mp-accent))]' : 'opacity-90 hover:bg-mp-ink/[.05]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" hidden={!open} className="min-h-0 overflow-y-auto px-4 pb-4 pt-3">
        {current.body}
      </div>
    </GlassPanel>
  );
}
