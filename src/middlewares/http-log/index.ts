import type { Core } from '@strapi/strapi';
import { DEFAULT_SKIP_PATHS } from '@tanngo11/log';
import { strapiRequestLogger } from '@tanngo11/log/strapi';

import { log } from '../../shared/log';

// Replaces strapi::logger: opens the request log context and writes one http.request line.
// The request id is server-issued and returned as X-Request-ID; an inbound X-Request-ID (the
// frontend's own id) is recorded as upstream_request_id. Strapi's /_health is not logged.
export default (): Core.MiddlewareHandler =>
  strapiRequestLogger({ log, skipPaths: [...DEFAULT_SKIP_PATHS, '/_health'] });
