import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AffordabilityCalculator } from './data/AffordabilityCalculator';
import { AlertCards } from './data/AlertCards';
import { ColumnPicker } from './data/ColumnPicker';
import { DataTable } from './data/DataTable';
import { KpiCard } from './data/KpiCard';
import { TemperatureComponents } from './data/TemperatureComponents';
import { TemperatureGauge } from './data/TemperatureGauge';
import { MetroMap } from './map';
import { CommandPalette } from './shell/CommandPalette';
import { paletteResults } from '../lib/palette';
import { FreshnessChip } from './shell/FreshnessChip';
import { ThemeToggle } from './shell/ThemeToggle';
import { MetroSearch } from './ui/MetroSearch';
import { ErrorState } from './ui/StateViews';
import { StatusBadge } from './ui/Status';
import { severityStatus } from '../lib/labels';

const ITEMS = [
  { slug: 'san-diego-ca', name: 'San Diego, CA' },
  { slug: 'san-antonio-tx', name: 'San Antonio, TX' },
  { slug: 'austin-tx', name: 'Austin, TX' },
];
const withRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('MetroSearch', () => {
  it('filters as you type and selects with the keyboard', async () => {
    const onSelect = vi.fn();
    render(<MetroSearch items={ITEMS} onSelect={onSelect} />);
    const box = screen.getByRole('combobox', { name: 'Find a metro' });
    await userEvent.type(box, 'san');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['San Antonio, TX', 'San Diego, CA']);
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', options[1]!.id);
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('san-diego-ca');
  });
});

describe('CommandPalette', () => {
  it('ranks metros first, then pages, and offers a compare shortcut', () => {
    const results = paletteResults('aus', ITEMS);
    expect(results[0]).toMatchObject({ label: 'Austin, TX', to: '/metro/austin-tx', group: 'Metros' });
    expect(results.some((r) => r.to === '/compare?m=austin-tx')).toBe(true);
    expect(paletteResults('method', ITEMS).map((r) => r.label)).toEqual(['Methodology']);
  });

  it('is a keyboard-driven modal dialog', async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} metros={ITEMS} onNavigate={onNavigate} />);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toHaveAttribute('aria-modal', 'true');
    const input = screen.getByRole('combobox', { name: 'Search metros and pages' });
    await userEvent.type(input, 'diego');
    await userEvent.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('/metro/san-diego-ca');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('AffordabilityCalculator', () => {
  const defaults = { price: 275000, downPaymentPct: 20, ratePct: 7.03, termYears: 30, income: null, publishedPayment: 1468.1 };

  it('starts from the published defaults and recomputes from inputs and sliders', async () => {
    render(<AffordabilityCalculator defaults={defaults} />);
    const out = screen.getByRole('status');
    expect(out).toHaveTextContent('$1,468');
    expect(out).toHaveTextContent('Total interest');
    const down = screen.getByRole('spinbutton', { name: /Down payment/ });
    await userEvent.clear(down);
    await userEvent.type(down, '10');
    expect(out).toHaveTextContent('$1,652');
    fireEvent.change(screen.getByRole('slider', { name: 'Down payment slider' }), { target: { value: '20' } });
    expect(out).toHaveTextContent('$1,468');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByRole('spinbutton', { name: /Home price/ })).toHaveValue(275000);
  });

  it('shows payment-to-income when income exists, and validates input', async () => {
    render(<AffordabilityCalculator defaults={{ ...defaults, income: 80000 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('22.0%');
    await userEvent.clear(screen.getByRole('spinbutton', { name: /Home price/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Enter a price');
  });
});

describe('DataTable and ColumnPicker', () => {
  it('exposes aria-sort, sorts, and pins the row header', async () => {
    const onSort = vi.fn();
    render(
      <DataTable
        caption="Test table"
        columns={[
          { id: 'name', header: 'Metro', sortable: true },
          { id: 'v', header: 'Value', sortable: true, align: 'right' },
        ]}
        rows={[{ key: 'a', cells: { name: 'A', v: '1' } }]}
        sortKey="v"
        sortDir="desc"
        onSort={onSort}
        rowHeader="name"
      />,
    );
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveAttribute('aria-sort', 'none');
    expect(headers[1]).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(within(headers[0]!).getByRole('button'));
    expect(onSort).toHaveBeenCalledWith('name');
    expect(screen.getByRole('rowheader')).toHaveClass('sticky');
  });

  it('toggles columns from a popover', async () => {
    const onChange = vi.fn();
    render(<ColumnPicker groups={[{ label: 'Price', options: [{ id: 'p.value', label: 'Value' }, { id: 'p.yoy', label: 'YoY' }] }]} selected={['p.value']} onChange={onChange} onReset={() => {}} />);
    const button = screen.getByRole('button', { name: /Columns/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('checkbox', { name: 'YoY' }));
    expect(onChange).toHaveBeenCalledWith(['p.value', 'p.yoy']);
  });
});

describe('data display', () => {
  it('gauge and KPI card expose their values accessibly', () => {
    render(<TemperatureGauge score={59} label="Balanced" basis="vs its own 3-year history" />);
    expect(screen.getByRole('img', { name: 'Market temperature 59 out of 100, Balanced' })).toBeInTheDocument();
    render(<KpiCard label="Median sale price" value={398596} formatValue={(v) => `$${v}`} deltas={[{ value: 0.022, format: 'percent_signed', label: 'YoY' }]} spark={[1, 2, 3]} highlighted />);
    expect(screen.getByText('$398596')).toHaveClass('sr-only');
    expect(screen.getByText('+2.2%')).toBeInTheDocument();
  });

  it('temperature components describe each bar in words', () => {
    render(<TemperatureComponents bars={[{ key: 'median_dom', label: 'Median days on market', z: -1.2, contribution: 1.2, reading: 'Homes sell faster than in most metros' }]} />);
    expect(screen.getByText('Homes sell faster than in most metros')).toBeInTheDocument();
    expect(screen.getByText('z −1.20'.replace('−', '-'))).toBeInTheDocument();
  });

  it('alert cards pair status color with an icon and a label', () => {
    withRouter(<AlertCards alerts={[{ flag: 'inventory_drop', label: 'Inventory down ≥20% YoY', severity: 'notable', metros: [{ slug: 'miami-fl', name: 'Miami, FL', label: 'Inventory -20% YoY', severity: 'notable' }] }]} />);
    expect(screen.getByRole('link', { name: 'Miami, FL' })).toHaveAttribute('href', '/metro/miami-fl');
    expect(screen.getByText('Notable')).toBeInTheDocument();
    expect(severityStatus('major')).toBe('bad');
    render(<StatusBadge status="good">ok</StatusBadge>);
  });

  it('freshness chip links to the run details and flags staleness', () => {
    withRouter(<FreshnessChip dataThrough="2026-08-31" ratesAsOf="2026-09-24" stale sample />);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('Aug 2026');
    expect(link).toHaveTextContent('(older than usual)');
    expect(link).toHaveTextContent('Sample');
  });

  it('theme toggle is a pressed-button group', async () => {
    const onChange = vi.fn();
    render(<ThemeToggle value="system" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'System theme' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('map falls back to its list when WebGL is unavailable (jsdom has none)', () => {
    render(<MetroMap points={[]} onSelect={() => {}} label="Map" fallback={<p>Fallback list</p>} />);
    expect(screen.getByText('Fallback list')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Map unavailable');
  });

  it('error state offers a retry', async () => {
    const retry = vi.fn();
    render(<ErrorState error={new Error('latest.json was not found')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('latest.json was not found');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});
