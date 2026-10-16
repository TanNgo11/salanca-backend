import { z } from '@strapi/utils';

import { RULE_CODES } from '../../../shared/audit/types';

const seoFieldName = z.string().min(1);

const contentTypeConfig = z.object({
  // One SEO block (a field name) or several (an array of field names); each block is audited as
  // its own entry. Defaults to `seo` when omitted.
  seoField: z.union([seoFieldName, z.array(seoFieldName).min(1)]).optional(),
  labelField: z.string().min(1).optional(),
});

/**
 * Keyed maps, never arrays: Strapi merges the plugin default with the app config through
 * `defaultsDeep`, which merges arrays index by index (same note as the ordering validator).
 */
export const configSchema = z.object({
  contentTypes: z.record(z.string(), contentTypeConfig),
  fields: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    // null = this website has no such field; the matching rules are skipped.
    image: z.string().min(1).nullable(),
    noIndex: z.string().min(1).nullable(),
  }),
  status: z.enum(['published', 'draft']),
  limits: z.object({
    title: z.number().int().positive(),
    description: z.number().int().positive(),
  }),
  severities: z.partialRecord(z.enum(RULE_CODES), z.enum(['error', 'warn', 'notice', 'off'])),
});

export type SeoToolkitConfig = z.infer<typeof configSchema>;

export default {
  default: {
    contentTypes: {},
    fields: {
      title: 'metaTitle',
      description: 'metaDescription',
      image: 'shareImage',
      noIndex: 'noIndex',
    },
    status: 'published',
    limits: { title: 60, description: 160 },
    severities: {},
  },
  /** Strapi ignores the return value; it only reacts to a thrown error. */
  validator(config: unknown) {
    const result = configSchema.safeParse(config);
    if (!result.success) {
      throw new Error(
        result.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; '),
      );
    }
  },
};
