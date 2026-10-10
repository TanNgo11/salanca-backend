import { describe, expect, it } from 'vitest';

import {
  buildCategoryTree,
  siblingRanks,
  subtreeRefs,
  wouldCreateCycle,
} from './category-tree';

const rows = [
  { ref: 'a', parentRef: null, rank: 0 },
  { ref: 'b', parentRef: 'a', rank: 0 },
  { ref: 'c', parentRef: 'a', rank: 1 },
  { ref: 'd', parentRef: 'b', rank: 0 },
  { ref: 'e', parentRef: null, rank: 1 },
];

describe('buildCategoryTree', () => {
  it('nests children under parents, ordered by rank', () => {
    const tree = buildCategoryTree(rows);
    expect(tree.map((node) => node.item.ref)).toEqual(['a', 'e']);
    const a = tree[0];
    expect(a.children.map((node) => node.item.ref)).toEqual(['b', 'c']);
    expect(a.children[0].children[0].item.ref).toBe('d');
  });

  it('treats a dangling parent ref as a root', () => {
    const tree = buildCategoryTree([{ ref: 'x', parentRef: 'missing', rank: 0 }]);
    expect(tree).toHaveLength(1);
    expect(tree[0].item.ref).toBe('x');
  });

  it('does not recurse forever on cyclic stored data', () => {
    const tree = buildCategoryTree([
      { ref: 'x', parentRef: 'y', rank: 0 },
      { ref: 'y', parentRef: 'x', rank: 0 },
    ]);
    expect(tree).toHaveLength(0); // both have parents — a pure cycle has no entry point
  });
});

describe('subtreeRefs / wouldCreateCycle', () => {
  it('includes the node and all descendants', () => {
    expect([...subtreeRefs(rows, 'a')].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...subtreeRefs(rows, 'b')].sort()).toEqual(['b', 'd']);
  });

  it.each([
    ['a', 'a', true, 'cannot be its own parent'],
    ['a', 'b', true, 'cannot move under its child'],
    ['a', 'd', true, 'cannot move under its grandchild'],
    ['d', 'a', false, 'leaf can move up to a'],
    ['e', 'b', false, 'unrelated root can move under b'],
    ['b', 'e', false, 'child can move to another root'],
    ['b', null, false, 'moving to root never cycles'],
  ])('moving %s under %s → %s (%s)', (ref, parentRef, expected) => {
    expect(wouldCreateCycle(rows, ref, parentRef)).toBe(expected);
  });
});

describe('siblingRanks', () => {
  it('assigns dense ranks in order', () => {
    expect(siblingRanks(['x', 'y', 'z'])).toEqual(
      new Map([
        ['x', 0],
        ['y', 1],
        ['z', 2],
      ]),
    );
  });
});
