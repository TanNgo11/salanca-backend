# OW — Bộ storefront mặc định + SDK

## 1. Mục tiêu

Plugin kèm sẵn một bộ giao diện đặt món đơn giản, giống WooCommerce khi mới cài: menu, giỏ, checkout, thanh toán,
xác nhận, tra cứu đơn. Website nào cũng dùng được ngay, rồi tự custom giao diện. Bên dưới là SDK TypeScript gọi
API, nên website muốn làm UI riêng hoàn toàn vẫn được. Salanca là website đầu tiên dùng bộ này.

## 2. Trạng thái

📝 **Đổi hướng** từ "web riêng của Salanca" sang **bộ dùng lại**. Chưa code. FE làm song song bằng mock theo
contract; nối API thật khi O2 bước 7, O3a, O4 xong. Branch FE: `salanca-web` → `feat/ordering-web`.

## 3. Input / Output

### 3.1. Cấu trúc (code như package, chạy trong repo web)
```
salanca-web/src/ordering/        ← coi như package riêng, không import component của Salanca
  sdk/                           client API có type: catalog, quote, orders, payment, lookup
  storefront/                    component mặc định
    OrderingProvider/            cấu hình: baseUrl, locale, theme, chi nhánh mặc định
    BranchPicker/  Menu/  ProductDialog/  Cart/  Checkout/  PaymentQr/  OrderStatus/  OrderLookup/
  theme/                         token màu, font, bo góc → website ghi đè
```
Theo luật FE: mỗi component `{Name}/{Name}.tsx` + `use{Name}.ts` + `{Name}.helper.ts` + `{Name}.types.ts`, con
trong `components/`; `.tsx` ≤ 250 dòng; React Query cho dữ liệu server; không `any`/`unknown`.

### 3.2. Màn hình và API dùng

| Màn | API | Ghi chú |
| --- | --- | --- |
| W1 Chọn chi nhánh, cách nhận, giờ | `GET /branches`, `GET /config`, `GET /slots` | lưu lựa chọn trong `sessionStorage`; hiện "Đang tạm ngưng nhận đơn tới HH:mm" |
| W2 Menu | `GET /catalog/categories`, `GET /catalog/products` | món nổi bật lên đầu; tạm hết làm mờ; ngoài giờ bán "Bán từ HH:mm" |
| W3 Hộp chọn món | `GET /catalog/products/:slug` | biến thể, nhóm tùy chọn (min/max, bắt buộc), combo, ghi chú, số lượng |
| W4 Giỏ | `POST /quote` | sửa số lượng, xóa, ghi chú từng món + cả đơn; **giá hiển thị lấy từ quote** |
| W5 Checkout | `POST /orders` | tên, SĐT, email tùy chọn, giờ, đồng ý dữ liệu cá nhân, Turnstile, `Idempotency-Key` mỗi lần bấm |
| W6 Thanh toán | `GET /orders/payment` | QR + nội dung + đếm ngược hạn; poll có backoff, dừng khi xong; tiền mặt: "Trả khi nhận" |
| W7 Xác nhận / trạng thái | `GET /orders` (header `X-Order-Token`) | đọc token từ `#t=`, xóa fragment, lưu `sessionStorage`; nút sao chép link |
| W8 Tra cứu | `POST /orders/lookup` | mã đơn + SĐT, chỉ hiện trạng thái |

Lỗi API hiện bằng chữ dễ hiểu theo mã lỗi (`PRICE_CHANGED` → "Giá vừa thay đổi, vui lòng xem lại giỏ"); mọi nút
gửi có trạng thái đang gửi và chặn bấm lại; lỗi mạng có nút thử lại.

### 3.3. Custom
- Ghi đè theme token; thay từng component bằng component của website (slot/props render).
- Chuỗi chữ VI/EN có thể ghi đè.

## 4. Đã làm

Đặc tả màn hình W1–W8 + mockup (`docs/plans/ordering-w-screens.md`, `mockups/ordering-w-web.html`). Branch FE
`feat/ordering-web` đã tạo từ `main`.

## 5. Chưa làm

1. Type + mock data theo contract (catalog 20.2, storefront 11, 21.x).
2. SDK có type, dùng được với mock và API thật.
3. W2 Menu + W3 Hộp chọn món (làm trước, API sẽ có sớm nhất).
4. W4 Giỏ + W1 Chọn chi nhánh/giờ.
5. W5 Checkout + W7 Trạng thái + W8 Tra cứu.
6. W6 Thanh toán QR (sau O4).
7. Theme + cơ chế thay component; tích hợp vào trang Salanca.
8. Giao tận nơi trong checkout (sau O5).

## 6. Lỗi dự kiến và cách chặn

| Rủi ro | Cách chặn |
| --- | --- |
| Hiển thị giá client khác giá server | Chỉ hiển thị tổng từ quote; giá trong hộp chọn món ghi "tạm tính" |
| Đặt trùng khi bấm 2 lần | `Idempotency-Key` sinh một lần cho mỗi lần xác nhận, giữ khi thử lại |
| Token lộ trên URL | Fragment `#t=`, xóa bằng `history.replaceState` |
| Giỏ cũ khi đổi chi nhánh | Quote lại, đánh dấu món không còn bán |
| Mock lệch API thật | Mock sinh từ cùng type của SDK; khi có API thì chạy cùng bộ test với API thật |

## 7. Edge case

- Món bị tạm hết khi đang ở checkout → báo, cho bỏ món và tiếp tục.
- Giá đổi giữa quote và đặt → hiện lại giỏ với giá mới.
- Hết slot vừa chọn → chọn slot khác, giữ nguyên giỏ.
- Đang tạm ngưng nhận đơn → vẫn xem menu, không cho đặt.
- Khách đóng tab ở trang QR rồi mở lại link → còn QR nếu chưa hết hạn.
- Hết hạn thanh toán trên trang QR → báo, cho đặt lại.
- Mạng chập chờn khi poll → backoff, không spam request.

## 8. Phần dễ tốn thời gian nhất (dự kiến) và vì sao

**Hộp chọn món (W3) với nhóm tùy chọn và combo.** Lý do: nhiều luật cùng lúc (chọn 1 / nhiều, min/max, bắt
buộc, giá cộng thêm, lựa chọn tạm hết, combo có nhóm chọn trong nhóm), phải tạm tính giá đúng, nút "Thêm vào
giỏ" chỉ bật khi đủ điều kiện, và vẫn giữ `.tsx` ≤ 250 dòng → phải tách component và hook cẩn thận.

**Thứ hai: làm bộ "dùng lại được" thay vì chỉ cho Salanca.** Cơ chế theme và thay component tốn thời gian thiết
kế API; dễ bị dính style của Salanca.

## 9. Gate / Acceptance

FE: typecheck, lint, test của component (hộp chọn món, giỏ, checkout), build. UAT: đặt đơn từ đầu đến cuối với
API thật trên staging (tự lấy + tiền mặt, sau đó QR SePay); VI/EN; điện thoại 375px; tra cứu bằng mã + SĐT.

## 10. Tài liệu chi tiết

`docs/phases/phase-ordering-w-web.md`, `docs/plans/ordering-w-screens.md`, `docs/plans/mockups/ordering-w-web.html`,
contracts mục 11, 20.2, 21.1–21.4; luật FE trong `salanca-web/.agent/rules/07-ui-module-structure.md`.
