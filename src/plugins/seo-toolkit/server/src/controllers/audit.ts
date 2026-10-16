import type { Core } from '@strapi/strapi';
import { errors, z } from '@strapi/utils';

import type auditFactory from '../services/audit';
import type { AuditRunOptions } from '../services/audit';

const { ValidationError } = errors;

type AuditService = ReturnType<typeof auditFactory>;

/** Minimal Koa context surface used by the audit controller. */
export interface AuditHttpCtx {
  request: { body?: unknown };
  body: unknown;
}

const bodySchema = z.object({
  status: z.enum(['published', 'draft']).optional(),
  contentTypes: z.array(z.string()).optional(),
  locales: z.array(z.string()).optional(),
});

/** POST /seo-toolkit/audit/run — admin-only, read-only (spec §5). */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('seo-toolkit').service('audit') as AuditService;

  return {
    async run(ctx: AuditHttpCtx): Promise<void> {
      const parsed = bodySchema.safeParse(ctx.request.body ?? {});
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; '),
        );
      }
      ctx.body = await service().run(parsed.data as AuditRunOptions);
    },
  };
};
