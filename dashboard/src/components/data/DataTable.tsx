import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SortDir } from '../../viewmodels/metros';
import { ScrollArea } from '../ui/ScrollArea';

export interface Column {
  id: string;
  header: string;
  sub?: string;
  align?: 'left' | 'right';
  sortable?: boolean;
}

export interface TableRow {
  key: string;
  cells: Record<string, ReactNode>;
}

interface DataTableProps {
  caption: string;
  columns: readonly Column[];
  rows: readonly TableRow[];
  sortKey: string;
  sortDir: SortDir;
  onSort: (key: string) => void;
  /** Rendered as <th scope="row"> and pinned while scrolling horizontally. */
  rowHeader: string;
}

/** Sortable table (aria-sort) with a sticky header row and a sticky first column. */
export function DataTable({ caption, columns, rows, sortKey, sortDir, onSort, rowHeader }: DataTableProps) {
  return (
    <ScrollArea label={caption} maxHeight>
      <table className="table-base min-w-max">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-20">
          <tr>
            {columns.map((col) => {
              const active = col.id === sortKey;
              const sticky = col.id === rowHeader ? 'sticky left-0 z-30 border-r group-data-[scrolled=true]/scroll:shadow-[6px_0_8px_-6px_rgb(0_0_0/0.18)]' : '';
              const align = col.align === 'right' ? 'text-right' : 'text-left';
              const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th key={col.id} scope="col" aria-sort={col.sortable ? (active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined} className={`${align} ${sticky} whitespace-nowrap`}>
                  {col.sortable ? (
                    <button type="button" onClick={() => onSort(col.id)} className={`inline-flex items-center gap-1 rounded-sm font-medium hover:text-text ${active ? 'text-text' : ''} ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                      <span className={col.align === 'right' ? 'text-right' : ''}>
                        {col.header}
                        {col.sub && <span className="block text-2xs font-normal text-text-3">{col.sub}</span>}
                      </span>
                      <Icon aria-hidden="true" className={`h-3 w-3 shrink-0 ${active ? '' : 'opacity-40'}`} />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="group">
              {columns.map((col) => {
                const align = col.align === 'right' ? 'text-right num' : 'text-left';
                return col.id === rowHeader ? (
                  <th key={col.id} scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-2 text-left font-normal group-hover:bg-surface-2 group-data-[scrolled=true]/scroll:shadow-[6px_0_8px_-6px_rgb(0_0_0/0.18)]">
                    {row.cells[col.id]}
                  </th>
                ) : (
                  <td key={col.id} className={`${align} whitespace-nowrap bg-surface group-hover:bg-surface-2`}>
                    {row.cells[col.id]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}
