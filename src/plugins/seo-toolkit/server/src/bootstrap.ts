import type { Core } from '@strapi/strapi';

import type { SeoToolkitConfig } from './config';
import { inspectConfig } from './collector/inspect';

type AuditService = {
  setConfigProblems: (problems: string[]) => void;
};

/**
 * The schema check is soft: an invalid config is logged and recorded on the service
 * (so `run` can answer 400 / the CLI can exit 2), but Strapi still boots (spec §2).
 */
const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const config = strapi.config.get('plugin::seo-toolkit') as SeoToolkitConfig;
  const { problems } = inspectConfig(strapi, config);
  const service = strapi.plugin('seo-toolkit').service('audit') as unknown as AuditService;

  service.setConfigProblems(problems);
  for (const problem of problems) {
    strapi.log.error(`[seo-toolkit] invalid config: ${problem}`);
  }
  if (problems.length === 0) {
    strapi.log.info(
      `[seo-toolkit] ready: ${Object.keys(config.contentTypes).length} content types`,
    );
  }
};

export default bootstrap;
