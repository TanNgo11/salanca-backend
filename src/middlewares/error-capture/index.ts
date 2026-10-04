import type { Core } from '@strapi/strapi';
import { strapiErrorCapture } from '@tanngo11/log/strapi';

// Runs right after strapi::errors so an unhandled error is logged once, on the request's
// http.request line, instead of again through strapi::errors' strapi.log.error call.
export default (): Core.MiddlewareHandler => strapiErrorCapture();
