import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';

import { ALERT_CODES, isAlertCode, type AlertCode } from '../domain/alert-codes';
import { OrderingError } from '../domain/errors';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';

/**
 * Per-code alert rules (contracts §12, §19.2), editable in Admin → Bán hàng → Cảnh báo and stored
 * in the plugin store under `alert-rules`. `recipients` lists either the literal 'branch-email'
 * (the alert's locationRef branch mailbox) or a plugin action — holders of that action get the
 * `staff.ops-alert` email. A missing stored entry always falls back to the default below.
 */
export const ALERT_RULE_RECIPIENTS = [
  'branch-email',
  'ops.read',
  'report.read',
  'payment.review',
  'order.read',
] as const;

export type AlertRuleRecipient = (typeof ALERT_RULE_RECIPIENTS)[number];

const ruleSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(1),
  criticalThreshold: z.number().int().min(1).optional(),
  aggregationMinutes: z.number().int().min(1).max(1440),
  recipients: z.array(z.enum(ALERT_RULE_RECIPIENTS)),
});

export type AlertRule = z.infer<typeof ruleSchema>;
export type AlertRules = Record<AlertCode, AlertRule>;

/** Default thresholds of contracts §12 (severity ladder, aggregation window, recipient role). */
export const ALERT_RULE_DEFAULTS: AlertRules = {
  'webhook-failing': {
    enabled: true,
    threshold: 5,
    criticalThreshold: 20,
    aggregationMinutes: 60,
    recipients: ['ops.read'],
  },
  // O10: an outbound endpoint crossed 50 consecutive failures and switched itself off.
  'webhook-endpoint-disabled': {
    enabled: true,
    threshold: 1,
    criticalThreshold: 1,
    aggregationMinutes: 60,
    recipients: ['ops.read'],
  },
  'payment-unmatched': {
    enabled: true,
    threshold: 1,
    criticalThreshold: 10,
    aggregationMinutes: 60,
    recipients: ['report.read'],
  },
  'outbox-stuck': {
    enabled: true,
    threshold: 10,
    criticalThreshold: 60,
    aggregationMinutes: 60,
    recipients: ['ops.read'],
  },
  'job-heartbeat-missed': {
    enabled: true,
    threshold: 2,
    criticalThreshold: 6,
    aggregationMinutes: 60,
    recipients: ['ops.read'],
  },
  'order-awaiting-acceptance': {
    enabled: true,
    threshold: 1,
    criticalThreshold: 3,
    aggregationMinutes: 60,
    recipients: ['branch-email'],
  },
  'reconciliation-mismatch': {
    enabled: true,
    threshold: 1,
    criticalThreshold: 10,
    aggregationMinutes: 60,
    recipients: ['payment.review'],
  },
  'manual-payment-unconfirmed': {
    enabled: true,
    threshold: 24,
    criticalThreshold: 72,
    aggregationMinutes: 60,
    recipients: ['report.read'],
  },
  'cash-closing-mismatch': {
    enabled: true,
    threshold: 1,
    criticalThreshold: 1,
    aggregationMinutes: 1440,
    recipients: ['report.read'],
  },
  // O15: a change-log row whose hash or chain link no longer verifies. Always critical.
  'audit-tampered': {
    enabled: true,
    threshold: 1,
    criticalThreshold: 1,
    aggregationMinutes: 1440,
    recipients: ['ops.read'],
  },
  // O10: a saved template failed at render — the order mail still went out with the default copy.
  'notification-template-broken': {
    enabled: true,
    threshold: 1,
    criticalThreshold: 10,
    aggregationMinutes: 60,
    recipients: ['ops.read'],
  },
  // O8: one alert per order rated at or below `threshold` stars (default 2), for the branch's
  // report readers. Not count-based: `threshold` is the star ceiling, not an occurrence count.
  'low-rating': {
    enabled: true,
    threshold: 2,
    aggregationMinutes: 1440,
    recipients: ['report.read'],
  },
  // O9: one alert per IP once wrong-code attempts reach `threshold` inside the window.
  'gift-card-probing': {
    enabled: true,
    threshold: 20,
    criticalThreshold: 60,
    aggregationMinutes: 60,
    recipients: ['ops.read'],
  },
};

/** Unknown codes (custom callers) behave as a minimal warning rule rather than being dropped. */
export const FALLBACK_RULE: AlertRule = {
  enabled: true,
  threshold: 1,
  aggregationMinutes: 60,
  recipients: ['ops.read'],
};

const alertRules = ({ strapi }: { strapi: Core.Strapi }) => {
  const store = () => strapi.store({ type: 'plugin', name: 'ordering', key: 'alert-rules' });
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  const mergeDefaults = (stored: unknown): AlertRules => {
    const raw = (stored ?? {}) as Record<string, unknown>;
    const merged = {} as AlertRules;
    for (const code of ALERT_CODES) {
      const parsed = ruleSchema.safeParse(raw[code]);
      merged[code] = parsed.success ? parsed.data : { ...ALERT_RULE_DEFAULTS[code] };
    }
    return merged;
  };

  const service = {
    async get(): Promise<AlertRules> {
      return mergeDefaults(await store().get({}));
    },

    /** Returns the effective rule for one code (defaults merged); `FALLBACK_RULE` when unknown. */
    async ruleOf(code: string): Promise<AlertRule> {
      if (!isAlertCode(code)) return FALLBACK_RULE;
      return (await service.get())[code];
    },

    /**
     * Replaces the provided rules; omitted codes keep their current effective value. Unknown
     * codes or malformed rules are rejected with VALIDATION_ERROR (details.issues).
     */
    async put(raw: unknown, ctx: ServiceContext): Promise<AlertRules> {
      const input = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
        string,
        unknown
      >;
      const unknownKeys = Object.keys(input).filter((key) => !isAlertCode(key));
      const issues: Array<{ path: string; message: string }> = unknownKeys.map((key) => ({
        path: key,
        message: 'unknown alert code',
      }));
      const parsedRules = {} as Record<AlertCode, AlertRule>;
      for (const code of ALERT_CODES) {
        if (!(code in input)) continue;
        const parsed = ruleSchema.safeParse(input[code]);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            issues.push({ path: `${code}.${issue.path.join('.')}`, message: issue.message });
          }
          continue;
        }
        parsedRules[code] = parsed.data;
      }
      if (issues.length > 0) {
        throw new OrderingError('VALIDATION_ERROR', 'alert rules are invalid', {
          details: { issues },
        });
      }
      const before = await service.get();
      const next = { ...before, ...parsedRules };
      await store().set({ value: next });
      await changeLog().record(
        {
          action: 'alert-rules.update',
          entityType: 'alert-rules',
          entityId: 'ordering',
          before: before as unknown as Record<string, unknown>,
          after: next as unknown as Record<string, unknown>,
        },
        ctx,
      );
      return next;
    },
  };

  return service;
};

export default alertRules;
