import { describe, expect, it } from 'vitest';

import { formatEnumerationColumns } from './enum-list-cells.helper';

describe('formatEnumerationColumns', () => {
  const format = formatEnumerationColumns((value) => `label:${String(value)}`);

  it('formats enumeration columns with the row value', () => {
    const result = format({
      displayedHeaders: [
        { name: 'fullName', attribute: { type: 'string' } },
        { name: 'menuSelectionMode', attribute: { type: 'enumeration' } },
      ],
    });

    expect(result.displayedHeaders[0]).not.toHaveProperty('cellFormatter');
    const formatter = result.displayedHeaders[1].cellFormatter as (
      row: Record<string, unknown>,
    ) => unknown;
    expect(formatter({ menuSelectionMode: 'later' })).toBe('label:later');
  });

  it('keeps a formatter another plugin already set', () => {
    const existing = () => 'plugin';
    const result = format({
      displayedHeaders: [
        { name: 'status', attribute: { type: 'enumeration' }, cellFormatter: existing },
      ],
    });

    expect(result.displayedHeaders[0].cellFormatter).toBe(existing);
  });
});
