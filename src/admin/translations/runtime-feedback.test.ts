import { describe, expect, it } from 'vitest';

import {
  buildAdminTranslationOverrides,
  collectMissingAdminMessageIds,
} from './coverage.helper';
import { runtimeFeedbackVietnameseTranslations } from './runtime-feedback';

const FEEDBACK_ID_PATTERN =
  /(?:notification|\.error(?:\.|$)|error\.|\.success(?:\.|$)|success\.|missing-assets|missing-relations|new-field|unknown-fields|no-images|submitted|validation|limit|not-available|has-passed|no-transition|save-first|single-stage)/iu;

describe('Vietnamese Admin runtime feedback', () => {
  it('defines non-empty Vietnamese copy for every explicit override', () => {
    for (const value of Object.values(runtimeFeedbackVietnameseTranslations)) {
      expect(value.trim()).not.toBe('');
      expect(value).toMatch(
        /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/iu,
      );
    }
  });

  it('covers every installed Strapi feedback id matched by the audit policy', () => {
    const missingFeedback = collectMissingAdminMessageIds(
      buildAdminTranslationOverrides(),
    ).filter((entry) => FEEDBACK_ID_PATTERN.test(entry.id));

    expect(missingFeedback).toEqual([]);
  });
});
