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

## Manual UAT checklist

- [ ] Editor cannot open API Tokens, Transfer Tokens, or plugin marketplace settings.
- [ ] Publisher/Super Admin can publish and unpublish localized entries independently (VI vs EN).
- [ ] Editor can upload media and attach `shared.image` with alt text.
- [ ] Deleting a media file still used by a document is blocked with a clear error.
- [ ] Content API Public role remains read-only (`find` / `findOne`); no public create/update/delete.
- [ ] A role without `audit-log.read` does not see `Nhật ký hoạt động` in the menu and gets 403 on `/admin/audit-log/events`.
- [ ] A role without `reservation-inbox.read` does not see `Hộp thư đặt bàn` or the unread pill, and gets 403 on `/reservation-inbox/summary`.
- [ ] A role with `read` but not `details` sees event rows but no technical metadata in the drawer.
- [ ] A role with `export` can download CSV; exporting > 31 days fails instead of truncating.
- [ ] Creating/editing a CMS entry and deleting a media file each produce exactly one `audit_events` row with a `request_id`.

## API tokens (server-to-server)

- Prefer read-only custom tokens scoped to required content types.
- Never put admin JWT or full-access tokens in frontend env files.
- Rotate tokens when people leave or tokens leak.

## Notes

Exact permission matrices depend on Strapi edition and version. Document any Community edition limits honestly after UAT; do not claim Enterprise RBAC features that are unavailable.
