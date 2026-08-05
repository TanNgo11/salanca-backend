import { describe, expect, it } from 'vitest';

import {
  assertCmsWebhookBodySize,
  buildCmsWebhookPayload,
  parseCmsWebhookPayload,
  signCmsWebhookPayload,
  verifyCmsWebhookSignature,
  CmsWebhookValidationError,
  CmsWebhookValidationErrorCode,
} from './cms-webhook.helper';
import { CmsWebhookContentUid, CmsWebhookEvent } from './cms-webhook.types';

describe('cms webhook signing', () => {
  it('round-trips a signature', () => {
    const body = JSON.stringify({ ok: true });
    const secret = 'test-secret';
    const signature = signCmsWebhookPayload(body, secret);

    expect(() => verifyCmsWebhookSignature(body, secret, `sha256=${signature}`)).not.toThrow();
  });

  it('rejects a bad signature', () => {
    try {
      verifyCmsWebhookSignature('{}', 'secret', 'sha256=deadbeef');
      expect.unreachable('expected error');
    } catch (error) {
      expect(error).toBeInstanceOf(CmsWebhookValidationError);
      expect((error as CmsWebhookValidationError).code).toBe(
        CmsWebhookValidationErrorCode.InvalidSignature,
      );
    }
  });
});

describe('parseCmsWebhookPayload', () => {
  it('accepts an allowlisted publish payload', () => {
    expect(
      parseCmsWebhookPayload({
        uid: CmsWebhookContentUid.HomePage,
        locale: 'vi',
        documentId: 'abc123',
        event: CmsWebhookEvent.Publish,
      }),
    ).toEqual({
      uid: CmsWebhookContentUid.HomePage,
      locale: 'vi',
      documentId: 'abc123',
      event: CmsWebhookEvent.Publish,
    });
  });

  it('rejects unknown UIDs', () => {
    expect(() =>
      parseCmsWebhookPayload({
        uid: 'api::unknown.unknown',
        locale: 'vi',
        documentId: 'x',
        event: CmsWebhookEvent.Publish,
      }),
    ).toThrow(CmsWebhookValidationError);
  });
});

describe('buildCmsWebhookPayload', () => {
  it('builds a validated payload', () => {
    const payload = buildCmsWebhookPayload(
      CmsWebhookContentUid.Location,
      'en',
      'loc-1',
      CmsWebhookEvent.Unpublish,
    );
    expect(payload.event).toBe(CmsWebhookEvent.Unpublish);
  });
});

describe('assertCmsWebhookBodySize', () => {
  it('rejects oversized bodies', () => {
    const huge = 'x'.repeat(5_000);
    expect(() => assertCmsWebhookBodySize(huge)).toThrow(CmsWebhookValidationError);
  });
});
