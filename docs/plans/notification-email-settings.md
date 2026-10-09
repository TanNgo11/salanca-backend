# Staff notification email settings in Admin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: Automated verification passed; ready for manual UAT
Owner: tan_ngo (developer); restaurant owner for recipient addresses
Last updated: 2026-10-09
Related: [`../resend-email-operations.md`](../resend-email-operations.md), [`../admin-roles.md`](../admin-roles.md), [`lead-workflow-confirmation-export.md`](lead-workflow-confirmation-export.md)

**Goal:** The owner or a manager sets, in Admin, which addresses get the staff email for each kind of form lead (reservations, contact messages). A "Gửi thử" button sends a sample to the saved list. No env change or restart is needed to change recipients.

**Architecture:** One generic registry of notification kinds (`src/domain/notification-settings`) holds a recipient list per kind. The value lives in Strapi's core store (`strapi.store`), not in a content type, so it never reaches the public Content API, the Content Manager or the seed `schemaHash`. `sendFormLeadNotify` reads the list for the lead's kind. Until someone saves the screen once, it falls back to `FORM_NOTIFY_TO`, so current environments keep working. A permission-gated admin route set (`GET`/`PUT` settings, `POST` test) and one Admin screen sit on top. Each save writes one audit row.

**Tech Stack:** Strapi 5.51.1 (TypeScript), Strapi Admin (React, `@strapi/design-system`, `@strapi/icons`), Vitest, PostgreSQL.

## Global Constraints

- Admin copy is Vietnamese.
- The public `POST /api/v1/reservation-requests` and `POST /api/v1/contact-messages` 201 contracts must not change. Notify stays off the response path and never throws into it.
- Every new admin route uses `policies: ['admin::isAuthenticatedAdmin']` and an explicit `auth.scope`.
- Recipient addresses and lead personal data never reach logs. Log `kind`, `documentId`, `recipientCount` and error codes only.
- No new npm dependencies.
- At most 10 recipients per kind.
- Commit only after the user says so (project rule). Steps below mark where a commit goes.
- Gates per task: `pnpm run lint`, `pnpm run typecheck` and `pnpm run test` stay green.

## Non-goals

- No per-kind Reply-To override. Guest replies still go to `EMAIL_REPLY_TO`. In production that address must belong to `EMAIL_SENDER_DOMAIN` (`config/transactional-email.helper.ts:212`), which an Admin field could not guarantee.
- No SMTP credentials in Admin. Transport stays in env.
- No separate newsletter kind. Newsletter sign-ups are `contact-message` rows and follow the contact list.
- No order notifications yet. The future `order` kind is one more entry in `NOTIFICATION_KINDS`.
- No new Admin role is created by code (see Decisions).

## Current evidence

- Staff notify for both forms: `scheduleFormLeadNotify` in `src/api/reservation-request/controllers/reservation-request.ts:101` and `src/api/contact-message/controllers/contact-message.ts:71`.
- Recipients come only from env: `resolveFormNotifyRecipientsFromEnv(process.env, log)` in `src/domain/form-intake/send-form-lead-notify.ts:90`. Parsing (comma/semicolon, lowercase, dedupe, drop invalid) is `parseFormNotifyRecipients` in `form-lead-notify.ts`.
- SMTP opt-in is `isFormNotifySmtpConfigured()` (`EMAIL_SMTP_HOST`).
- Permission pattern to copy: `src/api/lead-export/index.ts` (register action, `resetSuperAdminPermissions`, admin route) and `src/admin/lead-export/*` (screen, `Page.Protect`, `useFetchClient`).
- Core store already used in `src/domain/media-processing/upload-optimize.ts:131` (`strapi.store({ type: 'plugin', name: 'upload', key: 'settings' })`).
- Audit: `writeAdminAuditForCurrentRequest` (`src/domain/audit/admin-audit-request.ts:67`). `AuditAction`/`AuditTargetType` must match `src/api/audit-event/content-types/audit-event/schema.json` exactly (`audit-event-schema.contract.test.ts`). Admin labels: `src/admin/audit-log/audit-log.helper.ts` (`Record<AuditAction, string>` and `TARGET_TYPE_LABELS`, enforced by typecheck).
- Seed `schemaHash` covers `allUids` + all components (`scripts/lib/content-release.helper.mjs`). `audit-event` is not in `allUids` and no component changes, so the hash does not change.
- Strapi Community has only Super Admin, Editor and Author roles by default. There is no "Manager" role in code.

## Decisions and assumptions

- Decision (user, 2026-10-09): one list per kind (reservations and contact messages separate), built as a generic kind registry.
- Decision (user, 2026-10-09): Super Admin and Manager can edit. Implemented as one RBAC action `admin::notification-settings.manage`. Bootstrap grants it to Super Admin. The Manager role is created in Admin by the owner (Settings → Roles), with this action ticked. Steps go in `docs/admin-roles.md`.
- Decision (user, 2026-10-09): "Gửi thử" ships in this change.
- Decision: storage is the core store key `notification-settings` (`type: 'plugin', name: 'salanca'`). It is not part of the content release or seed. Each environment configures its own list.
- Decision: fallback rule. If the store has never been saved, every kind uses `FORM_NOTIFY_TO`. Once saved, the stored list wins, even when empty (empty = no email for that kind).
- Decision: "Gửi thử" sends to the **saved** list only, never to addresses typed but not saved, and at most once per kind every 30 seconds per server process.
- Decision: audit action `notification_settings_update` with target type `setting`, category Security (it changes where guest data is sent). The row carries no addresses.
- Assumption: one Postgres row read per lead is acceptable (low lead volume). No cache, so a save takes effect on the next lead.

## Invariants

- A lead is stored and the client gets its 201 whether or not settings exist, are invalid, or the store read fails.
- With no saved settings, behavior equals today's env-only behavior.
- Saved lists contain only valid, lowercase, unique addresses, at most 10 per kind.
- Routes return 403 without `admin::notification-settings.manage`.

## File structure

| Path | Responsibility |
| --- | --- |
| `src/domain/notification-settings/notification-settings.ts` | Pure: kind registry, types, list parsing/validation, recipient resolution, test-email builder |
| `src/domain/notification-settings/notification-settings.test.ts` | Unit tests for the above |
| `src/domain/notification-settings/notification-settings.store.ts` | Read/write the core store value |
| `src/domain/form-intake/send-form-lead-notify.ts` | Use per-kind recipients instead of env only |
| `src/domain/form-intake/send-form-lead-notify.test.ts` | New: adapter tests |
| `src/api/notification-settings/notification-settings.types.ts` | Route paths, permission enum |
| `src/api/notification-settings/notification-settings.controller.ts` | GET / PUT / test handlers |
| `src/api/notification-settings/notification-settings.controller.test.ts` | Controller tests |
| `src/api/notification-settings/index.ts` | Register action, bootstrap grant, admin routes |
| `src/index.ts` | Wire register + bootstrap |
| `src/domain/audit/audit-event.types.ts`, `audit-event-category.ts`, `src/api/audit-event/content-types/audit-event/schema.json`, `src/admin/audit-log/audit-log.helper.ts` | New audit action + target type |
| `src/admin/notification-settings/notification-settings.helper.ts` (+ `.test.ts`) | Chip parsing/validation, labels, permissions, API paths |
| `src/admin/notification-settings/EmailChipInput.tsx` | Email chip input (design-system `Tag` + `TextInput`) |
| `src/admin/notification-settings/NotificationSettingsScreen.tsx` | Admin screen |
| `src/admin/app.tsx` | Menu link |
| Docs | `docs/resend-email-operations.md`, `docs/admin-roles.md`, `docs/cms-editor-guide.md`, `docs/STATUS.md`, `.env.example` |

---

### Task 1: Domain module — kinds, parsing, resolution, test email

**Files:**
- Create: `src/domain/notification-settings/notification-settings.ts`
- Create: `src/domain/notification-settings/notification-settings.test.ts`

**Interfaces:**
- Consumes: `parseFormNotifyRecipients(raw: string | undefined | null): string[]` from `src/domain/form-intake/form-lead-notify.ts`; `isValidEmailAddress` from `src/shared/email/email.ts`.
- Produces:
  - `NOTIFICATION_KINDS = ['reservation-request', 'contact-message'] as const`, `type NotificationKind`
  - `NOTIFICATION_KIND_LABELS_VI: Record<NotificationKind, string>`
  - `MAX_RECIPIENTS_PER_KIND = 10`
  - `type NotificationSettings = { version: 1; recipients: Record<NotificationKind, string[]> }`
  - `class NotificationSettingsError extends Error { vietnameseMessage: string }`
  - `parseNotificationSettingsInput(body: unknown): NotificationSettings` (throws `NotificationSettingsError`)
  - `normalizeStoredSettings(value: unknown): NotificationSettings | null`
  - `resolveKindRecipients(stored: NotificationSettings | null, kind: NotificationKind, env?: NodeJS.ProcessEnv): string[]`
  - `isNotificationKind(value: unknown): value is NotificationKind`
  - `buildTestNotificationEmail(kind: NotificationKind): { subject: string; text: string; html: string }`

- [ ] **Step 1: Write the failing tests**

`src/domain/notification-settings/notification-settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildTestNotificationEmail,
  isNotificationKind,
  MAX_RECIPIENTS_PER_KIND,
  NOTIFICATION_KINDS,
  NotificationSettingsError,
  normalizeStoredSettings,
  parseNotificationSettingsInput,
  resolveKindRecipients,
} from './notification-settings';

const saved = (reservation: string[], contact: string[]) => ({
  version: 1 as const,
  recipients: { 'reservation-request': reservation, 'contact-message': contact },
});

describe('notification kinds', () => {
  it('lists reservation and contact', () => {
    expect(NOTIFICATION_KINDS).toEqual(['reservation-request', 'contact-message']);
    expect(isNotificationKind('contact-message')).toBe(true);
    expect(isNotificationKind('order')).toBe(false);
  });
});

describe('parseNotificationSettingsInput', () => {
  it('lowercases, trims and dedupes each list', () => {
    const result = parseNotificationSettingsInput({
      recipients: {
        'reservation-request': [' Booking@Salanca.vn ', 'booking@salanca.vn', 'chef@salanca.vn'],
        'contact-message': [],
      },
    });
    expect(result).toEqual(saved(['booking@salanca.vn', 'chef@salanca.vn'], []));
  });

  it('treats a missing kind as an empty list', () => {
    expect(parseNotificationSettingsInput({ recipients: {} })).toEqual(saved([], []));
  });

  it('rejects an invalid address and names it', () => {
    expect(() =>
      parseNotificationSettingsInput({
        recipients: { 'reservation-request': ['booking@salanca'], 'contact-message': [] },
      }),
    ).toThrowError(
      expect.objectContaining({
        vietnameseMessage: 'Email không hợp lệ: "booking@salanca" (Đặt bàn).',
      }),
    );
  });

  it('rejects more than the maximum recipients', () => {
    const many = Array.from({ length: MAX_RECIPIENTS_PER_KIND + 1 }, (_, i) => `s${i}@salanca.vn`);
    expect(() =>
      parseNotificationSettingsInput({
        recipients: { 'reservation-request': [], 'contact-message': many },
      }),
    ).toThrowError(
      expect.objectContaining({ vietnameseMessage: 'Tối đa 10 email cho mục Liên hệ.' }),
    );
  });

  it('rejects a non-object body and non-string entries', () => {
    expect(() => parseNotificationSettingsInput(null)).toThrow(NotificationSettingsError);
    expect(() =>
      parseNotificationSettingsInput({ recipients: { 'reservation-request': [42] } }),
    ).toThrow(NotificationSettingsError);
  });
});

describe('normalizeStoredSettings', () => {
  it('returns null when nothing was saved', () => {
    expect(normalizeStoredSettings(null)).toBeNull();
    expect(normalizeStoredSettings(undefined)).toBeNull();
    expect(normalizeStoredSettings({ version: 2 })).toBeNull();
  });

  it('keeps valid addresses and drops garbage from a hand-edited row', () => {
    expect(
      normalizeStoredSettings({
        version: 1,
        recipients: { 'reservation-request': ['a@salanca.vn', 'bad'], 'contact-message': 'x' },
      }),
    ).toEqual(saved(['a@salanca.vn'], []));
  });
});

describe('resolveKindRecipients', () => {
  const env = { FORM_NOTIFY_TO: 'ops@salanca.vn, owner@salanca.vn' } as NodeJS.ProcessEnv;

  it('falls back to FORM_NOTIFY_TO when nothing was saved', () => {
    expect(resolveKindRecipients(null, 'contact-message', env)).toEqual([
      'ops@salanca.vn',
      'owner@salanca.vn',
    ]);
  });

  it('uses the saved list for that kind once saved', () => {
    const stored = saved(['booking@salanca.vn'], ['hello@salanca.vn']);
    expect(resolveKindRecipients(stored, 'reservation-request', env)).toEqual([
      'booking@salanca.vn',
    ]);
    expect(resolveKindRecipients(stored, 'contact-message', env)).toEqual(['hello@salanca.vn']);
  });

  it('sends nothing for a saved empty list, even with FORM_NOTIFY_TO set', () => {
    expect(resolveKindRecipients(saved([], ['x@salanca.vn']), 'reservation-request', env)).toEqual(
      [],
    );
  });
});

describe('buildTestNotificationEmail', () => {
  it('names the kind in subject and body', () => {
    const message = buildTestNotificationEmail('reservation-request');
    expect(message.subject).toBe('[Salanca] Email thử — Đặt bàn');
    expect(message.text).toContain('Đặt bàn');
    expect(message.html).toContain('Đặt bàn');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/domain/notification-settings`
Expected: FAIL, `Failed to resolve import "./notification-settings"`.

- [ ] **Step 3: Implement the module**

`src/domain/notification-settings/notification-settings.ts`:

```ts
/**
 * Staff notification recipients per form kind, edited in Admin.
 * Adding a kind (e.g. `order`) = one entry in NOTIFICATION_KINDS + its label.
 */
import { parseFormNotifyRecipients } from '../form-intake/form-lead-notify';
import { isValidEmailAddress } from '../../shared/email/email';

export const NOTIFICATION_KINDS = ['reservation-request', 'contact-message'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS_VI: Record<NotificationKind, string> = {
  'reservation-request': 'Đặt bàn',
  'contact-message': 'Liên hệ',
};

export const MAX_RECIPIENTS_PER_KIND = 10;

export type NotificationSettings = {
  version: 1;
  recipients: Record<NotificationKind, string[]>;
};

export class NotificationSettingsError extends Error {
  constructor(readonly vietnameseMessage: string) {
    super(vietnameseMessage);
    this.name = 'NotificationSettingsError';
  }
}

export const isNotificationKind = (value: unknown): value is NotificationKind =>
  NOTIFICATION_KINDS.some((kind) => kind === value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseKindList = (kind: NotificationKind, raw: unknown): string[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
    throw new NotificationSettingsError('Danh sách email không hợp lệ.');
  }
  const seen = new Set<string>();
  for (const entry of raw as string[]) {
    const address = entry.trim().toLowerCase();
    if (!address) continue;
    if (!isValidEmailAddress(address)) {
      throw new NotificationSettingsError(
        `Email không hợp lệ: "${entry.trim()}" (${NOTIFICATION_KIND_LABELS_VI[kind]}).`,
      );
    }
    seen.add(address);
  }
  if (seen.size > MAX_RECIPIENTS_PER_KIND) {
    throw new NotificationSettingsError(
      `Tối đa ${MAX_RECIPIENTS_PER_KIND} email cho mục ${NOTIFICATION_KIND_LABELS_VI[kind]}.`,
    );
  }
  return [...seen];
};

/** Validates an Admin PUT body. Throws NotificationSettingsError with a Vietnamese message. */
export const parseNotificationSettingsInput = (body: unknown): NotificationSettings => {
  if (!isRecord(body) || !isRecord(body.recipients)) {
    throw new NotificationSettingsError('Dữ liệu cài đặt không hợp lệ.');
  }
  const input = body.recipients;
  const recipients = Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => [kind, parseKindList(kind, input[kind])]),
  ) as Record<NotificationKind, string[]>;
  return { version: 1, recipients };
};

/** Reads a stored value leniently: never throws, drops anything invalid. Null = never saved. */
export const normalizeStoredSettings = (value: unknown): NotificationSettings | null => {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.recipients)) return null;
  const stored = value.recipients;
  const recipients = Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => {
      const list = stored[kind];
      return [
        kind,
        Array.isArray(list)
          ? parseFormNotifyRecipients(list.filter((e) => typeof e === 'string').join(','))
          : [],
      ];
    }),
  ) as Record<NotificationKind, string[]>;
  return { version: 1, recipients };
};

/** Saved list wins once saved (even empty); before that, FORM_NOTIFY_TO for every kind. */
export const resolveKindRecipients = (
  stored: NotificationSettings | null,
  kind: NotificationKind,
  env: NodeJS.ProcessEnv = process.env,
): string[] =>
  stored ? stored.recipients[kind] : parseFormNotifyRecipients(env.FORM_NOTIFY_TO);

export const buildTestNotificationEmail = (
  kind: NotificationKind,
): { subject: string; text: string; html: string } => {
  const label = NOTIFICATION_KIND_LABELS_VI[kind];
  const line = `Đây là email thử cho mục "${label}". Nếu bạn nhận được, email báo khách mới của mục này sẽ về hộp thư này.`;
  return {
    subject: `[Salanca] Email thử — ${label}`,
    text: `${line}\n`,
    html: `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}</p>`,
  };
};
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/domain/notification-settings`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm run lint && pnpm run typecheck`
Expected: no errors. If lint wants a different import order, fix it as lint says.

- [ ] **Step 6: Commit (after user OK)**

```bash
git add src/domain/notification-settings/notification-settings.ts src/domain/notification-settings/notification-settings.test.ts
git commit -m "feat(notify): per-kind staff notification recipient model"
```

### Task 2: Store + use per-kind recipients in staff notify

**Files:**
- Create: `src/domain/notification-settings/notification-settings.store.ts`
- Modify: `src/domain/form-intake/send-form-lead-notify.ts:62-123` (`sendFormLeadNotify`)
- Create: `src/domain/form-intake/send-form-lead-notify.test.ts`

**Interfaces:**
- Consumes: Task 1 (`normalizeStoredSettings`, `resolveKindRecipients`, `NotificationSettings`).
- Produces:
  - `readNotificationSettings(strapi: Core.Strapi): Promise<NotificationSettings | null>`
  - `writeNotificationSettings(strapi: Core.Strapi, settings: NotificationSettings): Promise<void>`
  - `sendFormLeadNotify` keeps its signature; recipients now come from `resolveKindRecipients(await readNotificationSettings(strapi), payload.kind)`.

- [ ] **Step 1: Write the failing adapter tests**

`src/domain/form-intake/send-form-lead-notify.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendFormLeadNotify } from './send-form-lead-notify';
import { toContactLeadNotifyPayload } from './form-lead-notify';

const payload = toContactLeadNotifyPayload('abc123def456', {
  fullName: 'Jane',
  email: 'guest@example.com',
  message: 'Hello',
  sourceLocale: 'vi',
});

const buildStrapi = (storedValue: unknown, storeGet = vi.fn(async () => storedValue)) => {
  const send = vi.fn(async () => undefined);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    send,
    log,
    storeGet,
    strapi: {
      store: vi.fn(() => ({ get: storeGet, set: vi.fn() })),
      plugin: vi.fn(() => ({
        service: () => ({ send, getProviderSettings: () => ({ provider: 'nodemailer' }) }),
      })),
      log,
    } as never,
  };
};

describe('sendFormLeadNotify recipients', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses FORM_NOTIFY_TO when settings were never saved', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('FORM_NOTIFY_TO', 'ops@salanca.vn');
    const { strapi, send } = buildStrapi(null);
    await sendFormLeadNotify(strapi, payload);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'ops@salanca.vn' }));
  });

  it('uses the saved list for the lead kind', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('FORM_NOTIFY_TO', 'ops@salanca.vn');
    const { strapi, send } = buildStrapi({
      version: 1,
      recipients: {
        'reservation-request': ['booking@salanca.vn'],
        'contact-message': ['hello@salanca.vn', 'owner@salanca.vn'],
      },
    });
    await sendFormLeadNotify(strapi, payload);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'hello@salanca.vn, owner@salanca.vn' }),
    );
  });

  it('sends nothing for a saved empty list', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('FORM_NOTIFY_TO', 'ops@salanca.vn');
    const { strapi, send } = buildStrapi({
      version: 1,
      recipients: { 'reservation-request': ['booking@salanca.vn'], 'contact-message': [] },
    });
    await sendFormLeadNotify(strapi, payload);
    expect(send).not.toHaveBeenCalled();
  });

  it('logs and swallows a store read failure', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const failing = vi.fn(async () => {
      throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' });
    });
    const { strapi, send, log } = buildStrapi(null, failing);
    await expect(sendFormLeadNotify(strapi, payload)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      'form lead notify unexpected failure',
      expect.objectContaining({ kind: 'contact-message', code: 'Error:ECONNREFUSED' }),
    );
  });

  it('does not touch the store when SMTP is off', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', '');
    const { strapi, storeGet } = buildStrapi(null);
    await sendFormLeadNotify(strapi, payload);
    expect(storeGet).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/domain/form-intake/send-form-lead-notify.test.ts`
Expected: FAIL. "uses the saved list for the lead kind" gets `to: 'ops@salanca.vn'` and "sends nothing for a saved empty list" sees a call, because the adapter still reads env only.

- [ ] **Step 3: Implement the store**

`src/domain/notification-settings/notification-settings.store.ts`:

```ts
/**
 * Core-store persistence for staff notification recipients. Kept out of
 * content types so it never reaches the Content API, Content Manager or seed.
 */
import type { Core } from '@strapi/strapi';

import { normalizeStoredSettings, type NotificationSettings } from './notification-settings';

const store = (strapi: Core.Strapi) =>
  strapi.store({ type: 'plugin', name: 'salanca', key: 'notification-settings' });

export const readNotificationSettings = async (
  strapi: Core.Strapi,
): Promise<NotificationSettings | null> => normalizeStoredSettings(await store(strapi).get({}));

export const writeNotificationSettings = async (
  strapi: Core.Strapi,
  settings: NotificationSettings,
): Promise<void> => {
  await store(strapi).set({ value: settings });
};
```

- [ ] **Step 4: Switch the adapter to per-kind recipients**

In `src/domain/form-intake/send-form-lead-notify.ts`:

Replace the import block from `./form-lead-notify` with:

```ts
import {
  formatNotifyErrorCode,
  isFormNotifySmtpConfigured,
  notifyFormLead,
  type FormLeadNotifyPayload,
} from './form-lead-notify';
import { resolveKindRecipients } from '../notification-settings/notification-settings';
import { readNotificationSettings } from '../notification-settings/notification-settings.store';
```

Update the doc comment above `sendFormLeadNotify` to:

```ts
/**
 * Best-effort staff email after public form create.
 * Recipients: the Admin-saved list for the lead's kind, or FORM_NOTIFY_TO
 * until the settings screen is saved once. No-ops without EMAIL_SMTP_HOST.
 * Never throws.
 */
```

Replace these lines:

```ts
    const recipients = resolveFormNotifyRecipientsFromEnv(process.env, log);
    if (recipients.length === 0) {
      return;
    }
```

with:

```ts
    const recipients = resolveKindRecipients(
      await readNotificationSettings(strapi),
      payload.kind,
    );
    if (recipients.length === 0) {
      return;
    }
```

The existing `catch` already logs `form lead notify unexpected failure` with `kind`, `documentId` and `code`, which covers a store read failure. Leave `resolveFormNotifyRecipientsFromEnv` exported in `form-lead-notify.ts`; its own tests still use it.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/domain/form-intake src/domain/notification-settings`
Expected: PASS, including the existing `form-lead-notify.test.ts` and `send-reservation-confirmation.test.ts`.

- [ ] **Step 6: Lint and typecheck**

Run: `pnpm run lint && pnpm run typecheck`
Expected: no errors. If lint flags `log` as only used for `warn` now, keep it: `notifyFormLead` still takes it.

- [ ] **Step 7: Commit (after user OK)**

```bash
git add src/domain/notification-settings/notification-settings.store.ts src/domain/form-intake/send-form-lead-notify.ts src/domain/form-intake/send-form-lead-notify.test.ts
git commit -m "feat(notify): staff notify reads per-kind recipients from Admin settings"
```

### Task 3: Audit action and target type

**Files:**
- Modify: `src/domain/audit/audit-event.types.ts` (`AuditAction`, `AuditTargetType`)
- Modify: `src/api/audit-event/content-types/audit-event/schema.json` (`action.enum`, `targetType.enum`)
- Modify: `src/domain/audit/audit-event-category.ts` (`SECURITY_ACTIONS`)
- Modify: `src/admin/audit-log/audit-log.helper.ts` (action label map near line 127, `TARGET_TYPE_LABELS` near line 146)
- Test: `src/domain/audit/audit-event-category.test.ts`

**Interfaces:**
- Produces: `AuditAction.NotificationSettingsUpdate = 'notification_settings_update'`, `AuditTargetType.Setting = 'setting'`.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/audit/audit-event-category.test.ts`:

```ts
describe('notification settings audit', () => {
  it('files a notification settings change under security', () => {
    expect(resolveAuditEventCategory(AuditAction.NotificationSettingsUpdate, true)).toBe(
      AuditEventCategory.Security,
    );
  });
});
```

If the file does not already import `resolveAuditEventCategory`, `AuditAction` and `AuditEventCategory`, add those imports at the top (from `./audit-event-category` and `./audit-event.types`).

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/domain/audit/audit-event-category.test.ts`
Expected: FAIL, `NotificationSettingsUpdate` is undefined (TypeScript error surfaced by Vitest or `expected 'content' to be 'security'`).

- [ ] **Step 3: Add the enum values**

In `audit-event.types.ts`, add to `AuditAction` (after `WebhookUpdate`):

```ts
  NotificationSettingsUpdate = 'notification_settings_update',
```

and to `AuditTargetType` (after `Webhook`):

```ts
  Setting = 'setting',
```

In `schema.json`, append `"notification_settings_update"` to `attributes.action.enum` and `"setting"` to `attributes.targetType.enum`.

In `audit-event-category.ts`, add `AuditAction.NotificationSettingsUpdate,` to `SECURITY_ACTIONS`.

In `src/admin/audit-log/audit-log.helper.ts`, add to the action label map:

```ts
  [AuditAction.NotificationSettingsUpdate]: 'Cập nhật email thông báo',
```

and to `TARGET_TYPE_LABELS`:

```ts
  [AuditTargetType.Setting]: 'Cài đặt hệ thống',
```

- [ ] **Step 4: Run the audit tests and the schema contract**

Run: `pnpm vitest run src/domain/audit src/admin/audit-log && pnpm run typecheck`
Expected: PASS. `audit-event-schema.contract.test.ts` passes because schema and enums match.

- [ ] **Step 5: Confirm the seed hash is unchanged**

Run: `git diff --stat src/components`
Expected: empty. `audit-event` is not in `allUids`.

- [ ] **Step 6: Commit (after user OK)**

```bash
git add src/domain/audit/audit-event.types.ts src/domain/audit/audit-event-category.ts src/domain/audit/audit-event-category.test.ts src/api/audit-event/content-types/audit-event/schema.json src/admin/audit-log/audit-log.helper.ts
git commit -m "feat(audit): notification settings update action"
```

### Task 4: Admin API — permission, GET / PUT / test routes

**Files:**
- Create: `src/api/notification-settings/notification-settings.types.ts`
- Create: `src/api/notification-settings/notification-settings.controller.ts`
- Create: `src/api/notification-settings/notification-settings.controller.test.ts`
- Create: `src/api/notification-settings/index.ts`
- Modify: `src/index.ts` (register + bootstrap)

**Interfaces:**
- Consumes: Task 1 (`parseNotificationSettingsInput`, `resolveKindRecipients`, `isNotificationKind`, `buildTestNotificationEmail`, `NotificationSettingsError`, `NOTIFICATION_KINDS`), Task 2 (`readNotificationSettings`, `writeNotificationSettings`), Task 3 (`AuditAction.NotificationSettingsUpdate`, `AuditTargetType.Setting`), `resolveIntentionalEmailSend` and `isFormNotifySmtpConfigured`, `formatNotifyErrorCode`, `writeAdminAuditForCurrentRequest`.
- Produces (HTTP, under `/admin`):
  - `GET /notification-settings` → `{ data: { recipients: Record<NotificationKind, string[]>, saved: boolean, smtpConfigured: boolean } }`. When not saved, `recipients` shows the env fallback for every kind.
  - `PUT /notification-settings` body `{ recipients: Record<NotificationKind, string[]> }` → same shape as GET with `saved: true`. 400 with Vietnamese message on invalid input.
  - `POST /notification-settings/test/:kind` → `{ data: { sent: true, recipientCount: number } }`. 400 when the kind is unknown, the saved list is empty, SMTP is off, or the cooldown is active.
  - `ApiNotificationSettingsPermission.Manage = 'admin::notification-settings.manage'`
  - `registerNotificationSettingsPermissions`, `bootstrapNotificationSettingsPermissions`, `registerNotificationSettingsAdminRoutes` (all `(strapi: Core.Strapi)`).

- [ ] **Step 1: Write the types**

`src/api/notification-settings/notification-settings.types.ts`:

```ts
export enum ApiNotificationSettingsPermission {
  Manage = 'admin::notification-settings.manage',
}

export enum ApiNotificationSettingsRoute {
  Settings = '/notification-settings',
  Test = '/notification-settings/test/:kind',
}

/** One test email per kind per process every 30 s. */
export const NOTIFICATION_TEST_COOLDOWN_MS = 30_000;
```

- [ ] **Step 2: Write the failing controller tests**

`src/api/notification-settings/notification-settings.controller.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../domain/audit/admin-audit-request', () => ({
  writeAdminAuditForCurrentRequest: vi.fn(),
}));

import { writeAdminAuditForCurrentRequest } from '../../domain/audit/admin-audit-request';
import { createNotificationSettingsController } from './notification-settings.controller';

const buildContext = (input: { params?: Record<string, unknown>; body?: unknown } = {}) => ({
  params: input.params ?? {},
  request: { body: input.body },
  body: undefined as unknown,
  badRequest: vi.fn(),
  internalServerError: vi.fn(),
});

const buildStrapi = (storedValue: unknown = null) => {
  let value = storedValue;
  const send = vi.fn(async () => undefined);
  const set = vi.fn(async ({ value: next }: { value: unknown }) => {
    value = next;
  });
  return {
    send,
    set,
    strapi: {
      store: vi.fn(() => ({ get: vi.fn(async () => value), set })),
      plugin: vi.fn(() => ({
        service: () => ({ send, getProviderSettings: () => ({ provider: 'nodemailer' }) }),
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as never,
  };
};

const savedValue = {
  version: 1,
  recipients: { 'reservation-request': ['booking@salanca.vn'], 'contact-message': [] },
};

describe('notification settings controller', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.mocked(writeAdminAuditForCurrentRequest).mockClear();
  });

  it('shows the env fallback before the first save', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('FORM_NOTIFY_TO', 'ops@salanca.vn');
    const context = buildContext();
    await createNotificationSettingsController(buildStrapi().strapi).find(context as never);
    expect(context.body).toEqual({
      data: {
        recipients: { 'reservation-request': ['ops@salanca.vn'], 'contact-message': ['ops@salanca.vn'] },
        saved: false,
        smtpConfigured: true,
      },
    });
  });

  it('saves a valid body and writes one audit row', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', '');
    const { strapi, set } = buildStrapi();
    const context = buildContext({
      body: { recipients: { 'reservation-request': ['Booking@Salanca.vn'], 'contact-message': [] } },
    });
    await createNotificationSettingsController(strapi).update(context as never);
    expect(set).toHaveBeenCalledWith({ value: savedValue });
    expect(context.body).toEqual({
      data: { recipients: savedValue.recipients, saved: true, smtpConfigured: false },
    });
    expect(writeAdminAuditForCurrentRequest).toHaveBeenCalledTimes(1);
    expect(writeAdminAuditForCurrentRequest).toHaveBeenCalledWith(
      strapi,
      expect.objectContaining({
        action: 'notification_settings_update',
        targetType: 'setting',
        targetLabel: 'Email thông báo',
      }),
    );
  });

  it('rejects an invalid address without saving', async () => {
    const { strapi, set } = buildStrapi();
    const context = buildContext({
      body: { recipients: { 'reservation-request': ['nope'], 'contact-message': [] } },
    });
    await createNotificationSettingsController(strapi).update(context as never);
    expect(context.badRequest).toHaveBeenCalledWith('Email không hợp lệ: "nope" (Đặt bàn).');
    expect(set).not.toHaveBeenCalled();
    expect(writeAdminAuditForCurrentRequest).not.toHaveBeenCalled();
  });

  it('sends a test email to the saved list', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const { strapi, send } = buildStrapi(savedValue);
    const context = buildContext({ params: { kind: 'reservation-request' } });
    await createNotificationSettingsController(strapi).sendTest(context as never);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'booking@salanca.vn', subject: '[Salanca] Email thử — Đặt bàn' }),
    );
    expect(context.body).toEqual({ data: { sent: true, recipientCount: 1 } });
  });

  it('refuses a test for an empty list, an unknown kind or SMTP off', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const controller = createNotificationSettingsController(buildStrapi(savedValue).strapi);

    const empty = buildContext({ params: { kind: 'contact-message' } });
    await controller.sendTest(empty as never);
    expect(empty.badRequest).toHaveBeenCalledWith(
      'Mục Liên hệ chưa có email nào. Lưu danh sách trước khi gửi thử.',
    );

    const unknown = buildContext({ params: { kind: 'order' } });
    await controller.sendTest(unknown as never);
    expect(unknown.badRequest).toHaveBeenCalledWith('Loại thông báo không hợp lệ.');

    vi.stubEnv('EMAIL_SMTP_HOST', '');
    const off = buildContext({ params: { kind: 'reservation-request' } });
    await controller.sendTest(off as never);
    expect(off.badRequest).toHaveBeenCalledWith(
      'Máy chủ email chưa được cấu hình (EMAIL_SMTP_HOST). Liên hệ kỹ thuật.',
    );
  });

  it('enforces the 30 s cooldown per kind', async () => {
    vi.useFakeTimers();
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const { strapi, send } = buildStrapi(savedValue);
    const controller = createNotificationSettingsController(strapi);

    await controller.sendTest(buildContext({ params: { kind: 'reservation-request' } }) as never);
    const second = buildContext({ params: { kind: 'reservation-request' } });
    await controller.sendTest(second as never);
    expect(second.badRequest).toHaveBeenCalledWith('Vừa gửi thử. Vui lòng đợi 30 giây.');

    vi.advanceTimersByTime(30_000);
    await controller.sendTest(buildContext({ params: { kind: 'reservation-request' } }) as never);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports an SMTP failure without leaking addresses', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    const { strapi, send } = buildStrapi(savedValue);
    send.mockRejectedValueOnce(Object.assign(new Error('535 auth'), { code: 'EAUTH' }));
    const context = buildContext({ params: { kind: 'reservation-request' } });
    await createNotificationSettingsController(strapi).sendTest(context as never);
    expect(context.badRequest).toHaveBeenCalledWith(
      'Gửi thử thất bại (Error:EAUTH). Kiểm tra cấu hình email máy chủ.',
    );
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm vitest run src/api/notification-settings`
Expected: FAIL, `Failed to resolve import "./notification-settings.controller"`.

- [ ] **Step 4: Implement the controller**

`src/api/notification-settings/notification-settings.controller.ts`:

```ts
import type { Core } from '@strapi/strapi';

import { writeAdminAuditForCurrentRequest } from '../../domain/audit/admin-audit-request';
import { AuditAction, AuditTargetType } from '../../domain/audit/audit-event.types';
import {
  formatNotifyErrorCode,
  isFormNotifySmtpConfigured,
} from '../../domain/form-intake/form-lead-notify';
import { resolveIntentionalEmailSend } from '../../domain/form-intake/send-form-lead-notify';
import {
  buildTestNotificationEmail,
  isNotificationKind,
  NOTIFICATION_KIND_LABELS_VI,
  NOTIFICATION_KINDS,
  NotificationSettingsError,
  parseNotificationSettingsInput,
  resolveKindRecipients,
  type NotificationKind,
  type NotificationSettings,
} from '../../domain/notification-settings/notification-settings';
import {
  readNotificationSettings,
  writeNotificationSettings,
} from '../../domain/notification-settings/notification-settings.store';
import { NOTIFICATION_TEST_COOLDOWN_MS } from './notification-settings.types';

interface NotificationSettingsContext {
  params?: { kind?: unknown };
  request?: { body?: unknown };
  body: unknown;
  badRequest: (message: string) => void;
  internalServerError: (message: string) => void;
}

const UNEXPECTED = 'Không thể xử lý cài đặt email lúc này. Vui lòng thử lại sau.';

const view = (stored: NotificationSettings | null) => ({
  recipients: Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => [kind, resolveKindRecipients(stored, kind)]),
  ) as Record<NotificationKind, string[]>,
  saved: stored !== null,
  smtpConfigured: isFormNotifySmtpConfigured(),
});

export const createNotificationSettingsController = (strapi: Core.Strapi) => {
  const lastTestAt = new Map<NotificationKind, number>();

  const fail = (context: NotificationSettingsContext, error: unknown): void => {
    if (error instanceof NotificationSettingsError) {
      context.badRequest(error.vietnameseMessage);
      return;
    }
    strapi.log.error('Notification settings request failed.', {
      code: formatNotifyErrorCode(error),
    });
    context.internalServerError(UNEXPECTED);
  };

  return {
    async find(context: NotificationSettingsContext): Promise<void> {
      try {
        context.body = { data: view(await readNotificationSettings(strapi)) };
      } catch (error) {
        fail(context, error);
      }
    },

    async update(context: NotificationSettingsContext): Promise<void> {
      try {
        const settings = parseNotificationSettingsInput(context.request?.body);
        await writeNotificationSettings(strapi, settings);
        writeAdminAuditForCurrentRequest(strapi, {
          action: AuditAction.NotificationSettingsUpdate,
          eventName: 'notification-settings.update',
          targetLabel: 'Email thông báo',
          targetType: AuditTargetType.Setting,
        });
        context.body = { data: view(settings) };
      } catch (error) {
        fail(context, error);
      }
    },

    async sendTest(context: NotificationSettingsContext): Promise<void> {
      try {
        const kind = context.params?.kind;
        if (!isNotificationKind(kind)) {
          throw new NotificationSettingsError('Loại thông báo không hợp lệ.');
        }
        const send = resolveIntentionalEmailSend(strapi);
        if (!send) {
          throw new NotificationSettingsError(
            'Máy chủ email chưa được cấu hình (EMAIL_SMTP_HOST). Liên hệ kỹ thuật.',
          );
        }
        const recipients = resolveKindRecipients(await readNotificationSettings(strapi), kind);
        if (recipients.length === 0) {
          throw new NotificationSettingsError(
            `Mục ${NOTIFICATION_KIND_LABELS_VI[kind]} chưa có email nào. Lưu danh sách trước khi gửi thử.`,
          );
        }
        const now = Date.now();
        if (now - (lastTestAt.get(kind) ?? -Infinity) < NOTIFICATION_TEST_COOLDOWN_MS) {
          throw new NotificationSettingsError('Vừa gửi thử. Vui lòng đợi 30 giây.');
        }
        lastTestAt.set(kind, now);
        try {
          await send({ to: recipients.join(', '), ...buildTestNotificationEmail(kind) });
        } catch (error) {
          const code = formatNotifyErrorCode(error);
          strapi.log.error('notification test email failed', { kind, code });
          throw new NotificationSettingsError(
            `Gửi thử thất bại (${code}). Kiểm tra cấu hình email máy chủ.`,
          );
        }
        strapi.log.info('notification test email sent', {
          kind,
          recipientCount: recipients.length,
        });
        context.body = { data: { sent: true, recipientCount: recipients.length } };
      } catch (error) {
        fail(context, error);
      }
    },
  };
};
```

Note: "Gửi thử" uses `resolveKindRecipients`, so before the first save it tests the env fallback list. That matches what a real lead would do.

- [ ] **Step 5: Run the controller tests**

Run: `pnpm vitest run src/api/notification-settings`
Expected: PASS.

- [ ] **Step 6: Register action, bootstrap grant and routes**

`src/api/notification-settings/index.ts`:

```ts
import type { Core } from '@strapi/strapi';

import { createNotificationSettingsController } from './notification-settings.controller';
import {
  ApiNotificationSettingsPermission,
  ApiNotificationSettingsRoute,
} from './notification-settings.types';

// Changes where guest personal data is emailed, so it has its own action.
const NOTIFICATION_SETTINGS_ACTIONS = [
  {
    section: 'settings',
    displayName: 'Cài đặt email nhận thông báo (đặt bàn, liên hệ)',
    uid: 'notification-settings.manage',
    pluginName: 'admin',
    category: 'notification settings',
    subCategory: 'manage',
  },
] as const;

type NotificationSettingsRoleService = {
  resetSuperAdminPermissions(): Promise<void>;
};

export const registerNotificationSettingsPermissions = (strapi: Core.Strapi): void => {
  strapi.admin.services.permission.actionProvider.registerMany([
    ...NOTIFICATION_SETTINGS_ACTIONS,
  ]);
};

export const bootstrapNotificationSettingsPermissions = async (
  strapi: Core.Strapi,
): Promise<void> => {
  const roleService = strapi.admin.services.role as unknown as NotificationSettingsRoleService;
  await roleService.resetSuperAdminPermissions();
};

export const registerNotificationSettingsAdminRoutes = (strapi: Core.Strapi): void => {
  const controller = createNotificationSettingsController(strapi);
  const config = {
    policies: ['admin::isAuthenticatedAdmin'],
    auth: { scope: [ApiNotificationSettingsPermission.Manage] },
  };

  strapi.server.api('admin').routes([
    { method: 'GET', path: ApiNotificationSettingsRoute.Settings, handler: controller.find as never, config },
    { method: 'PUT', path: ApiNotificationSettingsRoute.Settings, handler: controller.update as never, config },
    { method: 'POST', path: ApiNotificationSettingsRoute.Test, handler: controller.sendTest as never, config },
  ]);
};
```

In `src/index.ts`, add the import next to the lead-export one:

```ts
import {
  bootstrapNotificationSettingsPermissions,
  registerNotificationSettingsAdminRoutes,
  registerNotificationSettingsPermissions,
} from './api/notification-settings';
```

In `register`, after `registerLeadExportAdminRoutes(strapi);`:

```ts
    registerNotificationSettingsPermissions(strapi);
    registerNotificationSettingsAdminRoutes(strapi);
```

In `bootstrap`, after `await bootstrapLeadExportPermissions(strapi);`:

```ts
    await bootstrapNotificationSettingsPermissions(strapi);
```

- [ ] **Step 7: Gates**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: all pass.

- [ ] **Step 8: Boot check**

Run: `pnpm run develop` (needs local Postgres from `.env`). In Admin → Settings → Roles → Super Admin → Plugins, the "notification settings" section shows "Cài đặt email nhận thông báo (đặt bàn, liên hệ)". Without login, `curl -i http://localhost:1337/admin/notification-settings` returns 401. Stop the server.

- [ ] **Step 9: Commit (after user OK)**

```bash
git add src/api/notification-settings src/index.ts
git commit -m "feat(notify): admin routes to manage and test notification recipients"
```

### Task 5: Admin screen "Email thông báo"

**Files:**
- Create: `src/admin/notification-settings/notification-settings.helper.ts`
- Create: `src/admin/notification-settings/notification-settings.helper.test.ts`
- Create: `src/admin/notification-settings/EmailChipInput.tsx`
- Create: `src/admin/notification-settings/NotificationSettingsScreen.tsx`
- Modify: `src/admin/app.tsx` (imports + one `addMenuLink`)

**Why a custom chip input:** `@strapi/design-system` 2.2.3 has no multi-value creatable field. `MultiSelect` (`withTags`) only picks from fixed options, and `Combobox` (`creatable`) holds one value. The input is built from the design system's own `Tag` (chip with a remove button) and `TextInput`, so it looks native and needs no new dependency.

**Interfaces:**
- Consumes: HTTP routes from Task 4. The admin bundle must not import server code that pulls in `@strapi/strapi` runtime; it imports only the pure module `src/domain/notification-settings/notification-settings.ts` (same as `audit-log.helper.ts` imports `src/domain/audit/*`).
- Produces:
  - `notificationSettingsPermissions = [{ action: 'admin::notification-settings.manage', subject: null }]`
  - `NOTIFICATION_SETTINGS_PATH = '/notification-settings'`
  - `notificationTestPath(kind: NotificationKind): string`
  - `splitRecipientInput(text: string): string[]`
  - `addRecipients(current: readonly string[], raw: string): { list: string[]; invalid: string[] }`
  - `sameRecipients(a: readonly string[], b: readonly string[]): boolean`
  - `EmailChipInput` props: `{ id: string; label: string; hint: string; value: string[]; disabled?: boolean; onChange: (next: string[]) => void }`

- [ ] **Step 1: Write the failing helper tests**

`src/admin/notification-settings/notification-settings.helper.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  addRecipients,
  notificationTestPath,
  sameRecipients,
  splitRecipientInput,
} from './notification-settings.helper';

describe('notification settings helper', () => {
  it('splits typed or pasted text on spaces, new lines, commas and semicolons', () => {
    expect(splitRecipientInput(' a@salanca.vn,\n\nb@salanca.vn ; c@salanca.vn d@salanca.vn')).toEqual([
      'a@salanca.vn',
      'b@salanca.vn',
      'c@salanca.vn',
      'd@salanca.vn',
    ]);
  });

  it('adds valid addresses as lowercase chips and skips duplicates', () => {
    expect(addRecipients(['a@salanca.vn'], 'B@Salanca.vn, a@salanca.vn')).toEqual({
      list: ['a@salanca.vn', 'b@salanca.vn'],
      invalid: [],
    });
  });

  it('keeps invalid entries out of the list and returns them as typed', () => {
    expect(addRecipients([], 'ok@salanca.vn abc x@y')).toEqual({
      list: ['ok@salanca.vn'],
      invalid: ['abc', 'x@y'],
    });
  });

  it('compares lists in order', () => {
    expect(sameRecipients(['a@x.vn'], ['a@x.vn'])).toBe(true);
    expect(sameRecipients(['a@x.vn', 'b@x.vn'], ['b@x.vn', 'a@x.vn'])).toBe(false);
  });

  it('builds the test path per kind', () => {
    expect(notificationTestPath('contact-message')).toBe(
      '/notification-settings/test/contact-message',
    );
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/admin/notification-settings`
Expected: FAIL, `Failed to resolve import "./notification-settings.helper"`.

- [ ] **Step 3: Implement the helper**

`src/admin/notification-settings/notification-settings.helper.ts`:

```ts
import type { NotificationKind } from '../../domain/notification-settings/notification-settings';
import { isValidEmailAddress } from '../../shared/email/email';

export {
  MAX_RECIPIENTS_PER_KIND,
  NOTIFICATION_KIND_LABELS_VI,
  NOTIFICATION_KINDS,
  type NotificationKind,
} from '../../domain/notification-settings/notification-settings';

export const notificationSettingsPermissions = [
  { action: 'admin::notification-settings.manage', subject: null },
];

export const NOTIFICATION_SETTINGS_PATH = '/notification-settings';

export const notificationTestPath = (kind: NotificationKind): string =>
  `${NOTIFICATION_SETTINGS_PATH}/test/${kind}`;

export const splitRecipientInput = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

/**
 * Turns typed or pasted text into chips. Same rule as the server
 * (isValidEmailAddress); the server still re-validates on save.
 */
export const addRecipients = (
  current: readonly string[],
  raw: string,
): { list: string[]; invalid: string[] } => {
  const list = [...current];
  const invalid: string[] = [];
  for (const entry of splitRecipientInput(raw)) {
    const address = entry.toLowerCase();
    if (!isValidEmailAddress(address)) {
      invalid.push(entry);
    } else if (!list.includes(address)) {
      list.push(address);
    }
  }
  return { list, invalid };
};

export const sameRecipients = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export type NotificationSettingsView = {
  recipients: Record<NotificationKind, string[]>;
  saved: boolean;
  smtpConfigured: boolean;
};
```

If `src/domain/notification-settings/notification-settings.ts` importing `../form-intake/form-lead-notify` breaks the admin build (it should not: that module is pure TS), move `parseFormNotifyRecipients` usage behind a local copy only if `pnpm run build` fails, and record that in the completion notes.

- [ ] **Step 4: Run the helper tests**

Run: `pnpm vitest run src/admin/notification-settings`
Expected: PASS.

- [ ] **Step 5: Implement the chip input**

`src/admin/notification-settings/EmailChipInput.tsx`:

Behavior: type an address, then press Enter, comma, semicolon, space or Tab (or leave the field) to turn it into a chip. Pasting a list makes one chip per address. Backspace on an empty field removes the last chip. Clicking a chip's ✕ removes it. Invalid text stays in the field with a red error naming it. At 10 chips the field is disabled.

```tsx
import { useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';

import { Field, Flex, Tag, TextInput } from '@strapi/design-system';
import { Cross } from '@strapi/icons';

import { addRecipients, MAX_RECIPIENTS_PER_KIND } from './notification-settings.helper';

type EmailChipInputProps = {
  id: string;
  label: string;
  hint: string;
  value: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
};

const COMMIT_KEYS = new Set(['Enter', ',', ';', ' ']);

export const EmailChipInput = ({ id, label, hint, value, disabled, onChange }: EmailChipInputProps) => {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();
  const full = value.length >= MAX_RECIPIENTS_PER_KIND;

  const commit = (raw: string): void => {
    if (!raw.trim()) return;
    const { list, invalid } = addRecipients(value, raw);
    const kept = list.slice(0, MAX_RECIPIENTS_PER_KIND);
    onChange(kept);
    setDraft(invalid.join(' '));
    setError(
      invalid.length > 0
        ? `Email không hợp lệ: ${invalid.join(', ')}`
        : list.length > kept.length
          ? `Tối đa ${MAX_RECIPIENTS_PER_KIND} email.`
          : undefined,
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (COMMIT_KEYS.has(event.key) || (event.key === 'Tab' && draft.trim() !== '')) {
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    commit(`${draft} ${event.clipboardData.getData('text')}`);
  };

  return (
    <Field.Root error={error} hint={hint} id={id} name={id}>
      <Field.Label>{label}</Field.Label>
      {value.length > 0 ? (
        <Flex gap={2} paddingBottom={2} wrap="wrap">
          {value.map((address) => (
            <Tag
              disabled={disabled}
              icon={<Cross aria-hidden />}
              key={address}
              label={`Xoá ${address}`}
              onClick={() => onChange(value.filter((entry) => entry !== address))}
            >
              {address}
            </Tag>
          ))}
        </Flex>
      ) : null}
      <TextInput
        disabled={disabled || full}
        onBlur={() => commit(draft)}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setDraft(event.target.value);
          setError(undefined);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={full ? `Đã đủ ${MAX_RECIPIENTS_PER_KIND} email` : 'Nhập email rồi bấm Enter'}
        value={draft}
      />
      <Field.Error />
      <Field.Hint />
    </Field.Root>
  );
};
```

- [ ] **Step 6: Implement the screen**

`src/admin/notification-settings/NotificationSettingsScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';

import { Alert, Box, Button, Flex, Typography } from '@strapi/design-system';
import { Check, PaperPlane } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import { EmailChipInput } from './EmailChipInput';
import {
  MAX_RECIPIENTS_PER_KIND,
  NOTIFICATION_KIND_LABELS_VI,
  NOTIFICATION_KINDS,
  NOTIFICATION_SETTINGS_PATH,
  notificationSettingsPermissions,
  notificationTestPath,
  sameRecipients,
  type NotificationKind,
  type NotificationSettingsView,
} from './notification-settings.helper';

const LOAD_FAILED = 'Không tải được cài đặt email. Vui lòng thử lại.';
const SAVE_FAILED = 'Không lưu được. Vui lòng thử lại.';

const readError = (error: unknown, fallback: string): string =>
  (error as { response?: { data?: { error?: { message?: string } } } } | null)?.response?.data
    ?.error?.message ?? fallback;

const emptyDrafts = (): Record<NotificationKind, string[]> =>
  Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, []])) as Record<
    NotificationKind,
    string[]
  >;

const NotificationSettingsScreen = () => {
  const { get, put, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [view, setView] = useState<NotificationSettingsView | null>(null);
  const [drafts, setDrafts] = useState(emptyDrafts);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<NotificationKind | null>(null);

  const apply = (next: NotificationSettingsView): void => {
    setView(next);
    setDrafts({ ...next.recipients });
  };

  useEffect(() => {
    get<{ data: NotificationSettingsView }>(NOTIFICATION_SETTINGS_PATH)
      .then((response) => apply(response.data.data))
      .catch(() => toggleNotification({ type: 'danger', message: LOAD_FAILED }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty =
    view !== null &&
    NOTIFICATION_KINDS.some((kind) => !sameRecipients(drafts[kind], view.recipients[kind]));

  const onSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const response = await put<{ data: NotificationSettingsView }>(NOTIFICATION_SETTINGS_PATH, {
        recipients: drafts,
      });
      apply(response.data.data);
      toggleNotification({ type: 'success', message: 'Đã lưu email thông báo.' });
    } catch (error: unknown) {
      toggleNotification({ type: 'danger', message: readError(error, SAVE_FAILED) });
    } finally {
      setSaving(false);
    }
  };

  const onTest = async (kind: NotificationKind): Promise<void> => {
    setTesting(kind);
    try {
      const response = await post<{ data: { recipientCount: number } }>(
        notificationTestPath(kind),
      );
      toggleNotification({
        type: 'success',
        message: `Đã gửi email thử tới ${response.data.data.recipientCount} địa chỉ. Kiểm tra hộp thư (cả mục Spam).`,
      });
    } catch (error: unknown) {
      toggleNotification({ type: 'danger', message: readError(error, 'Gửi thử thất bại.') });
    } finally {
      setTesting(null);
    }
  };

  return (
    <Page.Protect permissions={notificationSettingsPermissions}>
      <Page.Title>Email thông báo</Page.Title>
      <Page.Main>
        <Layouts.Header
          primaryAction={
            <Button
              disabled={!dirty}
              loading={saving}
              onClick={() => void onSave()}
              startIcon={<Check />}
            >
              Lưu
            </Button>
          }
          subtitle="Email nhận thông báo khi khách gửi form trên website."
          title="Email thông báo"
        />
        <Layouts.Content>
          <Flex alignItems="stretch" direction="column" gap={4}>
            {view && !view.smtpConfigured ? (
              <Alert closeLabel="Đóng" title="Chưa gửi được email" variant="danger">
                Máy chủ chưa cấu hình gửi email (EMAIL_SMTP_HOST). Danh sách vẫn lưu được nhưng chưa
                có email nào được gửi. Liên hệ kỹ thuật.
              </Alert>
            ) : null}
            {view && !view.saved ? (
              <Alert closeLabel="Đóng" title="Đang dùng giá trị mặc định" variant="default">
                Danh sách dưới đây lấy từ cấu hình máy chủ. Bấm Lưu một lần để quản lý tại đây.
              </Alert>
            ) : null}
            {NOTIFICATION_KINDS.map((kind) => (
              <Box
                background="neutral0"
                hasRadius
                key={kind}
                padding={6}
                shadow="tableShadow"
              >
                <EmailChipInput
                  disabled={view === null}
                  hint={`Tối đa ${MAX_RECIPIENTS_PER_KIND} email. Không có email nào thì mục này không gửi thông báo.`}
                  id={`recipients-${kind}`}
                  label={NOTIFICATION_KIND_LABELS_VI[kind]}
                  onChange={(next) => setDrafts((current) => ({ ...current, [kind]: next }))}
                  value={drafts[kind]}
                />
                <Flex justifyContent="space-between" paddingTop={3}>
                  <Typography textColor="neutral600" variant="pi">
                    {dirty ? 'Lưu trước khi gửi thử — email thử đi tới danh sách đã lưu.' : ''}
                  </Typography>
                  <Button
                    disabled={view === null || dirty}
                    loading={testing === kind}
                    onClick={() => void onTest(kind)}
                    startIcon={<PaperPlane />}
                    variant="secondary"
                  >
                    Gửi thử
                  </Button>
                </Flex>
              </Box>
            ))}
          </Flex>
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default NotificationSettingsScreen;
```

- [ ] **Step 7: Add the menu link**

In `src/admin/app.tsx`:
- Change the icons import to `import { Bell, Calendar, Clock, Cog, Download, Mail } from '@strapi/icons';`
- Add `import { notificationSettingsPermissions } from './notification-settings/notification-settings.helper';` next to the `leadExportPermissions` import.
- After the lead-export `addMenuLink` block, add:

```tsx
    app.addMenuLink({
      to: '/plugins/notification-settings',
      icon: Cog,
      intlLabel: { id: 'notification-settings.title', defaultMessage: 'Email thông báo' },
      Component: () => import('./notification-settings/NotificationSettingsScreen'),
      permissions: notificationSettingsPermissions,
      position: 0.5,
    });
```

- [ ] **Step 8: Gates**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build`
Expected: all pass; `strapi build` finishes the admin bundle without errors.

- [ ] **Step 9: Manual check in the browser**

Run `pnpm run develop` with a local Mailpit (`EMAIL_SMTP_HOST=localhost`, `EMAIL_SMTP_PORT=1025`, `FORM_NOTIFY_TO=ops@salanca.local`). As Super Admin:
1. "Email thông báo" is in the left menu. The screen shows an `ops@salanca.local` chip in both fields and the "Đang dùng giá trị mặc định" notice.
2. Remove the `ops@` chips, type `booking@salanca.local` + Enter under Đặt bàn, paste `hello@salanca.local, owner@salanca.local` under Liên hệ (two chips appear), then Lưu. The notice disappears.
3. "Gửi thử" under Đặt bàn sends one mail to `booking@salanca.local` in Mailpit. A second click within 30 s shows "Vừa gửi thử. Vui lòng đợi 30 giây."
4. Typing `abc` + Enter keeps `abc` in the field with "Email không hợp lệ: abc" and adds no chip. Backspace on an empty field removes the last chip.
5. Submit a reservation on the web (or `pnpm run smoke:reservation-form`): staff mail goes to `booking@salanca.local` only. A contact form goes to `hello@salanca.local` and `owner@salanca.local` only.
6. Nhật ký hoạt động shows one "Cập nhật email thông báo" row per save.

- [ ] **Step 10: Commit (after user OK)**

```bash
git add src/admin/notification-settings src/admin/app.tsx
git commit -m "feat(admin): Email thông báo screen with per-kind recipients and test send"
```

### Task 6: Documentation

**Files:**
- Modify: `docs/resend-email-operations.md`
- Modify: `docs/admin-roles.md`
- Modify: `docs/cms-editor-guide.md`
- Modify: `docs/STATUS.md`
- Modify: `.env.example` (comment near `FORM_NOTIFY_TO`)
- Modify: `AGENTS.md` (form-leads line mentions `FORM_NOTIFY_TO`)

- [ ] **Step 1: `resend-email-operations.md`**

Replace the "Opt-in" table with:

```md
| Condition | Behaviour |
| --- | --- |
| `EMAIL_SMTP_HOST` unset | Email plugin not configured; forms work; no mail. The Admin screen shows a red notice. |
| Host set, Admin settings never saved | Every kind notifies `FORM_NOTIFY_TO` (empty = no notify). |
| Host set, Admin settings saved | Each kind notifies its own list from **Email thông báo**. An empty list turns that kind off. `FORM_NOTIFY_TO` is ignored. |
```

Add a section after "Guest reservation receipt":

```md
## Staff recipients in Admin

Admin → **Email thông báo** (permission `admin::notification-settings.manage`) holds one list per
form kind: Đặt bàn (`reservation-request`) and Liên hệ (`contact-message`, newsletter included).
Max 10 addresses per kind. Stored in Strapi's core store (`plugin_salanca_notification-settings`),
not in content, so it is per environment and not part of the content release.

"Gửi thử" sends a sample to the **saved** list of that kind, at most once per 30 s. Each save
writes one `notification_settings_update` audit row (no addresses in the row).
```

Add to the code map table:

```md
| Recipient settings (pure) | `src/domain/notification-settings/notification-settings.ts` |
| Recipient settings store | `src/domain/notification-settings/notification-settings.store.ts` |
| Admin routes | `src/api/notification-settings/` |
| Admin screen | `src/admin/notification-settings/` |
```

Change the ownership row `` `FORM_NOTIFY_TO` mailbox `` to `Staff notification mailboxes (Admin → Email thông báo)`.

- [ ] **Step 2: `admin-roles.md`**

Add after "Lead export permission":

```md
## Notification settings permission (2026-10-09)

The `Email thông báo` menu link and `/admin/notification-settings*` routes are gated by one
action under **Settings → Roles → Plugins → Notification settings**:

| Action | Unlocks |
| --- | --- |
| `admin::notification-settings.manage` ("Cài đặt email nhận thông báo (đặt bàn, liên hệ)") | Menu link, screen, save and "Gửi thử" |

Bootstrap grants it to Super Admin. Owner decision (2026-10-09): managers may edit too. Strapi
Community has no Manager role, so create it once: Settings → Roles → "Add new role" → name
`Quản lý`, copy the Editor permissions you want, tick this action, save, then assign it to the
manager's account.
```

Add to the UAT checklist:

```md
- [ ] A role without `notification-settings.manage` does not see `Email thông báo` and gets 403 on `/admin/notification-settings`.
- [ ] The `Quản lý` role with the action can save recipients and send a test.
```

- [ ] **Step 3: `cms-editor-guide.md`**

Add a short section (Vietnamese, editor-facing):

```md
## Email thông báo

Menu **Email thông báo**: nhập email nhận báo khi khách đặt bàn hoặc gửi liên hệ, mỗi dòng một
email (tối đa 10). Để trống một mục = không gửi email cho mục đó. Bấm **Lưu**, rồi **Gửi thử** để
kiểm tra hộp thư (xem cả Spam). Chỉ Super Admin và vai trò Quản lý thấy mục này.
```

- [ ] **Step 4: `.env.example`, `AGENTS.md`, `STATUS.md`**

In `.env.example`, above the `FORM_NOTIFY_TO` line, add:

```env
# FORM_NOTIFY_TO is only the default until Admin → "Email thông báo" is saved once.
```

In `AGENTS.md`, in the "Form leads in scope" bullet, change `Optional Resend SMTP staff notify via EMAIL_SMTP_HOST + FORM_NOTIFY_TO` to `Optional Resend SMTP staff notify via EMAIL_SMTP_HOST; recipients per kind in Admin → Email thông báo (FORM_NOTIFY_TO until first save)`.

In `docs/STATUS.md`, add a line under the current lead/notify state: "Staff notification recipients are managed per kind in Admin (Email thông báo) — automated verification passed; ready for manual UAT" (only after Tasks 1–5 gates pass).

- [ ] **Step 5: Check**

Run: `git diff --check`
Expected: no output.

- [ ] **Step 6: Commit (after user OK)**

```bash
git add docs/resend-email-operations.md docs/admin-roles.md docs/cms-editor-guide.md docs/STATUS.md .env.example AGENTS.md docs/plans/notification-email-settings.md
git commit -m "docs(notify): Admin-managed staff notification recipients"
```

## Data and rollback

- Migration/backfill: none. The store row is created on the first save. Nothing reads it before then except the fallback path.
- Compatibility: environments that never open the screen behave exactly as today (`FORM_NOTIFY_TO`). The audit schema gains two enum values (`varchar` in Postgres, no DDL constraint change). Seed `schemaHash` unchanged.
- Rollback: revert the commits. The leftover `strapi_core_store_settings` row with key `plugin_salanca_notification-settings` is harmless; delete it by hand if wanted. Audit rows with the new action stay readable as raw values.

## Verification

- Automated: `pnpm run lint`, `pnpm run verify:schema`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`.
- Manual UAT: Task 5 Step 8 list, plus the two new `admin-roles.md` checklist items with a non-Super-Admin account.
- Evidence to record: `docs/STATUS.md` line and the completion record below.

## Risks and blockers

- Owner must create the `Quản lý` role once in each environment (staging, production). Trigger: before handing the screen to a manager.
- A saved empty list silently turns a kind off. Mitigation: the field hint says so; the audit row shows who saved.
- The 30 s cooldown is per process. With several Strapi instances a user could send a few more test mails. Acceptable for an authenticated, permission-gated button.
- Recipients must be real mailboxes; Resend counts bounces against the sender domain. "Gửi thử" surfaces wrong addresses early.

## Completion record

Implemented 2026-10-09 (Tasks 1–6, commits deferred per project rule):

- Domain module `src/domain/notification-settings/` (kinds, validation, resolution, test email)
  plus the core-store persistence wrapper.
- `sendFormLeadNotify` reads the per-kind Admin-saved list with `FORM_NOTIFY_TO` fallback.
- Audit action `notification_settings_update` (target type `setting`, Security category) in
  enums, schema, SECURITY_ACTIONS and Admin labels; `types/generated/` regenerated via
  `strapi ts:generate-types`.
- Permission-gated admin routes: `GET`/`PUT /notification-settings`,
  `POST /notification-settings/test/:kind` (30 s per-kind cooldown); RBAC action
  `admin::notification-settings.manage` registered, granted to Super Admin at bootstrap.
- Admin screen `Email thông báo` (chip input per kind, save, "Gửi thử") + menu link.
- Docs: `resend-email-operations.md`, `admin-roles.md`, `cms-editor-guide.md`, `STATUS.md`,
  `.env.example`, `AGENTS.md`.

Automated verification run (all green):

- `pnpm vitest run` per TDD step: notification-settings 12 tests, send-form-lead-notify 5 tests,
  audit 10 files/60 tests, controller 7 tests, admin helper 5 tests.
- `pnpm run lint` — pass.
- `pnpm run typecheck` — pass (after `strapi ts:generate-types` regenerated the audit-event
  enums into `types/generated/contentTypes.d.ts`).
- `pnpm run test` — 109 files / 649 tests pass.
- `pnpm run verify:schema` — pass.
- `pnpm run build` — pass (admin bundle built cleanly; the line-1241 fallback was not needed).
- `git diff --stat src/components` — empty; `git diff --check` — clean.

Deviations from this plan: `send-form-lead-notify.ts` top doc comment reworded (was stale after
per-kind resolution); the plan's `eslint-disable react-hooks/exhaustive-deps` comment removed
(rule not installed in this repo's ESLint config); `NotificationSettingsUpdate` placed
alphabetically in `SECURITY_ACTIONS`; `types/generated/contentTypes.d.ts` regenerated (required
by typecheck).

Task 4 Step 8 boot check (2026-10-09, local Postgres): `pnpm run develop` started cleanly;
`GET`/`PUT /notification-settings` and `POST /notification-settings/test/contact-message` all
return 401 without login; `admin_permissions` holds `admin::notification-settings.manage` linked
to Super Admin; no `plugin_salanca_notification-settings` store row yet (never saved). Note:
`strapi.server.api('admin')` mounts at the root, so the live paths are `/notification-settings*`
(the `/admin/...` prefix in docs follows the existing lead-export/audit-log wording). The Roles
screen visual check was not done (no admin credentials in this session).

Open manual gates (not yet run):

- Task 4 Step 8 remainder: Settings → Roles → Super Admin → Plugins shows "Cài đặt email nhận
  thông báo (đặt bàn, liên hệ)".
- Task 5 Step 9: browser UAT with Mailpit (list, save, "Gửi thử", cooldown, lead notify routing,
  audit row). Blocked locally on 2026-10-09: Docker Desktop not running, no Mailpit binary, and
  `EMAIL_SMTP_HOST` unset in `.env`.
- `admin-roles.md` checklist: 403 for a role without `notification-settings.manage`; `Quản lý`
  role save + test.

Review fixes (2026-10-09, after code review):

- Lưu is always enabled before the first save, so the env default can be taken over unchanged.
- Text typed in a chip field without Enter is turned into chips on Lưu; bad entries block the
  save and are shown on the field. Typed text also enables Lưu.
- An env fallback longer than 10 addresses shows a warning and keeps the first 10.
- "Gửi thử" is off until the list is saved; a failed send no longer starts the 30 s wait.
- `FORM_NOTIFY_TO` fallback also covers a kind added after the last save and a failed settings
  read (warn log). The "FORM_NOTIFY_TO has no valid address" warning is back.
  `resolveFormNotifyRecipientsFromEnv` removed (no callers).
- Gates: lint, typecheck, verify:schema, test (109 files, 658 tests), build — all pass.
- Still open: browser check with Mailpit (Task 5 Step 9), role UAT in `admin-roles.md`.
