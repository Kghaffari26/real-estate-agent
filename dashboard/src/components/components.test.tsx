import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AlertCards } from './data/AlertCards';
import { TemperatureComponents } from './data/TemperatureComponents';
import { CommandPalette } from './shell/CommandPalette';
import { paletteResults } from '../lib/palette';
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



describe('data display', () => {

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




  it('error state offers a retry', async () => {
    const retry = vi.fn();
    render(<ErrorState error={new Error('latest.json was not found')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('latest.json was not found');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});
