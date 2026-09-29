import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { clearCache } from '../data/api';

const sample = (p: string) => readFileSync(resolve(__dirname, '../../sample-data', p), 'utf8');

function serve(files: Record<string, string | number>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace(/^.*\/data\//, '').replace(/\?.*$/, '');
      const body = files[path];
      if (body === undefined) return new Response('not found', { status: 404 });
      if (typeof body === 'number') return new Response('', { status: body });
      return new Response(body, { status: 200 });
    }),
  );
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

// Routes are React.lazy: the first import of each page module is compiled on demand,
// which under a busy parallel run can outlast findBy's timeout. Load them up front so
// every timed wait only covers rendering, never compilation.
beforeAll(async () => {
  await Promise.all([import('./MetrosPage'), import('./MetroPage'), import('./ComparePage'), import('./AboutPage'), import('./NotFoundPage')]);
}, 60_000);

beforeEach(() => clearCache());
afterEach(() => vi.unstubAllGlobals());

describe('pages', () => {
  it('overview renders the headline from the sample data', async () => {
    serve({ 'latest.json': sample('latest.json'), 'manifest-entry.json': sample('manifest-entry.json'), 'source.json': '{"source":"sample"}' });
    renderAt('/');
    const index = JSON.parse(sample('latest.json'));
    expect(await screen.findByRole('heading', { name: index.headline })).toBeInTheDocument();
    // Freshness chip: "Redfin through <month>" with a Sample marker.
    expect(await screen.findByText('Sample')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /through/ })).toHaveAttribute('href', '/about?section=run');
    expect(screen.getAllByText(/Data through/).length).toBeGreaterThan(0);
    // The KPI row renders every national metric's final value for screen readers.
    expect(screen.getByRole('region', { name: 'Key national metrics' })).toBeInTheDocument();
  });

  it('shows an error state with retry when latest.json is missing', async () => {
    serve({ 'latest.json': 500 });
    renderAt('/');
    const alerts = await screen.findAllByRole('alert');
    expect(alerts[0]).toHaveTextContent("Couldn't load data");
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });

  it('shows a loading state first', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderAt('/metros');
    expect((await screen.findAllByRole('status')).some((el) => /Loading/.test(el.textContent ?? '') || /Loading/.test(el.getAttribute('aria-label') ?? ''))).toBe(true);
  });

  it('metro page: not found for unknown slugs', async () => {
    serve({ 'latest.json': sample('latest.json') });
    renderAt('/metro/nowhere-zz');
    expect(await screen.findByRole('heading', { name: 'Metro not found' })).toBeInTheDocument();
  });

  it('compare: empty state without metros', async () => {
    serve({ 'latest.json': sample('latest.json') });
    renderAt('/compare');
    expect(await screen.findByText('Pick metros to compare')).toBeInTheDocument();
  });

  it('about: lists sources with attribution', async () => {
    serve({ 'latest.json': sample('latest.json'), 'manifest-entry.json': sample('manifest-entry.json') });
    renderAt('/about');
    expect(await screen.findByRole('heading', { name: 'Sources and attribution' })).toBeInTheDocument();
    expect(screen.getAllByText('Data: Redfin, a national real estate brokerage.').length).toBeGreaterThan(0);
    const manifest = JSON.parse(sample('manifest-entry.json'));
    const cost = manifest.run_cost_usd < 1 ? manifest.run_cost_usd.toFixed(4) : manifest.run_cost_usd.toFixed(2);
    expect(await screen.findByText(`$${cost}`)).toBeInTheDocument();
  });
});
