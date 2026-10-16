import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultBranch, rememberBranch, rememberedBranch } from './branch-memory';

const branches = [{ code: 'E2E' }, { code: 'Q1' }, { code: 'Q3' }];

const stubStorage = (store: Record<string, string>) =>
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    },
  });

afterEach(() => vi.unstubAllGlobals());

describe('branch memory', () => {
  it('falls back to the first visible branch when nothing is remembered or storage is unavailable', () => {
    expect(defaultBranch(branches)?.code).toBe('E2E'); // no window at all (node)
    stubStorage({});
    expect(defaultBranch(branches)?.code).toBe('E2E');
  });

  it('opens on the branch the staff member last worked in', () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    rememberBranch('Q1');
    expect(rememberedBranch()).toBe('Q1');
    expect(defaultBranch(branches)?.code).toBe('Q1');
  });

  it('ignores a remembered branch the caller can no longer see', () => {
    stubStorage({ 'ordering.inbox.branch': 'Q9' });
    expect(defaultBranch(branches)?.code).toBe('E2E');
  });

  it('survives blocked storage', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(() => rememberBranch('Q1')).not.toThrow();
    expect(defaultBranch(branches)?.code).toBe('E2E');
  });
});
