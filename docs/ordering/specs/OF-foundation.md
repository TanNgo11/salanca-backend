# OF — Nền tảng generic

## 1. Mục tiêu

Dựng các khung dùng chung để plugin tách được khỏi Salanca và cắm thêm được cổng thanh toán, kênh thông báo, máy
in mà **không sửa lõi**. Gom các quyết định ngày 2026-10-11 vào code **trước** khi O3 bắt đầu lưu dữ liệu thật.

## 2. Trạng thái

📝 **Phase mới, chưa code.** Làm sau O2, trước O3a.

## 3. Input / Output

### 3.1. Ranh giới package
- `server/src/public.ts`: export mọi interface và type provider được phép dùng.
- ESLint `no-restricted-imports`: lõi không import `src/api`, `src/ordering`, plugin provider; provider chỉ
  import `public.ts`.

### 3.2. Registry provider chung
Mỗi provider (thanh toán, kênh thông báo, giao hàng, máy in, captcha) đăng ký:

```ts
type ProviderManifest = {
  id: string;                 // 'sepay', 'momo', 'email-smtp', 'browser-print'
  kind: 'payment' | 'notification' | 'fulfillment' | 'printer' | 'captcha';
  name: LocalizedText;
  configSchema: ConfigField[];   // Admin tự sinh form; field `secret: true` được mã hóa
  capabilities: string[];        // 'refund', 'webhook', 'reconcile', 'partialRefund', ...
  presentation?: 'qr' | 'redirect' | 'embedded' | 'offline';  // chỉ cho payment
  testConnection?(config: ProviderConfig): Promise<ConnectionResult>;
};
```

**Admin API:**

| Route | Input | Output |
| --- | --- | --- |
| `GET /ordering/providers` | — | danh sách provider đã cài + trạng thái cấu hình (không trả secret) |
| `PUT /ordering/providers/:id/config` | giá trị theo `configSchema` | phiên bản cấu hình mới ở trạng thái `pending` |
| `POST /ordering/providers/:id/test` | — | kết quả kiểm tra kết nối |
| `POST /ordering/providers/:id/activate` | `versionId` | phiên bản `active`; bản cũ thành `retiring` (còn nhận webhook tới hạn) |

Lỗi: `PROVIDER_NOT_FOUND`, `PROVIDER_CONFIG_INVALID` (kèm field), `PROVIDER_TEST_FAILED`.

### 3.3. Keyring
- Env: `ORDERING_ENCRYPTION_KEYS=k2:<base64>,k1:<base64>`, `ORDERING_ENCRYPTION_ACTIVE_KID=k2`.
- Bản mã: `v1.<kid>.<iv>.<tag>.<ciphertext>` (AES-256-GCM).
- Webhook secret dạng danh sách, thử lần lượt, ghi `kid` khớp.
- Job mã hóa lại dữ liệu sang key mới; báo còn bao nhiêu bản ghi dùng key cũ.
- Bootstrap từ chối chạy khi thiếu key active, key sai định dạng, hoặc có dữ liệu dùng `kid` không có trong keyring.

### 3.4. Khung cài đặt
- Cài đặt **chung** và **theo chi nhánh**, có kiểu và giá trị mặc định (danh sách ở `highlevel.md` mục 11).
- Admin API: `GET /ordering/settings?scope=`, `PUT /ordering/settings` (validate theo schema).
- Mỗi lần đổi ghi `admin-change-log` (ai, lúc nào, cũ → mới). **Chỉ áp cho đơn mới**: đơn lưu snapshot cài đặt
  liên quan lúc tạo.

### 3.5. Khung thông báo
- Sự kiện lõi phát ra (`order.placed`, `payment.received`, `order.accepted`, `order.ready`, `order.rejected`,
  `order.cannot-complete`, `order.delivering`, `payment.mismatch`, …).
- Quy tắc: **sự kiện × người nhận × kênh × mẫu tin**, kèm thứ tự kênh dự phòng.
- Interface `NotificationChannel.send(message): Promise<DeliveryResult>`; nhật ký gửi; mỗi
  (sự kiện, người nhận, kênh) gửi đúng một lần.

### 3.6. Interface máy in
`PrinterProvider.render(order, template, paper): PrintJob`; mẫu **phiếu bếp** (không giá) và **hóa đơn khách**
(có giá); khổ 58mm / 80mm / A5. Bản đầu chỉ có `browser-print` (O3b).

### 3.7. Thay đổi workflow và timeline
- Thêm bước **"Không thể hoàn tất"** (`cannot-complete`) từ "Đã nhận" và "Đang chuẩn bị"; bắt buộc lý do; nếu
  đã thu tiền thì tạo khoản hoàn tiền; báo cáo tách riêng với "Hủy".
- Timeline/audit lưu `actorId` **và tên người thao tác tại thời điểm đó**, để vẫn đọc được khi tài khoản bị vô
  hiệu hóa.
- Danh sách lý do có sẵn (từ chối, hủy, không thể hoàn tất) là cài đặt VI/EN.

## 4. Đã làm

Chưa có. Phần O1 dùng lại được: registry có kiểu (`services/registry.ts`), outbox, change-log, workflow engine.

## 5. Chưa làm (thứ tự đề xuất)

1. `public.ts` + luật ESLint.
2. Keyring + định dạng bản mã + health check bootstrap + job mã hóa lại.
3. Registry provider chung + lưu cấu hình có phiên bản (secret mã hóa) + Admin API.
4. Khung cài đặt + change-log + snapshot vào đơn.
5. Khung thông báo (chưa có kênh thật; kênh test ghi log).
6. Interface máy in.
7. Bước "Không thể hoàn tất", tên người thao tác trong timeline, danh sách lý do.
8. Cập nhật contracts, README plugin.

## 6. Lỗi dự kiến và cách chặn

| Rủi ro | Cách chặn |
| --- | --- |
| Đổi key mà dữ liệu cũ không giải mã được | Bản mã luôn mang `kid`; bootstrap kiểm mọi `kid` đang dùng có trong keyring |
| Secret lọt ra API/log | Serialize cấu hình provider luôn che field `secret`; test snapshot response và log |
| Đổi cài đặt làm đổi đơn đang chạy | Đơn lưu snapshot cài đặt lúc tạo; test đổi lead time không ảnh hưởng đơn cũ |
| Thêm bước workflow làm hỏng đơn đang ở bước cũ | Workflow có version; đơn cũ giữ version cũ |
| Gửi thông báo trùng khi dispatcher chạy lại | Unique key (sự kiện, người nhận, kênh) |

## 7. Edge case

- Keyring có 2 key, active là key mới; đọc dữ liệu mã hóa bằng key cũ vẫn được.
- Bỏ key cũ khi còn bản ghi dùng nó → bootstrap từ chối, báo số bản ghi.
- Webhook ký bằng secret cũ trong thời gian `retiring` → nhận; sau hạn → từ chối.
- Kích hoạt cấu hình provider khi kiểm tra kết nối lỗi → không cho.
- Tài khoản nhân viên bị vô hiệu hóa → timeline vẫn hiện tên.
- "Không thể hoàn tất" khi đơn chưa thu tiền → không tạo hoàn tiền; khi đã thu → tạo hoàn tiền đủ số.

## 8. Phần dễ tốn thời gian nhất (dự kiến) và vì sao

**Form cấu hình tự sinh từ `configSchema` trong Admin.** Lý do: phải hỗ trợ nhiều kiểu field (chuỗi, số, bật/tắt,
chọn, secret, danh sách), validate cùng một schema ở client và server, che secret khi hiển thị lại, và quản lý
phiên bản (chờ kích hoạt / đang dùng / đang hết hạn). Dễ phình to; giữ phạm vi bằng cách chỉ hỗ trợ các kiểu
field mà SePay, email SMTP và máy in trình duyệt cần.

**Thứ hai: keyring + mã hóa lại.** Phải chạy an toàn khi đang có traffic, chia lô, chạy lại được khi bị ngắt.

## 9. Gate / Acceptance

lint (gồm luật import), typecheck, test, build, `check:ordering` (thêm script keyring, provider-config,
settings-snapshot, notification-once). UAT: cấu hình một provider test trong Admin, kiểm tra kết nối, kích hoạt,
không thấy secret khi mở lại; đổi một cài đặt thấy dòng change-log.

## 10. Tài liệu chi tiết

`highlevel.md` mục 3, 5.4, 5.5, 8, 9, 10, 11; contracts mục 2, 8, 12, 14.
