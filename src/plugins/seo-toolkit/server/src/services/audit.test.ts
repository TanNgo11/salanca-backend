import type { Core } from '@strapi/strapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runAudit } from '../../../shared/audit/engine';
import type { AuditReport } from '../../../shared/audit/types';
import type { SeoToolkitConfig } from '../config';
import { collectEntries } from '../collector/collect';
import audit from './audit';

vi.mock('../collector/collect', () => ({ collectEntries: vi.fn() }));
vi.mock('../../../shared/audit/engine', () => ({ runAudit: vi.fn() }));

const mockCollect = vi.mocked(collectEntries);
const mockRun = vi.mocked(runAudit);

const config: SeoToolkitConfig = {
  contentTypes: { 'api::page.page': {} },
  fields: {
    title: 'metaTitle',
    description: 'metaDescription',
    image: 'shareImage',
    noIndex: 'noIndex',
  },
  status: 'published',
  limits: { title: 60, description: 160 },
  severities: {},
};

const makeStrapi = (overrides: Partial<SeoToolkitConfig> = {}): Core.Strapi =>
  ({
    config: { get: () => ({ ...config, ...overrides }) },
  }) as unknown as Core.Strapi;

const report: AuditReport = {
  generatedAt: '2026-10-16T00:00:00.000Z',
  scope: { status: 'published', locales: ['vi', 'en'], contentTypes: ['api::page.page'] },
  summary: { entries: 0, error: 0, warn: 0, notice: 0 },
  issues: [],
};

describe('seo-toolkit audit service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollect.mockResolvedValue({ entries: [], locales: ['vi', 'en'] });
    mockRun.mockReturnValue(report);
  });

  it('uses the configured status by default and forwards locales/limits/fields to the engine', async () => {
    const service = audit({ strapi: makeStrapi() });

    await service.run();

    expect(mockCollect).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      status: 'published',
      contentTypes: undefined,
      locales: undefined,
    });
    const options = mockRun.mock.calls[0][1];
    expect(options.status).toBe('published');
    expect(options.locales).toEqual(['vi', 'en']);
    expect(options.limits).toEqual({ title: 60, description: 160 });
    expect(options.fields.title).toBe('metaTitle');
    expect(mockRun.mock.calls[0][2].contentTypes).toEqual(['api::page.page']);
  });

  it('forwards an explicit status', async () => {
    const service = audit({ strapi: makeStrapi() });

    await service.run({ status: 'draft' });

    expect(mockCollect.mock.calls[0][2].status).toBe('draft');
  });

  it('returns the engine report unchanged', async () => {
    const service = audit({ strapi: makeStrapi() });

    expect(await service.run()).toBe(report);
  });

  it('refuses to run while configuration problems are recorded', async () => {
    const service = audit({ strapi: makeStrapi() });
    service.setConfigProblems(['api::page.page: SEO field "seo" is not a component attribute']);

    await expect(service.run()).rejects.toThrow(/invalid configuration/);
    expect(mockCollect).not.toHaveBeenCalled();
  });

  it('rejects an undeclared content type', async () => {
    const service = audit({ strapi: makeStrapi() });

    await expect(service.run({ contentTypes: ['api::nope.nope'] })).rejects.toThrow(
      /unknown content types/,
    );
  });
});
