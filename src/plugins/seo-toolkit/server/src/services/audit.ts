import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { runAudit } from '../../../shared/audit/engine';
import type { AuditReport, AuditStatus } from '../../../shared/audit/types';
import type { SeoToolkitConfig } from '../config';
import { collectEntries } from '../collector/collect';

const { ValidationError } = errors;

export interface AuditRunOptions {
  status?: AuditStatus;
  contentTypes?: string[];
  locales?: string[];
}

/** Read-only SEO audit over the configured content types (spec §5). */
const audit = ({ strapi }: { strapi: Core.Strapi }) => {
  let configProblems: string[] = [];

  return {
    /** Set by `bootstrap` after the schema check — never a hard boot failure (spec §2). */
    setConfigProblems(problems: string[]) {
      configProblems = problems;
    },

    getConfigProblems() {
      return configProblems;
    },

    async run(options: AuditRunOptions = {}): Promise<AuditReport> {
      if (configProblems.length > 0) {
        throw new ValidationError(
          `[seo-toolkit] invalid configuration: ${configProblems.join('; ')}`,
        );
      }

      const config = strapi.config.get('plugin::seo-toolkit') as SeoToolkitConfig;
      const declared = Object.keys(config.contentTypes);
      if (options.contentTypes) {
        const unknown = options.contentTypes.filter((uid) => !declared.includes(uid));
        if (unknown.length > 0) {
          throw new ValidationError(`[seo-toolkit] unknown content types: ${unknown.join(', ')}`);
        }
      }
      const contentTypes = options.contentTypes ?? declared;
      const status = options.status ?? config.status;

      const { entries, locales } = await collectEntries(strapi, config, {
        status,
        contentTypes: options.contentTypes,
        locales: options.locales,
      });

      return runAudit(
        entries,
        {
          status,
          locales,
          limits: config.limits,
          severities: config.severities,
          fields: config.fields,
        },
        { generatedAt: new Date().toISOString(), contentTypes },
      );
    },
  };
};

export default audit;
