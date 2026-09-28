import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AffordabilityCalculator } from './AffordabilityCalculator';
import { AlertsList } from './AlertsList';
import { MetroSearch } from './layout/MetroSearch';
import { SortableTable } from './MetroTable';
import { TemperatureGauge } from './TemperatureGauge';
import { ErrorState } from './ui/StateViews';

const ITEMS = [
  { slug: 'san-diego-ca', name: 'San Diego, CA' },
  { slug: 'san-antonio-tx', name: 'San Antonio, TX' },
  { slug: 'austin-tx', name: 'Austin, TX' },
];

describe('MetroSearch', () => {
  it('filters as you type and selects with the keyboard', async () => {
    const onSelect = vi.fn();
    render(<MetroSearch items={ITEMS} onSelect={onSelect} />);
    const box = screen.getByRole('combobox', { name: 'Find a metro' });
    await userEvent.type(box, 'san');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['San Antonio, TX', 'San Diego, CA']);
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', options[1]!.id);
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('san-diego-ca');
    expect(box).toHaveValue('');
  });

  it('closes on Escape and reports no matches', async () => {
    render(<MetroSearch items={ITEMS} onSelect={() => {}} exclude={['austin-tx']} />);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'austin');
    expect(screen.getByRole('option')).toHaveTextContent('No matching metros');
    await userEvent.keyboard('{Escape}');
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('AffordabilityCalculator', () => {
  const defaults = { price: 275000, downPaymentPct: 20, ratePct: 7.03, termYears: 30, income: null, publishedPayment: 1468.1 };

  it('starts from the published defaults and recomputes', async () => {
    render(<AffordabilityCalculator defaults={defaults} />);
    const out = screen.getByRole('status');
    expect(out).toHaveTextContent('$1,468');
    expect(out).toHaveTextContent('Needs median household income');
    const down = screen.getByLabelText(/Down payment/);
    await userEvent.clear(down);
    await userEvent.type(down, '10');
    expect(out).toHaveTextContent('$1,652');
    await userEvent.selectOptions(screen.getByLabelText(/Term/), '15');
    expect(out).not.toHaveTextContent('$1,652');
  });

  it('shows payment-to-income when income exists, and validates input', async () => {
    render(<AffordabilityCalculator defaults={{ ...defaults, income: 80000 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('22.0%');
    await userEvent.clear(screen.getByLabelText(/Home price/));
    expect(screen.getByRole('status')).toHaveTextContent('Enter a price');
  });
});

describe('SortableTable', () => {
  it('exposes aria-sort and calls onSort', async () => {
    const onSort = vi.fn();
    render(
      <SortableTable
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
    expect(screen.getByRole('rowheader')).toHaveTextContent('A');
  });
});

describe('small components', () => {
  it('gauge describes itself', () => {
    render(<TemperatureGauge score={59} label="Balanced" basis="vs its own 3-year history" />);
    expect(screen.getByRole('img', { name: 'Market temperature 59 out of 100, Balanced' })).toBeInTheDocument();
    render(<TemperatureGauge score={null} label={null} />);
    expect(screen.getByRole('img', { name: 'Market temperature unavailable' })).toBeInTheDocument();
  });

  it('alerts list links each metro with its own figure', () => {
    render(
      <MemoryRouter>
        <AlertsList alerts={[{ flag: 'x', label: 'Inventory down ≥20% YoY', severity: 'notable', metros: [{ slug: 'miami-fl', name: 'Miami, FL', label: 'Inventory -20% YoY', severity: 'notable' }] }]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Miami, FL' })).toHaveAttribute('href', '/metro/miami-fl');
    expect(screen.getByText('Inventory -20% YoY')).toBeInTheDocument();
    render(<AlertsList alerts={[]} />);
    expect(screen.getByText(/No notable or major flags/)).toBeInTheDocument();
  });

  it('error state offers a retry', async () => {
    const retry = vi.fn();
    render(<ErrorState error={new Error('latest.json was not found')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('latest.json was not found');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});
