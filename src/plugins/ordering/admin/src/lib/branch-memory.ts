/**
 * The branch the staff member last worked in, shared with the order inbox, deliveries and kitchen
 * (same key). A per-browser convenience, never data: storage can be blocked or empty, so every
 * access is guarded and callers fall back to the first branch they are allowed to see.
 */
const BRANCH_KEY = 'ordering.inbox.branch';

export const rememberedBranch = (): string | null => {
  try {
    return window.localStorage.getItem(BRANCH_KEY);
  } catch {
    return null;
  }
};

export const rememberBranch = (code: string): void => {
  try {
    window.localStorage.setItem(BRANCH_KEY, code);
  } catch {
    // private mode / blocked storage: the choice just is not remembered
  }
};

/** The remembered branch when the caller can still see it, otherwise the first visible one. */
export const defaultBranch = <T extends { code: string }>(visible: T[]): T | undefined => {
  const code = rememberedBranch();
  return visible.find((option) => option.code === code) ?? visible[0];
};
