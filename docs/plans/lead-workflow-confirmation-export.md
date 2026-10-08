# Lead workflow, guest confirmation email, CSV export, hours and drinks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: Parts A–C automated verification passed; ready for manual UAT. Part D waits for owner data
Owner: tan_ngo (developer); restaurant owner for data in Part D
Last updated: 2026-10-08
Related: [`reservation-inbox-realtime.md`](reservation-inbox-realtime.md), [`admin-audit-log.md`](admin-audit-log.md), [`../resend-email-operations.md`](../resend-email-operations.md)

**Goal:** Staff can work a reservation from first call to visit (confirm, cancel, no-show, internal note). Guests who leave an email get a receipt. The owner can download leads as CSV for Excel. Opening hours and a drinks tab go live as soon as the owner sends the data.

**Architecture:** Parts A–C are backend + Admin only (`salanca-backend`). Lead statuses move to one shared module (`src/shared/lead-status`) used by the API, Admin screens and CSV export. The guest email reuses the existing opt-in SMTP path (`send-form-lead-notify.ts`). CSV export is a new permission-gated admin route that reuses the audit log's CSV escaping, moved to `src/shared/csv`. Part D is mostly data: opening hours are already fully wired (CMS field `global-setting.openingHours`, footer, contact page, `openingHoursSpecification` JSON-LD). Drinks need one route entry in `salanca-web`.

**Tech Stack:** Strapi 5.51.1 (TypeScript), Strapi Admin (React, `@strapi/design-system`), Vitest, PostgreSQL; Next.js 16 for Part D.

## Global Constraints

- Admin copy is Vietnamese. Guest-facing copy exists in both `vi` and `en`, picked from the lead's `sourceLocale`.
- The public `POST /api/v1/reservation-requests` 201 contract must not change. Email work runs off the response path and never throws into it.
- The live inbox contract (`summary`, `stream`, `unreadCount` = status `new`) must not change.
- Every new admin route uses `policies: ['admin::isAuthenticatedAdmin']` and an explicit `auth.scope`.
- Lead personal data never reaches logs. Log only `documentId`, `kind` and error codes.
- No new npm dependencies.
- Commit only after the user says so (project rule). Steps below mark where a commit goes.
- Gates per task: `pnpm run lint`, `pnpm run typecheck` and `pnpm run test` must stay green, except the pre-existing failure in `content-manager-labels.vi.test.ts` ("covers every field in Salanca API schemas"). Task 1 adds the label it needs for `staffNote`. Do not count that old failure as new.

## Non-goals

- No booking engine, slot capacity or table assignment.
- No second email when staff confirm a request. Staff confirm by phone. This can be added later on the `confirmed` transition.
- Contact messages keep `new / read / archived`. Only reservations get the new statuses.
- No Excel `.xlsx` output. A UTF-8 BOM CSV opens correctly in Excel.
- No drinks content is invented. Part D waits for owner data.

## Current evidence

- `reservation-request.leadStatus` enum is `['new','read','archived']` (`src/api/reservation-request/content-types/reservation-request/schema.json`). `RESERVATION_STATUSES` is duplicated in `src/api/reservation-inbox/reservation-inbox.types.ts:26` and `src/admin/reservation-inbox/reservation-inbox.types.ts:11`.
- Admin status labels: `src/admin/translations/content-enum-options.ts` (CM forms), `src/admin/reservation-inbox/vi.ts` (inbox), `src/admin/dashboard-widgets/dashboard-widgets.helper.ts:122` (`leadStatusLabel`).
- The schema check asserts the enum (`scripts/verify-content-model.mjs:251`).
- Staff email: `src/domain/form-intake/form-lead-notify.ts` (pure builders) and `send-form-lead-notify.ts` (Strapi adapter, opt-in on `EMAIL_SMTP_HOST`). `EMAIL_REPLY_TO` is already required when SMTP is on, so guest replies reach the booking inbox.
- CSV: `src/api/audit-log/audit-log.export.ts` (`escapeCsvCell`, BOM, CRLF) and the admin blob download in `src/admin/audit-log/useAuditLogScreen.ts:186`.
- Newsletter sign-ups are `contact-message` rows with `topic = "newsletter"` (`salanca-web/src/components/newsletter/newsletter-action.ts`).
- The seed `schemaHash` covers marketing types plus **all components** (`scripts/lib/content-release.helper.mjs:14`, `content-release.mjs:38`). `reservation-request` is not in `allUids`, so Part A changes no hash **as long as no component is added or changed**. This plan adds none.
- Opening hours: `global-setting.openingHours` is a repeatable `shared.operating-period` (label localized; `opensAt`/`closesAt` times). The web reads it in `salanca-web/src/lib/cms/global-setting.ts:391` and emits JSON-LD in `src/lib/seo/structured-data.ts:125`.
- Drinks: any active `menu-category` with items already renders as a menu tab (`salanca-web/src/components/menu/menu-page.tsx:36`). Its tab link falls back to `/menu/category/<slug>` unless the slug is listed in `SECTIONS` (`src/lib/catalog/menu-section-paths.ts:23`).

## Decisions and assumptions

- Decision: the reservation statuses are `new, read, confirmed, cancelled, no_show, archived`, in that order. Existing rows keep their value; `NULL` still counts as `new`.
- Decision: chip tones are new = Info, read = Neutral, confirmed = Published (green), cancelled and no_show = Warning, archived = Neutral. Dashboard lead chips use the same mapping.
- Decision: `staffNote` is a `text` attribute with `maxLength 2000` and `private: true`, so it never leaves through the content API.
- Decision (owner, 2026-10-08): the guest email is always on whenever SMTP is configured; there is no separate flag. It says that the request was **received, not confirmed**. (Supersedes the original opt-in `RESERVATION_CONFIRM_EMAIL_ENABLED` design in Task 6 below.)
- Decision: CSV export gets its own RBAC action `admin::lead-export.export`, because it is a bulk personal-data download. Each export is capped at 10,000 rows.
- Assumption: anyone can type someone else's email in the form, so the receipt could reach a stranger. Turnstile plus the per-IP rate limit bound the volume. The email contains no link and no marketing copy. Verify during UAT that the owner accepts this.
- Owner decision required (Part D): opening hours per period (VI/EN label) and the drinks list with prices.

---

## Part A — Reservation workflow

### Task 1: Shared lead statuses, schema enum and the `staffNote` field

**Files:**
- Create: `src/shared/lead-status/lead-status.ts`
- Create: `src/shared/lead-status/lead-status.test.ts`
- Modify: `src/api/reservation-request/content-types/reservation-request/schema.json`
- Modify: `src/api/reservation-inbox/reservation-inbox.types.ts:26-27`
- Modify: `src/admin/reservation-inbox/reservation-inbox.types.ts:11-12`
- Modify: `src/admin/translations/content-enum-options.ts:18-21`
- Modify: `src/bootstrap/content-manager-labels/content-manager-labels.vi.ts` (field label map, alphabetical, near `socialImages`)
- Modify: `scripts/verify-content-model.mjs:251-255`

**Interfaces:**
- Produces: `RESERVATION_LEAD_STATUSES`, `ReservationLeadStatus`, `CONTACT_LEAD_STATUSES`, `ContactLeadStatus`, `LEAD_STATUS_LABELS_VI: Record<ReservationLeadStatus, string>`, `RESERVATION_STAFF_NOTE_MAX_LENGTH = 2000`. Both `reservation-inbox.types.ts` files re-export `RESERVATION_STATUSES` and `ReservationStatus` as aliases, so existing imports keep working.

- [ ] **Step 1: Write the failing test**

`src/shared/lead-status/lead-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  CONTACT_LEAD_STATUSES,
  LEAD_STATUS_LABELS_VI,
  RESERVATION_LEAD_STATUSES,
} from './lead-status';

describe('lead statuses', () => {
  it('lists reservation statuses in workflow order', () => {
    expect(RESERVATION_LEAD_STATUSES).toEqual([
      'new',
      'read',
      'confirmed',
      'cancelled',
      'no_show',
      'archived',
    ]);
  });

  it('keeps contact messages on the original three statuses', () => {
    expect(CONTACT_LEAD_STATUSES).toEqual(['new', 'read', 'archived']);
  });

  it('labels every reservation status in Vietnamese', () => {
    expect(LEAD_STATUS_LABELS_VI).toEqual({
      new: 'Mới',
      read: 'Đã đọc',
      confirmed: 'Đã xác nhận',
      cancelled: 'Đã huỷ',
      no_show: 'Khách không đến',
      archived: 'Lưu trữ',
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/shared/lead-status/lead-status.test.ts`
Expected: FAIL, `Failed to resolve import "./lead-status"`.

- [ ] **Step 3: Implement the module**

`src/shared/lead-status/lead-status.ts`:

```ts
/**
 * Lead workflow statuses, shared by the inbox API, Admin screens and CSV
 * export. Reservations have the full call-back workflow; contact messages
 * (and newsletter sign-ups, which ride on them) keep the original three.
 */
export const RESERVATION_LEAD_STATUSES = [
  'new',
  'read',
  'confirmed',
  'cancelled',
  'no_show',
  'archived',
] as const;
export type ReservationLeadStatus = (typeof RESERVATION_LEAD_STATUSES)[number];

export const CONTACT_LEAD_STATUSES = ['new', 'read', 'archived'] as const;
export type ContactLeadStatus = (typeof CONTACT_LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS_VI: Record<ReservationLeadStatus, string> = {
  new: 'Mới',
  read: 'Đã đọc',
  confirmed: 'Đã xác nhận',
  cancelled: 'Đã huỷ',
  no_show: 'Khách không đến',
  archived: 'Lưu trữ',
};

export const RESERVATION_STAFF_NOTE_MAX_LENGTH = 2000;
```

- [ ] **Step 4: Re-export it from both inbox type files**

In `src/api/reservation-inbox/reservation-inbox.types.ts`, replace lines 26–27 with:

```ts
export {
  RESERVATION_LEAD_STATUSES as RESERVATION_STATUSES,
  type ReservationLeadStatus as ReservationStatus,
} from '../../shared/lead-status/lead-status';
import type { ReservationLeadStatus as ReservationStatus } from '../../shared/lead-status/lead-status';
```

In `src/admin/reservation-inbox/reservation-inbox.types.ts`, replace lines 11–12 with the same block. In both files, the `import type` line makes `ReservationStatus` usable inside the file; move it up with the other imports so lint's import order passes.

- [ ] **Step 5: Update the schema**

In `schema.json`, set `leadStatus.enum` to:

```json
"enum": ["new", "read", "confirmed", "cancelled", "no_show", "archived"],
```

Add this after `overlapCount`:

```json
    "staffNote": {
      "type": "text",
      "maxLength": 2000,
      "private": true
    }
```

- [ ] **Step 6: Update labels and the schema check**

In `content-enum-options.ts`, replace the leadStatus block with:

```ts
  // reservation-request / contact-message .leadStatus
  ...LEAD_STATUS_LABELS_VI,
```

Add `import { LEAD_STATUS_LABELS_VI } from '../../shared/lead-status/lead-status';` at the top of that file.

In `content-manager-labels.vi.ts`, add this entry to the field label map:

```ts
  staffNote: 'Ghi chú nội bộ của nhân viên',
```

In `verify-content-model.mjs`, replace the reservation enum assertion (lines 251–254) with:

```js
assert(
  JSON.stringify(reservationRequest?.leadStatus?.enum) ===
    JSON.stringify(['new', 'read', 'confirmed', 'cancelled', 'no_show', 'archived']),
  'reservation-request.leadStatus enum is invalid',
);
assert(reservationRequest?.staffNote?.private === true, 'reservation-request.staffNote must be private');
```

- [ ] **Step 7: Run the gates**

Run: `pnpm vitest run src/shared/lead-status && pnpm run verify:schema && pnpm run typecheck`
Expected: all pass. `verify:schema` prints no assertion error.

- [ ] **Step 8: Confirm the seed hash is unchanged**

Run: `git diff --stat src/components`
Expected: empty output. Components are part of `schemaHash`; `reservation-request` is not. If this shows changes, stop and recompute the hash (see memory "seed is the deploy path").

- [ ] **Step 9: Commit (after user OK)**

```bash
git add src/shared/lead-status src/api/reservation-request src/api/reservation-inbox/reservation-inbox.types.ts src/admin/reservation-inbox/reservation-inbox.types.ts src/admin/translations/content-enum-options.ts src/bootstrap/content-manager-labels/content-manager-labels.vi.ts scripts/verify-content-model.mjs
git commit -m "feat(leads): reservation confirmed/cancelled/no-show statuses and staff note field"
```

### Task 2: Inbox API — status counts, note in detail, note update route

**Files:**
- Modify: `src/api/reservation-inbox/reservation-inbox.service.ts`
- Modify: `src/api/reservation-inbox/reservation-inbox.controller.ts`
- Modify: `src/api/reservation-inbox/reservation-inbox.types.ts`
- Modify: `src/api/reservation-inbox/index.ts`
- Test: `src/api/reservation-inbox/reservation-inbox.service.test.ts`, `src/api/reservation-inbox/reservation-inbox.controller.test.ts`

**Interfaces:**
- Consumes: `RESERVATION_STATUSES`, `ReservationStatus`, `RESERVATION_STAFF_NOTE_MAX_LENGTH` (Task 1).
- Produces:
  - `ApiReservationInboxRoute.SetNote = '/reservation-inbox/:documentId/note'`
  - `service.setNote(documentId: string, note: string | null): Promise<{ documentId: string; staffNote: string | null }>`
  - `ReservationInboxDetail.staffNote: string | null`
  - `list().counts: Record<ReservationStatus, number>` with all six keys

- [ ] **Step 1: Write the failing service tests**

Append to `reservation-inbox.service.test.ts`:

```ts
describe('createReservationInboxService workflow statuses', () => {
  it('counts every reservation status', async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 2);
    const service = createReservationInboxService(buildStrapi({ findMany, count }));

    const result = await service.list({ page: 1 });

    expect(result.counts).toEqual({
      new: 2,
      read: 2,
      confirmed: 2,
      cancelled: 2,
      no_show: 2,
      archived: 2,
    });
    expect(count).toHaveBeenCalledWith({ filters: { leadStatus: 'no_show' } });
  });

  it('returns the staff note in detail', async () => {
    const findOne = vi.fn(async () => ({
      documentId: 'abc123def456',
      fullName: 'A',
      phone: '0901',
      guestCount: 2,
      preferredDate: '2030-06-15',
      preferredTime: '19:00',
      overlapCount: 0,
      createdAt: '2030-06-10T12:00:00.000Z',
      leadStatus: 'confirmed',
      staffNote: 'Gọi lúc 10h, khách xác nhận',
    }));
    const service = createReservationInboxService(buildStrapi({ findOne }));

    const detail = await service.detail('abc123def456');

    expect(detail.status).toBe('confirmed');
    expect(detail.staffNote).toBe('Gọi lúc 10h, khách xác nhận');
    expect(findOne.mock.calls[0][0].fields).toContain('staffNote');
  });

  it('trims the note and stores an empty note as null', async () => {
    const findOne = vi.fn(async () => ({ documentId: 'abc123def456' }));
    const update = vi.fn(async ({ data }: { data: { staffNote: string | null } }) => ({
      documentId: 'abc123def456',
      staffNote: data.staffNote,
    }));
    const service = createReservationInboxService(buildStrapi({ findOne, update }));

    await expect(service.setNote('abc123def456', '  gọi lại 15h  ')).resolves.toEqual({
      documentId: 'abc123def456',
      staffNote: 'gọi lại 15h',
    });
    await expect(service.setNote('abc123def456', '   ')).resolves.toEqual({
      documentId: 'abc123def456',
      staffNote: null,
    });
  });

  it('rejects a note for a missing request', async () => {
    const service = createReservationInboxService(
      buildStrapi({ findOne: vi.fn(async () => null), update: vi.fn() }),
    );

    await expect(service.setNote('abc123def456', 'x')).rejects.toMatchObject({
      code: ReservationInboxErrorCode.NotFound,
    });
  });
});
```

- [ ] **Step 2: Write the failing controller tests**

Append to `reservation-inbox.controller.test.ts`:

```ts
describe('reservation inbox controller workflow', () => {
  it('accepts the confirmed status', async () => {
    const findOne = vi.fn(async () => ({ documentId: 'abc123def456' }));
    const update = vi.fn(async () => ({ documentId: 'abc123def456', leadStatus: 'confirmed' }));
    const controller = createReservationInboxController(buildStrapi({ findOne, update }));
    const context = buildContext({
      params: { documentId: 'abc123def456' },
      request: { body: { status: 'confirmed' } },
    });

    await controller.setStatus(context as never);

    expect(context.body).toEqual({ data: { documentId: 'abc123def456', status: 'confirmed' } });
  });

  it('saves a staff note', async () => {
    const findOne = vi.fn(async () => ({ documentId: 'abc123def456' }));
    const update = vi.fn(async () => ({ documentId: 'abc123def456', staffNote: 'ok' }));
    const controller = createReservationInboxController(buildStrapi({ findOne, update }));
    const context = buildContext({
      params: { documentId: 'abc123def456' },
      request: { body: { note: 'ok' } },
    });

    await controller.setNote(context as never);

    expect(context.body).toEqual({ data: { documentId: 'abc123def456', staffNote: 'ok' } });
  });

  it('rejects a note longer than 2000 characters', async () => {
    const findOne = vi.fn();
    const controller = createReservationInboxController(buildStrapi({ findOne }));
    const context = buildContext({
      params: { documentId: 'abc123def456' },
      request: { body: { note: 'x'.repeat(2001) } },
    });

    await controller.setNote(context as never);

    expect(context.badRequest).toHaveBeenCalledWith('Ghi chú tối đa 2000 ký tự.');
    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects a non-string note', async () => {
    const controller = createReservationInboxController(buildStrapi({ findOne: vi.fn() }));
    const context = buildContext({
      params: { documentId: 'abc123def456' },
      request: { body: { note: 42 } },
    });

    await controller.setNote(context as never);

    expect(context.badRequest).toHaveBeenCalledWith('Ghi chú không hợp lệ.');
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm vitest run src/api/reservation-inbox`
Expected: FAIL. The counts are missing `confirmed`/`cancelled`/`no_show`, `staffNote` is undefined, and `controller.setNote is not a function`.

- [ ] **Step 4: Implement the types**

In `reservation-inbox.types.ts`:
- Add `SetNote = '/reservation-inbox/:documentId/note',` to `ApiReservationInboxRoute`.
- Add `staffNote: string | null;` to `ReservationInboxDetail`, after `status`.
- Add `setNote: (context: ApiReservationInboxRequestContext) => Promise<void>;` to `ApiReservationInboxController`.

- [ ] **Step 5: Implement the service**

In `reservation-inbox.service.ts`:

Add `'staffNote'` to `DETAIL_FIELDS`. Add `staffNote?: unknown;` to `ReservationDetailRow`. Add `staffNote: toOptionalText(row.staffNote),` to the object `detail()` returns.

Replace the `Promise.all` and the `counts` construction in `list()` with:

```ts
    const [rows, total, ...statusCounts] = await Promise.all([
      strapi.documents(UID).findMany({
        filters,
        fields: [...LIST_FIELDS],
        sort: 'createdAt:desc',
        limit: RESERVATION_INBOX_PAGE_SIZE,
        start: (query.page - 1) * RESERVATION_INBOX_PAGE_SIZE,
      }),
      strapi.documents(UID).count({ filters }),
      ...RESERVATION_STATUSES.map((status) =>
        strapi.documents(UID).count({ filters: statusFilter(status) }),
      ),
    ]);

    const totalCount = toCount(total);
    const counts = Object.fromEntries(
      RESERVATION_STATUSES.map((status, index) => [status, toCount(statusCounts[index])]),
    ) as Record<ReservationStatus, number>;
```

Then return `counts,` in place of the hand-written object.

Add this method after `setStatus`:

```ts
  async setNote(
    documentId: string,
    note: string | null,
  ): Promise<{ documentId: string; staffNote: string | null }> {
    const existing = await strapi.documents(UID).findOne({ documentId, fields: ['documentId'] });
    if (!existing) {
      throw notFound(documentId);
    }

    const staffNote = note?.trim() ? note.trim() : null;
    const updated = (await strapi.documents(UID).update({
      documentId,
      data: { staffNote },
      fields: ['documentId', 'staffNote'],
    })) as unknown as { documentId?: unknown; staffNote?: unknown } | null;

    return {
      documentId: String(updated?.documentId ?? documentId),
      staffNote: toOptionalText(updated?.staffNote),
    };
  },
```

- [ ] **Step 6: Implement the controller**

In `reservation-inbox.controller.ts`, import `RESERVATION_STAFF_NOTE_MAX_LENGTH` from `'../../shared/lead-status/lead-status'`. Add this parser:

```ts
const parseNote = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw invalidQuery('Invalid staff note type.', 'Ghi chú không hợp lệ.');
  }
  if (value.length > RESERVATION_STAFF_NOTE_MAX_LENGTH) {
    throw invalidQuery(
      `Staff note too long: ${value.length}.`,
      `Ghi chú tối đa ${RESERVATION_STAFF_NOTE_MAX_LENGTH} ký tự.`,
    );
  }
  return value;
};
```

Add the handler after `setStatus`:

```ts
    async setNote(context): Promise<void> {
      const requestId = readRequestId(context);
      await Promise.resolve()
        .then(async () => {
          const documentId = parseDocumentId(context.params?.documentId);
          const body = (context.request?.body ?? {}) as Record<string, unknown>;
          context.body = { data: await service.setNote(documentId, parseNote(body.note)) };
        })
        .catch((error: Error) => handleControllerError(strapi, context, error, requestId));
    },
```

- [ ] **Step 7: Register the route**

In `index.ts`, add this to the routes array:

```ts
    {
      method: 'POST',
      path: ApiReservationInboxRoute.SetNote,
      handler: controller.setNote as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiReservationInboxPermission.Read] },
      },
    },
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `pnpm vitest run src/api/reservation-inbox && pnpm run typecheck`
Expected: PASS. Typecheck errors will appear in admin files that build `counts` by hand (`ReservationInboxScreen.tsx:92`); Task 3 fixes them. If you commit this task alone, change that line to `const counts = result?.counts;` and use `counts?.new ?? 0` and so on.

- [ ] **Step 9: Commit (after user OK)**

```bash
git add src/api/reservation-inbox
git commit -m "feat(reservation-inbox): workflow status counts and a staff note endpoint"
```

### Task 3: Admin inbox — new tabs, row actions and the note editor in the detail modal

**Files:**
- Modify: `src/admin/reservation-inbox/reservation-inbox.types.ts` (translation keys)
- Modify: `src/admin/reservation-inbox/vi.ts`
- Modify: `src/admin/reservation-inbox/reservation-inbox.helper.ts:254-293`
- Modify: `src/admin/reservation-inbox/useReservationList.ts`
- Modify: `src/admin/reservation-inbox/ReservationInboxScreen.tsx`
- Modify: `src/admin/reservation-inbox/ReservationDetailModal.tsx`
- Modify: `src/admin/reservation-inbox/reservation-inbox.css`
- Test: `src/admin/reservation-inbox/reservation-inbox.helper.test.ts`

**Interfaces:**
- Consumes: `POST /reservation-inbox/:documentId/status` and `POST /reservation-inbox/:documentId/note` (Task 2), and `ReservationInboxDetail.staffNote`.
- Produces:
  - `reservationStatusActions(status): ReservationStatusAction[]`, full list, primary action first
  - `RESERVATION_ROW_ACTION_LIMIT = 2`
  - `reservationStatusChipKey: Record<ReservationStatus, ReservationInboxTranslationKey>`
  - `reservationStatusTabKey: Record<ReservationStatus, ReservationInboxTranslationKey>`
  - `useReservationList().setNote(documentId, note): Promise<boolean>`

- [ ] **Step 1: Write the failing helper tests**

Append to `reservation-inbox.helper.test.ts` (add the imports to the existing import list):

```ts
import {
  RESERVATION_ROW_ACTION_LIMIT,
  reservationStatusActions,
  reservationStatusTone,
} from './reservation-inbox.helper';
import { InformationStatusChipTone } from '../information-status-chip/information-status-chip.types';

describe('reservation workflow actions', () => {
  const targets = (status: Parameters<typeof reservationStatusActions>[0]) =>
    reservationStatusActions(status).map((action) => action.target);

  it('offers confirm first on a new request', () => {
    expect(targets('new')).toEqual(['confirmed', 'cancelled', 'read']);
  });

  it('moves a confirmed request to no-show, cancel or archive', () => {
    expect(targets('confirmed')).toEqual(['no_show', 'cancelled', 'archived']);
  });

  it('lets staff restore closed requests', () => {
    expect(targets('cancelled')).toEqual(['archived', 'read']);
    expect(targets('no_show')).toEqual(['archived', 'confirmed']);
    expect(targets('archived')).toEqual(['read']);
  });

  it('never offers the current status', () => {
    for (const status of ['new', 'read', 'confirmed', 'cancelled', 'no_show', 'archived'] as const) {
      expect(targets(status)).not.toContain(status);
    }
  });

  it('shows two actions per table row', () => {
    expect(RESERVATION_ROW_ACTION_LIMIT).toBe(2);
  });

  it('colours statuses by outcome', () => {
    expect(reservationStatusTone('new')).toBe(InformationStatusChipTone.Info);
    expect(reservationStatusTone('confirmed')).toBe(InformationStatusChipTone.Published);
    expect(reservationStatusTone('cancelled')).toBe(InformationStatusChipTone.Warning);
    expect(reservationStatusTone('no_show')).toBe(InformationStatusChipTone.Warning);
    expect(reservationStatusTone('archived')).toBe(InformationStatusChipTone.Neutral);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/admin/reservation-inbox/reservation-inbox.helper.test.ts`
Expected: FAIL. `RESERVATION_ROW_ACTION_LIMIT` is undefined and the action targets do not match.

- [ ] **Step 3: Add the translation keys and Vietnamese strings**

Add these to the `ReservationInboxTranslationKey` enum:

```ts
  ChipConfirmed = 'chip.confirmed',
  ChipCancelled = 'chip.cancelled',
  ChipNoShow = 'chip.noShow',
  StatusConfirmed = 'status.confirmed',
  StatusCancelled = 'status.cancelled',
  StatusNoShow = 'status.noShow',
  ActionConfirm = 'actions.confirm',
  ActionCancel = 'actions.cancel',
  ActionNoShow = 'actions.noShow',
  ActionRestoreConfirmed = 'actions.restoreConfirmed',
  DetailActions = 'detail.actions',
  DetailStaffNote = 'detail.staffNote',
  DetailStaffNoteHint = 'detail.staffNoteHint',
  DetailStaffNoteSave = 'detail.staffNoteSave',
  DetailStaffNoteSaved = 'detail.staffNoteSaved',
  DetailStaffNoteFailed = 'detail.staffNoteFailed',
```

Add these to `vi.ts`:

```ts
  [ReservationInboxTranslationKey.ChipConfirmed]: 'Đã xác nhận',
  [ReservationInboxTranslationKey.ChipCancelled]: 'Đã huỷ',
  [ReservationInboxTranslationKey.ChipNoShow]: 'Khách không đến',
  [ReservationInboxTranslationKey.StatusConfirmed]: 'Đã xác nhận ({count})',
  [ReservationInboxTranslationKey.StatusCancelled]: 'Đã huỷ ({count})',
  [ReservationInboxTranslationKey.StatusNoShow]: 'Không đến ({count})',
  [ReservationInboxTranslationKey.ActionConfirm]: 'Xác nhận',
  [ReservationInboxTranslationKey.ActionCancel]: 'Huỷ',
  [ReservationInboxTranslationKey.ActionNoShow]: 'Khách không đến',
  [ReservationInboxTranslationKey.ActionRestoreConfirmed]: 'Khách đã đến',
  [ReservationInboxTranslationKey.DetailActions]: 'Chuyển trạng thái',
  [ReservationInboxTranslationKey.DetailStaffNote]: 'Ghi chú nội bộ',
  [ReservationInboxTranslationKey.DetailStaffNoteHint]:
    'Chỉ nhân viên thấy. Ví dụ: đã gọi lúc 10h, khách đổi sang 6 người.',
  [ReservationInboxTranslationKey.DetailStaffNoteSave]: 'Lưu ghi chú',
  [ReservationInboxTranslationKey.DetailStaffNoteSaved]: 'Đã lưu ghi chú',
  [ReservationInboxTranslationKey.DetailStaffNoteFailed]: 'Không lưu được ghi chú. Vui lòng thử lại.',
```

- [ ] **Step 4: Implement the helper**

In `reservation-inbox.helper.ts`, replace `reservationStatusTone` and `reservationStatusActions` with:

```ts
export const reservationStatusTone = (
  status: ReservationStatus,
): InformationStatusChipTone => {
  switch (status) {
    case 'new':
      return InformationStatusChipTone.Info;
    case 'confirmed':
      return InformationStatusChipTone.Published;
    case 'cancelled':
    case 'no_show':
      return InformationStatusChipTone.Warning;
    default:
      return InformationStatusChipTone.Neutral;
  }
};

export const reservationStatusChipKey: Record<ReservationStatus, ReservationInboxTranslationKey> = {
  new: ReservationInboxTranslationKey.ChipNew,
  read: ReservationInboxTranslationKey.ChipRead,
  confirmed: ReservationInboxTranslationKey.ChipConfirmed,
  cancelled: ReservationInboxTranslationKey.ChipCancelled,
  no_show: ReservationInboxTranslationKey.ChipNoShow,
  archived: ReservationInboxTranslationKey.ChipArchived,
};

export const reservationStatusTabKey: Record<ReservationStatus, ReservationInboxTranslationKey> = {
  new: ReservationInboxTranslationKey.StatusNew,
  read: ReservationInboxTranslationKey.StatusRead,
  confirmed: ReservationInboxTranslationKey.StatusConfirmed,
  cancelled: ReservationInboxTranslationKey.StatusCancelled,
  no_show: ReservationInboxTranslationKey.StatusNoShow,
  archived: ReservationInboxTranslationKey.StatusArchived,
};

export interface ReservationStatusAction {
  /** Status the request moves to. */
  target: ReservationStatus;
  translationKey: ReservationInboxTranslationKey;
}

/** Table rows show only the first actions; the detail modal shows all. */
export const RESERVATION_ROW_ACTION_LIMIT = 2;

const action = (
  target: ReservationStatus,
  translationKey: ReservationInboxTranslationKey,
): ReservationStatusAction => ({ target, translationKey });

/** Next steps per current status, most likely step first. */
export const reservationStatusActions = (
  status: ReservationStatus,
): ReservationStatusAction[] => {
  const K = ReservationInboxTranslationKey;
  switch (status) {
    case 'new':
      return [
        action('confirmed', K.ActionConfirm),
        action('cancelled', K.ActionCancel),
        action('read', K.ActionMarkRead),
      ];
    case 'read':
      return [
        action('confirmed', K.ActionConfirm),
        action('cancelled', K.ActionCancel),
        action('archived', K.ActionArchive),
        action('new', K.ActionMarkNew),
      ];
    case 'confirmed':
      return [
        action('no_show', K.ActionNoShow),
        action('cancelled', K.ActionCancel),
        action('archived', K.ActionArchive),
      ];
    case 'cancelled':
      return [action('archived', K.ActionArchive), action('read', K.ActionRestore)];
    case 'no_show':
      return [
        action('archived', K.ActionArchive),
        action('confirmed', K.ActionRestoreConfirmed),
      ];
    default:
      return [action('read', K.ActionRestore)];
  }
};
```

- [ ] **Step 5: Run the helper tests and confirm they pass**

Run: `pnpm vitest run src/admin/reservation-inbox`
Expected: PASS.

- [ ] **Step 6: Add `setNote` to the list hook**

In `useReservationList.ts`, add `setNote(documentId: string, note: string): Promise<boolean>;` to `UseReservationList`. Implement it next to `setStatus`:

```ts
  const setNote = useCallback(async (documentId: string, note: string): Promise<boolean> => {
    try {
      await clientRef.current.post(
        `/reservation-inbox/${encodeURIComponent(documentId)}/note`,
        { note },
      );
      return true;
    } catch {
      return false;
    }
  }, []);
```

Return `{ result, loading, failed, reload: load, setStatus, setNote }`.

- [ ] **Step 7: Update the screen**

In `ReservationInboxScreen.tsx`:
- Delete the local `chipLabelKey` and import `reservationStatusChipKey`, `reservationStatusTabKey`, `RESERVATION_ROW_ACTION_LIMIT` from the helper. Import `RESERVATION_STATUSES` from `./reservation-inbox.types`.
- Replace `chipLabelKey[item.status]` with `reservationStatusChipKey[item.status]`.
- Replace the `counts` line and the `statusTabs` array with:

```ts
  const counts = result?.counts;
  const countOf = (status: ReservationStatus): number => counts?.[status] ?? 0;
  const statusTabs: ReadonlyArray<{
    value: ReservationStatusFilter;
    key: ReservationInboxTranslationKey;
    count: number;
  }> = [
    ...RESERVATION_STATUSES.map((status) => ({
      value: status,
      key: reservationStatusTabKey[status],
      count: countOf(status),
    })),
    {
      value: 'all',
      key: ReservationInboxTranslationKey.FilterAll,
      count: RESERVATION_STATUSES.reduce((sum, status) => sum + countOf(status), 0),
    },
  ];
```

- Change the row actions to `reservationStatusActions(item.status).slice(0, RESERVATION_ROW_ACTION_LIMIT).map(...)`.
- Pass the hook's handlers to the modal:

```tsx
        <ReservationDetailModal
          documentId={detailDocumentId}
          onClose={() => setDetailDocumentId(null)}
          onSaveNote={setNote}
          onStatusChange={async (documentId, target) => {
            const ok = await setStatus(documentId, target);
            if (ok) {
              void refresh().catch(() => {});
            }
            return ok;
          }}
          translate={translate}
        />
```

Destructure `setNote` from `useReservationList`.

- [ ] **Step 8: Update the detail modal**

In `ReservationDetailModal.tsx`:
- Add `Field, Textarea` to the `@strapi/design-system` import and `useNotification` to the `@strapi/strapi/admin` import.
- Delete the local `chipLabelKey`; import `reservationStatusChipKey` and `reservationStatusActions` from the helper.
- Extend the props:

```ts
interface ReservationDetailModalProps {
  documentId: string | null;
  onClose(): void;
  onSaveNote(documentId: string, note: string): Promise<boolean>;
  onStatusChange(documentId: string, status: ReservationStatus): Promise<boolean>;
  translate(key: ReservationInboxTranslationKey, values?: Record<string, unknown>): string;
}
```

- Add state and a reload counter. Put this inside the component, after the existing state:

```ts
  const { toggleNotification } = useNotification();
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setNoteDraft(detail?.staffNote ?? '');
  }, [detail]);

  const saveNote = async () => {
    if (!documentId) return;
    setSavingNote(true);
    const ok = await onSaveNote(documentId, noteDraft);
    setSavingNote(false);
    toggleNotification({
      type: ok ? 'success' : 'danger',
      message: translate(
        ok
          ? ReservationInboxTranslationKey.DetailStaffNoteSaved
          : ReservationInboxTranslationKey.DetailStaffNoteFailed,
      ),
    });
  };

  const changeStatus = async (target: ReservationStatus) => {
    if (!documentId) return;
    const ok = await onStatusChange(documentId, target);
    if (ok) {
      setReloadKey((key) => key + 1);
    } else {
      toggleNotification({
        type: 'danger',
        message: translate(ReservationInboxTranslationKey.ActionFailed),
      });
    }
  };
```

- Add `reloadKey` to the fetch effect's dependency list: `[documentId, reloadKey]`.
- Replace `chipLabelKey[detail.status]` with `reservationStatusChipKey[detail.status]`.
- After the status `DetailRow`, add:

```tsx
        <DetailRow label={translate(ReservationInboxTranslationKey.DetailActions)}>
          <Flex gap={2} wrap="wrap">
            {reservationStatusActions(detail.status).map((action) => (
              <Button
                key={action.target}
                onClick={() => void changeStatus(action.target)}
                size="S"
                variant="secondary"
              >
                {translate(action.translationKey)}
              </Button>
            ))}
          </Flex>
        </DetailRow>
```

- After the guest note row (`DetailNote`), add:

```tsx
        <div className="reservation-detail__row reservation-detail__row--wide">
          <Field.Root
            hint={translate(ReservationInboxTranslationKey.DetailStaffNoteHint)}
            name="staffNote"
          >
            <Field.Label>{translate(ReservationInboxTranslationKey.DetailStaffNote)}</Field.Label>
            <Textarea
              maxLength={2000}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                setNoteDraft(event.target.value)
              }
              value={noteDraft}
            />
            <Field.Hint />
          </Field.Root>
          <Flex justifyContent="flex-end" paddingTop={2}>
            <Button
              disabled={savingNote || noteDraft === (detail.staffNote ?? '')}
              loading={savingNote}
              onClick={() => void saveNote()}
              size="S"
            >
              {translate(ReservationInboxTranslationKey.DetailStaffNoteSave)}
            </Button>
          </Flex>
        </div>
```

Change `import { useEffect, useRef, useState, type ReactNode } from 'react';` to also import `type ChangeEvent`, and use `ChangeEvent<HTMLTextAreaElement>` in place of `React.ChangeEvent`.

- [ ] **Step 9: Typecheck, lint and build**

Run: `pnpm run typecheck && pnpm run lint && pnpm run build`
Expected: all pass. The build compiles the admin bundle and catches design-system prop errors.

- [ ] **Step 10: Manual check in Admin**

Run: `pnpm run develop`. Then open `/admin/plugins/reservation-inbox` and check:
- There are 7 status tabs (Mới, Đã đọc, Đã xác nhận, Đã huỷ, Không đến, Lưu trữ, Tất cả), and each count matches.
- A new row shows "Xác nhận" and "Huỷ". Clicking "Xác nhận" moves the row to the Đã xác nhận tab, and its chip turns green.
- In the detail modal, typing a note and clicking "Lưu ghi chú" shows a toast. After a page reload, the note is still there.
- In Content Manager, the reservation edit form shows "Ghi chú nội bộ của nhân viên" and the status dropdown lists all 6 Vietnamese labels.

- [ ] **Step 11: Commit (after user OK)**

```bash
git add src/admin/reservation-inbox
git commit -m "feat(reservation-inbox): confirm, cancel and no-show actions with an internal note"
```

### Task 4: Dashboard widgets ignore cancelled and no-show bookings

**Files:**
- Modify: `src/admin/dashboard-widgets/dashboard-widgets.helper.ts`
- Test: `src/admin/dashboard-widgets/dashboard-widgets.helper.test.ts`

**Interfaces:**
- Consumes: `ReservationLeadStatus`, `LEAD_STATUS_LABELS_VI` (Task 1); `reservationStatusTone` (Task 3).
- Produces: `LeadFilter` values may be `string | number | readonly string[]`. Arrays serialize as `[$op][i]=v`.

- [ ] **Step 1: Write the failing test**

Append to `dashboard-widgets.helper.test.ts` (add the imports to the existing list):

```ts
import { buildLeadListUrl, buildLeadOverviewFilters, leadStatusLabel } from './dashboard-widgets.helper';

describe('closed reservations', () => {
  it('leaves cancelled, no-show and archived bookings out of today and upcoming', () => {
    const filters = buildLeadOverviewFilters(new Date('2030-06-15T09:00:00+07:00'));
    expect(filters.today.leadStatus).toEqual({ $notIn: ['archived', 'cancelled', 'no_show'] });
  });

  it('serializes array filter values with indexes', () => {
    const url = buildLeadListUrl('api::x.x', {
      filters: { leadStatus: { $notIn: ['archived', 'cancelled'] } },
      pageSize: 1,
    });
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('filters[$and][0][leadStatus][$notIn][0]')).toBe('archived');
    expect(params.get('filters[$and][0][leadStatus][$notIn][1]')).toBe('cancelled');
  });

  it('labels the new statuses', () => {
    expect(leadStatusLabel.confirmed).toBe('Đã xác nhận');
    expect(leadStatusLabel.no_show).toBe('Khách không đến');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/admin/dashboard-widgets`
Expected: FAIL. The `leadStatus` filter is `{ $ne: 'archived' }` and `leadStatusLabel.confirmed` is undefined.

- [ ] **Step 3: Implement it**

In `dashboard-widgets.helper.ts`:

```ts
import {
  LEAD_STATUS_LABELS_VI,
  type ReservationLeadStatus,
} from '../../shared/lead-status/lead-status';
import { reservationStatusTone } from '../reservation-inbox/reservation-inbox.helper';

export type LeadStatus = ReservationLeadStatus;

export type LeadFilterValue = string | number | readonly string[];
export type LeadFilter = Record<string, Record<string, LeadFilterValue>>;
```

In `buildLeadListUrl`, replace the inner `forEach` body with:

```ts
    Object.entries(conditions).forEach(([operator, value]) => {
      const key = `filters[$and][${index}][${field}][${operator}]`;
      if (Array.isArray(value)) {
        value.forEach((entry, position) => params.set(`${key}[${position}]`, String(entry)));
      } else {
        params.set(key, String(value));
      }
    });
```

Replace `const notArchived = { $ne: 'archived' };` with:

```ts
/** Bookings that will not seat anyone today. */
const notClosed = { $notIn: ['archived', 'cancelled', 'no_show'] };
```

Then replace every `notArchived` with `notClosed`, except in `buildLatestContactsUrl`. Contacts keep `{ $ne: 'archived' }`, written inline there.

Replace `leadStatusLabel` and `leadStatusTone` with:

```ts
export const leadStatusLabel: Record<LeadStatus, string> = LEAD_STATUS_LABELS_VI;

/** Same tone mapping as the reservation inbox chip, so status reads alike everywhere. */
export const leadStatusTone = reservationStatusTone;
```

Note: `leadStatusLabel.read` changes from "Đã xem" to "Đã đọc", which matches the inbox. Update any existing test that asserts "Đã xem".

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run src/admin/dashboard-widgets && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit (after user OK)**

```bash
git add src/admin/dashboard-widgets
git commit -m "fix(dashboard): leave cancelled and no-show bookings out of today's guests"
```

---

## Part B — Guest confirmation email

### Task 5: Pure email builder (VI/EN)

**Files:**
- Create: `src/domain/form-intake/reservation-confirmation-email.ts`
- Test: `src/domain/form-intake/reservation-confirmation-email.test.ts`

**Interfaces:**
- Consumes: `sanitizeSubjectFragment`, `FormLeadEmailMessage` from `form-lead-notify.ts`.
- Produces:

```ts
export type ReservationConfirmationInput = {
  locale: 'vi' | 'en';
  fullName: string;
  phone: string;
  preferredDate: string; // YYYY-MM-DD
  preferredTime: string; // HH:mm
  guestCount: number;
  restaurant: { brandName: string; hotline?: string; address?: string };
};
export function buildReservationConfirmationEmail(input: ReservationConfirmationInput): FormLeadEmailMessage;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { buildReservationConfirmationEmail } from './reservation-confirmation-email';

const base = {
  fullName: 'Nguyễn Văn An',
  phone: '0901234567',
  preferredDate: '2030-06-15',
  preferredTime: '19:00',
  guestCount: 4,
  restaurant: {
    brandName: 'Salanca Brazil',
    hotline: '0989 561 159',
    address: '49 Phan Bội Châu, Cửa Nam, Hà Nội',
  },
};

describe('reservation confirmation email', () => {
  it('writes Vietnamese for VI requests and says the table is not yet confirmed', () => {
    const email = buildReservationConfirmationEmail({ ...base, locale: 'vi' });
    expect(email.subject).toBe('Salanca Brazil đã nhận yêu cầu đặt bàn của bạn');
    expect(email.text).toContain('15/06/2030 lúc 19:00');
    expect(email.text).toContain('4 khách');
    expect(email.text).toContain('chưa phải xác nhận giữ bàn');
    expect(email.text).toContain('0901234567');
    expect(email.text).toContain('0989 561 159');
    expect(email.html).toContain('Nguyễn Văn An');
  });

  it('writes English for EN requests', () => {
    const email = buildReservationConfirmationEmail({ ...base, locale: 'en', guestCount: 1 });
    expect(email.subject).toBe('Salanca Brazil received your reservation request');
    expect(email.text).toContain('15/06/2030 at 19:00');
    expect(email.text).toContain('1 guest');
    expect(email.text).not.toContain('1 guests');
    expect(email.text).toContain('not yet a confirmed booking');
  });

  it('omits the hotline and address lines when the CMS has none', () => {
    const email = buildReservationConfirmationEmail({
      ...base,
      locale: 'vi',
      restaurant: { brandName: 'Salanca Brazil' },
    });
    expect(email.text).not.toContain('Hotline');
    expect(email.text).not.toContain('Địa chỉ');
  });

  it('escapes HTML in the guest name', () => {
    const email = buildReservationConfirmationEmail({
      ...base,
      locale: 'vi',
      fullName: '<script>x</script>',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/domain/form-intake/reservation-confirmation-email.test.ts`
Expected: FAIL, the module cannot be resolved.

- [ ] **Step 3: Implement it**

```ts
/**
 * Receipt sent to the guest after a public reservation request. It confirms
 * receipt only: staff still call to confirm the table, so the copy must never
 * read as a booking confirmation.
 */
import { sanitizeSubjectFragment, type FormLeadEmailMessage } from './form-lead-notify';

export type ReservationConfirmationInput = {
  locale: 'vi' | 'en';
  fullName: string;
  phone: string;
  preferredDate: string;
  preferredTime: string;
  guestCount: number;
  restaurant: { brandName: string; hotline?: string; address?: string };
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatDate = (isoDate: string): string => {
  const [year = '', month = '', day = ''] = isoDate.split('-');
  return `${day}/${month}/${year}`;
};

const copy = {
  vi: {
    subject: (brand: string) => `${brand} đã nhận yêu cầu đặt bàn của bạn`,
    greeting: (name: string) => `Xin chào ${name},`,
    received: (brand: string) => `${brand} đã nhận yêu cầu đặt bàn của bạn:`,
    visit: (date: string, time: string, guests: number) => `${date} lúc ${time} · ${guests} khách`,
    pending: (phone: string) =>
      `Đây chưa phải xác nhận giữ bàn. Nhân viên sẽ gọi số ${phone} để xác nhận với bạn.`,
    change: 'Cần đổi hoặc huỷ, bạn chỉ cần trả lời email này hoặc gọi cho nhà hàng.',
    hotline: 'Hotline',
    address: 'Địa chỉ',
    signOff: (brand: string) => `Hẹn gặp bạn tại ${brand}.`,
  },
  en: {
    subject: (brand: string) => `${brand} received your reservation request`,
    greeting: (name: string) => `Hello ${name},`,
    received: (brand: string) => `${brand} has received your reservation request:`,
    visit: (date: string, time: string, guests: number) =>
      `${date} at ${time} · ${guests} ${guests === 1 ? 'guest' : 'guests'}`,
    pending: (phone: string) =>
      `This is not yet a confirmed booking. Our team will call ${phone} to confirm.`,
    change: 'To change or cancel, reply to this email or call the restaurant.',
    hotline: 'Hotline',
    address: 'Address',
    signOff: (brand: string) => `We look forward to welcoming you at ${brand}.`,
  },
} as const;

export function buildReservationConfirmationEmail(
  input: ReservationConfirmationInput,
): FormLeadEmailMessage {
  const t = copy[input.locale];
  const brand = input.restaurant.brandName;
  const lines = [
    t.greeting(input.fullName),
    '',
    t.received(brand),
    t.visit(formatDate(input.preferredDate), input.preferredTime, input.guestCount),
    '',
    t.pending(input.phone),
    t.change,
    '',
    ...(input.restaurant.hotline ? [`${t.hotline}: ${input.restaurant.hotline}`] : []),
    ...(input.restaurant.address ? [`${t.address}: ${input.restaurant.address}`] : []),
    t.signOff(brand),
  ];

  const html = lines
    .map((line) => (line === '' ? '<br>' : `<p style="margin:0 0 4px">${escapeHtml(line)}</p>`))
    .join('');

  return {
    subject: sanitizeSubjectFragment(t.subject(brand)),
    text: `${lines.join('\n')}\n`,
    html,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run src/domain/form-intake/reservation-confirmation-email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (after user OK)**

```bash
git add src/domain/form-intake/reservation-confirmation-email.ts src/domain/form-intake/reservation-confirmation-email.test.ts
git commit -m "feat(forms): bilingual reservation receipt email for guests"
```

### Task 6: Send the receipt after a reservation is created

**Files:**
- Modify: `src/domain/form-intake/send-form-lead-notify.ts` (export `resolveIntentionalEmailSend`)
- Create: `src/domain/form-intake/send-reservation-confirmation.ts`
- Test: `src/domain/form-intake/send-reservation-confirmation.test.ts`
- Modify: `src/api/reservation-request/controllers/reservation-request.ts`
- Modify: `.env.example`, `docs/resend-email-operations.md`, `docs/cms-api-contract.md` (reservation section: one line on the receipt)

**Interfaces:**
- Consumes: `buildReservationConfirmationEmail` (Task 5); `resolveIntentionalEmailSend(strapi)` (now exported).
- Produces: `scheduleReservationConfirmation(strapi, input: { documentId: string; email?: string; locale: 'vi' | 'en'; fullName: string; phone: string; preferredDate: string; preferredTime: string; guestCount: number }): void`, plus `sendReservationConfirmation`, the same function made awaitable, for tests.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendReservationConfirmation } from './send-reservation-confirmation';

const input = {
  documentId: 'abc123def456',
  email: 'guest@example.com',
  locale: 'en' as const,
  fullName: 'Jane',
  phone: '0901',
  preferredDate: '2030-06-15',
  preferredTime: '19:00',
  guestCount: 2,
};

const buildStrapi = (send = vi.fn(async () => undefined)) => {
  const findFirst = vi.fn(async () => ({
    brandName: 'Salanca Brazil',
    hotline: '0989 561 159',
    address: '49 Phan Boi Chau',
  }));
  return {
    send,
    findFirst,
    strapi: {
      documents: vi.fn(() => ({ findFirst })),
      plugin: vi.fn(() => ({
        service: () => ({ send, getProviderSettings: () => ({ provider: 'nodemailer' }) }),
      })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as never,
  };
};

describe('sendReservationConfirmation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does nothing unless the feature flag is on', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('RESERVATION_CONFIRM_EMAIL_ENABLED', '');
    const { strapi, send } = buildStrapi();
    await sendReservationConfirmation(strapi, input);
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when the guest left no email', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('RESERVATION_CONFIRM_EMAIL_ENABLED', 'true');
    const { strapi, send } = buildStrapi();
    await sendReservationConfirmation(strapi, { ...input, email: undefined });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the English receipt with contact facts from the EN global setting', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('RESERVATION_CONFIRM_EMAIL_ENABLED', 'true');
    const { strapi, send, findFirst } = buildStrapi();
    await sendReservationConfirmation(strapi, input);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en', status: 'published' }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guest@example.com',
        subject: 'Salanca Brazil received your reservation request',
      }),
    );
  });

  it('logs a code and swallows SMTP failures', async () => {
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.resend.com');
    vi.stubEnv('RESERVATION_CONFIRM_EMAIL_ENABLED', 'true');
    const failing = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { code: 'ECONNRESET' });
    });
    const { strapi } = buildStrapi(failing);
    await expect(sendReservationConfirmation(strapi, input)).resolves.toBeUndefined();
    expect((strapi as unknown as { log: { error: ReturnType<typeof vi.fn> } }).log.error)
      .toHaveBeenCalledWith('reservation confirmation failed', {
        documentId: 'abc123def456',
        code: 'Error:ECONNRESET',
      });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/domain/form-intake/send-reservation-confirmation.test.ts`
Expected: FAIL, the module cannot be resolved.

- [ ] **Step 3: Export the email resolver**

In `send-form-lead-notify.ts`, change `function resolveIntentionalEmailSend(` to `export function resolveIntentionalEmailSend(`. Also export its option type: `export type FormLeadPluginSendOptions = ...`.

- [ ] **Step 4: Implement the sender**

`src/domain/form-intake/send-reservation-confirmation.ts`:

```ts
/**
 * Best-effort guest receipt after a public reservation create.
 * Opt-in: EMAIL_SMTP_HOST (transport) and RESERVATION_CONFIRM_EMAIL_ENABLED=true.
 * Never throws; never logs the guest's address.
 */
import type { Core } from '@strapi/strapi';

import { formatNotifyErrorCode } from './form-lead-notify';
import { buildReservationConfirmationEmail } from './reservation-confirmation-email';
import { resolveIntentionalEmailSend } from './send-form-lead-notify';

export type ReservationConfirmationRequest = {
  documentId: string;
  email?: string;
  locale: 'vi' | 'en';
  fullName: string;
  phone: string;
  preferredDate: string;
  preferredTime: string;
  guestCount: number;
};

const GLOBAL_SETTING_UID = 'api::global-setting.global-setting' as const;
const FALLBACK_BRAND = 'Salanca';

const isEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  ['1', 'true', 'yes', 'on'].includes(
    (env.RESERVATION_CONFIRM_EMAIL_ENABLED ?? '').trim().toLowerCase(),
  );

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

async function loadRestaurantFacts(strapi: Core.Strapi, locale: 'vi' | 'en') {
  const row = (await strapi.documents(GLOBAL_SETTING_UID).findFirst({
    locale,
    status: 'published',
    fields: ['brandName', 'hotline', 'address'],
  })) as { brandName?: unknown; hotline?: unknown; address?: unknown } | null;

  return {
    brandName: text(row?.brandName) ?? FALLBACK_BRAND,
    hotline: text(row?.hotline),
    address: text(row?.address),
  };
}

export async function sendReservationConfirmation(
  strapi: Core.Strapi,
  request: ReservationConfirmationRequest,
): Promise<void> {
  try {
    if (!request.email || !isEnabled()) {
      return;
    }
    const send = resolveIntentionalEmailSend(strapi);
    if (!send) {
      return;
    }

    const restaurant = await loadRestaurantFacts(strapi, request.locale);
    const message = buildReservationConfirmationEmail({ ...request, restaurant });
    await send({ to: request.email, ...message });
    strapi.log.info('reservation confirmation sent', { documentId: request.documentId });
  } catch (error: unknown) {
    strapi.log.error('reservation confirmation failed', {
      documentId: request.documentId,
      code: formatNotifyErrorCode(error),
    });
  }
}

/** Fire-and-forget so SMTP latency never delays the public 201. */
export function scheduleReservationConfirmation(
  strapi: Core.Strapi,
  request: ReservationConfirmationRequest,
): void {
  void sendReservationConfirmation(strapi, request);
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm vitest run src/domain/form-intake`
Expected: PASS, including the existing `form-lead-notify.test.ts`.

- [ ] **Step 6: Call it from the create controller**

In `src/api/reservation-request/controllers/reservation-request.ts`, import `scheduleReservationConfirmation` from `'../../../domain/form-intake/send-reservation-confirmation'`. Add this right after the `scheduleFormLeadNotify(...)` call:

```ts
    scheduleReservationConfirmation(strapi, {
      documentId: document.documentId,
      ...(parsed.email ? { email: parsed.email } : {}),
      locale: parsed.sourceLocale,
      fullName: parsed.fullName,
      phone: parsed.phone,
      preferredDate: parsed.preferredDate,
      preferredTime: parsed.preferredTime,
      guestCount: parsed.guestCount,
    });
```

If `parsed.sourceLocale` is typed as `string`, narrow it with `parsed.sourceLocale === 'en' ? 'en' : 'vi'`.

- [ ] **Step 7: Document the env var**

In `.env.example`, under the `EMAIL_*` block, add:

```
# Send guests a "request received" email after they book (needs EMAIL_SMTP_HOST).
# RESERVATION_CONFIRM_EMAIL_ENABLED=true
```

In `docs/resend-email-operations.md`, add a short "Guest reservation receipt" section. It covers: the flag; that the From/Reply-To are `EMAIL_FROM_*`/`EMAIL_REPLY_TO`; that the brand, hotline and address come from the published `global-setting` in the guest's locale; and that the email says "not yet confirmed".

- [ ] **Step 8: Run the gates and the smoke test**

Run: `pnpm run typecheck && pnpm run test && pnpm run smoke:reservation-form`
Expected: typecheck and tests pass. The smoke test still returns 201 with the same body (it needs Postgres and a running server, as before).

Manual check with Mailpit: set `EMAIL_SMTP_HOST=localhost`, `EMAIL_SMTP_PORT=1025` and `RESERVATION_CONFIRM_EMAIL_ENABLED=true`. Submit `/vi/dat-ban` with an email, then submit `/en/reservations`. Mailpit should show one Vietnamese and one English receipt next to the staff notify. Submitting without an email sends no receipt.

- [ ] **Step 9: Commit (after user OK)**

```bash
git add src/domain/form-intake src/api/reservation-request/controllers/reservation-request.ts .env.example docs/resend-email-operations.md docs/cms-api-contract.md
git commit -m "feat(forms): email guests a receipt after a reservation request"
```

---

## Part C — CSV export of leads

### Task 7: Shared CSV module

**Files:**
- Create: `src/shared/csv/csv.ts`
- Create: `src/shared/csv/csv.test.ts`
- Modify: `src/api/audit-log/audit-log.export.ts`

**Interfaces:**
- Produces: `escapeCsvCell(value: string): string` and `buildCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string` (BOM, CRLF, formula-safe). `audit-log.export.ts` keeps exporting `escapeCsvCell` and `buildAuditLogCsv` unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { buildCsv, escapeCsvCell } from './csv';

describe('csv', () => {
  it('starts with a UTF-8 BOM and ends rows with CRLF', () => {
    expect(buildCsv(['A', 'B'], [['1', 'x"y']])).toBe('﻿"A","B"\r\n"1","x""y"\r\n');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell('+84901')).toBe(`"'+84901"`);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/shared/csv`
Expected: FAIL, the module cannot be resolved.

- [ ] **Step 3: Implement it and point the audit log at it**

`src/shared/csv/csv.ts`:

```ts
const CSV_BOM = '﻿';
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Quotes a cell and defuses spreadsheet formula injection. */
export const escapeCsvCell = (value: string): string => {
  const formulaSafe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${formulaSafe.split('"').join('""')}"`;
};

/** Excel-friendly CSV: UTF-8 BOM, every cell quoted, CRLF line ends. */
export const buildCsv = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string => {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
};
```

Replace the body of `audit-log.export.ts` with:

```ts
import { buildCsv, escapeCsvCell } from '../../shared/csv/csv';

export { escapeCsvCell };

export const AUDIT_LOG_CSV_HEADERS = [
  'Thời gian',
  'Người thực hiện',
  'Nhóm',
  'Hành động',
  'Đối tượng',
  'Nguồn',
  'Kết quả',
] as const;

export const buildAuditLogCsv = (rows: readonly (readonly string[])[]): string =>
  buildCsv(AUDIT_LOG_CSV_HEADERS, rows);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run src/shared/csv src/api/audit-log`
Expected: PASS, with the existing audit CSV tests unchanged.

- [ ] **Step 5: Commit (after user OK)**

```bash
git add src/shared/csv src/api/audit-log/audit-log.export.ts
git commit -m "refactor(csv): share the Excel-safe CSV writer"
```

### Task 8: Lead export API

**Files:**
- Create: `src/api/lead-export/lead-export.types.ts`
- Create: `src/api/lead-export/lead-export.mapper.ts`
- Create: `src/api/lead-export/lead-export.mapper.test.ts`
- Create: `src/api/lead-export/lead-export.service.ts`
- Create: `src/api/lead-export/lead-export.service.test.ts`
- Create: `src/api/lead-export/lead-export.controller.ts`
- Create: `src/api/lead-export/lead-export.controller.test.ts`
- Create: `src/api/lead-export/index.ts`
- Modify: `src/index.ts` (register and bootstrap, next to the reservation inbox calls at lines 44–45 and 61)

**Interfaces:**
- Consumes: `buildCsv` (Task 7); `LEAD_STATUS_LABELS_VI` (Task 1).
- Produces:
  - Route `GET /admin/lead-export/:kind?from=YYYY-MM-DD&to=YYYY-MM-DD`, where `kind` is one of `reservations | contacts | newsletter`
  - Permission `admin::lead-export.export`
  - Responds `text/csv` with `Content-Disposition: attachment; filename="<prefix>-<from>_<to>.csv"`
  - Over 10,000 matching rows returns 400 "Kết quả vượt quá 10.000 dòng…"

- [ ] **Step 1: Write the types**

`lead-export.types.ts`:

```ts
export enum ApiLeadExportPermission {
  Export = 'admin::lead-export.export',
}

export const LEAD_EXPORT_ROUTE = '/lead-export/:kind';

export const LEAD_EXPORT_KINDS = ['reservations', 'contacts', 'newsletter'] as const;
export type LeadExportKind = (typeof LEAD_EXPORT_KINDS)[number];

export const LEAD_EXPORT_MAX_ROWS = 10_000;

export interface LeadExportQuery {
  kind: LeadExportKind;
  /** YYYY-MM-DD, Vietnam calendar day, inclusive. */
  from?: string;
  /** YYYY-MM-DD, Vietnam calendar day, inclusive. */
  to?: string;
}

export const LEAD_EXPORT_FILE_PREFIX: Record<LeadExportKind, string> = {
  reservations: 'dat-ban',
  contacts: 'lien-he',
  newsletter: 'newsletter',
};
```

- [ ] **Step 2: Write the failing mapper test**

`lead-export.mapper.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  CONTACT_CSV_HEADERS,
  NEWSLETTER_CSV_HEADERS,
  RESERVATION_CSV_HEADERS,
  contactRow,
  newsletterRow,
  reservationRow,
  toVietnamDateTime,
} from './lead-export.mapper';

describe('lead export mapper', () => {
  it('formats timestamps in Vietnam time', () => {
    expect(toVietnamDateTime('2030-06-15T17:30:00.000Z')).toBe('16/06/2030 00:30');
  });

  it('maps a reservation row in header order', () => {
    const row = reservationRow({
      createdAt: '2030-06-10T03:00:00.000Z',
      fullName: 'An',
      phone: '0901',
      email: null,
      preferredDate: '2030-06-15',
      preferredTime: '19:00',
      guestCount: 4,
      occasion: 'Sinh nhật',
      note: 'Bàn gần cửa sổ',
      menuPackages: [{ name: 'Buffet' }],
      menuItems: [],
      leadStatus: 'confirmed',
      staffNote: 'Đã gọi',
      overlapCount: 1,
      sourceLocale: 'vi',
    });
    expect(row).toHaveLength(RESERVATION_CSV_HEADERS.length);
    expect(row).toEqual([
      '10/06/2030 10:00',
      'An',
      '0901',
      '',
      '15/06/2030',
      '19:00',
      '4',
      'Sinh nhật',
      'Bàn gần cửa sổ',
      'Buffet',
      '',
      'Đã xác nhận',
      'Đã gọi',
      '1',
      'vi',
    ]);
  });

  it('treats a missing status as new', () => {
    expect(reservationRow({ leadStatus: null })[11]).toBe('Mới');
  });

  it('maps contact and newsletter rows', () => {
    expect(CONTACT_CSV_HEADERS).toHaveLength(9);
    expect(
      contactRow({
        createdAt: '2030-06-10T03:00:00.000Z',
        fullName: 'B',
        email: 'b@x.vn',
        phone: '',
        topic: 'event',
        message: 'Hi',
        leadStatus: 'read',
        sourceLocale: 'en',
        sourcePath: '/en/contact',
      }),
    ).toEqual(['10/06/2030 10:00', 'B', 'b@x.vn', '', 'event', 'Hi', 'Đã đọc', 'en', '/en/contact']);
    expect(NEWSLETTER_CSV_HEADERS).toEqual(['Đăng ký lúc', 'Email', 'Ngôn ngữ', 'Trang đăng ký']);
    expect(
      newsletterRow({
        createdAt: '2030-06-10T03:00:00.000Z',
        email: 'c@x.vn',
        sourceLocale: 'vi',
        sourcePath: '/vi',
      }),
    ).toEqual(['10/06/2030 10:00', 'c@x.vn', 'vi', '/vi']);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm vitest run src/api/lead-export`
Expected: FAIL, the module cannot be resolved.

- [ ] **Step 4: Implement the mapper**

`lead-export.mapper.ts`:

```ts
import {
  LEAD_STATUS_LABELS_VI,
  RESERVATION_LEAD_STATUSES,
} from '../../shared/lead-status/lead-status';

type Row = Record<string, unknown>;

export const RESERVATION_CSV_HEADERS = [
  'Nhận lúc',
  'Họ tên',
  'Số điện thoại',
  'Email',
  'Ngày đến',
  'Giờ đến',
  'Số khách',
  'Dịp',
  'Yêu cầu của khách',
  'Gói đã chọn',
  'Món đã chọn',
  'Trạng thái',
  'Ghi chú nội bộ',
  'Trùng khung giờ',
  'Ngôn ngữ',
] as const;

export const CONTACT_CSV_HEADERS = [
  'Nhận lúc',
  'Họ tên',
  'Email',
  'Số điện thoại',
  'Chủ đề',
  'Nội dung',
  'Trạng thái',
  'Ngôn ngữ',
  'Trang gửi',
] as const;

export const NEWSLETTER_CSV_HEADERS = ['Đăng ký lúc', 'Email', 'Ngôn ngữ', 'Trang đăng ký'] as const;

const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

export const toVietnamDateTime = (value: unknown): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return date
    .toLocaleString('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(',', '');
};

const toDayMonthYear = (isoDate: unknown): string => {
  const [year, month, day] = str(isoDate).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '';
};

const statusLabel = (value: unknown): string => {
  const status = RESERVATION_LEAD_STATUSES.find((candidate) => candidate === value) ?? 'new';
  return LEAD_STATUS_LABELS_VI[status];
};

const names = (value: unknown): string =>
  Array.isArray(value)
    ? value
        .map((entry) => str((entry as { name?: unknown } | null)?.name))
        .filter(Boolean)
        .join(', ')
    : '';

export const reservationRow = (row: Row): string[] => [
  toVietnamDateTime(row.createdAt),
  str(row.fullName),
  str(row.phone),
  str(row.email),
  toDayMonthYear(row.preferredDate),
  str(row.preferredTime),
  str(row.guestCount),
  str(row.occasion),
  str(row.note),
  names(row.menuPackages),
  names(row.menuItems),
  statusLabel(row.leadStatus),
  str(row.staffNote),
  str(row.overlapCount),
  str(row.sourceLocale),
];

export const contactRow = (row: Row): string[] => [
  toVietnamDateTime(row.createdAt),
  str(row.fullName),
  str(row.email),
  str(row.phone),
  str(row.topic),
  str(row.message),
  statusLabel(row.leadStatus),
  str(row.sourceLocale),
  str(row.sourcePath),
];

export const newsletterRow = (row: Row): string[] => [
  toVietnamDateTime(row.createdAt),
  str(row.email),
  str(row.sourceLocale),
  str(row.sourcePath),
];
```

- [ ] **Step 5: Run the mapper test and confirm it passes**

Run: `pnpm vitest run src/api/lead-export/lead-export.mapper.test.ts`
Expected: PASS. If `toVietnamDateTime` prints `16/06/2030, 00:30` on some Node ICU builds, the `.replace(',', '')` already handles it. Do not change the expected value.

- [ ] **Step 6: Write the failing service test**

`lead-export.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { buildLeadExportFilters, createLeadExportService } from './lead-export.service';

const buildStrapi = (impl: Record<string, unknown>) =>
  ({ documents: vi.fn(() => impl) }) as never;

describe('lead export filters', () => {
  it('turns Vietnam calendar days into a UTC createdAt window', () => {
    expect(buildLeadExportFilters({ kind: 'reservations', from: '2030-06-01', to: '2030-06-30' }))
      .toEqual({
        $and: [
          { createdAt: { $gte: '2030-05-31T17:00:00.000Z' } },
          { createdAt: { $lt: '2030-06-30T17:00:00.000Z' } },
        ],
      });
  });

  it('splits newsletter sign-ups from contact messages', () => {
    expect(buildLeadExportFilters({ kind: 'newsletter' })).toEqual({
      $and: [{ topic: { $eq: 'newsletter' } }],
    });
    expect(buildLeadExportFilters({ kind: 'contacts' })).toEqual({
      $and: [{ $or: [{ topic: { $ne: 'newsletter' } }, { topic: { $null: true } }] }],
    });
  });
});

describe('lead export service', () => {
  it('refuses exports above the row cap', async () => {
    const service = createLeadExportService(
      buildStrapi({ count: vi.fn(async () => 10_001), findMany: vi.fn() }),
    );
    await expect(service.exportCsv({ kind: 'contacts' })).rejects.toMatchObject({
      code: 'EXPORT_TOO_LARGE',
    });
  });

  it('queries reservations oldest first with menu names', async () => {
    const findMany = vi.fn(async () => [{ fullName: 'An', leadStatus: 'new' }]);
    const service = createLeadExportService(
      buildStrapi({ count: vi.fn(async () => 1), findMany }),
    );
    const csv = await service.exportCsv({ kind: 'reservations' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: 'createdAt:asc',
        limit: 10_000,
        populate: { menuPackages: { fields: ['name'] }, menuItems: { fields: ['name'] } },
      }),
    );
    expect(csv.split('\r\n')[1]).toContain('"An"');
  });
});
```

- [ ] **Step 7: Implement the service**

`lead-export.service.ts`:

```ts
import type { Core } from '@strapi/strapi';

import { buildCsv } from '../../shared/csv/csv';
import {
  CONTACT_CSV_HEADERS,
  NEWSLETTER_CSV_HEADERS,
  RESERVATION_CSV_HEADERS,
  contactRow,
  newsletterRow,
  reservationRow,
} from './lead-export.mapper';
import { LEAD_EXPORT_MAX_ROWS, type LeadExportKind, type LeadExportQuery } from './lead-export.types';

export class LeadExportError extends Error {
  constructor(
    readonly code: 'INVALID_QUERY' | 'EXPORT_TOO_LARGE',
    message: string,
    readonly vietnameseMessage: string,
  ) {
    super(message);
  }
}

const RESERVATION_UID = 'api::reservation-request.reservation-request' as const;
const CONTACT_UID = 'api::contact-message.contact-message' as const;

const VIETNAM_OFFSET = '+07:00';

/** Start of a Vietnam calendar day as a UTC ISO string. */
const vietnamDayStart = (day: string): string =>
  new Date(`${day}T00:00:00${VIETNAM_OFFSET}`).toISOString();

const nextDay = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const KIND_FILTER: Record<LeadExportKind, Record<string, unknown> | null> = {
  reservations: null,
  newsletter: { topic: { $eq: 'newsletter' } },
  contacts: { $or: [{ topic: { $ne: 'newsletter' } }, { topic: { $null: true } }] },
};

export const buildLeadExportFilters = (query: LeadExportQuery): Record<string, unknown> => {
  const clauses: Record<string, unknown>[] = [];
  const kindFilter = KIND_FILTER[query.kind];
  if (kindFilter) clauses.push(kindFilter);
  if (query.from) clauses.push({ createdAt: { $gte: vietnamDayStart(query.from) } });
  if (query.to) clauses.push({ createdAt: { $lt: vietnamDayStart(nextDay(query.to)) } });
  return clauses.length > 0 ? { $and: clauses } : {};
};

const SOURCES = {
  reservations: {
    uid: RESERVATION_UID,
    headers: RESERVATION_CSV_HEADERS,
    toRow: reservationRow,
    populate: { menuPackages: { fields: ['name'] }, menuItems: { fields: ['name'] } },
  },
  contacts: { uid: CONTACT_UID, headers: CONTACT_CSV_HEADERS, toRow: contactRow, populate: undefined },
  newsletter: {
    uid: CONTACT_UID,
    headers: NEWSLETTER_CSV_HEADERS,
    toRow: newsletterRow,
    populate: undefined,
  },
} as const;

export const createLeadExportService = (strapi: Core.Strapi) => ({
  async exportCsv(query: LeadExportQuery): Promise<string> {
    const source = SOURCES[query.kind];
    const filters = buildLeadExportFilters(query);
    const documents = strapi.documents(source.uid);

    const total = Number(await documents.count({ filters }));
    if (total > LEAD_EXPORT_MAX_ROWS) {
      throw new LeadExportError(
        'EXPORT_TOO_LARGE',
        `Lead export matched ${total} rows.`,
        `Kết quả vượt quá ${LEAD_EXPORT_MAX_ROWS.toLocaleString('vi-VN')} dòng. Hãy chọn khoảng ngày ngắn hơn.`,
      );
    }

    const rows = (await documents.findMany({
      filters,
      sort: 'createdAt:asc',
      limit: LEAD_EXPORT_MAX_ROWS,
      ...(source.populate ? { populate: source.populate } : {}),
    })) as unknown as Record<string, unknown>[];

    return buildCsv(source.headers, rows.map(source.toRow));
  },
});
```

- [ ] **Step 8: Write the failing controller test**

`lead-export.controller.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { createLeadExportController } from './lead-export.controller';

const buildContext = (params: Record<string, unknown>, query: Record<string, unknown> = {}) => ({
  params,
  query,
  body: undefined as unknown,
  set: vi.fn(),
  badRequest: vi.fn(),
  internalServerError: vi.fn(),
  state: {},
});

const strapi = (count = 0) =>
  ({
    documents: vi.fn(() => ({ count: vi.fn(async () => count), findMany: vi.fn(async () => []) })),
    log: { error: vi.fn() },
  }) as never;

describe('lead export controller', () => {
  it('rejects an unknown kind', async () => {
    const context = buildContext({ kind: 'users' });
    await createLeadExportController(strapi()).exportCsv(context as never);
    expect(context.badRequest).toHaveBeenCalledWith('Loại dữ liệu không hợp lệ.');
  });

  it('rejects a malformed date and a reversed range', async () => {
    const bad = buildContext({ kind: 'contacts' }, { from: '15/06/2030' });
    await createLeadExportController(strapi()).exportCsv(bad as never);
    expect(bad.badRequest).toHaveBeenCalledWith('Ngày không hợp lệ. Dùng định dạng YYYY-MM-DD.');

    const reversed = buildContext({ kind: 'contacts' }, { from: '2030-06-30', to: '2030-06-01' });
    await createLeadExportController(strapi()).exportCsv(reversed as never);
    expect(reversed.badRequest).toHaveBeenCalledWith('Ngày bắt đầu phải trước ngày kết thúc.');
  });

  it('sends a named CSV attachment', async () => {
    const context = buildContext(
      { kind: 'reservations' },
      { from: '2030-06-01', to: '2030-06-30' },
    );
    await createLeadExportController(strapi()).exportCsv(context as never);
    expect(context.set).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(context.set).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="dat-ban-2030-06-01_2030-06-30.csv"',
    );
    expect(String(context.body).startsWith('﻿')).toBe(true);
  });

  it('maps the row cap to a Vietnamese bad request', async () => {
    const context = buildContext({ kind: 'contacts' });
    await createLeadExportController(strapi(10_001)).exportCsv(context as never);
    expect(context.badRequest).toHaveBeenCalledWith(
      expect.stringContaining('Kết quả vượt quá'),
    );
  });
});
```

- [ ] **Step 9: Implement the controller**

`lead-export.controller.ts`:

```ts
import type { Core } from '@strapi/strapi';

import { LeadExportError, createLeadExportService } from './lead-export.service';
import {
  LEAD_EXPORT_FILE_PREFIX,
  LEAD_EXPORT_KINDS,
  type LeadExportKind,
  type LeadExportQuery,
} from './lead-export.types';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface LeadExportContext {
  params?: { kind?: unknown };
  query?: unknown;
  body: unknown;
  set: (name: string, value: string) => void;
  badRequest: (message: string) => void;
  internalServerError: (message: string) => void;
}

const invalid = (vietnameseMessage: string) =>
  new LeadExportError('INVALID_QUERY', vietnameseMessage, vietnameseMessage);

const parseDay = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    !DAY_PATTERN.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw invalid('Ngày không hợp lệ. Dùng định dạng YYYY-MM-DD.');
  }
  return value;
};

const parseQuery = (context: LeadExportContext): LeadExportQuery => {
  const kind = LEAD_EXPORT_KINDS.find((candidate) => candidate === context.params?.kind);
  if (!kind) throw invalid('Loại dữ liệu không hợp lệ.');
  const raw = (context.query ?? {}) as Record<string, unknown>;
  const from = parseDay(raw.from);
  const to = parseDay(raw.to);
  if (from && to && from > to) throw invalid('Ngày bắt đầu phải trước ngày kết thúc.');
  return { kind, ...(from ? { from } : {}), ...(to ? { to } : {}) };
};

const fileName = (kind: LeadExportKind, from?: string, to?: string): string =>
  `${LEAD_EXPORT_FILE_PREFIX[kind]}-${from ?? 'dau'}_${to ?? 'nay'}.csv`;

export const createLeadExportController = (strapi: Core.Strapi) => {
  const service = createLeadExportService(strapi);

  return {
    async exportCsv(context: LeadExportContext): Promise<void> {
      try {
        const query = parseQuery(context);
        const csv = await service.exportCsv(query);
        context.set('Content-Type', 'text/csv; charset=utf-8');
        context.set(
          'Content-Disposition',
          `attachment; filename="${fileName(query.kind, query.from, query.to)}"`,
        );
        context.body = csv;
      } catch (error) {
        if (error instanceof LeadExportError) {
          context.badRequest(error.vietnameseMessage);
          return;
        }
        strapi.log.error('Lead export failed.', { error });
        context.internalServerError('Không thể xuất dữ liệu lúc này. Vui lòng thử lại sau.');
      }
    },
  };
};
```

- [ ] **Step 10: Register the permission and route**

`src/api/lead-export/index.ts`:

```ts
import type { Core } from '@strapi/strapi';

import { createLeadExportController } from './lead-export.controller';
import { ApiLeadExportPermission, LEAD_EXPORT_ROUTE } from './lead-export.types';

const LEAD_EXPORT_ACTIONS = [
  {
    section: 'settings',
    displayName: 'Xuất CSV khách hàng (đặt bàn, liên hệ, newsletter)',
    uid: 'lead-export.export',
    pluginName: 'admin',
    category: 'lead export',
    subCategory: 'export',
  },
] as const;

export const registerLeadExportPermissions = (strapi: Core.Strapi): void => {
  strapi.admin.services.permission.actionProvider.registerMany([...LEAD_EXPORT_ACTIONS]);
};

export const bootstrapLeadExportPermissions = async (strapi: Core.Strapi): Promise<void> => {
  const roleService = strapi.admin.services.role as unknown as {
    resetSuperAdminPermissions(): Promise<void>;
  };
  await roleService.resetSuperAdminPermissions();
};

export const registerLeadExportAdminRoutes = (strapi: Core.Strapi): void => {
  const controller = createLeadExportController(strapi);
  strapi.server.api('admin').routes([
    {
      method: 'GET',
      path: LEAD_EXPORT_ROUTE,
      handler: controller.exportCsv as never,
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        auth: { scope: [ApiLeadExportPermission.Export] },
      },
    },
  ]);
};
```

In `src/index.ts`, import the three functions. Call `registerLeadExportPermissions(strapi)` and `registerLeadExportAdminRoutes(strapi)` right after the reservation inbox register calls, and `await bootstrapLeadExportPermissions(strapi)` right after `bootstrapReservationInboxPermissions`.

- [ ] **Step 11: Run all the tests**

Run: `pnpm vitest run src/api/lead-export && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 12: Commit (after user OK)**

```bash
git add src/api/lead-export src/index.ts
git commit -m "feat(leads): permission-gated CSV export of reservations, contacts and newsletter"
```

### Task 9: Admin screen "Xuất dữ liệu khách"

**Files:**
- Create: `src/admin/lead-export/LeadExportScreen.tsx`
- Create: `src/admin/lead-export/lead-export.helper.ts`
- Create: `src/admin/lead-export/lead-export.helper.test.ts`
- Modify: `src/admin/app.tsx` (one `addMenuLink` after the reservation-requests link, around line 156)

**Interfaces:**
- Consumes: `GET /lead-export/:kind` (Task 8).
- Produces: `buildLeadExportPath(kind, from, to): string`, `leadExportPermissions`, `LEAD_EXPORT_KIND_LABELS`.

- [ ] **Step 1: Write the failing helper test**

```ts
import { describe, expect, it } from 'vitest';

import { buildLeadExportPath, defaultExportRange } from './lead-export.helper';

describe('lead export helper', () => {
  it('builds the export path with optional dates', () => {
    expect(buildLeadExportPath('reservations', '2030-06-01', '2030-06-30')).toBe(
      '/lead-export/reservations?from=2030-06-01&to=2030-06-30',
    );
    expect(buildLeadExportPath('newsletter', '', '')).toBe('/lead-export/newsletter');
  });

  it('defaults to the current month in local time', () => {
    expect(defaultExportRange(new Date(2030, 5, 15))).toEqual({
      from: '2030-06-01',
      to: '2030-06-15',
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/admin/lead-export`
Expected: FAIL, the module cannot be resolved.

- [ ] **Step 3: Implement the helper**

```ts
import { localDateKey } from '../dashboard-widgets/dashboard-widgets.helper';

export type LeadExportKind = 'reservations' | 'contacts' | 'newsletter';

export const LEAD_EXPORT_KIND_LABELS: Record<LeadExportKind, string> = {
  reservations: 'Yêu cầu đặt bàn',
  contacts: 'Tin nhắn liên hệ',
  newsletter: 'Đăng ký nhận tin (newsletter)',
};

export const leadExportPermissions = [
  { action: 'admin::lead-export.export', subject: null },
];

export const buildLeadExportPath = (kind: LeadExportKind, from: string, to: string): string => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return `/lead-export/${kind}${query ? `?${query}` : ''}`;
};

export const defaultExportRange = (now: Date): { from: string; to: string } => ({
  from: localDateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
  to: localDateKey(now),
});
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm vitest run src/admin/lead-export`
Expected: PASS.

- [ ] **Step 5: Build the screen**

`LeadExportScreen.tsx`:

```tsx
import { useState, type ChangeEvent } from 'react';

import { Button, Field, Flex, SingleSelect, SingleSelectOption, TextInput, Typography } from '@strapi/design-system';
import { FileCsv } from '@strapi/icons';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';

import {
  buildLeadExportPath,
  defaultExportRange,
  LEAD_EXPORT_KIND_LABELS,
  leadExportPermissions,
  type LeadExportKind,
} from './lead-export.helper';

const readBlobError = async (error: unknown): Promise<string | null> => {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text()) as { error?: { message?: string } };
      return parsed.error?.message ?? null;
    } catch {
      return null;
    }
  }
  return null;
};

const LeadExportScreen = () => {
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const initial = defaultExportRange(new Date());
  const [kind, setKind] = useState<LeadExportKind>('reservations');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [exporting, setExporting] = useState(false);

  const onExport = async () => {
    setExporting(true);
    try {
      const response = await get(buildLeadExportPath(kind, from, to), {
        responseType: 'blob',
      } as never);
      const disposition = String(
        (response as { headers?: Record<string, string> }).headers?.['content-disposition'] ?? '',
      );
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${kind}.csv`;
      const url = URL.createObjectURL(
        new Blob([response.data as BlobPart], { type: 'text/csv;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: (await readBlobError(error)) ?? 'Không thể xuất dữ liệu lúc này. Vui lòng thử lại.',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Page.Protect permissions={leadExportPermissions}>
      <Page.Title>Xuất dữ liệu khách</Page.Title>
      <Page.Main>
        <Layouts.Header
          subtitle="Tải file CSV mở được bằng Excel. Lọc theo ngày khách gửi."
          title="Xuất dữ liệu khách"
        />
        <Layouts.Content>
          <Flex alignItems="flex-end" background="neutral0" gap={4} hasRadius padding={6} shadow="tableShadow" wrap="wrap">
            <Field.Root name="kind">
              <Field.Label>Loại dữ liệu</Field.Label>
              <SingleSelect onChange={(value: string | number) => setKind(value as LeadExportKind)} value={kind}>
                {(Object.keys(LEAD_EXPORT_KIND_LABELS) as LeadExportKind[]).map((key) => (
                  <SingleSelectOption key={key} value={key}>
                    {LEAD_EXPORT_KIND_LABELS[key]}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
            <Field.Root name="from">
              <Field.Label>Từ ngày</Field.Label>
              <TextInput onChange={(event: ChangeEvent<HTMLInputElement>) => setFrom(event.target.value)} type="date" value={from} />
            </Field.Root>
            <Field.Root name="to">
              <Field.Label>Đến ngày</Field.Label>
              <TextInput onChange={(event: ChangeEvent<HTMLInputElement>) => setTo(event.target.value)} type="date" value={to} />
            </Field.Root>
            <Button loading={exporting} onClick={() => void onExport()} startIcon={<FileCsv />}>
              Xuất CSV
            </Button>
          </Flex>
          <Typography tag="p" textColor="neutral600" variant="pi">
            Để trống cả hai ngày để xuất toàn bộ. Tối đa 10.000 dòng mỗi lần.
          </Typography>
        </Layouts.Content>
      </Page.Main>
    </Page.Protect>
  );
};

export default LeadExportScreen;
```

- [ ] **Step 6: Add the menu link**

In `src/admin/app.tsx`, import `Download` from `@strapi/icons` (next to `Bell`, `Calendar`, `Mail`) and `leadExportPermissions` from `./lead-export/lead-export.helper`. Then add:

```ts
    app.addMenuLink({
      to: '/plugins/lead-export',
      icon: Download,
      intlLabel: { id: 'lead-export.title', defaultMessage: 'Xuất dữ liệu khách' },
      Component: () => import('./lead-export/LeadExportScreen'),
      permissions: leadExportPermissions,
      position: 0.4,
    });
```

- [ ] **Step 7: Build and check it by hand**

Run: `pnpm run typecheck && pnpm run lint && pnpm run build && pnpm run develop`
Then check in `/admin`:
- The super admin sees "Xuất dữ liệu khách" in the sidebar.
- A role without "Xuất CSV khách hàng" does not see the link, and calling `GET /admin/lead-export/contacts` with that role returns 403.
- Export each of the 3 kinds and open the files in Excel. Vietnamese diacritics show correctly, and a phone number starting with `+84` shows as `'+84…` (formula guard).
- A reversed date range shows "Ngày bắt đầu phải trước ngày kết thúc."
- The newsletter file contains only `topic=newsletter` rows, and the contacts file contains none of them.

- [ ] **Step 8: Commit (after user OK)**

```bash
git add src/admin/lead-export src/admin/app.tsx
git commit -m "feat(admin): export leads to CSV from a dedicated screen"
```

---

## Part D — Data-gated: opening hours and drinks

Start these only when the owner sends the data. Nothing here invents content.

### Task 10: Opening hours (data only, no code)

The code path already exists end to end: `global-setting.openingHours` (repeatable `shared.operating-period`, localized `label`, shared `opensAt`/`closesAt`). The web adapter is `salanca-web/src/lib/cms/global-setting.ts:391`; it renders in the footer and on the contact page, and `openingHoursSpecification` goes into the Restaurant JSON-LD (`src/lib/seo/structured-data.ts:125`).

- [ ] **Step 1: Enter the data in local Admin.** Go to Content Manager → Cài đặt chung → `vi`. Add one row per period, for example label "Trưa", 11:00 to 14:00, and label "Tối", 17:00 to 22:00. Publish. Switch to `en` and enter the same times with English labels ("Lunch", "Dinner"). Publish.
- [ ] **Step 2: Check on local web.** On `/vi` and `/en`, the footer shows the hours. On `/vi/lien-he`, the hours channel is filled. Run `curl -s http://localhost:3000/vi | grep -o '"openingHoursSpecification":\[[^]]*\]'` and expect one entry per period with `opens`/`closes` in `HH:mm`.
- [ ] **Step 3: Check booking times.** `salanca-web/src/lib/booking/reservation-slots.ts` limits arrival times to service hours (backend commit `c1c37a1`). Read it and confirm whether it uses CMS hours or a hard-coded window. If it is hard-coded and differs from the owner's hours, raise that with the user before changing it.
- [ ] **Step 4: Put the data in the seed.** Patch `data/content-release/bundle.json` → `payload` → global-setting `vi` and `en` → `openingHours` with the same rows, surgically. Do **not** run `export:cms-seed`. No schema changed, so `schemaHash` stays the same. Run `pnpm vitest run scripts/production-content.test.ts scripts/content-bundle.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit (after user OK).** `git commit -m "content: publish opening hours from the owner"`

### Task 11: Drinks tab

An active `menu-category` that has items already shows up as a menu tab. This task gives it a clean URL (`/vi/thuc-don/do-uong`, `/en/menu/drinks`), a sitemap entry and a working language switch. **Merge the web change only together with published drinks data.** `SECTIONS` feeds the sitemap unconditionally, so an empty drinks category would put a thin page in the sitemap.

**Files (salanca-web):**
- Modify: `src/lib/catalog/menu-section-paths.ts:23-30`
- Test: `src/lib/catalog/menu-section-paths.test.ts`

- [ ] **Step 1: Create the data in local Admin.** Create a `menu-category` with VI name "Đồ uống", slug `do-uong`; EN name "Drinks", slug `drinks`. Set `displayOrder` before Catering and `isActive` on. Create the drink `menu-item`s in both locales with owner prices, and link them to the category. Publish both locales.
- [ ] **Step 2: Write the failing test** (append to `menu-section-paths.test.ts`):

```ts
  it("gives drinks its own tab path in both locales", () => {
    expect(menuSectionPublicPath("do-uong", "vi")).toBe("/vi/thuc-don/do-uong");
    expect(menuSectionPublicPath("drinks", "en")).toBe("/en/menu/drinks");
    expect(categorySlugForLocale("do-uong", "en")).toBe("drinks");
    expect(MENU_SITEMAP_SECTION_IDS).toContain("drinks");
  });
```

- [ ] **Step 3: Run it and confirm it fails.** Run `pnpm vitest run src/lib/catalog/menu-section-paths.test.ts` in `salanca-web`. Expected: FAIL, the first assertion receives `undefined`.
- [ ] **Step 4: Implement it.** In `SECTIONS`, insert this before the catering entry:

```ts
  { id: "drinks", kind: "category", vi: "do-uong", en: "drinks" },
```

- [ ] **Step 5: Run the tests and check the pages.** Run `pnpm vitest run src/lib/catalog && pnpm run typecheck`. Then open `/vi/thuc-don/do-uong`, switch the language, and confirm you land on `/en/menu/drinks`. Check that `/sitemap.xml` lists both URLs with hreflang, and that every drinks price shows in the same format as the other tabs.
- [ ] **Step 6: Put the data in the seed.** Add the category and items to `data/content-release/bundle.json` (`collectionFields` already covers `menu-category` and `menu-item`). No schema change, so `schemaHash` stays the same.
- [ ] **Step 7: Commit (after user OK)**, one commit per repo:
  - web: `feat(menu): drinks tab with its own VI/EN path`
  - backend: `content: drinks menu from the owner`

---

## Data and rollback

- Migration: none. Strapi adds the `staff_note` column and accepts the new enum values on boot (Postgres stores enums as varchar). Existing rows are untouched.
- Compatibility: the public API is unchanged. `staffNote` is private. The live inbox and the staff email are unchanged.
- Rollback: revert the commits. Before reverting Task 1 on a database that already has rows with `confirmed`, `cancelled` or `no_show`, run `UPDATE reservation_requests SET lead_status = 'read' WHERE lead_status IN ('confirmed','cancelled','no_show');`. Otherwise the reverted enum rejects those rows when they are edited in Content Manager. The `staff_note` column can stay; Strapi ignores unknown columns.

## Verification

- Automated (backend): `pnpm run check` (lint, verify:schema, typecheck, test, build), then `pnpm run check:forms` with Postgres.
- Automated (web, Task 11 only): `pnpm run typecheck && pnpm vitest run`.
- Manual UAT (owner/staff):
  - Work one test booking through new → confirmed → no-show with a note, and see the dashboard "today" count drop.
  - Book with an email in VI and in EN, and check both receipts (wording, hotline, Reply-To).
  - Export all 3 CSVs and open them in Excel.
  - Check that a role without the export permission cannot see or call the export.
- Evidence to record: add a dated entry to `docs/STATUS.md` with the commands run, the test count and the open UAT items.

## Documentation impact

- `docs/STATUS.md`: a dated entry per part.
- `docs/cms-editor-guide.md`: a short "Xử lý đặt bàn" section (meaning of each status, note) and a "Xuất dữ liệu khách" section.
- `docs/admin-roles.md`: the new `lead-export.export` permission and UAT rows.
- `docs/resend-email-operations.md` and `.env.example`: the guest receipt flag (Task 6).
- `docs/cms-api-contract.md`: one line saying a guest receipt may be sent after a reservation create.

## Risks and blockers

- Guest receipt to a mistyped or someone else's address. Mitigation: opt-in flag, Turnstile, per-IP rate limit, neutral copy with no links. The owner accepts this or keeps the flag off.
- Resend sender domain: `EMAIL_FROM_ADDRESS` must belong to `EMAIL_SENDER_DOMAIN`, which must be verified in Resend before production. Otherwise every receipt bounces. This is checked at boot by the transactional email config.
- `full_documentation.json` (documentation plugin) still lists the old enum until it is regenerated. It is not served publicly; regenerate it when convenient.
- Part D is blocked on owner data (Z-list).

## Completion record

- _Fill in per task: commands run, results, and open manual gates._
