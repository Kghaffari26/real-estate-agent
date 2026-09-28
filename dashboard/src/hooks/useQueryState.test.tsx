import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useQueryList, useQueryState, useSetQuery } from './useQueryState';

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
}

describe('useQueryState', () => {
  it('reads, validates and writes a parameter', () => {
    const { result } = renderHook(
      () => ({ state: useQueryState('range', '3Y', ['1Y', '3Y', 'All'] as const), loc: useLocation() }),
      { wrapper: wrapper('/x?range=bogus') },
    );
    expect(result.current.state[0]).toBe('3Y');
    act(() => result.current.state[1]('1Y'));
    expect(result.current.loc.search).toBe('?range=1Y');
    act(() => result.current.state[1]('3Y'));
    expect(result.current.loc.search).toBe('');
  });

  it('parses list parameters with a max and no duplicates', () => {
    const { result } = renderHook(() => useQueryList('m', 3), { wrapper: wrapper('/c?m=a,b,a,,c,d') });
    expect(result.current[0]).toEqual(['a', 'b', 'c']);
  });

  it('sets several parameters at once without clobbering', () => {
    const { result } = renderHook(() => ({ set: useSetQuery(), loc: useLocation() }), { wrapper: wrapper('/m?q=san') });
    act(() => result.current.set({ sort: 'name', dir: 'asc' }));
    expect(new URLSearchParams(result.current.loc.search).toString()).toBe('q=san&sort=name&dir=asc');
    act(() => result.current.set({ q: null }));
    expect(result.current.loc.search).toBe('?sort=name&dir=asc');
  });
});
