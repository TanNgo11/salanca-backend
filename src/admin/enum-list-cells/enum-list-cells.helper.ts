import type { ReactNode } from 'react';

export const INJECT_COLUMN_IN_TABLE_HOOK = 'Admin/CM/pages/ListView/inject-column-in-table';

interface ListHeader {
  name: string;
  attribute?: { type?: string };
  cellFormatter?: unknown;
}

interface ListHeadersState<THeader extends ListHeader> {
  displayedHeaders: readonly THeader[];
}

export type EnumCellRenderer = (value: unknown) => ReactNode;

/**
 * The Content Manager list prints enumeration values raw (`later`, `vi`).
 * Gives each enumeration column a formatter that shows the translated label
 * instead; columns another plugin already formats are left alone.
 */
export const formatEnumerationColumns =
  (renderValue: EnumCellRenderer) =>
  <THeader extends ListHeader, TState extends ListHeadersState<THeader>>(state: TState): TState => ({
    ...state,
    displayedHeaders: state.displayedHeaders.map((header) =>
      header.attribute?.type === 'enumeration' && typeof header.cellFormatter !== 'function'
        ? {
            ...header,
            cellFormatter: (row: Record<string, unknown>) =>
              renderValue(row[header.name.split('.')[0]]),
          }
        : header,
    ),
  });
