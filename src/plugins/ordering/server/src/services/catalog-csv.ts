import { createHash } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { withAuditSuppressed } from '../domain/audit/suppress';
import type { ProductModifierGroup } from '../domain/catalog/modifier-groups';
import { slugify } from '../domain/catalog/slug';
import { buildCsv, parseCsv } from '../domain/csv';
import { OrderingError } from '../domain/errors';
import type changeLogFactory from './change-log';
import { actorRefOf, nowOf, type ServiceContext } from './context';
import type { OrderingRegistry } from './registry';

const PRODUCT = 'plugin::ordering.catalog-product';
const VARIANT = 'plugin::ordering.catalog-variant';
const PRICE = 'plugin::ordering.catalog-price';
const GROUP = 'plugin::ordering.catalog-modifier-group';
const MODIFIER = 'plugin::ordering.catalog-modifier';
const CATEGORY = 'plugin::ordering.catalog-category';
const SLUG = 'plugin::ordering.catalog-slug';
const IMPORT = 'plugin::ordering.catalog-import';

/** Hard caps from the plan — the report lists at most this many row errors. */
export const CATALOG_CSV_MAX_ROWS = 5000;
const MAX_REPORT_ERRORS = 500;

export const PRODUCT_CSV_HEADERS = [
  'Danh mục',
  'Slug món',
  'Tên món (VI)',
  'Tên món (EN)',
  'Mô tả (VI)',
  'Mô tả (EN)',
  'Loại món',
  'Bán online',
  'Thứ tự',
  'Nhóm thuế',
  'SKU',
  'Tên biến thể (VI)',
  'Tên biến thể (EN)',
  'Mặc định',
  'Giá',
  'Nhóm tùy chọn',
] as const;

export const MODIFIER_CSV_HEADERS = [
  'Mã nhóm',
  'Tên nhóm (VI)',
  'Tên nhóm (EN)',
  'Chọn tối thiểu',
  'Chọn tối đa',
  'Mã tùy chọn',
  'Tên tùy chọn (VI)',
  'Tên tùy chọn (EN)',
  'Giá cộng thêm',
  'Thứ tự',
] as const;

export type CatalogCsvKind = 'products' | 'modifiers';

export type CsvRowError = { line: number; field?: string; message: string };

type ImportReport = {
  errors: CsvRowError[];
  created: Record<string, number>;
  updated: Record<string, number>;
};

type ImportRow = {
  id: number;
  documentId: string;
  kind: CatalogCsvKind;
  fileName: string;
  rowCount: number;
  status: 'validated' | 'applied' | 'failed';
  report: ImportReport | null;
  payload: string | null;
  catalogVersion: string | null;
  createdByRef: string | null;
  appliedAt: string | null;
  createdAt: string;
};

type GroupRow = {
  id: number;
  documentId: string;
  code: string | null;
  name?: Record<string, string>;
  selectionType?: string;
  minQuantity?: number;
  maxQuantity?: number;
  freeQuantity?: number;
  rank?: number;
};

type ModifierRow = {
  id: number;
  documentId: string;
  code: string | null;
  name?: Record<string, string>;
  priceDelta?: string | number;
  rank?: number;
  group?: { documentId?: string } | null;
};

type CategoryRow = {
  id: number;
  documentId: string;
  parent?: { documentId?: string } | null;
};

type PriceRow = {
  id: number;
  documentId: string;
  amount?: string | number;
  rules?: unknown;
};

type VariantRow = {
  id: number;
  documentId: string;
  sku?: string | null;
  name?: Record<string, string>;
  isDefault?: boolean;
  rank?: number;
  product?: { documentId?: string } | null;
  prices?: PriceRow[];
};

type ProductRow = {
  id: number;
  documentId: string;
  productType?: string;
  name?: Record<string, string>;
  description?: Record<string, string>;
  slug?: Record<string, string>;
  status?: string;
  sellOnline?: boolean;
  taxGroupRef?: string | null;
  modifierGroups?: ProductModifierGroup[];
  rank?: number;
  categories?: { documentId?: string }[];
  variants?: VariantRow[];
};

const emptyReport = (): ImportReport => ({
  errors: [],
  created: {},
  updated: {},
});

const bump = (bucket: Record<string, number>, key: string) => {
  bucket[key] = (bucket[key] ?? 0) + 1;
};

const cellText = (row: Record<string, string>, header: string): string =>
  (row[header] ?? '').trim();

const parseBool = (raw: string): boolean | null => {
  const value = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'có', 'x'].includes(value)) return true;
  if (['false', '0', 'no', 'không', ''].includes(value)) return false;
  return null;
};

const parseVnd = (raw: string): number | null => {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
};

const parseIntCell = (raw: string): number | null => {
  const value = raw.trim();
  if (!/^-?\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
};

/** `;`-separated reference list (category paths, modifier-group codes). */
const parseList = (raw: string): string[] =>
  raw
    .split(';')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);

const isBlankRules = (rules: unknown): boolean =>
  rules === null ||
  rules === undefined ||
  (typeof rules === 'object' && !Array.isArray(rules) && Object.keys(rules as object).length === 0) ||
  (Array.isArray(rules) && rules.length === 0);

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const query = (uid: string) => strapi.db.query(uid);
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;
  const registry = () => strapi.plugin('ordering').service('registry') as OrderingRegistry;

  // ── Catalog snapshot loaders ────────────────────────────────────────────

  /** Modifier groups keyed by their CSV `mã`: explicit `code` first, documentId fallback. */
  const loadGroupIndex = async (): Promise<Map<string, GroupRow>> => {
    const rows = (await query(GROUP).findMany({})) as GroupRow[];
    const index = new Map<string, GroupRow>();
    for (const row of rows) {
      index.set(row.documentId, row);
      if (row.code) index.set(row.code, row);
    }
    return index;
  };

  const loadModifiers = async (): Promise<ModifierRow[]> =>
    (await query(MODIFIER).findMany({
      populate: { group: { select: ['documentId'] } },
      orderBy: { rank: 'asc' },
    })) as ModifierRow[];

  const loadCategoryPaths = async (): Promise<Map<string, CategoryRow>> => {
    const rows = (await query(CATEGORY).findMany({
      populate: { parent: { select: ['documentId'] } },
    })) as CategoryRow[];
    const slugRows = (await query(SLUG).findMany({
      where: { entityType: 'catalog-category', locale: 'vi' },
    })) as { entityDocumentId: string; slug: string }[];
    const slugOf = new Map(slugRows.map((row) => [row.entityDocumentId, row.slug]));
    const byRef = new Map(rows.map((row) => [row.documentId, row]));
    const pathOf = (row: CategoryRow): string => {
      const chain: CategoryRow[] = [];
      const seen = new Set<string>();
      let cursor: CategoryRow | undefined = row;
      while (cursor && !seen.has(cursor.documentId)) {
        seen.add(cursor.documentId);
        chain.unshift(cursor);
        cursor = cursor.parent?.documentId ? byRef.get(cursor.parent.documentId) : undefined;
      }
      return chain.map((entry) => slugOf.get(entry.documentId) ?? entry.documentId).join('/');
    };
    const paths = new Map<string, CategoryRow>();
    for (const row of rows) paths.set(pathOf(row), row);
    return paths;
  };

  /** VI public slug → entity documentId (products use it as the CSV match key). */
  const loadSlugIndex = async (): Promise<Map<string, string>> => {
    const rows = (await query(SLUG).findMany({
      where: { entityType: 'catalog-product', locale: 'vi' },
    })) as { entityDocumentId: string; slug: string }[];
    return new Map(rows.map((row) => [row.slug, row.entityDocumentId]));
  };

  const loadVariantsBySku = async (): Promise<Map<string, VariantRow>> => {
    const rows = (await query(VARIANT).findMany({
      where: { sku: { $notNull: true } },
      populate: { product: { select: ['documentId'] } },
    })) as VariantRow[];
    const index = new Map<string, VariantRow>();
    for (const row of rows) if (row.sku) index.set(row.sku, row);
    return index;
  };

  const loadProducts = async (): Promise<ProductRow[]> =>
    (await query(PRODUCT).findMany({
      populate: {
        categories: { select: ['documentId'] },
        variants: { populate: { prices: true } },
      },
    })) as ProductRow[];

  /**
   * Fingerprint of the catalog at validation time — `max(updated_at)` + `count(*)` over every
   * table the import touches (categories included: a rename changes category paths). Any
   * catalog write between validate and apply fails the apply with CATALOG_IMPORT_STALE.
   * Queries run sequentially: inside an apply transaction they share one pg client, and
   * parallel queries on it are deprecated.
   */
  const catalogVersion = async (): Promise<string> => {
    const tables = [
      'plugins_ordering_catalog_product',
      'plugins_ordering_catalog_variant',
      'plugins_ordering_catalog_price',
      'plugins_ordering_catalog_modifier_group',
      'plugins_ordering_catalog_modifier',
      'plugins_ordering_catalog_category',
    ];
    const parts: string[] = [];
    for (const table of tables) {
      const row = (await strapi.db
        .connection(table)
        .max('updated_at as m')
        .count('* as c')
        .first()) as { m?: string | Date | null; c?: string | number } | undefined;
      // `count` catches deletes, which never touch another row's updated_at.
      parts.push(`${table}:${row?.m ? new Date(row.m).toISOString() : '-'}:${row?.c ?? 0}`);
    }
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  };

  // ── Grid helpers ────────────────────────────────────────────────────────

  const readGrid = (
    text: string,
    headers: readonly string[],
  ): { rows: { line: number; cells: Record<string, string> }[] } => {
    const grid = parseCsv(text);
    if (grid.length === 0) {
      throw new OrderingError('CSV_INVALID', 'the file is empty', { details: {} });
    }
    const headerRow = grid[0].map((cell) => cell.trim());
    const missing = headers.filter((header) => !headerRow.includes(header));
    if (missing.length > 0) {
      throw new OrderingError('CSV_INVALID', `missing required column(s): ${missing.join(', ')}`, {
        details: { column: missing[0] },
      });
    }
    const rows = grid
      .slice(1)
      .map((cells, index) => ({
        line: index + 2,
        cells: Object.fromEntries(headerRow.map((header, col) => [header, cells[col] ?? ''])),
      }))
      .filter((row) => headerRow.some((header) => row.cells[header]?.trim() !== ''));
    if (rows.length > CATALOG_CSV_MAX_ROWS) {
      throw new OrderingError(
        'CSV_INVALID',
        `the file has ${rows.length} data rows — the limit is ${CATALOG_CSV_MAX_ROWS}`,
        { details: { rowCount: rows.length, maxRows: CATALOG_CSV_MAX_ROWS } },
      );
    }
    return { rows };
  };

  const error = (
    errors: CsvRowError[],
    line: number,
    message: string,
    field?: string,
  ): void => {
    if (errors.length < MAX_REPORT_ERRORS) errors.push({ line, field, message });
  };

  // ── Export ──────────────────────────────────────────────────────────────

  const exportProducts = async (): Promise<string> => {
    const products = await loadProducts();
    const groups = await loadGroupIndex();
    const slugIndex = await loadSlugIndex();
    const categoryPaths = await loadCategoryPaths();
    const pathByRef = new Map(
      [...categoryPaths.entries()].map(([path, row]) => [row.documentId, path]),
    );
    const rows: string[][] = [];
    for (const product of products) {
      const categories = (product.categories ?? [])
        .map((ref) => (ref.documentId ? pathByRef.get(ref.documentId) : undefined))
        .filter((path): path is string => typeof path === 'string')
        .join(';');
      const groupsCell = (product.modifierGroups ?? [])
        .map((attach) => {
          const group = groups.get(attach.groupRef);
          return group?.code ?? attach.groupRef;
        })
        .join(';');
      const variants = product.variants?.length
        ? [...product.variants].sort(
            (a, b) => Number(b.isDefault === true) - Number(a.isDefault === true),
          )
        : [null];
      for (const variant of variants) {
        const price = variant?.prices?.find((row) => isBlankRules(row.rules));
        rows.push([
          categories,
          slugIndex.get(product.documentId) ?? '',
          product.name?.vi ?? '',
          product.name?.en ?? '',
          product.description?.vi ?? '',
          product.description?.en ?? '',
          product.productType ?? 'food',
          product.sellOnline === false ? 'false' : 'true',
          String(product.rank ?? 0),
          product.taxGroupRef ?? '',
          variant?.sku ?? '',
          variant?.name?.vi ?? '',
          variant?.name?.en ?? '',
          variant?.isDefault === true ? 'true' : 'false',
          price?.amount !== undefined ? String(price.amount) : '',
          groupsCell,
        ]);
      }
    }
    return buildCsv(PRODUCT_CSV_HEADERS, rows);
  };

  const exportModifiers = async (): Promise<string> => {
    const groups = await loadGroupIndex();
    const modifiers = await loadModifiers();
    const byGroup = new Map<string, ModifierRow[]>();
    for (const row of modifiers) {
      const ref = row.group?.documentId ?? '';
      const list = byGroup.get(ref) ?? [];
      list.push(row);
      byGroup.set(ref, list);
    }
    const sortedGroups = [...new Set(groups.values())].sort(
      (a, b) => (a.rank ?? 0) - (b.rank ?? 0),
    );
    const rows: string[][] = [];
    for (const group of sortedGroups) {
      const options = byGroup.get(group.documentId) ?? [];
      const shared = [
        group.code ?? group.documentId,
        group.name?.vi ?? '',
        group.name?.en ?? '',
        String(group.minQuantity ?? 0),
        String(group.maxQuantity ?? 0),
      ];
      if (options.length === 0) {
        rows.push([...shared, '', '', '', '', '']);
        continue;
      }
      for (const option of options) {
        rows.push([
          ...shared,
          option.code ?? option.documentId,
          option.name?.vi ?? '',
          option.name?.en ?? '',
          String(option.priceDelta ?? 0),
          String(option.rank ?? 0),
        ]);
      }
    }
    return buildCsv(MODIFIER_CSV_HEADERS, rows);
  };

  // ── products.csv ────────────────────────────────────────────────────────

  type ProductCsvRow = {
    line: number;
    categories: string[];
    slug: string;
    nameVi: string;
    nameEn: string;
    descVi: string;
    descEn: string;
    productType: string;
    sellOnline: boolean;
    rank: number;
    taxGroupRef: string;
    sku: string;
    variantVi: string;
    variantEn: string;
    isDefault: boolean;
    price: number;
    groupKeys: string[];
  };

  const validateProducts = async (
    rows: { line: number; cells: Record<string, string> }[],
  ): Promise<{
    parsed: ProductCsvRow[];
    errors: CsvRowError[];
    predicted: { created: Record<string, number>; updated: Record<string, number> };
  }> => {
    const errors: CsvRowError[] = [];
    const groups = await loadGroupIndex();
    const categoryPaths = await loadCategoryPaths();
    const variantsBySku = await loadVariantsBySku();
    const slugIndex = await loadSlugIndex();
    const productTypes = new Set(registry().productTypeCodes());
    const seenSlugs = new Map<string, number>();
    const seenSkus = new Map<string, number>();
    const defaultLines = new Map<string, number[]>();
    const parsed: ProductCsvRow[] = [];

    for (const { line, cells } of rows) {
      const lineErrors = errors.length;
      const slugRaw = cellText(cells, 'Slug món');
      const nameVi = cellText(cells, 'Tên món (VI)');
      const slug = slugify(slugRaw || nameVi);
      if (!slug) {
        error(errors, line, 'Slug món hoặc Tên món (VI) là bắt buộc', 'Slug món');
      } else if (seenSlugs.has(slug)) {
        error(errors, line, `slug "${slug}" trùng với dòng ${seenSlugs.get(slug)}`, 'Slug món');
      } else {
        seenSlugs.set(slug, line);
      }

      const sku = cellText(cells, 'SKU');
      if (sku && seenSkus.has(sku)) {
        error(errors, line, `SKU "${sku}" trùng với dòng ${seenSkus.get(sku)}`, 'SKU');
      } else if (sku) {
        seenSkus.set(sku, line);
      }

      const price = parseVnd(cellText(cells, 'Giá'));
      if (price === null) error(errors, line, 'Giá phải là số nguyên ≥ 0', 'Giá');

      const rank = parseIntCell(cellText(cells, 'Thứ tự'));
      if (cellText(cells, 'Thứ tự') !== '' && rank === null) {
        error(errors, line, 'Thứ tự phải là số nguyên', 'Thứ tự');
      }

      const sellOnline = parseBool(cellText(cells, 'Bán online'));
      if (cellText(cells, 'Bán online') !== '' && sellOnline === null) {
        error(errors, line, 'Bán online phải là true/false', 'Bán online');
      }
      const isDefault = parseBool(cellText(cells, 'Mặc định'));
      if (cellText(cells, 'Mặc định') !== '' && isDefault === null) {
        error(errors, line, 'Mặc định phải là true/false', 'Mặc định');
      }
      if (isDefault === true) {
        const list = defaultLines.get(slug) ?? [];
        list.push(line);
        defaultLines.set(slug, list);
      }

      const productType = cellText(cells, 'Loại món') || 'food';
      if (!productTypes.has(productType)) {
        error(errors, line, `Loại món "${productType}" không được đăng ký`, 'Loại món');
      }

      const categories = parseList(cellText(cells, 'Danh mục'));
      for (const path of categories) {
        if (!categoryPaths.has(path)) {
          error(errors, line, `Danh mục "${path}" không tồn tại`, 'Danh mục');
        }
      }

      const groupKeys = parseList(cellText(cells, 'Nhóm tùy chọn'));
      for (const key of groupKeys) {
        if (!groups.has(key)) {
          error(errors, line, `Nhóm tùy chọn "${key}" không tồn tại`, 'Nhóm tùy chọn');
        }
      }

      // A SKU attached to a different product than the slug's owner would silently move it.
      const owner = sku ? variantsBySku.get(sku) : undefined;
      const slugOwner = slug ? slugIndex.get(slug) : undefined;
      if (owner?.product?.documentId && slugOwner && owner.product.documentId !== slugOwner) {
        error(errors, line, `SKU "${sku}" thuộc món khác`, 'SKU');
      }

      if (errors.length === lineErrors) {
        parsed.push({
          line,
          categories,
          slug,
          nameVi,
          nameEn: cellText(cells, 'Tên món (EN)'),
          descVi: cellText(cells, 'Mô tả (VI)'),
          descEn: cellText(cells, 'Mô tả (EN)'),
          productType,
          sellOnline: sellOnline ?? false,
          rank: rank ?? 0,
          taxGroupRef: cellText(cells, 'Nhóm thuế'),
          sku,
          variantVi: cellText(cells, 'Tên biến thể (VI)') || nameVi,
          variantEn: cellText(cells, 'Tên biến thể (EN)') || cellText(cells, 'Tên món (EN)'),
          isDefault: isDefault ?? false,
          price: price ?? 0,
          groupKeys,
        });
      }
    }

    for (const [slug, lines] of defaultLines) {
      if (lines.length > 1) {
        error(
          errors,
          lines[1],
          `món "${slug}" có ${lines.length} biến thể mặc định trong file`,
          'Mặc định',
        );
      }
    }

    // Predicted counts drive the apply dialog ("Sẽ tạo n, sửa m món") before anything writes.
    const productVariants = new Map<string, VariantRow[]>();
    for (const variant of variantsBySku.values()) {
      const ref = variant.product?.documentId;
      if (!ref) continue;
      const list = productVariants.get(ref) ?? [];
      list.push(variant);
      productVariants.set(ref, list);
    }
    const predicted = { created: {} as Record<string, number>, updated: {} as Record<string, number> };
    for (const [slug, lines] of groupRowsBySlug(parsed)) {
      const productRef = slugIndex.get(slug);
      bump(predicted[productRef ? 'updated' : 'created'], 'products');
      const existing = productRef ? productVariants.get(productRef) ?? [] : [];
      for (const row of lines) {
        const match = row.sku
          ? variantsBySku.get(row.sku)
          : existing.length === 1 && !existing[0].sku
            ? existing[0]
            : undefined;
        const belongs = match?.product?.documentId === productRef;
        bump(predicted[belongs ? 'updated' : 'created'], 'variants');
      }
    }
    return { parsed, errors, predicted };
  };

  const groupRowsBySlug = (
    parsed: ProductCsvRow[],
  ): Map<string, ProductCsvRow[]> => {
    const bySlug = new Map<string, ProductCsvRow[]>();
    for (const row of parsed) {
      const list = bySlug.get(row.slug) ?? [];
      list.push(row);
      bySlug.set(row.slug, list);
    }
    return bySlug;
  };

  // ── modifiers.csv ───────────────────────────────────────────────────────

  type ModifierCsvRow = {
    line: number;
    groupKey: string;
    groupVi: string;
    groupEn: string;
    min: number;
    max: number;
    optionKey: string;
    optionVi: string;
    optionEn: string;
    priceDelta: number;
    rank: number;
  };

  const validateModifiers = async (
    rows: { line: number; cells: Record<string, string> }[],
  ): Promise<{
    parsed: ModifierCsvRow[];
    errors: CsvRowError[];
    predicted: { created: Record<string, number>; updated: Record<string, number> };
  }> => {
    const errors: CsvRowError[] = [];
    const groups = await loadGroupIndex();
    const modifiers = await loadModifiers();
    const optionsByGroup = new Map<string, Map<string, ModifierRow>>();
    for (const row of modifiers) {
      const ref = row.group?.documentId ?? '';
      const index = optionsByGroup.get(ref) ?? new Map<string, ModifierRow>();
      index.set(row.documentId, row);
      if (row.code) index.set(row.code, row);
      optionsByGroup.set(ref, index);
    }
    const seenOptions = new Map<string, number>();
    const groupAttrs = new Map<string, { line: number; signature: string }>();
    const parsed: ModifierCsvRow[] = [];

    for (const { line, cells } of rows) {
      const lineErrors = errors.length;
      const groupKey = cellText(cells, 'Mã nhóm');
      const groupVi = cellText(cells, 'Tên nhóm (VI)');
      const groupEn = cellText(cells, 'Tên nhóm (EN)');
      if (!groupKey) error(errors, line, 'Mã nhóm là bắt buộc', 'Mã nhóm');
      if (!groupVi) error(errors, line, 'Tên nhóm (VI) là bắt buộc', 'Tên nhóm (VI)');

      const min = parseIntCell(cellText(cells, 'Chọn tối thiểu'));
      const max = parseIntCell(cellText(cells, 'Chọn tối đa'));
      if (cellText(cells, 'Chọn tối thiểu') !== '' && min === null) {
        error(errors, line, 'Chọn tối thiểu phải là số nguyên ≥ 0', 'Chọn tối thiểu');
      }
      if (cellText(cells, 'Chọn tối đa') !== '' && max === null) {
        error(errors, line, 'Chọn tối đa phải là số nguyên ≥ 0', 'Chọn tối đa');
      }
      const minV = min ?? 0;
      const maxV = max ?? 0;
      if (min !== null && min < 0) error(errors, line, 'Chọn tối thiểu ≥ 0', 'Chọn tối thiểu');
      if (max !== null && max < 0) error(errors, line, 'Chọn tối đa ≥ 0', 'Chọn tối đa');
      if (min !== null && max !== null && maxV > 0 && minV > maxV) {
        error(errors, line, 'Chọn tối thiểu không vượt tối đa', 'Chọn tối thiểu');
      }

      if (groupKey) {
        const signature = `${groupVi}|${groupEn}|${minV}|${maxV}`;
        const known = groupAttrs.get(groupKey);
        if (known && known.signature !== signature) {
          error(
            errors,
            line,
            `nhóm "${groupKey}" khác thuộc tính với dòng ${known.line}`,
            'Mã nhóm',
          );
        } else if (!known) {
          groupAttrs.set(groupKey, { line, signature });
        }
      }

      const optionKey = cellText(cells, 'Mã tùy chọn');
      const optionVi = cellText(cells, 'Tên tùy chọn (VI)');
      const optionEn = cellText(cells, 'Tên tùy chọn (EN)');
      const priceDelta = parseVnd(cellText(cells, 'Giá cộng thêm'));
      const rank = parseIntCell(cellText(cells, 'Thứ tự'));
      if (optionKey) {
        const composite = `${groupKey}\u0000${optionKey}`;
        if (seenOptions.has(composite)) {
          error(
            errors,
            line,
            `tùy chọn "${optionKey}" trùng trong nhóm với dòng ${seenOptions.get(composite)}`,
            'Mã tùy chọn',
          );
        } else {
          seenOptions.set(composite, line);
        }
        if (!optionVi) error(errors, line, 'Tên tùy chọn (VI) là bắt buộc', 'Tên tùy chọn (VI)');
        if (priceDelta === null) error(errors, line, 'Giá cộng thêm phải là số nguyên ≥ 0', 'Giá cộng thêm');
        if (cellText(cells, 'Thứ tự') !== '' && rank === null) {
          error(errors, line, 'Thứ tự phải là số nguyên', 'Thứ tự');
        }
      }

      if (errors.length === lineErrors) {
        parsed.push({
          line,
          groupKey,
          groupVi,
          groupEn,
          min: minV,
          max: maxV,
          optionKey,
          optionVi,
          optionEn,
          priceDelta: priceDelta ?? 0,
          rank: rank ?? 0,
        });
      }
    }

    // Predicted counts for the apply dialog — a group key present in the file creates or
    // updates exactly once, then each option row counts against its group's members.
    const predicted = { created: {} as Record<string, number>, updated: {} as Record<string, number> };
    const countedGroups = new Set<string>();
    const groupRefOf = new Map<string, string>();
    for (const row of parsed) {
      if (!countedGroups.has(row.groupKey)) {
        countedGroups.add(row.groupKey);
        const existing = groups.get(row.groupKey);
        bump(predicted[existing ? 'updated' : 'created'], 'modifierGroups');
        groupRefOf.set(row.groupKey, existing?.documentId ?? `new:${row.groupKey}`);
      }
      if (!row.optionKey) continue;
      const index = optionsByGroup.get(groupRefOf.get(row.groupKey) ?? '');
      bump(predicted[index?.has(row.optionKey) ? 'updated' : 'created'], 'modifiers');
    }
    return { parsed, errors, predicted };
  };

  // ── Apply ───────────────────────────────────────────────────────────────

  /** One Document Service write per entity — middleware keeps slugs and audit rows honest. */
  const writeProduct = async (
    documentId: string | null,
    data: Record<string, unknown>,
  ): Promise<string> => {
    const docs = strapi.documents(PRODUCT);
    if (documentId) {
      const updated = (await docs.update({ documentId, data: data as never })) as {
        documentId: string;
      };
      return updated.documentId;
    }
    const created = (await docs.create({ data: data as never })) as { documentId: string };
    return created.documentId;
  };

  const applyProducts = async (
    parsed: ProductCsvRow[],
    report: ImportReport,
  ): Promise<void> => {
    const groups = await loadGroupIndex();
    const categoryPaths = await loadCategoryPaths();
    const slugIndex = await loadSlugIndex();
    const variantsBySku = await loadVariantsBySku();
    // Group file rows by product so a product is written once, then its variants.
    const bySlug = new Map<string, ProductCsvRow[]>();
    for (const row of parsed) {
      const list = bySlug.get(row.slug) ?? [];
      list.push(row);
      bySlug.set(row.slug, list);
    }

    for (const [slug, lines] of bySlug) {
      const first = lines[0];
      const existingRef = slugIndex.get(slug);
      const existing = existingRef
        ? ((await query(PRODUCT).findOne({
            where: { documentId: existingRef },
            populate: { categories: { select: ['documentId'] } },
          })) as ProductRow | null)
        : null;

      const name: Record<string, string> = {};
      if (first.nameVi) name.vi = first.nameVi;
      if (first.nameEn) name.en = first.nameEn;
      const description: Record<string, string> = {};
      if (first.descVi) description.vi = first.descVi;
      if (first.descEn) description.en = first.descEn;

      const data: Record<string, unknown> = {
        name,
        description,
        productType: first.productType,
        sellOnline: first.sellOnline,
        rank: first.rank,
        taxGroupRef: first.taxGroupRef || null,
      };
      if (!existing) {
        data.slug = { vi: slug };
        data.status = 'active';
      }
      if (first.categories.length > 0) {
        data.categories = first.categories
          .map((path) => categoryPaths.get(path)?.documentId)
          .filter((ref): ref is string => typeof ref === 'string');
      }
      if (first.groupKeys.length > 0) {
        const attached = new Map(
          (existing?.modifierGroups ?? []).map((attach) => [attach.groupRef, attach]),
        );
        data.modifierGroups = first.groupKeys
          .map((key) => groups.get(key))
          .filter((group): group is GroupRow => group !== undefined)
          .map((group, index) => {
            const keep = attached.get(group.documentId);
            if (keep) return { ...keep, rank: index };
            return {
              groupRef: group.documentId,
              required: (group.minQuantity ?? 0) > 0,
              min: group.minQuantity ?? 0,
              max: group.maxQuantity ?? 0,
              freeQuantity: group.freeQuantity ?? 0,
              rank: index,
              overrides: {},
            };
          });
      }

      const productRef = await writeProduct(existing?.documentId ?? null, data);
      bump(report[existing ? 'updated' : 'created'], 'products');

      // Variants: resolve each row against SKU/global index or the product's own set.
      const productVariants = (await query(VARIANT).findMany({
        where: { product: { documentId: productRef } },
        populate: { prices: true },
      })) as VariantRow[];
      const variantDocs: { row: ProductCsvRow; documentId: string }[] = [];
      for (const row of lines) {
        let variant: VariantRow | null = null;
        if (row.sku) {
          const bySku = variantsBySku.get(row.sku);
          variant =
            bySku && bySku.product?.documentId === productRef
              ? productVariants.find((entry) => entry.documentId === bySku.documentId) ?? null
              : null;
        } else if (productVariants.length === 1 && !productVariants[0].sku) {
          variant = productVariants[0];
        }
        const vData: Record<string, unknown> = {
          name: {
            ...(row.variantVi ? { vi: row.variantVi } : {}),
            ...(row.variantEn ? { en: row.variantEn } : {}),
          },
        };
        let variantRef: string;
        if (variant) {
          const updated = (await strapi.documents(VARIANT).update({
            documentId: variant.documentId,
            data: vData as never,
          })) as { documentId: string };
          variantRef = updated.documentId;
          bump(report.updated, 'variants');
        } else {
          const created = (await strapi.documents(VARIANT).create({
            data: {
              ...vData,
              product: productRef,
              ...(row.sku ? { sku: row.sku } : {}),
              isDefault: row.isDefault,
            } as never,
          })) as { documentId: string };
          variantRef = created.documentId;
          bump(report.created, 'variants');
          if (row.sku) {
            variantsBySku.set(row.sku, { documentId: variantRef } as VariantRow);
          }
        }
        variantDocs.push({ row, documentId: variantRef });

        // Upsert the rule-less base price row.
        const priceRow = (variant?.prices ?? []).find((entry) => isBlankRules(entry.rules));
        if (priceRow) {
          if (Number(priceRow.amount) !== row.price) {
            await strapi.documents(PRICE).update({
              documentId: priceRow.documentId,
              data: { amount: row.price } as never,
            });
            bump(report.updated, 'prices');
          }
        } else {
          await strapi.documents(PRICE).create({
            data: {
              variant: variantRef,
              amount: row.price,
              currency: 'VND',
              minQuantity: 1,
            } as never,
          });
          bump(report.created, 'prices');
        }
      }

      // Exactly one default per product: a marked row wins; otherwise keep an existing
      // default; a brand-new product falls back to its first file row.
      const marked = variantDocs.find((entry) => entry.row.isDefault);
      const all = (await query(VARIANT).findMany({
        where: { product: { documentId: productRef } },
      })) as VariantRow[];
      const target =
        marked?.documentId ??
        all.find((entry) => entry.isDefault === true)?.documentId ??
        variantDocs[0]?.documentId;
      for (const entry of all) {
        const should = entry.documentId === target;
        if (Boolean(entry.isDefault) !== should) {
          await strapi.documents(VARIANT).update({
            documentId: entry.documentId,
            data: { isDefault: should } as never,
          });
        }
      }
    }
  };

  const applyModifiers = async (
    parsed: ModifierCsvRow[],
    report: ImportReport,
  ): Promise<void> => {
    const groups = await loadGroupIndex();
    const modifiers = await loadModifiers();
    const optionsByGroup = new Map<string, Map<string, ModifierRow>>();
    for (const row of modifiers) {
      const ref = row.group?.documentId ?? '';
      const index = optionsByGroup.get(ref) ?? new Map<string, ModifierRow>();
      index.set(row.documentId, row);
      if (row.code) index.set(row.code, row);
      optionsByGroup.set(ref, index);
    }

    const groupRefs = new Map<string, string>();
    for (const row of parsed) {
      const known = groupRefs.get(row.groupKey);
      if (known) continue;
      const existing = groups.get(row.groupKey);
      const data: Record<string, unknown> = {
        name: {
          vi: row.groupVi,
          ...(row.groupEn ? { en: row.groupEn } : {}),
        },
        minQuantity: row.min,
        maxQuantity: row.max,
      };
      let ref: string;
      if (existing) {
        const updated = (await strapi.documents(GROUP).update({
          documentId: existing.documentId,
          data: { ...data, ...(existing.code ? {} : { code: row.groupKey }) } as never,
        })) as { documentId: string };
        ref = updated.documentId;
        bump(report.updated, 'modifierGroups');
      } else {
        const created = (await strapi.documents(GROUP).create({
          data: {
            ...data,
            code: row.groupKey,
            selectionType: 'multiple',
          } as never,
        })) as { documentId: string };
        ref = created.documentId;
        bump(report.created, 'modifierGroups');
      }
      groupRefs.set(row.groupKey, ref);
    }

    for (const row of parsed) {
      if (!row.optionKey) continue;
      const groupRef = groupRefs.get(row.groupKey);
      if (!groupRef) continue;
      const index = optionsByGroup.get(groupRef) ?? new Map<string, ModifierRow>();
      const existing = index.get(row.optionKey);
      const data: Record<string, unknown> = {
        name: {
          vi: row.optionVi,
          ...(row.optionEn ? { en: row.optionEn } : {}),
        },
        priceDelta: row.priceDelta,
        rank: row.rank,
      };
      if (existing) {
        await strapi.documents(MODIFIER).update({
          documentId: existing.documentId,
          data: { ...data, ...(existing.code ? {} : { code: row.optionKey }) } as never,
        });
        bump(report.updated, 'modifiers');
      } else {
        const created = (await strapi.documents(MODIFIER).create({
          data: { ...data, code: row.optionKey, group: groupRef } as never,
        })) as { documentId: string };
        index.set(row.optionKey, { documentId: created.documentId } as ModifierRow);
        optionsByGroup.set(groupRef, index);
        bump(report.created, 'modifiers');
      }
    }
  };

  // ── Public API ──────────────────────────────────────────────────────────

  const serialize = (row: ImportRow) => ({
    documentId: row.documentId,
    kind: row.kind,
    fileName: row.fileName,
    rowCount: row.rowCount,
    status: row.status,
    report: row.report ?? emptyReport(),
    hasPayload: typeof row.payload === 'string' && row.payload.length > 0,
    createdByRef: row.createdByRef ?? null,
    appliedAt: row.appliedAt ?? null,
    createdAt: row.createdAt,
  });

  const findImport = async (documentId: string): Promise<ImportRow> => {
    const row = (await query(IMPORT).findOne({ where: { documentId } })) as ImportRow | null;
    if (!row) {
      throw new OrderingError('CATALOG_IMPORT_NOT_FOUND', 'catalog import not found', {
        details: { documentId },
      });
    }
    return row;
  };

  const applyImport = async (row: ImportRow, ctx: ServiceContext): Promise<ImportRow> => {
    if (row.status === 'applied') return row;
    if (row.status !== 'validated' || !row.payload) {
      throw new OrderingError(
        'VALIDATION_ERROR',
        'only a successfully dry-run import can be applied',
        { details: { status: row.status } },
      );
    }
    const version = await catalogVersion();
    if (version !== row.catalogVersion) {
      throw new OrderingError(
        'CATALOG_IMPORT_STALE',
        'the catalog changed after this file was validated — run the import again',
        { details: { documentId: row.documentId } },
      );
    }
    const report = row.report ?? emptyReport();
    report.errors = [];
    // The stored report carries predicted counts — apply recomputes the real numbers.
    report.created = {};
    report.updated = {};

    await strapi.db.transaction(async () => {
      // Document Service writes log per-entity audit rows; an import only needs its summary.
      await withAuditSuppressed(PRODUCT, async () =>
        withAuditSuppressed(VARIANT, async () =>
          withAuditSuppressed(PRICE, async () =>
            withAuditSuppressed(GROUP, async () =>
              withAuditSuppressed(MODIFIER, async () => {
                if (row.kind === 'products') {
                  const { parsed } = await validateProducts(
                    readGrid(row.payload as string, PRODUCT_CSV_HEADERS).rows,
                  );
                  await applyProducts(parsed, report);
                } else {
                  const { parsed } = await validateModifiers(
                    readGrid(row.payload as string, MODIFIER_CSV_HEADERS).rows,
                  );
                  await applyModifiers(parsed, report);
                }
              }),
            ),
          ),
        ),
      );
      await strapi.db.query(IMPORT).update({
        where: { id: row.id },
        data: {
          status: 'applied',
          payload: null,
          appliedAt: nowOf(ctx),
          report,
        },
      });
    });
    await changeLog().record(
      {
        action: 'catalog.import',
        entityType: 'catalog-import',
        entityId: row.documentId,
        entityLabel: row.fileName,
        after: { created: report.created, updated: report.updated, rowCount: row.rowCount },
      },
      ctx,
    );
    return findImport(row.documentId);
  };

  return {
    catalogVersion,

    /** CSV download for one kind — operators round-trip these exact files back into import. */
    async exportCsv(kind: CatalogCsvKind): Promise<{ csv: string; fileName: string }> {
      if (kind !== 'products' && kind !== 'modifiers') {
        throw new OrderingError('VALIDATION_ERROR', 'kind must be products or modifiers', {
          details: { field: 'kind' },
        });
      }
      const csv = kind === 'products' ? await exportProducts() : await exportModifiers();
      return { csv, fileName: `${kind}.csv` };
    },

    /** Recent import runs for the admin screen — payload never leaves the service. */
    async listImports(limit = 20) {
      const rows = (await query(IMPORT).findMany({
        orderBy: { createdAt: 'desc' },
        limit,
      })) as ImportRow[];
      return rows.map(serialize);
    },

    async getImport(documentId: string) {
      return serialize(await findImport(documentId));
    },

    /**
     * Validate an uploaded file: parse → row checks → `catalog-import` row. `dryRun === false`
     * applies immediately when validation is clean; either way the run is persisted.
     */
    async importCsv(
      input: { kind: CatalogCsvKind; fileName: string; text: string; dryRun?: boolean },
      ctx: ServiceContext,
    ) {
      if (input.kind !== 'products' && input.kind !== 'modifiers') {
        throw new OrderingError('VALIDATION_ERROR', 'kind must be products or modifiers', {
          details: { field: 'kind' },
        });
      }
      const fileName = input.fileName?.trim() || `${input.kind}.csv`;
      const grid = readGrid(
        input.text,
        input.kind === 'products' ? PRODUCT_CSV_HEADERS : MODIFIER_CSV_HEADERS,
      );
      const checked =
        input.kind === 'products'
          ? await validateProducts(grid.rows)
          : await validateModifiers(grid.rows);
      const report = emptyReport();
      report.errors = checked.errors;
      // Predicted create/update counts let the apply dialog say "Sẽ tạo n, sửa m" up front;
      // applyImport overwrites them with the real numbers.
      report.created = checked.predicted.created;
      report.updated = checked.predicted.updated;
      const status = checked.errors.length > 0 ? 'failed' : 'validated';
      const created = (await query(IMPORT).create({
        data: {
          kind: input.kind,
          fileName,
          rowCount: grid.rows.length,
          status,
          report,
          payload: status === 'validated' ? input.text : null,
          catalogVersion: await catalogVersion(),
          createdByRef: actorRefOf(ctx),
        },
      })) as ImportRow;
      if (status !== 'validated' || input.dryRun !== false) {
        return { import: serialize(created), report };
      }
      const applied = await applyImport(created, ctx);
      return { import: serialize(applied), report: applied.report ?? report };
    },

    /** POST /catalog/import/:id/apply — re-runs the stored payload inside one transaction. */
    async apply(documentId: string, ctx: ServiceContext) {
      const applied = await applyImport(await findImport(documentId), ctx);
      return serialize(applied);
    },
  };
};
