import { describe, expect, it } from 'vitest';

import {
  isGenericAuditCaptureSuppressed,
  withGenericAuditCaptureSuppressed,
} from './audit-event.suppression';

describe('generic audit capture suppression', () => {
  it('is inactive outside an append', () => {
    expect(isGenericAuditCaptureSuppressed()).toBe(false);
  });

  it('nests and always restores', async () => {
    await withGenericAuditCaptureSuppressed(async () => {
      expect(isGenericAuditCaptureSuppressed()).toBe(true);
      await withGenericAuditCaptureSuppressed(async () => {
        expect(isGenericAuditCaptureSuppressed()).toBe(true);
      });
      expect(isGenericAuditCaptureSuppressed()).toBe(true);
    });
    expect(isGenericAuditCaptureSuppressed()).toBe(false);
  });

  it('restores after a thrown append', async () => {
    await expect(
      withGenericAuditCaptureSuppressed(async () => {
        throw new Error('append failed');
      }),
    ).rejects.toThrow('append failed');
    expect(isGenericAuditCaptureSuppressed()).toBe(false);
  });

  it('does not suppress a concurrent request while another append is in flight', async () => {
    let concurrentSawSuppression = true;
    const append = withGenericAuditCaptureSuppressed(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 40);
      });
      expect(isGenericAuditCaptureSuppressed()).toBe(true);
    });
    const concurrent = (async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      concurrentSawSuppression = isGenericAuditCaptureSuppressed();
    })();

    await Promise.all([append, concurrent]);
    expect(concurrentSawSuppression).toBe(false);
    expect(isGenericAuditCaptureSuppressed()).toBe(false);
  });
});
