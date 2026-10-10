# Admin roles matrix (Phase 4C)

Community Strapi Admin roles should be configured in Admin → Settings → Administration panel → Roles.

| Role | Intended use | Content | Publish | Media | Users / tokens / plugins |
| --- | --- | --- | --- | --- | --- |
| Super Admin | Technical owners | Full | Full | Full | Full |
| Editor | Day-to-day content | Create/update/delete content | Optional deny | Upload/select | Deny |
| Author (optional) | Draft-only writers | Create/update own or all content per policy | Deny | Upload/select | Deny |

## Audit log permissions (2026-10-04)

The `Nhật ký hoạt động` screen and `/admin/audit-log/*` routes are gated by
three actions registered under **Settings → Roles → Plugins → Audit log**:

| Action | Unlocks |
| --- | --- |
| `admin::audit-log.read` | List screen + event list route |
| `admin::audit-log.details` | Technical metadata in the detail drawer (request ID, method, path, status code, field names) |
| `admin::audit-log.export` | CSV export button + export route |

Bootstrap grants all three to Super Admin. Other roles default to deny.

## Reservation inbox permissions (2026-10-04)

The `Hộp thư đặt bàn` menu link, the floating unread indicator/toast widget and
the `/reservation-inbox/*` routes are gated by one action registered under
**Settings → Roles → Plugins → Reservation inbox**:

| Action | Unlocks |
| --- | --- |
| `admin::reservation-inbox.read` ("Xem hộp thư đặt bàn") | Menu link, live toast/pill widget, inbox screen, and the summary/stream/mark-read routes |

Bootstrap grants it to Super Admin. Other roles default to deny — grant it to
Editors who triage reservation leads. Without it the menu link and pill are
hidden and the routes return 403.

## Lead export permission (2026-10-08)

The "Xuất CSV" button on the Yêu cầu đặt bàn and Tin nhắn liên hệ lists (2026-10-09: replaced
the former `Xuất dữ liệu khách` screen) and `GET /admin/lead-export/:kind` are gated by
one action under **Settings → Roles → Plugins → Lead export**:

| Action | Unlocks |
| --- | --- |
| `admin::lead-export.export` ("Xuất CSV khách hàng (đặt bàn, liên hệ, newsletter)") | "Xuất CSV" button on the two lead lists and the CSV route for reservations, contact messages and newsletter sign-ups |

It is a bulk download of guest personal data, so it is separate from Content
Manager read. Bootstrap grants it to Super Admin only.

## Notification settings permission (2026-10-09)

The `Email thông báo` link (Settings → Salanca, 2026-10-09: moved off the main menu) and
`/admin/notification-settings*` routes are gated by one
action under **Settings → Roles → Plugins → Notification settings**:

| Action | Unlocks |
| --- | --- |
| `admin::notification-settings.manage` ("Cài đặt email nhận thông báo (đặt bàn, liên hệ)") | Settings link, screen, save and "Gửi thử" |

Bootstrap grants it to Super Admin. Owner decision (2026-10-09): managers may edit too. Strapi
Community has no Manager role, so create it once: Settings → Roles → "Add new role" → name
`Quản lý`, copy the Editor permissions you want, tick this action, save, then assign it to the
manager's account.

## Ordering plugin catalog permissions (2026-10-10)

Two actions under **Settings → Roles → Plugins → Ordering** gate the O2 catalog screens and
their `/ordering/*` admin routes:

| Action | Unlocks |
| --- | --- |
| `plugin::ordering.catalog.manage` ("Quản lý danh mục bán hàng") | The `Danh mục` screen: category tree create/edit/delete/move, and the `Tạm hết món` screen including toggles |
| `plugin::ordering.catalog.toggle-availability` ("Bật/tắt tạm hết món") | Only the `Tạm hết món` screen: branch select, entity list, Còn/Hết toggles |

The two actions overlap deliberately: `catalog.manage` is the full-capability grant for
managers; `catalog.toggle-availability` is the narrow grant for branch staff. Either action
opens the availability screen (the routes accept both). Branch staff are additionally
limited by their `staff-location-scope` row — a staff member scoped to Q1 gets 403 on
any read or toggle targeting Q3. Every toggle appends an `admin-change-log` row with the
actor ref and branch.

Bootstrap grants both to Super Admin. Other roles default to deny. Grant
`catalog.toggle-availability` (+ a `staff-location-scope` row) to branch staff, and
`catalog.manage` to the `Quản lý` role.

## Manual UAT checklist

- [ ] Editor cannot open API Tokens, Transfer Tokens, or plugin marketplace settings.
- [ ] Publisher/Super Admin can publish and unpublish localized entries independently (VI vs EN).
- [ ] Editor can upload media and attach `shared.image` with alt text.
- [ ] Deleting a media file still used by a document is blocked with a clear error.
- [ ] Content API Public role remains read-only (`find` / `findOne`); no public create/update/delete.
- [ ] A role without `audit-log.read` does not see `Nhật ký hoạt động` in the menu and gets 403 on `/admin/audit-log/events`.
- [ ] A role without `reservation-inbox.read` does not see `Hộp thư đặt bàn` or the unread pill, and gets 403 on `/reservation-inbox/summary`.
- [ ] A role without `lead-export.export` does not see the "Xuất CSV" button on the lead lists and gets 403 on `/admin/lead-export/contacts`.
- [ ] A role without `notification-settings.manage` does not see `Email thông báo` under Settings and gets 403 on `/admin/notification-settings`.
- [ ] The `Quản lý` role with the action can save recipients and send a test.
- [ ] Each export (đặt bàn, liên hệ, newsletter) opens in Excel with correct Vietnamese text; the newsletter file holds only `topic=newsletter` rows and the contacts file none.
- [ ] A role with `read` but not `details` sees event rows but no technical metadata in the drawer.
- [ ] A role with `export` can download CSV; exporting > 31 days fails instead of truncating.
- [ ] Creating/editing a CMS entry and deleting a media file each produce exactly one `audit_events` row with a `request_id`.
- [ ] A role without `catalog.manage` does not see the `Danh mục` screen and gets 403 on `/ordering/categories`.
- [ ] A staff member with `catalog.toggle-availability` scoped to Q1 sees only Q1 in the branch select and gets 403 toggling at another branch.
- [ ] Marking a product "Hết ngày kinh doanh" hides it from the public catalog until the configured day-close; toggling "Còn" restores it immediately and writes a change-log row.

## API tokens (server-to-server)

- Prefer read-only custom tokens scoped to required content types.
- Never put admin JWT or full-access tokens in frontend env files.
- Rotate tokens when people leave or tokens leak.

## Notes

Exact permission matrices depend on Strapi edition and version. Document any Community edition limits honestly after UAT; do not claim Enterprise RBAC features that are unavailable.
