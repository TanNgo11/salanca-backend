import { describe, expect, it } from 'vitest';

import {
  markAuditRequestCaptured,
  wasAuditRequestCaptured,
  withAuditRequestCapture,
} from './audit-request-capture';

describe('request-scoped audit capture tracking', () => {
  it('tracks only the matching request and does not leak outside the async scope', async () => {
    expect(wasAuditRequestCaptured('request-a')).toBe(false);

    await withAuditRequestCapture(async () => {
      markAuditRequestCaptured('request-a');
      expect(wasAuditRequestCaptured('request-a')).toBe(true);
      expect(wasAuditRequestCaptured('request-b')).toBe(false);
    });

    expect(wasAuditRequestCaptured('request-a')).toBe(false);
  });
});
