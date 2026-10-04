import { strapiLoggerConfig } from '@tanngo11/log/strapi';

import { log } from '../src/shared/log';

// Every strapi.log.* call (app and framework) becomes one contract JSON line on stdout,
// carrying the request context opened by the http-log middleware.
export default strapiLoggerConfig(log);
