import { describe, expect, it } from 'vitest';

import {
  areContentManagerMetadatasEqual,
  hasContentManagerLabelOverrides,
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

describe('hasContentManagerLabelOverrides', () => {
  it('is false without metadatas', () => {
    expect(hasContentManagerLabelOverrides(undefined)).toBe(false);
    expect(hasContentManagerLabelOverrides({})).toBe(false);
    expect(hasContentManagerLabelOverrides({ config: { metadatas: {} } })).toBe(false);
  });

  it('is true when at least one override exists', () => {
    expect(
      hasContentManagerLabelOverrides({
        config: { metadatas: { brandName: { edit: { label: 'Tên' } } } },
      }),
    ).toBe(true);
  });
});
