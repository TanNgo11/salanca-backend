import { z } from '@strapi/utils';

/**
 * SePay settings live in the app plugin config (env), never in Admin. Accounts are an object
 * keyed by id — `defaultsDeep` merges arrays by index, so a list would silently mix defaults.
 * `locationRefs: 'all'` is one shared account; a string array is the branches that account
 * collects for (contracts §19.7).
 */
const locationRefs = z.union([z.literal('all'), z.array(z.string().min(1)).min(1)]);

export const sepayAccountSchema = z.object({
  accountNumber: z.string().regex(/^\d{6,20}$/, 'digits only'),
  bankCode: z.string().min(2).max(32),
  bankName: z.string().min(1).max(80).optional(),
  accountName: z.string().min(1).max(120),
  subAccount: z.string().min(1).max(40).optional(),
  locationRefs,
});

export const sepaySettingsSchema = z.object({
  enabled: z.literal(true),
  webhookSecret: z.string().min(16),
  apiToken: z.string().min(16),
  memoTemplate: z.string().min(1).max(80).default('SLC{orderCode}'),
  captureMode: z.enum(['auto', 'review-all']).default('auto'),
  amountTolerance: z.number().int().min(0).max(1_000_000).default(0),
  accounts: z.record(z.string().min(1), sepayAccountSchema),
  qrBaseUrl: z.string().url().default('https://qr.sepay.vn/img'),
  apiBaseUrl: z.string().url().default('https://userapi.sepay.vn'),
});

export type SepayAccount = z.infer<typeof sepayAccountSchema>;
export type SepaySettings = z.infer<typeof sepaySettingsSchema>;

const issueText = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');

/**
 * `null` when SePay is absent or explicitly disabled. Throws when it is enabled but the
 * shape is wrong — startup must fail before a webhook can be accepted unsigned.
 */
export const parseSepaySettings = (raw: unknown): SepaySettings | null => {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('providers.payment.sepay: expected an object keyed by setting name');
  }
  if ((raw as { enabled?: unknown }).enabled !== true) return null;
  const parsed = sepaySettingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`providers.payment.sepay: ${issueText(parsed.error)}`);
  }
  if (Object.keys(parsed.data.accounts).length === 0) {
    throw new Error('providers.payment.sepay.accounts: at least one account is required');
  }
  if (!parsed.data.memoTemplate.includes('{orderCode}')) {
    throw new Error('providers.payment.sepay.memoTemplate: must contain {orderCode}');
  }
  return parsed.data;
};

export type SepayAccountChoice = SepayAccount & { key: string };

/** Branch-specific account wins over a shared `all` account. */
export const selectSepayAccount = (
  settings: SepaySettings,
  locationRef: string,
): SepayAccountChoice | null => {
  const accounts = Object.entries(settings.accounts).map(([key, account]) => ({ key, ...account }));
  const specific = accounts.find(
    (account) => Array.isArray(account.locationRefs) && account.locationRefs.includes(locationRef),
  );
  if (specific) return specific;
  return accounts.find((account) => account.locationRefs === 'all') ?? null;
};

/** Which branches an incoming account number belongs to, or null when it is not configured. */
export const accountScope = (
  settings: SepaySettings,
  accountNumber: string,
  subAccount?: string | null,
): SepayAccountChoice | null => {
  const number = accountNumber.replace(/\s/g, '');
  const matches = Object.entries(settings.accounts)
    .map(([key, account]) => ({ key, ...account }))
    .filter((account) => account.accountNumber === number);
  if (matches.length === 0) return null;
  if (!subAccount) return matches.find((account) => !account.subAccount) ?? matches[0];
  return matches.find((account) => account.subAccount === subAccount) ?? null;
};
