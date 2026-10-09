# Resend transactional email (form lead notify)

Scope: SMTP transport for **staff notifications** when a public form lead is
created (`contact-message`, `reservation-request`). Pattern lifted from
Nhà Thật / BDS (`config/transactional-email.helper.ts` + Nodemailer provider).

Resend transports mail only. It is not a second CMS or booking system.

## Opt-in

| Condition | Behaviour |
| --- | --- |
| `EMAIL_SMTP_HOST` unset | Email plugin not configured; forms work; no mail. The Admin screen shows a red notice. |
| Host set, Admin settings never saved | Every kind notifies `FORM_NOTIFY_TO` (empty = no notify). |
| Host set, Admin settings saved | Each kind notifies its own list from **Email thông báo**. An empty list turns that kind off. `FORM_NOTIFY_TO` is used only for a kind added after the last save, or when the settings row cannot be read (logged as a warn). |

Delivery is **scheduled after** the public `201` response is prepared so SMTP
latency does not block the client. Failure is **logged**
(`form lead notify failed`) and **never** turns a create into an error. There is
no application-level retry queue. Invalid `FORM_NOTIFY_TO` (set but no valid
addresses) logs a warn and skips send.

## Production Resend profile

| Setting | Value |
| --- | --- |
| Host | `smtp.resend.com` only |
| Port | `587` or `2587` (STARTTLS) or `465` (implicit TLS) |
| User | always `resend` |
| Password | Resend API key (`re_...`) → `EMAIL_SMTP_KEY` |
| From / Reply-To | Must belong to `EMAIL_SENDER_DOMAIN` (verified in Resend) |

References: [Resend SMTP](https://resend.com/docs/send-with-smtp),
[API keys](https://resend.com/api-keys), [Domains](https://resend.com/domains).

## Local capture

```env
EMAIL_SMTP_HOST=localhost
EMAIL_SMTP_PORT=1025
EMAIL_FROM_NAME=Salanca
EMAIL_FROM_ADDRESS=no-reply@salanca.local
EMAIL_REPLY_TO=booking@salanca.local
FORM_NOTIFY_TO=you@example.com
```

Use Mailpit or similar on port 1025. Auth optional for capture.

## Dev against real Resend

Outside production, non-loopback hosts require:

```env
EMAIL_ALLOW_EXTERNAL_DELIVERY=true
EMAIL_SMTP_HOST=smtp.resend.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=resend
EMAIL_SMTP_KEY=re_...
EMAIL_SMTP_REQUIRE_TLS=true
EMAIL_SMTP_SECURE=false
```

## Guest reservation receipt

Always on once the SMTP settings above are configured (owner decision 2026-10-08, no
separate flag). When a guest leaves an email on the reservation form, they get a short
receipt in the language of the page they booked from (`sourceLocale`).

- The receipt says the request was **received, not confirmed**. Staff still call to confirm.
- From / Reply-To are `EMAIL_FROM_*` / `EMAIL_REPLY_TO`, so a guest reply reaches the booking inbox.
- Brand name, hotline and address come from the published `global-setting` in the guest's locale;
  missing values are left out.
- Sent after the 201 response; failures are logged with `documentId` and an error code only.
- Anyone can type another person's address into the form. Turnstile and the per-IP rate limit
  bound the volume; the email has no links or marketing copy.

## Staff recipients in Admin

Admin → **Cài đặt → Salanca → Email thông báo** (permission `admin::notification-settings.manage`) holds one list per
form kind: Đặt bàn (`reservation-request`) and Liên hệ (`contact-message`, newsletter included).
Max 10 addresses per kind. Stored in Strapi's core store (`plugin_salanca_notification-settings`),
not in content, so it is per environment and not part of the content release.

"Gửi thử" sends a sample to the **saved** list of that kind, at most once per 30 s (a failed send
does not start the wait). Before the first save the button is off; Lưu is always on so the env
default can be taken over unchanged. If `FORM_NOTIFY_TO` holds more than 10 addresses, the screen
warns and keeps the first 10. Each save writes one `notification_settings_update` audit row (no
addresses in the row).

## Ownership (fill before launch)

| Area | Owner |
| --- | --- |
| Resend account / plan | TBD |
| Sender domain DKIM | TBD |
| Staff notification mailboxes (Admin → Email thông báo) | TBD |
| API key rotation | TBD |

## Code map

| Piece | Path |
| --- | --- |
| SMTP config | `config/transactional-email.helper.ts` |
| Plugin wire | `config/plugins.ts` (when host set) |
| Message + parse recipients | `src/domain/form-intake/form-lead-notify.ts` |
| Strapi send adapter | `src/domain/form-intake/send-form-lead-notify.ts` |
| Guest receipt message | `src/domain/form-intake/reservation-confirmation-email.ts` |
| Guest receipt sender | `src/domain/form-intake/send-reservation-confirmation.ts` |
| Recipient settings (pure) | `src/domain/notification-settings/notification-settings.ts` |
| Recipient settings store | `src/domain/notification-settings/notification-settings.store.ts` |
| Admin routes | `src/api/notification-settings/` |
| Admin screen | `src/admin/notification-settings/` |
