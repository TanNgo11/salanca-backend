import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { z } from '@strapi/utils';

/**
 * Administrative-unit catalog (provinces and communes, two levels from 2025-07-01).
 * The official file is `server/src/data/admin-units/<version>.json`, supplied by the
 * owner. This module never invents official codes. A missing file stays unavailable;
 * the test fixture is applied only by `resolveCatalog` when `testing.builtins` is on.
 */

const codeSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z]{1,16}$/, 'code must be 1–16 letters or digits')
  .transform((value) => value.toUpperCase());

export const adminUnitFileSchema = z
  .object({
    version: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z._-]{1,40}$/, 'version must be a short file-safe token'),
    source: z.string().trim().min(1).max(400),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveFrom must be YYYY-MM-DD'),
    provinces: z
      .array(
        z.object({
          code: codeSchema,
          name: z.string().trim().min(1).max(160),
        }),
      )
      .min(1)
      .max(200),
    communes: z
      .array(
        z.object({
          code: codeSchema,
          name: z.string().trim().min(1).max(160),
          provinceCode: codeSchema,
        }),
      )
      .min(1)
      .max(20_000),
  })
  .superRefine((file, ctx) => {
    const provinces = new Set<string>();
    for (const [index, province] of file.provinces.entries()) {
      if (provinces.has(province.code)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate province code ${province.code}`,
          path: ['provinces', index, 'code'],
        });
      }
      provinces.add(province.code);
    }
    const communes = new Set<string>();
    for (const [index, commune] of file.communes.entries()) {
      if (communes.has(commune.code)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate commune code ${commune.code}`,
          path: ['communes', index, 'code'],
        });
      }
      communes.add(commune.code);
      if (!provinces.has(commune.provinceCode)) {
        ctx.addIssue({
          code: 'custom',
          message: `commune ${commune.code} points at unknown province ${commune.provinceCode}`,
          path: ['communes', index, 'provinceCode'],
        });
      }
    }
  });

export type AdminUnitFile = z.infer<typeof adminUnitFileSchema>;

export type ProvinceRecord = { code: string; name: string; folded: string };
export type CommuneRecord = {
  code: string;
  name: string;
  provinceCode: string;
  provinceName: string;
  folded: string;
};

export type AdminUnitCatalog = {
  version: string | null;
  source: string | null;
  effectiveFrom: string | null;
  provinces: ProvinceRecord[];
  communes: CommuneRecord[];
};

/** Accent-insensitive match key. `đ` is not a combining mark, so it is replaced explicitly. */
export function foldAdminUnitName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

export function emptyCatalog(): AdminUnitCatalog {
  return { version: null, source: null, effectiveFrom: null, provinces: [], communes: [] };
}

export function buildCatalog(file: AdminUnitFile): AdminUnitCatalog {
  const provinceName = new Map(file.provinces.map((province) => [province.code, province.name]));
  return {
    version: file.version,
    source: file.source,
    effectiveFrom: file.effectiveFrom,
    provinces: file.provinces.map((province) => ({
      code: province.code,
      name: province.name,
      folded: foldAdminUnitName(province.name),
    })),
    communes: file.communes.map((commune) => ({
      code: commune.code,
      name: commune.name,
      provinceCode: commune.provinceCode,
      provinceName: provinceName.get(commune.provinceCode) ?? '',
      folded: foldAdminUnitName(commune.name),
    })),
  };
}

const issueText = (error: z.ZodError): string =>
  error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

export function parseAdminUnitFile(
  raw: unknown,
): { ok: true; catalog: AdminUnitCatalog } | { ok: false; message: string } {
  const parsed = adminUnitFileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: issueText(parsed.error) };
  return { ok: true, catalog: buildCatalog(parsed.data) };
}

export type DirectoryRead =
  | { ok: true; catalog: AdminUnitCatalog; fileName: string; ignored: string[] }
  | { ok: false; reason: 'missing' | 'invalid'; message: string; fileName?: string };

const MISSING_CATALOG =
  'administrative-unit catalog is missing. Add src/plugins/ordering/server/src/data/admin-units/<version>.json from the official source';

const isCatalogFile = (name: string): boolean =>
  name.endsWith('.json') && !name.startsWith('test-') && !name.includes('.test.');

/**
 * Reads the official catalog directory. The lexicographically last `*.json` wins when
 * several versions are present. Files named `test-*` are never treated as official.
 */
export function readAdminUnitDirectory(dir: string): DirectoryRead {
  if (!existsSync(dir)) {
    return { ok: false, reason: 'missing', message: MISSING_CATALOG };
  }
  let names: string[];
  try {
    names = readdirSync(dir).filter(isCatalogFile).sort();
  } catch (error) {
    return { ok: false, reason: 'invalid', message: (error as Error).message };
  }
  if (names.length === 0) {
    return { ok: false, reason: 'missing', message: MISSING_CATALOG };
  }
  const fileName = names[names.length - 1] as string;
  const ignored = names.slice(0, -1);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(dir, fileName), 'utf8')) as unknown;
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid',
      fileName,
      message: `${fileName} is not valid JSON (${(error as Error).message})`,
    };
  }
  const parsed = parseAdminUnitFile(raw);
  if (!parsed.ok) {
    return { ok: false, reason: 'invalid', fileName, message: `${fileName}: ${parsed.message}` };
  }
  return { ok: true, catalog: parsed.catalog, fileName, ignored };
}

export type CatalogOrigin = 'file' | 'test-fixture' | 'none';

export type ResolvedCatalog = {
  available: boolean;
  origin: CatalogOrigin;
  catalog: AdminUnitCatalog;
  /** Set when the catalog cannot be used. Safe to log: codes and file names only. */
  message: string | null;
  fileName: string | null;
};

/**
 * A real file always wins. An invalid file is NOT replaced by the test fixture, so a
 * broken official drop cannot silently serve invented codes. The fixture loads only
 * when the directory is empty and `testing.builtins` is on.
 */
export function resolveCatalog(input: {
  fromDisk: DirectoryRead;
  testingBuiltins: boolean;
  fixture: AdminUnitFile;
}): ResolvedCatalog {
  if (input.fromDisk.ok) {
    return {
      available: true,
      origin: 'file',
      catalog: input.fromDisk.catalog,
      message: null,
      fileName: input.fromDisk.fileName,
    };
  }
  if (input.fromDisk.reason === 'invalid') {
    return {
      available: false,
      origin: 'none',
      catalog: emptyCatalog(),
      message: `administrative-unit catalog is invalid: ${input.fromDisk.message}`,
      fileName: input.fromDisk.fileName ?? null,
    };
  }
  if (input.testingBuiltins) {
    return {
      available: true,
      origin: 'test-fixture',
      catalog: buildCatalog(input.fixture),
      message: null,
      fileName: null,
    };
  }
  return {
    available: false,
    origin: 'none',
    catalog: emptyCatalog(),
    message: input.fromDisk.message,
    fileName: null,
  };
}

export function deliveryCatalogWarning(input: {
  deliveryEnabled: boolean;
  resolved: ResolvedCatalog;
}): string | null {
  if (!input.deliveryEnabled || input.resolved.available) return null;
  return (
    input.resolved.message ??
    'delivery is enabled but the administrative-unit catalog is missing. Add src/plugins/ordering/server/src/data/admin-units/<version>.json'
  );
}

export type CatalogQuery = { q?: string; provinceCode?: string; limit: number };

export type CatalogView = {
  available: boolean;
  version: string | null;
  source: string | null;
  effectiveFrom: string | null;
  provinceCount: number;
  communeCount: number;
  provinces: Array<{ code: string; name: string }>;
  communes: Array<{ code: string; name: string; provinceCode: string; provinceName: string }>;
  truncated: boolean;
  message: string | null;
};

const publicProvince = (province: ProvinceRecord) => ({ code: province.code, name: province.name });
const publicCommune = (commune: CommuneRecord) => ({
  code: commune.code,
  name: commune.name,
  provinceCode: commune.provinceCode,
  provinceName: commune.provinceName,
});

const rank = (folded: string, query: string): number => {
  if (folded === query) return 0;
  if (folded.startsWith(query)) return 1;
  return 2;
};

const matchName = <T extends { folded: string; name: string }>(rows: T[], query: string): T[] => {
  const folded = foldAdminUnitName(query);
  if (!folded) return rows;
  return rows
    .filter((row) => row.folded.includes(folded))
    .sort((a, b) => rank(a.folded, folded) - rank(b.folded, folded) || a.name.localeCompare(b.name, 'vi'));
};

export function lookupProvince(catalog: AdminUnitCatalog, code: string): ProvinceRecord | null {
  const key = code.trim().toUpperCase();
  return catalog.provinces.find((province) => province.code === key) ?? null;
}

export function lookupCommune(catalog: AdminUnitCatalog, code: string): CommuneRecord | null {
  const key = code.trim().toUpperCase();
  return catalog.communes.find((commune) => commune.code === key) ?? null;
}

/** Provinces always; communes only when a province or a search query is present. */
export function catalogView(resolved: ResolvedCatalog, query: CatalogQuery): CatalogView {
  const catalog = resolved.catalog;
  const base = {
    available: resolved.available,
    version: catalog.version,
    source: catalog.source,
    effectiveFrom: catalog.effectiveFrom,
    provinceCount: catalog.provinces.length,
    communeCount: catalog.communes.length,
    message: resolved.message,
  };
  if (!resolved.available) {
    return { ...base, provinces: [], communes: [], truncated: false };
  }
  const provinceCode = query.provinceCode?.trim().toUpperCase();
  const q = query.q?.trim();
  let provinces = catalog.provinces;
  if (q && !provinceCode) provinces = matchName(provinces, q);
  const provinceLimit = Math.min(query.limit, 200);
  const provincesOut = provinces.slice(0, provinceLimit).map(publicProvince);

  if (!q && !provinceCode) {
    return { ...base, provinces: provincesOut, communes: [], truncated: provinces.length > provinceLimit };
  }
  let communes = catalog.communes;
  if (provinceCode) communes = communes.filter((commune) => commune.provinceCode === provinceCode);
  if (q) communes = matchName(communes, q);
  const communesOut = communes.slice(0, query.limit).map(publicCommune);
  return {
    ...base,
    provinces: provincesOut,
    communes: communesOut,
    truncated: provinces.length > provinceLimit || communes.length > query.limit,
  };
}
