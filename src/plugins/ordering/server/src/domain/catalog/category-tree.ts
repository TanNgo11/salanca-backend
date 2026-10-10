/**
 * Pure category-tree helpers (plan step 7b): build the nested tree, find subtrees for cycle
 * prevention, and normalize sibling ranks after a move. No Strapi imports.
 */

export interface CategoryLike {
  ref: string;
  parentRef?: string | null;
  rank?: number;
}

export interface CategoryTreeNode<T extends CategoryLike> {
  item: T;
  children: CategoryTreeNode<T>[];
}

const childrenIndex = <T extends CategoryLike>(rows: T[]): Map<string | null, T[]> => {
  const byParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.parentRef ?? null;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  }
  return byParent;
};

/**
 * Nested tree ordered by `rank` at every level. A dangling `parentRef` (parent deleted or
 * outside the fetched set) treats the row as a root rather than dropping it silently.
 */
export function buildCategoryTree<T extends CategoryLike>(rows: T[]): CategoryTreeNode<T>[] {
  const byParent = childrenIndex(rows);
  const known = new Set(rows.map((row) => row.ref));
  const build = (items: T[], ancestors: Set<string>): CategoryTreeNode<T>[] =>
    items.map((item) => ({
      item,
      // A cycle in stored data must not recurse forever — stop expanding at repeats.
      children: ancestors.has(item.ref)
        ? []
        : build(byParent.get(item.ref) ?? [], new Set([...ancestors, item.ref])),
    }));
  // Rows whose parent isn't in the fetched set act as roots (disjoint from byParent[null]).
  const roots = [
    ...(byParent.get(null) ?? []),
    ...rows.filter((row) => row.parentRef != null && !known.has(row.parentRef)),
  ];
  return build(roots, new Set());
}

/** Every ref inside `ref`'s subtree, including `ref` itself — the set a move must avoid. */
export function subtreeRefs(rows: CategoryLike[], ref: string): Set<string> {
  const byParent = childrenIndex(rows);
  const out = new Set<string>();
  const queue = [ref];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (out.has(current)) continue;
    out.add(current);
    for (const child of byParent.get(current) ?? []) queue.push(child.ref);
  }
  return out;
}

/**
 * True when moving `ref` under `parentRef` would create a cycle: `parentRef` is `ref` itself
 * or one of its descendants. A null parent (move to root) can never cycle.
 */
export function wouldCreateCycle(
  rows: CategoryLike[],
  ref: string,
  parentRef: string | null,
): boolean {
  if (parentRef === null || parentRef === undefined) return false;
  return subtreeRefs(rows, ref).has(parentRef);
}

/** Rank assignments for an ordered sibling list: first gets 0, then 1, 2, … */
export function siblingRanks(orderedRefs: string[]): Map<string, number> {
  return new Map(orderedRefs.map((ref, index) => [ref, index]));
}
