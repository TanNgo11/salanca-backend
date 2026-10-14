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

Đẩy nhanh không cần chờ giờ: trang **Tình trạng vận hành** → tab Jobs → `sepay-reconciliation` →
**Chạy ngay** (`POST /ordering/ops/jobs/:name/run`, quyền `ops.read`). Job đang chạy trả
`ran:false` — không phải lỗi, đợi xong rồi chạy lại.

Đơn `prepay` quá `paymentTimeoutMinutes` thì job hết hạn (mỗi 30 giây) chuyển `expired` và nhả chỗ.
Tiền tới sau không ghi sổ. QR ẩn khi đã quá hạn dù job chưa chạy.

Nhân viên bấm "Sao chép link thanh toán" trên đơn đang chờ chuyển khoản. Link chỉ mở trang QR (`#p=`),
hết hạn theo cửa sổ thanh toán; tạo link mới thì kéo hạn đơn. Hủy một phần món trên đơn đã chuyển khoản
tạo phiếu hoàn chờ; `paymentStatus` đổi khi ghi mã ngân hàng.

## Đối soát hằng ngày (kế toán)

Quy trình cuối ngày kinh doanh:

1. **Duyệt chuyển khoản** (`/ordering/payment-reviews`, quyền `payment.review`): hết hàng chờ —
   mọi khoản SePay không tự khớp nằm đây (không có mã, sai số, đơn đã đóng, sai tài khoản).
2. **Cảnh báo** (`/plugins/ordering/alerts`): không còn `reconciliation-mismatch`,
   `payment-unmatched`, `manual-payment-unconfirmed` đang mở — xử lý từng cái theo
   [`ordering-ops-runbook.md`](ordering-ops-runbook.md#cảnh-báo).
3. **Báo cáo → Báo cáo** theo "Cách trả": dòng `sepay` (Đã thu) phải khớp sao kê SePay của
   ngày đó; dòng `test`/provider khác không có trên môi trường thật.
4. **Báo cáo → Chốt tiền mặt**: chốt từng người thu; chênh lệch ≠ 0 cần ghi chú và mở cảnh
   báo cho kế toán.
5. So sao kê SePay vs sổ: tổng `payment.captured` theo `business_date` (dòng `sepay` của báo
   cáo) phải bằng tổng tiền vào các tài khoản `SEPAY_ACCOUNTS` trong ngày kinh doanh đó.
   Lệch thường là tiền vào ngoài hệ thống (không mã) hoặc chuyển cho đơn đã hủy — tra tab Lỗi
   và Duyệt chuyển khoản trước khi kết luận.

## Hoàn tiền

SePay không hoàn qua API. Hủy hoặc từ chối đơn đã nhận chuyển khoản tự tạo phiếu hoàn chờ cho số đó.
Nhân viên chuyển trả ngoài hệ thống rồi ghi mã trên đơn. Phiếu hoàn ở trạng
thái chờ và **chưa** đổi `paymentStatus`. Khi ghi mã, sổ mới cộng và trạng thái thành hoàn một phần
hoặc hoàn đủ. Cùng mã trên đúng phiếu đó không cộng lần hai.

## Thẻ quà tặng làm cách trả (O9)

Khi đơn có `payment.giftCardCode`: hệ thống trừ thẻ **trước** trong cùng transaction tạo đơn
(`FOR UPDATE`, không bao giờ âm số dư), phần còn lại đi qua cách trả thường (tiền mặt / SePay).
Payment của phần thẻ mang `provider_code = 'gift-card'` với `requestedAmount` = ý định,
`capturedAmount` = số thực trừ (có thể thấp hơn nếu thẻ thiếu).

Hoàn/hủy: phiếu hoàn hoặc hủy đơn đang giữ tiền thẻ cộng **về đúng thẻ** qua sổ `credit` — không
cần thao tác ngoài, `paymentStatus` cập nhật như hoàn thường. Đơn bị hủy ở bất kỳ nhánh nào
(cust/staff/expiry) đều trả giá trị thẻ đang giữ trước khi đóng.

Đối soát: báo cáo tách `giftCards.sold` (tiền thu từ đơn bán thẻ), `giftCards.redeemed` (tiền thẻ
trừ vào đơn món), `giftCards.refunded` (tiền trả về thẻ), `giftCards.circulating` (số dư đang lưu
hành), `giftCards.expired` (số dư ghi `expire` trong kỳ). Chốt tiền mặt chỉ đếm `provider_code =
'cash'` — thẻ không làm lệch két. `giftCard.redeemed + circulating + expired` không nhất thiết
bằng `sold` trong cùng kỳ vì thẻ có hạn dùng và có thể được phát tặng.

Bảo mật vận hành: chỉ 4 số cuối xuất hiện ở mọi nơi (đơn, sổ, CSV, mail nhân viên); mã sai/bị khóa/
hết hạn trả cùng lỗi `GIFT_CARD_INVALID` để không tiết lộ thẻ tồn tại; dò mã bị rate-limit +
captcha và mở cảnh báo `gift-card-probing` (ops.read) từ 20 lần sai / IP / giờ, critical từ 60.

## Cảnh báo

Năm mã liên quan thanh toán: `webhook-failing` (lỗi liên tiếp, mức critical sau ngưỡng),
`payment-unmatched`, `manual-payment-unconfirmed` (ghi tay chưa xác nhận quá hạn),
`reconciliation-mismatch`, `gift-card-probing` (dò mã thẻ từ một IP). Một dòng đang mở cho mỗi khóa; ngưỡng, mức critical, người nhận
và cách xử lý từng mã — xem bảng đầy đủ ở
[`ordering-ops-runbook.md`](ordering-ops-runbook.md#cảnh-báo). Trang **Tình trạng vận
hành** (`ops.read`) theo dõi sức khỏe webhook và job đối soát theo thời gian thực.

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
