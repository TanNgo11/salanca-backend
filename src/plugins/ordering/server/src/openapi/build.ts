import { ERROR_RESPONSE, OPERATIONS, type Operation } from './operations';

/**
 * Builds the OpenAPI 3.1 document from the operation table (O10 plan step 5). `scope` selects
 * which document: 'public' is served at GET /api/v1/ordering/openapi.json, 'admin' is written
 * to docs/ordering-admin-openapi.json by `pnpm run ordering:openapi`.
 */

export type OpenApiDocument = Record<string, unknown>;

const strapiPath = (path: string): string => path.replace(/:([A-Za-z]+)/g, '{$1}');

const SCOPE_SERVER: Record<Operation['scope'], string> = {
  public: '/api/v1/ordering',
  admin: '/ordering',
};

const SCOPE_INFO: Record<Operation['scope'], { title: string; description: string }> = {
  public: {
    title: 'Ordering public API',
    description:
      'Storefront-facing endpoints of the ordering plugin: catalog, slots, quote, order ' +
      'create/track/cancel and inbound payment-provider webhooks. Public access token for ' +
      'order routes travels in the X-Order-Token header.',
  },
  admin: {
    title: 'Ordering admin API',
    description:
      'Staff-facing endpoints of the ordering plugin. Every route requires an authenticated ' +
      'Strapi admin holding the listed plugin::ordering.* permissions.',
  },
};

const operationObject = (op: Operation): Record<string, unknown> => {
  const success: Record<string, unknown> = {
    description: 'Success',
    content: { 'application/json': { schema: op.response ?? { type: 'object' } } },
  };
  const responses: Record<string, unknown> = { '200': success, default: ERROR_RESPONSE };
  if (op.method === 'post' && op.path === '/orders' && op.scope === 'public') {
    responses['201'] = success;
  }
  if (op.scope === 'admin') {
    responses['403'] = { description: 'Missing admin authentication or plugin permission' };
  }
  const out: Record<string, unknown> = {
    tags: [op.tag],
    summary: op.summary,
    operationId: `${op.scope}.${op.method}.${strapiPath(op.path)
      .replace(/[{}/]/g, '.')
      .replace(/\.+/g, '.')
      .replace(/^\.|\.$/g, '')}`,
    responses,
  };
  if (op.parameters?.length) out.parameters = op.parameters;
  if (op.permissions?.length) {
    out['x-ordering-permissions'] = op.permissions.map((action) => `plugin::ordering.${action}`);
  }
  if (op.requestBody) {
    out.requestBody = { required: true, content: { 'application/json': { schema: op.requestBody } } };
  }
  return out;
};

export function buildOpenApi(scope: Operation['scope']): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Map<string, number>();
  for (const op of OPERATIONS) {
    if (op.scope !== scope) continue;
    const path = strapiPath(op.path);
    paths[path] = { ...(paths[path] ?? {}), [op.method]: operationObject(op) };
    tags.set(op.tag, (tags.get(op.tag) ?? 0) + 1);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: SCOPE_INFO[scope].title,
      description: SCOPE_INFO[scope].description,
      version: '2026-10',
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    servers: [{ url: SCOPE_SERVER[scope] }],
    tags: [...tags.keys()].sort().map((name) => ({ name })),
    paths,
    components: { schemas: {} },
  };
}
