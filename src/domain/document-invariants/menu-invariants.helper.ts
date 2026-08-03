export const MENU_CATEGORY_UID = 'api::menu-category.menu-category' as const;
export const MENU_ITEM_UID = 'api::menu-item.menu-item' as const;

/**
 * Returns true when the Document Service payload carries a non-empty category
 * relation (id, documentId, connect, or set).
 */
export function hasCategoryRelation(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).length > 0;
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  const relation = value as {
    connect?: unknown[];
    set?: unknown[];
    documentId?: unknown;
    id?: unknown;
  };

  return Boolean(
    relation.documentId
      || relation.id
      || (Array.isArray(relation.connect) && relation.connect.length > 0)
      || (Array.isArray(relation.set) && relation.set.length > 0),
  );
}
