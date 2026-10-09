# Handoff vòng 4: sửa chỗ bị lùi, lỗi thiết kế, nghiên cứu còn thiếu

Bạn tiếp tục việc nghiên cứu plugin bán hàng generic. Đọc theo thứ tự, đọc hết trước khi làm:

1. `docs/plans/ordering-research-handoff.md` (bối cảnh, quyết định đã chốt, quy tắc ở mục 7).
2. `docs/plans/ordering-research-handoff-2.md` (vòng 2 + mục 7 bổ sung).
3. `docs/plans/ordering-reference.md` và `docs/plans/ordering-core-contracts.md` (bản hiện tại).
4. File này.

## 0. Quy tắc mới, quan trọng nhất

Vòng 3 đã **thay toàn bộ** `ordering-reference.md` bằng phần mới và làm mất toàn bộ nghiên cứu vòng 1.
File đã được khôi phục thủ công (Phần A, B, C).

- **Chỉ được sửa và bổ sung. Không xoá, không thay thế cả file, không gộp mất mục cũ** ở cả hai tài
  liệu.
- Muốn bỏ một đoạn sai thì sửa tại chỗ và ghi lý do; muốn bỏ hẳn một mục thì hỏi lại trong tin nhắn
  cuối, không tự xoá.
- Trước khi sửa, ghi lại số dòng và danh sách heading của mỗi file; sau khi sửa, so lại. Tin nhắn cuối
  phải báo: số dòng trước / sau, heading nào được thêm, heading nào bị sửa tên. Nếu có heading biến mất,
  coi là lỗi và khôi phục.
- Dùng sửa từng đoạn (patch), không ghi đè cả file.

Phân vai giữ nguyên: `ordering-reference.md` chỉ chứa nghiên cứu (mỗi hệ thống làm thế nào → best
practice); `ordering-core-contracts.md` là nguồn duy nhất cho thiết kế.

## 1. Sửa chỗ bị lùi trong `ordering-core-contracts.md`

So với vòng 1, các thứ sau bị mất. Thêm lại, cập nhật cho khớp thiết kế hiện tại:

1. **`FulfillmentProvider` và bảng fulfillment.** Sơ đồ còn nhắc nhưng không còn định nghĩa.
   Định nghĩa lại contract (tham khảo phần B6 của reference) và entity fulfillment: quan hệ tới đơn
   và tới dòng hàng kèm số lượng, provider, địa chỉ snapshot, mốc thời gian, tracking.
2. **Lưu tên + phiên bản workflow trên đơn** (hoặc trên từng nhóm giao nhận, xem mục 2.2), để đơn cũ
   không kẹt khi cấu hình đổi.
3. **Cờ nội bộ / hiện cho khách** (`isPublic`) trên dòng thời gian của đơn.
4. **Bản chụp thông tin liên hệ** trên đơn (tên, SĐT, email), không chỉ `customerRef`.
5. **Ví dụ cấu hình `config/plugins.ts`** kèm validator, cập nhật theo registry loại hàng, provider,
   scheduling, voucher.
6. **Bảng event** (tên, khi phát, payload tối thiểu), khớp với outbox.
7. **Bảng mô hình dữ liệu đầy đủ** liệt kê mọi entity, gồm cả `idempotency-key`, nhật ký gửi thông
   báo, outbox, hold, fulfillment, voucher, payment, payment-event, refund, order-event.

## 2. Sửa lỗi thiết kế

1. **Phản hồi webhook tính trước khi xử lý.** `webhookResponse(input: RawWebhook)` chỉ nhận dữ liệu thô,
   trong khi VNPAY trả mã theo kết quả xử lý (`00`, `01`, `02`, `04`, `97`, `99`) và SePay khuyên trả
   lời ngay rồi xử lý sau. Thiết kế lại để hỗ trợ cả hai kiểu: provider khai báo "trả lời sau khi xử
   lý" hay "trả lời ngay"; hàm tạo phản hồi nhận kết quả xử lý của lõi (ví dụ: đã ghi nhận, trùng,
   không thấy đơn, sai số tiền, sai chữ ký).
2. **Đơn có một `status` nhưng có thể chạy nhiều workflow.** Định nghĩa rõ, theo cách Medusa / Vendure:
   - Trạng thái chung của đơn: chỉ vài giá trị (ví dụ đã đặt, hoàn tất, huỷ).
   - **Nhóm giao nhận (fulfillment group)**: entity riêng, mỗi nhóm có workflow và các bước riêng (bước
     bếp, đóng gói, phát mã voucher, lịch hẹn).
   - Trạng thái chung của đơn suy ra từ các nhóm.
   - Quy tắc trộn loại hàng trong một đơn vẫn là câu hỏi cho chủ dự án; thiết kế phải chạy được cả khi
     cho trộn lẫn khi không.
3. **Token xem đơn nằm trong URL** (`GET /ordering/orders/:publicToken`): URL bị ghi vào log của
   Cloudflare và proxy. Đổi sang header (hoặc cách khác không đưa token vào URL), ghi lý do.
4. **Chống đơn ảo khi tạo đơn bị mất.** Thêm `CaptchaProvider` (Turnstile, reCAPTCHA… mỗi khách một
   loại) và giới hạn request cho `POST /orders`, `quote`, tra cứu.
5. **Link "Document Service middleware" sai.** Link hiện tại trỏ tới trang middleware HTTP. Trang đúng là
   `https://docs.strapi.io/cms/api/document-service/middlewares`. Kiểm lại mọi link Strapi trong hai file.
6. **Làm tròn "một lần ở cuối".** Tiền VND không có số lẻ. Giảm % cho cả đơn phải **chia khoản giảm
   xuống từng dòng** và làm tròn từng dòng (phương pháp phần dư lớn nhất), để hoàn tiền một món và tách
   VAT theo dòng không lệch. Đọc `OrderLineDiscountDistributionStrategy` của Vendure
   (`packages/core/src/config/order/`) và cách Medusa phân bổ adjustment. Thêm cột khoản giảm / phí đã
   chia trên dòng hàng.

## 3. Nghiên cứu còn thiếu từ vòng 2

Vòng 2 yêu cầu các mục dưới đây nhưng chưa có kết quả trong reference (phụ lục chỉ ghi tên file). Viết
vào `ordering-reference.md` thành mục mới (đánh số tiếp theo Phần B hoặc Phần C), theo khuôn "mỗi hệ
thống làm thế nào (kèm link file đúng commit) → best practice". Sau đó áp vào contracts nếu cần.

1. **Kết quả đọc source Strapi 5.51.1** (`node_modules/.pnpm/@strapi+*`, chỉ đọc):
   - `strapi.db.transaction`: chữ ký, cách lấy knex transaction, `forUpdate`.
   - Document Service middleware: chặn được gì, không chặn được gì (gọi thẳng `strapi.db.query`).
   - Ẩn content type khỏi Content Manager.
   - Plugin đăng ký quyền Admin và **điều kiện quyền** (permission condition).
   - Cron của Strapi.

   Mỗi ý ghi file và hàm đã đọc.
2. **Mô hình sản phẩm đa ngành:**
   - Medusa product module (option, variant, `product_type`).
   - Vendure `ProductOptionGroup`, `Facet`, custom field.
   - WooCommerce variable / grouped / virtual / downloadable.
   - Bagisto product types.

   So sánh cách mỗi bên tách biến thể và tùy chọn, và cách làm combo.
3. **Sổ cái thanh toán Saleor:** các field của `TransactionItem` / `TransactionEvent` và cách cộng dồn
   số tiền; so với payment collection của Medusa.
4. **Trạng thái nhiều trục của Sylius:** những trục nào, máy trạng thái nào; so với quyết định "chỉ lưu
   trạng thái đơn, thanh toán và giao nhận tính ra".
5. **Outbox và job:** Action Scheduler (claim, batch, retry, log), Medusa event bus và workflow engine
   (cách lưu bước, retry), provider `locking-postgres`.
6. **Sửa đơn, huỷ một phần, đổi/trả:** Vendure `OrderModifier` và trạng thái `Modifying`; Medusa order
   change.
7. **Thuế:** Vendure `TaxCategory` / `TaxRate` / tax zone; Medusa tax provider.
8. **Khách hàng:** Medusa customer / account holder; Vendure `GuestCheckoutStrategy`.

## 4. Năm mục mới

Mỗi mục: nghiên cứu → reference; thiết kế → contracts.

1. **Phân quyền nhân viên theo chi nhánh.** Nhân viên chi nhánh A chỉ thấy và xử lý đơn chi nhánh A.
   - Strapi Admin RBAC mặc định không lọc theo chi nhánh: kiểm cơ chế permission condition của Strapi
     5.51.1 trong source.
   - Áp cho route riêng của plugin: lọc theo chi nhánh ở tầng service, không chỉ ẩn ở giao diện.
2. **Múi giờ và ngày kinh doanh.** Server chạy UTC. "Hết món đến cuối ngày", khung giờ, ngày nghỉ, báo
   cáo theo ngày phải tính theo múi giờ của chi nhánh (`Asia/Ho_Chi_Minh` cho Salanca).
   - Có cần "ngày kinh doanh" kết thúc sau nửa đêm (quán mở tới 1–2 giờ sáng)?
   - Tham khảo TastyIgniter `WorkingSchedule`.
3. **Chia giảm giá xuống dòng và làm tròn:** xem mục 2.6.
4. **Khoá job khi chạy nhiều server.** Khi có từ 2 instance Strapi, cron chạy ở mọi instance:
   - Outbox dispatcher, job hết hạn đơn, job đối soát không được chạy trùng.
   - Thiết kế khoá trên PostgreSQL (advisory lock hoặc claim theo dòng). Tham khảo Medusa
     `locking-postgres`, Action Scheduler claim.
5. **Theo dõi vận hành và cảnh báo:**
   - Webhook lỗi liên tục.
   - Tiền vào không khớp đơn.
   - Outbox kẹt hoặc retry quá ngưỡng.
   - Đơn chờ nhận quá lâu.

   Ai nhận cảnh báo, qua kênh nào (dùng lại `NotificationProvider`), ghi gì vào log (không ghi dữ liệu
   cá nhân).

## 5. Câu hỏi cho chủ dự án

Giữ nguyên 8 câu ở mục "Cần chủ dự án quyết định" trong contracts. Thêm câu mới nếu có, không tự chốt.

## 6. Kết quả cần giao

1. **`ordering-reference.md`:** thêm nghiên cứu mục 3 và mục 4; cập nhật Phụ lục "Đã đọc" với file thật
   đã mở và **điều rút ra từ file đó** (một dòng mỗi file), không chỉ tên file.
2. **`ordering-core-contracts.md`:** sửa mục 1 và mục 2; thêm thiết kế cho mục 4; cập nhật "Câu hỏi còn
   mở" và "Quyết định đã đổi".
3. **Tin nhắn cuối:**
   - Số dòng trước / sau và danh sách heading thêm / sửa của mỗi file (theo quy tắc mục 0).
   - Quyết định thiết kế đã đổi, mỗi cái một dòng kèm lý do.
   - Những gì vẫn chưa kiểm được.
   - Câu hỏi mới cho chủ dự án.

## 7. Quy tắc

- Như mục 7 của handoff vòng 1 và mục 6 của handoff-2: chỉ sửa 2 file tài liệu ở mục 6; không sửa code,
  không tạo plugin, không sửa `node_modules`, không đổi schema, không commit, không push, không stage;
  không đụng thay đổi không liên quan trong working tree; không publish.
- Không sửa các file handoff.
- Mọi khẳng định có link tới source (đúng commit) hoặc tài liệu chính thức. Không chắc thì ghi
  **Chưa kiểm**.
- Không chép code từ nguồn GPL. Không chạy code tải về.
- Viết tiếng Việt, giữ thuật ngữ kỹ thuật và tên API bằng tiếng Anh. Câu ngắn; xuống dòng để dễ đọc khi
  diff.
