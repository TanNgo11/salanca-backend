# Thanh toán chuyển khoản SePay

Dành cho người vận hành CMS. Hợp đồng HTTP nằm ở `docs/ordering-api-contract.md`. Bí mật chỉ ở env,
không nhập trên Admin, không ghi vào log, không commit.

## Bật

1. `ORDERING_ENABLED=true` và đã chạy `pnpm run build:ordering`.
2. Đặt cùng lúc `SEPAY_WEBHOOK_SECRET` (ít nhất 16 ký tự), `SEPAY_API_TOKEN` (ít nhất 16 ký tự) và
   `SEPAY_ACCOUNTS` (ít nhất một tài khoản). Thiếu token hoặc tài khoản thì Strapi không boot.
3. Tùy chọn: `SEPAY_MEMO_TEMPLATE` (mặc định `SLC{orderCode}`, bắt buộc có `{orderCode}`),
   `SEPAY_CAPTURE_MODE` (`auto` hoặc `review-all`), `SEPAY_AMOUNT_TOLERANCE` (số nguyên VND, mặc định 0).

`SEPAY_ACCOUNTS` là một object JSON. Mỗi key là mã tài khoản trong cấu hình. `accountNumber` chỉ gồm
chữ số, dài 6–20. `locationRefs` là `"all"` (dùng chung mọi chi nhánh) hoặc mảng mã chi nhánh. Tài khoản
gắn đúng chi nhánh được chọn trước tài khoản `"all"`.

Ví dụ một dòng, số tài khoản là mẫu, thay bằng số thật:

```text
SEPAY_ACCOUNTS={"q1":{"accountNumber":"000000000001","bankCode":"MBBank","bankName":"MB Bank","accountName":"CONG TY SALANCA","locationRefs":["Q1"]}}
```

Xóa `SEPAY_WEBHOOK_SECRET` để tắt SePay. Đơn mới không còn chuyển khoản. Event và sổ đã ghi vẫn giữ
để đối soát.

## Webhook

Khai với SePay:

`https://<domain cms>/api/v1/ordering/webhooks/sepay`

Chữ ký: header `X-SePay-Timestamp` (giây Unix) và `X-SePay-Signature: sha256=<hex>`. Hex là HMAC-SHA256
của chuỗi `{timestamp}.{body gốc}`, khóa là `SEPAY_WEBHOOK_SECRET`. Lệch quá 300 giây thì từ chối.

| Kết quả | HTTP | Body |
| --- | --- | --- |
| Sai chữ ký hoặc timestamp cũ | 401 | `{"success": false}` |
| Body không đúng payload | 400 | `{"success": false}` |
| Đã lưu event (kể cả trùng `id`, tiền ra, không khớp đơn) | 200 | `{"success": true}` |

SePay gửi lại mọi phản hồi khác. Cloudflare không cache và không chặn path này. Không đặt route sau
rate limit của form.

Năm lần chữ ký hoặc xử lý lỗi liên tiếp mở một cảnh báo `webhook-failing:sepay`. Webhook hợp lệ xóa
bộ đếm. Lần thứ 20 nâng mức `critical`.

## Khớp tiền

Nội dung chuyển khoản phải chứa memo. Mẫu mặc định ghép `SLC` trước mã đơn: đơn `SLC-000124` cần nội
dung có `SLCSLC-000124`. Khớp đủ (đúng chiều `in`, đúng mã, đúng tài khoản của chi nhánh, đơn còn nhận
tiền, số tiền trong dung sai) thì ghi sổ và chuyển bước: `prepay` sang chờ quán nhận, `accept-then-pay`
sang đang làm. `transferType=out` bị bỏ qua.

Thiếu một điều kiện thì tiền vào hàng **Duyệt chuyển khoản** (`/ordering/payment-reviews`, quyền
`payment.review`), không tự ghi. Lý do: không có mã, không thấy đơn, chuyển thiếu, chuyển thừa, đơn đã
đóng, đã thanh toán đủ, sai tài khoản. `review-all` đẩy mọi khoản vào hàng này.

Tiền không rõ chi nhánh (số tài khoản không có trong cấu hình) chỉ người `allLocations` thấy. Hai người
xử lý cùng một khoản: một người thành công, người kia nhận `REVIEW_ALREADY_RESOLVED`.

## Khi webhook không tới

Nhân viên mở đơn và ghi mã giao dịch ngân hàng cùng số tiền đã thấy. Webhook hoặc đối soát tới sau,
cùng mã và cùng số tiền, chỉ xác nhận dòng đó, không ghi sổ lần hai. Khác số tiền thì vào hàng duyệt.
Mã đã tới từ SePay (webhook hoặc đối soát) thì không ghi tay được nữa (409 `PAYMENT_ALREADY_RECEIVED`);
xử lý giao dịch đó ở Duyệt chuyển khoản.

Job đối soát chạy mỗi giờ (`0 0 * * * *`), một process giữ khóa. Nó đọc
`GET https://userapi.sepay.vn/v2/transactions` bằng `Authorization: Bearer <SEPAY_API_TOKEN>`,
`since_id` theo từng số tài khoản. API không lọc theo số tài khoản; job tự lọc. Tối đa khoảng 3 request
mỗi giây; HTTP 429 thì thử lại, không quá 3 lần. Cursor chỉ tiến khi cả trang đã ghi xong.

Webhook (id số) và API (id UUID) là cùng một giao dịch khi trùng `referenceCode` và số tiền. Ngân hàng
không gửi `referenceCode` thì cần trùng cả số tiền, `transactionDate` (đúng từng giây), tài khoản nhận và mã
đơn trong nội dung. Cùng đơn, cùng số tiền nhưng khác giờ là lần chuyển thứ hai và vào hàng duyệt.

Giao dịch đối soát không ghi được vào sổ mở một cảnh báo theo id giao dịch của SePay. Khớp được thì
không mở cảnh báo đó.

Đơn `prepay` quá `paymentTimeoutMinutes` thì job hết hạn (mỗi 30 giây) chuyển `expired` và nhả chỗ.
Tiền tới sau không ghi sổ. QR ẩn khi đã quá hạn dù job chưa chạy.

Nhân viên bấm "Sao chép link thanh toán" trên đơn đang chờ chuyển khoản. Link chỉ mở trang QR (`#p=`),
hết hạn theo cửa sổ thanh toán; tạo link mới thì kéo hạn đơn. Hủy một phần món trên đơn đã chuyển khoản
tạo phiếu hoàn chờ; `paymentStatus` đổi khi ghi mã ngân hàng.

## Hoàn tiền

SePay không hoàn qua API. Hủy hoặc từ chối đơn đã nhận chuyển khoản tự tạo phiếu hoàn chờ cho số đó.
Nhân viên chuyển trả ngoài hệ thống rồi ghi mã trên đơn. Phiếu hoàn ở trạng
thái chờ và **chưa** đổi `paymentStatus`. Khi ghi mã, sổ mới cộng và trạng thái thành hoàn một phần
hoặc hoàn đủ. Cùng mã trên đúng phiếu đó không cộng lần hai.

## Cảnh báo

Một dòng đang mở cho mỗi khóa. Không có màn trạng thái vận hành.

| Mã | Khi nào |
| --- | --- |
| `webhook-failing` | 5 lần lỗi liên tiếp; lần 20 là critical |
| `payment-unmatched` | tiền vào không tự khớp, gộp theo provider |
| `manual-payment-unconfirmed` | ghi tay quá 24 giờ mà SePay chưa xác nhận; đóng khi đã xác nhận |
| `reconciliation-mismatch` | đối soát không ghi được một giao dịch |

Log chỉ có mã cảnh báo và số đếm. Không ghi tên người chuyển, số tài khoản đầy đủ, hay nội dung
chuyển khoản.

Job xác nhận ghi tay chạy mỗi giờ vào phút 15 (`0 15 * * * *`).

## Kiểm tra không cần tài khoản SePay

```powershell
node scripts/smoke-ordering-sepay.mjs
```

Script dùng DB `salanca_ordering_test`, ký bằng secret giả, không gọi mạng. Exit 0 khi một đơn prepay
nhận webhook đúng chữ ký, sang chờ quán nhận, và gửi lại cùng `id` không ghi tiền lần hai.

UAT với giao dịch SePay thật cần chủ dự án cấp tài khoản thử. Chưa có tài khoản thì chưa UAT.
