import { describe, expect, it } from 'vitest';

import {
  applyContentManagerListView,
  areContentManagerMetadatasEqual,
  mergeContentManagerMetadatas,
} from './content-manager-labels.helper';

describe('mergeContentManagerMetadatas', () => {
  it('merges edit/list labels for known fields', () => {
    const { mergedMetadatas, skippedFields } = mergeContentManagerMetadatas(
      {
        brandName: {
          edit: { label: 'Brand Name', description: '' },
          list: { label: 'Brand Name' },
        },
        hotline: {
          edit: { label: 'Hotline' },
          list: { label: 'Hotline' },
        },
      },
      {
        brandName: {
          edit: { label: 'Tên thương hiệu', placeholder: 'Salanca Brazil' },
          list: { label: 'Thương hiệu' },
        },
      },
    );

    expect(mergedMetadatas.brandName?.edit?.label).toBe('Tên thương hiệu');
    expect(mergedMetadatas.brandName?.edit?.placeholder).toBe('Salanca Brazil');
    expect(mergedMetadatas.brandName?.list?.label).toBe('Thương hiệu');
    expect(mergedMetadatas.hotline?.edit?.label).toBe('Hotline');
    expect(skippedFields).toEqual([]);
  });

  it('reports desired keys missing from current config', () => {
    const { mergedMetadatas, skippedFields } = mergeContentManagerMetadatas(
      { brandName: { edit: { label: 'Brand' }, list: { label: 'Brand' } } },
      { unknownField: { edit: { label: 'X' }, list: { label: 'X' } } },
    );
    expect(mergedMetadatas.unknownField).toBeUndefined();
    expect(skippedFields).toEqual(['unknownField']);
  });
});

describe('areContentManagerMetadatasEqual', () => {
  it('detects deep equality', () => {
    const sample = { brandName: { edit: { label: 'A' }, list: { label: 'A' } } };
    expect(areContentManagerMetadatasEqual(sample, { ...sample })).toBe(true);
    expect(
      areContentManagerMetadatasEqual(sample, {
        brandName: { edit: { label: 'B' }, list: { label: 'A' } },
      }),
    ).toBe(false);
  });
});

describe('applyContentManagerListView', () => {
  const fields = new Set(['fullName', 'phone', 'status', 'createdAt']);
  const current = {
    settings: { pageSize: 10, defaultSortBy: 'fullName', searchable: true },
    layouts: { list: ['id', 'fullName'], edit: [] },
  };

  it('sets columns, sort and page size while keeping other settings and layouts', () => {
    const result = applyContentManagerListView(
      current,
      {
        columns: ['fullName', 'status', 'createdAt'],
        defaultSortBy: 'createdAt',
        defaultSortOrder: 'DESC',
        pageSize: 25,
      },
      fields,
    );

    expect(result.layouts).toEqual({ list: ['fullName', 'status', 'createdAt'], edit: [] });
    expect(result.settings).toEqual({
      pageSize: 25,
      defaultSortBy: 'createdAt',
      defaultSortOrder: 'DESC',
      searchable: true,
    });
    expect(result.skippedColumns).toEqual([]);
  });

  it('reports unknown columns and ignores an unknown sort field', () => {
    const result = applyContentManagerListView(
      current,
      { columns: ['fullName', 'ghost'], defaultSortBy: 'ghost' },
      fields,
    );

    expect(result.layouts).toEqual({ list: ['fullName'], edit: [] });
    expect(result.settings).toMatchObject({ defaultSortBy: 'fullName' });
    expect(result.skippedColumns).toEqual(['ghost']);
  });

  it('leaves the configuration untouched without a list view', () => {
    const result = applyContentManagerListView(current, undefined, fields);

    expect(result.settings).toBe(current.settings);
    expect(result.layouts).toBe(current.layouts);
  });
});
