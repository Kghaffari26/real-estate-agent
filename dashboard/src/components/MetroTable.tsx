import type { ReactNode } from 'react';
import type { SortDir } from '../viewmodels/metros';

export interface Column {
  id: string;
  header: string;
  /** Secondary header line (e.g. "YoY"). */
  sub?: string;
  align?: 'left' | 'right';
  sortable?: boolean;
}

export interface TableRow {
  key: string;
  cells: Record<string, ReactNode>;
}

interface SortableTableProps {
  caption: string;
  columns: readonly Column[];
  rows: readonly TableRow[];
  sortKey: string;
  sortDir: SortDir;
  onSort: (key: string) => void;
  /** Column rendered as the row header (<th scope="row">). */
  rowHeader: string;
  id?: string;
}

/** A sortable table: header buttons with aria-sort; scrolls horizontally inside its own box. */
export function SortableTable({ caption, columns, rows, sortKey, sortDir, onSort, rowHeader, id }: SortableTableProps) {
  return (
    <div className="max-w-full overflow-x-auto rounded-md border border-border" tabIndex={0} role="region" aria-label={caption} id={id}>
      <table className="table-base min-w-max">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-muted">
          <tr>
            {columns.map((col) => {
              const active = col.id === sortKey;
              const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
              const align = col.align === 'right' ? 'text-right' : 'text-left';
              return (
                <th key={col.id} scope="col" aria-sort={col.sortable ? ariaSort : undefined} className={`${align} whitespace-nowrap`}>
                  {col.sortable ? (
                    <button type="button" onClick={() => onSort(col.id)} className={`inline-flex items-center gap-1 font-semibold hover:text-text ${active ? 'text-text' : ''}`}>
                      <span>
                        {col.header}
                        {col.sub && <span className="block text-xs font-normal">{col.sub}</span>}
                      </span>
                      <span aria-hidden="true">{active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
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
            <tr key={row.key} className="hover:bg-surface-muted">
              {columns.map((col) => {
                const align = col.align === 'right' ? 'text-right tabular-nums' : 'text-left';
                return col.id === rowHeader ? (
                  <th key={col.id} scope="row" className={`${align} font-normal`}>
                    {row.cells[col.id]}
                  </th>
                ) : (
                  <td key={col.id} className={`${align} whitespace-nowrap`}>
                    {row.cells[col.id]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
