import type { IncomingMessage } from 'node:http';

import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import type catalogCsvFactory from '../services/catalog-csv';
import { adminAction, type HttpCtx, text } from './http';

type CatalogCsvService = ReturnType<typeof catalogCsvFactory>;

/** Catalog CSV uploads cap at 2 MB (plan §CSV) — well under the 5000-row limit. */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/**
 * `text/csv` bodies ≤ 256 KB arrive parsed by strapi::body; larger files must post as
 * `application/octet-stream` (koa-body leaves the stream untouched) and are read here with
 * our own 2 MB cap — the global textLimit stays tight for public endpoints.
 */
const readCsvBody = async (ctx: HttpCtx): Promise<string> => {
  const parsed = ctx.request.body;
  if (typeof parsed === 'string') {
    if (Buffer.byteLength(parsed, 'utf8') > MAX_IMPORT_BYTES) {
      throw new OrderingError('CSV_INVALID', 'file exceeds the 2 MB import limit', {
        details: { maxBytes: MAX_IMPORT_BYTES },
      });
    }
    return parsed;
  }
  const req = (ctx as unknown as { req?: IncomingMessage }).req;
  if (!req) {
    throw new OrderingError('CSV_INVALID', 'request body must be the CSV file', {
      details: {},
    });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_IMPORT_BYTES) {
      req.destroy();
      throw new OrderingError('CSV_INVALID', 'file exceeds the 2 MB import limit', {
        details: { maxBytes: MAX_IMPORT_BYTES },
      });
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

/** O10 admin catalog CSV endpoints — `catalog.manage` (+`export` for downloads) gate the routes. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () =>
    strapi.plugin('ordering').service('catalog-csv') as CatalogCsvService;

  return {
    /** GET /ordering/catalog/imports — recent runs for the X3 screen. */
    list: adminAction(strapi, async () => ({
      results: await service().listImports(),
    })),

    /** GET /ordering/catalog/export?kind=products|modifiers — CSV download. */
    exportCsv: adminAction(strapi, async (ctx) => {
      const kind = text(ctx.query.kind) ?? '';
      const { csv, fileName } = await service().exportCsv(kind as 'products' | 'modifiers');
      ctx.set('Content-Type', 'text/csv; charset=utf-8');
      ctx.set('Content-Disposition', `attachment; filename="${fileName}"`);
      ctx.body = csv;
      return undefined;
    }),

    /**
     * POST /ordering/catalog/import?kind=&dryRun=&filename= — body is the CSV file.
     * `dryRun` defaults to true; `dryRun=false` validates and applies in one call.
     */
    importCsv: adminAction(strapi, async (ctx, serviceCtx) => {
      const kind = text(ctx.query.kind) ?? '';
      const dryRun = (text(ctx.query.dryRun) ?? 'true') !== 'false';
      const fileName = text(ctx.query.filename) ?? `${kind || 'catalog'}.csv`;
      const csv = await readCsvBody(ctx);
      return service().importCsv(
        {
          kind: kind as 'products' | 'modifiers',
          fileName,
          text: csv,
          dryRun,
        },
        serviceCtx,
      );
    }),

    /** POST /ordering/catalog/import/:id/apply — apply a dry-run-validated file. */
    apply: adminAction(strapi, async (ctx, serviceCtx) =>
      service().apply(ctx.params.id ?? '', serviceCtx),
    ),
  };
};
