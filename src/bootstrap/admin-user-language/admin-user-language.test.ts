import type { Core } from '@strapi/strapi';
import { describe, expect, it, vi } from 'vitest';

import {
  ADMIN_USER_LANGUAGE_FIELD,
  DEFAULT_ADMIN_INTERFACE_LANGUAGE,
  shouldApplyDefaultAdminLanguage,
} from './admin-user-language.helper';
import { backfillAdminUserLanguage, registerAdminUserLanguageDefault } from './index';

type SubscribeArgs = {
  models: string[];
  beforeCreate: (event: { params?: { data?: Record<string, unknown> } }) => void;
};

const createStrapi = (updateMany = vi.fn(async () => ({ count: 0 }))) => {
  const subscribe = vi.fn();
  const strapi = {
    db: {
      lifecycles: { subscribe },
      query: vi.fn(() => ({ updateMany })),
    },
    log: { info: vi.fn() },
  } as unknown as Core.Strapi;

  return { strapi, subscribe, updateMany };
};

describe('shouldApplyDefaultAdminLanguage', () => {
  it('defaults an unset or blank language', () => {
    expect(shouldApplyDefaultAdminLanguage(null)).toBe(true);
    expect(shouldApplyDefaultAdminLanguage(undefined)).toBe(true);
    expect(shouldApplyDefaultAdminLanguage('  ')).toBe(true);
  });

  it('keeps a language the administrator already chose', () => {
    expect(shouldApplyDefaultAdminLanguage('en')).toBe(false);
    expect(shouldApplyDefaultAdminLanguage(DEFAULT_ADMIN_INTERFACE_LANGUAGE)).toBe(false);
  });
});

describe('registerAdminUserLanguageDefault', () => {
  const runBeforeCreate = (data?: Record<string, unknown>) => {
    const { strapi, subscribe } = createStrapi();
    registerAdminUserLanguageDefault(strapi);
    const [args] = subscribe.mock.calls[0] as [SubscribeArgs];

    expect(args.models).toEqual(['admin::user']);
    args.beforeCreate({ params: { data } });

    return data;
  };

  it('sets Vietnamese on a new administrator', () => {
    expect(runBeforeCreate({ email: 'staff@example.com' })).toEqual({
      email: 'staff@example.com',
      [ADMIN_USER_LANGUAGE_FIELD]: DEFAULT_ADMIN_INTERFACE_LANGUAGE,
    });
  });

  it('preserves an explicit language', () => {
    expect(runBeforeCreate({ [ADMIN_USER_LANGUAGE_FIELD]: 'en' })).toEqual({
      [ADMIN_USER_LANGUAGE_FIELD]: 'en',
    });
  });

  it('ignores a create without data', () => {
    expect(() => runBeforeCreate(undefined)).not.toThrow();
  });
});

describe('backfillAdminUserLanguage', () => {
  it('updates only administrators without a language', async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const { strapi } = createStrapi(updateMany);

    await backfillAdminUserLanguage(strapi);

    expect(updateMany).toHaveBeenCalledWith({
      where: { [ADMIN_USER_LANGUAGE_FIELD]: { $null: true } },
      data: { [ADMIN_USER_LANGUAGE_FIELD]: DEFAULT_ADMIN_INTERFACE_LANGUAGE },
    });
    expect(strapi.log.info).toHaveBeenCalledOnce();
  });

  it('stays quiet when every administrator already has a language', async () => {
    const { strapi } = createStrapi();

    await backfillAdminUserLanguage(strapi);

    expect(strapi.log.info).not.toHaveBeenCalled();
  });
});
