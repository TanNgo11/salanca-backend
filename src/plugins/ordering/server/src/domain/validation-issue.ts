/** Structural subset of a zod issue, so this helper does not depend on the zod version. */
export type RawIssue = {
  code?: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
};

export type IssueView = { path: string; message: string; code: string; min?: number; max?: number };

/** One API issue: `code` and the bounds let the admin UI render its own translated text. */
export const issueView = (issue: RawIssue | undefined, fallbackPath: string): IssueView => ({
  path: issue?.path.map(String).join('.') || fallbackPath,
  message: issue?.message ?? 'invalid',
  code: issue?.code ?? 'invalid',
  ...(issue?.minimum !== undefined ? { min: Number(issue.minimum) } : {}),
  ...(issue?.maximum !== undefined ? { max: Number(issue.maximum) } : {}),
});
