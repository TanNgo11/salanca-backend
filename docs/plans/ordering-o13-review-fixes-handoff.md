# Prompt: sửa lỗi review O13 (provider)

Gửi cho agent: "Đọc `C:\Users\tan_ngo\orca\workspaces\salanca-backend\ordering-o13\docs\plans\ordering-o13-review-fixes-handoff.md`
và làm theo phần dưới dấu `---`".

---

Làm việc trong worktree `C:\Users\tan_ngo\orca\workspaces\salanca-backend\ordering-o13` (nhánh `TanNgo11/ordering-o13`, đang ở
`14b4ba3`, cùng commit với `origin/feat/ordering` lúc review). Sửa các lỗi review O13 dưới đây.

- Mỗi lỗi có test tái hiện: đỏ trước khi sửa, xanh sau khi sửa. Dùng server giả lập trong `scripts/ordering/` hoặc unit test.
- Không bịa thông số của hãng. Chỗ nào cần xác nhận với tài liệu chính thức thì đọc tài liệu, ghi URL và ngày đọc vào
  `docs/providers/<code>.md`, ghi "chưa kiểm sandbox".
- Làm tự chủ tới hết.

## Môi trường và quy tắc

- Chuẩn bị:
  ```bash
  pnpm install --frozen-lockfile
  pnpm run build:ordering
  export ORDERING_TEST_DATABASE=salanca_ordering_o13
  ```
- Không chạm `salanca_cms` hay production. Không chạy `check:phase3`, `smoke:*`, `strapi develop`.
- Không sửa worktree khác: O9, O12 đang có Devin làm; `D:\outsource\salanca\*` là của session khác.
- Không thêm dependency, không sửa `.npmrc` hay `pnpm-workspace.yaml`, không `git stash`.
- Không in bí mật, số điện thoại, nội dung tin ra log.
- Đổi schema thì dùng migration mới, tên chưa dùng. Không dùng `0010`/`0011`; xem `migrations/index.ts` trên `origin/feat/ordering`.

## Lỗi cần sửa (đường dẫn dưới `src/plugins/ordering/server/src/`)

### P0-1. VNPay ký trên giá trị đã decode, VNPay ký trên giá trị đã encode

**Vị trí:** `domain/signatures.ts` `sortedParamString` (khoảng dòng 67–76); dùng ở `providers/vnpay/provider.ts` (build pay URL)
và `verifyVnpayParams` (IPN, return URL).

**Lỗi:**
- Mã mẫu Node chính thức của VNPay chạy `sortObject` trước khi ký. Hàm này `encodeURIComponent` từng giá trị và thay `%20`
  bằng `+`, rồi mới `qs.stringify(…, {encode:false})`. PHP thì dùng `urlencode`. Vậy chuỗi ký là **dạng đã encode**.
- `docs/providers/vnpay.md` đọc sai chỗ này.
- Hệ quả: `vnp_ReturnUrl` có `https://`, `vnp_OrderInfo` có dấu cách → mọi pay URL bị từ chối (mã 70), mọi IPN thật trả
  RspCode 97. VNPay không chạy được.

**Sửa:**
- Ký trên dạng encode (`encodeURIComponent`, `%20` → `+`), cả lúc dựng URL lẫn lúc kiểm IPN và return URL. Kiểm IPN trên chính
  các giá trị nhận được, encode lại theo cùng quy tắc.
- Thêm **test vector cố định** (chuỗi ký + hash mong đợi) lấy từ ví dụ trong tài liệu hoặc mã mẫu VNPay, không tự ký rồi tự kiểm.
- Sửa `docs/providers/vnpay.md`.

### P1-2. Capture qua ví bỏ qua trạng thái đơn và số còn phải trả

**Vị trí:** `services/payment-matching.ts` khoảng dòng 455–500, nhánh ví.

**Lỗi:**
- Nhánh này có đọc `aggregate` và khóa group, nhưng không kiểm trạng thái group hay số đã thu như nhánh SePay (`matchTransfer`).
- Hệ quả:
  - IPN đến muộn cho đơn đã hết hạn hoặc đã hủy vẫn tự capture;
  - trả MoMo sau khi đã chuyển khoản SePay, hoặc mở cả phiên MoMo lẫn VNPay → capture hai lần;
  - đơn đã sửa giảm tiền sau khi mở phiên → capture số cũ.
- Không trường hợp nào vào hàng duyệt O4.

**Sửa:**
- Sau `lockGroups`, chạy cùng quy tắc như `matchTransfer`: group không còn `awaiting-payment`, hoặc số còn phải trả nhỏ hơn số
  IPN → `needs-review` (lý do `order-closed` / `overpaid`).
- `createWalletSession` (`services/payment.ts`) từ chối khi group không ở `awaiting-payment`, hoặc khi đã có phiên ví khác còn
  `pending`. Phiên cũ thì hủy trước, hoặc trả lỗi.
- Job hết hạn thanh toán và lệnh hủy đơn phải đánh dấu các phiên ví `pending` của đơn đó là `cancelled`.

### P1-3. Bắt lỗi trùng khóa ngay trong transaction PostgreSQL

**Vị trí:** `services/payment-matching.ts` khoảng dòng 408–430 (`walletPark` → `insertEvent`), cùng khối 464–472;
`providers/vnpay/provider.ts` khoảng dòng 171–176.

**Lỗi:**
- Nhánh thất bại cập nhật payment thành `failed`, rồi `insertEvent` gặp lỗi 23505.
- Lỗi được `catch` nhưng không có savepoint, nên transaction đã hỏng và rollback trong im lặng. Trạng thái `failed` bị mất.
- VNPay có thể gửi `vnp_TransactionNo = 0` cho giao dịch thất bại hoặc bị hủy — kiểm lại với tài liệu. Nếu đúng, mọi IPN thất bại
  sau cái đầu sẽ trùng khóa `(provider_code, provider_transaction_id)`.

**Sửa:**
- Xử lý trùng **ngoài** transaction, hoặc dùng savepoint (`trx.transaction()` lồng / `SAVEPOINT`).
- `TransactionNo` rỗng hoặc `0` thì dùng id riêng `vnpay-failed-<txnRef>`.

### P1-4. Job `wallet-status-check` kẹt ở các dòng cũ

**Vị trí:** `jobs/wallet-status.ts`.

**Lỗi:**
- Truy vấn lấy `status: 'pending'`, không giới hạn tuổi, sắp xếp `id asc`, `limit 50`.
- Phiên bỏ dở không bao giờ rời `pending`: MoMo mã 1000/1005 trả `null`; VNPay querydr mã 91 ném lỗi và bị bỏ qua.
- Hệ quả: sau 50 phiên bỏ dở, lần chạy nào cũng hỏi lại đúng 50 dòng đó; phiên mới bị mất IPN không bao giờ được đối soát.

**Sửa:**
- Giới hạn tuổi phiên theo cửa sổ như kế hoạch (2–30 phút, cấu hình được).
- Quá hạn mà hãng báo không tồn tại hoặc chưa trả → đánh dấu `expired`/`cancelled`.
- Xoay vòng thứ tự lấy dòng (vd. theo `updatedAt`).

### P1-5. Hoàn tiền có thể hoàn hai lần; tham số hoàn VNPay/MoMo cần kiểm lại

**Vị trí:** `services/refund.ts` khoảng dòng 270; `providers/momo/provider.ts` khoảng dòng 260–296;
`providers/vnpay/provider.ts` khoảng dòng 269.

**Lỗi:**
- Gọi API hãng **trước** khi ghi dòng refund; key mặc định `admin-refund:<uuid>`. Nếu gọi bị timeout nhưng hãng đã hoàn: không có
  dòng refund nào, nhân viên thử lại, key mới → khách được hoàn hai lần.
- MoMo refund dùng lại `orderId` của thanh toán gốc. Kiểm lại: MoMo yêu cầu `orderId` mới, duy nhất cho mỗi lần hoàn.
- VNPay `vnp_RequestId` nhận key dài 49 ký tự. Kiểm lại giới hạn độ dài và ký tự.
- VNPay mã `94` đang bị coi là `settled`.

**Sửa:**
- Ghi refund `pending` (có id ngắn, ổn định cho hãng) **trước** khi gọi API. Thử lại thì dùng lại đúng id đó.
- Chỉ chuyển `settled` khi hãng xác nhận, qua kết quả trả về hoặc query.
- Map mã kết quả theo tài liệu; mã nào chưa chắc thì để `pending`.

### P1-6. Refresh token Zalo không được xoay

**Vị trí:** `providers/zalo-zns/provider.ts` khoảng dòng 50–66.

**Lỗi:**
- Refresh token của Zalo dùng một lần. Code luôn gửi `ZALO_REFRESH_TOKEN` cố định từ env và bỏ qua `refresh_token` mới trong
  response.
- Hệ quả: sau lần làm mới đầu tiên, ZNS hỏng hẳn, mọi tin rơi sang SMS (tốn tiền).

**Sửa:**
- Lưu cặp token đã xoay vào DB (plugin store hoặc bảng), cập nhật dưới khóa.
- Env chỉ là giá trị khởi tạo. Không log token.

### P2 (sửa nếu kịp, cùng đợt)

- **Hạn mức tin nhắn mỗi ngày** (`services/notification.ts` khoảng dòng 178–185):
  - hiện đếm rồi mới gửi, không có khóa;
  - OTP qua SMS/Zalo và nút gửi thử bỏ qua hạn mức.
  - Sửa: dùng hàng đếm theo ngày `UPDATE … SET n = n + 1 WHERE n < limit RETURNING`, áp cho mọi đường gửi.
- **Open redirect** (`services/storefront.ts` khoảng dòng 266): return URL nhận mọi `https://`. Chỉ cho phép origin của storefront
  (cấu hình).
- **Mã kết quả có nghĩa là tiền đã chuyển:** MoMo `9000`, VNPay `07` → đưa vào hàng duyệt, không đánh `failed`.
- **Ahamove:**
  - số tiền thu hộ (COD) chốt lúc gọi xe; khách trả online sau đó thì tài xế vẫn thu tiền mặt → cập nhật hoặc chặn;
  - `applyCarrierStatus` chạy không có transaction/khóa → bọc lại;
  - `lat`/`lng` đang gửi 0 → bỏ qua nếu API cho phép, hoặc ghi rõ hạn chế.
- **Trang Nhà cung cấp** (`provider-status.ts` khoảng dòng 211, 263): không hiện 4 ký tự cuối của API key bí mật. Chỉ hiện "đã cấu
  hình".
- **HTTP client** (`providers/_http.ts:42`): giới hạn kích thước response trong lúc đọc, không đọc hết rồi mới kiểm.

## Kiểm tra (gọn)

```bash
pnpm run lint && pnpm run typecheck && pnpm run typecheck:admin
pnpm exec vitest run src/plugins/ordering
pnpm run build:ordering
node scripts/ordering/vnpay.mjs
node scripts/ordering/momo.mjs
node scripts/ordering/wallet-status.mjs
node scripts/ordering/payment-refund.mjs
node scripts/ordering/zalo-zns.mjs
node scripts/ordering/sms.mjs
node scripts/ordering/ahamove.mjs
node scripts/ordering/notifications.mjs
node scripts/ordering/sepay-webhook.mjs
node scripts/ordering/customer-auth.mjs
```

- Cộng script test mới nếu có.
- Có đổi giao diện Admin thì thêm `ORDERING_ENABLED=true pnpm exec strapi build`.
- Lỗi ở bước nào thì chỉ chạy lại bước đó.

## Khi xong

1. Ghi mục "Review fixes" vào Completion record của `docs/plans/ordering-o13-providers.md`: từng lỗi, cách sửa, test, kết quả thật,
   chỗ nào còn "chưa kiểm sandbox".
2. `git fetch origin && git merge origin/feat/ordering`. O9/O12 có thể đã vào; giải conflict bằng cách lấy cả hai bên, chuỗi i18n chỉ
   dùng `??`. Rồi `pnpm run build:ordering` và kiểm lại gọn.
3. `git push origin HEAD:feat/ordering-o13` rồi `git push origin HEAD:feat/ordering`. Không force push, không merge `main`.
4. Báo cáo:
   - danh sách commit;
   - test đỏ → xanh cho từng lỗi;
   - kết quả từng lệnh;
   - các thông số hãng còn cần xác nhận bằng sandbox.
