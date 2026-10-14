# Zalo ZNS — tin nhắn mẫu qua Zalo OA (O13)

Provider code: `zalo` (channel `zalo`). Loại: notification provider. **Tắt mặc định** — kênh ZNS chỉ hoạt động khi mẫu ZNS đã được Zalo duyệt và rule map template đã khai báo `templateId`.

## Nguồn tài liệu chính thức

- API gửi tin theo mẫu: <https://docs.zaloplatforms.com/docs/ZBS/gui-tin-template-qua-sdt/api-gui-tin-qua-sdt/api-gui-tin> (đọc 2026-10-13)
- Bảng mã lỗi: <https://docs.zaloplatforms.com/docs/ZBS/bang-ma-loi> (đọc 2026-10-13)
- OAuth OA (refresh access token): <https://docs.zaloplatforms.com/open-apis> (đọc 2026-10-13)

## Endpoint

| Việc | Endpoint |
| --- | --- |
| Gửi ZNS | `POST https://business.openapi.zalo.me/message/template` header `access_token` |
| Refresh token | `POST https://oauth.zaloapp.com/v4/oa/access_token` form `{app_id, grant_type:'refresh_token', refresh_token}` header `secret_key` |

## Request/response

- Body: `{ phone, template_id, template_data, tracking_id }`.
  - `phone`: số VN chuẩn hóa `84xxxxxxxxx` (không `+`).
  - `template_id`: id mẫu **đã duyệt** — cấu hình per-template trong `notification-channel-rule.zns.templateId`.
  - `template_data`: object tham số của mẫu — rule `zns.params` map `{paramZNS: biếnPlugin}`.
  - `tracking_id` (≤48 ký tự, không ký tự đặc biệt): `nd-<deliveryRowId>` — idempotency/đối soát; resend cùng tracking_id.
- Response: `{ error: 0, message: "Success", data: { msg_id, sent_time, quota } }`. `error != 0` → thất bại.
- Mã lỗi đáng chú ý: `-109` template id sai; `-1121/-1122/-1123` dữ liệu tham số sai/thiếu; `-117` OA chưa được cấp quyền mẫu; `-124` access token hết hạn/sai → refresh rồi thử lại **một** lần.

## Rate limit / giới hạn

- ZNS có quota theo OA (response trả `quota.dailyQuota`); tài liệu không công bố rate limit chu kỳ. Kênh ZNS đi qua giới hạn chung `notifications.dailyLimit` (mặc định 2000/ngày) ở lõi.
- Token access có hạn ~1h; refresh token được dùng qua OAuth khi cấu hình đủ `ZALO_APP_ID`/`ZALO_APP_SECRET`/`ZALO_REFRESH_TOKEN`.

## Env / cấu hình

Bắt buộc khi bật: `ZALO_ACCESS_TOKEN` **hoặc** bộ ba OAuth (`ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_REFRESH_TOKEN`).
Tùy chọn: `ZALO_BASE_URL` (mặc định `https://business.openapi.zalo.me` — test giả lập ghi đè), `ZALO_OAUTH_URL` (mặc định `https://oauth.zaloapp.com/v4/oa/access_token`).

## Ghi chú

- Mẫu chưa duyệt → Zalo trả `-109`/`-117`: không fallback âm thầm sang kênh khác mà không ghi log; lỗi này đánh dấu delivery `failed` và để kênh tiếp theo trong rule xử lý.
- Không lưu số điện thoại trong bảng gửi — `recipientHash` là SHA-256 của số chuẩn hóa; `providerMessageId` giữ `msg_id` để đối soát.
