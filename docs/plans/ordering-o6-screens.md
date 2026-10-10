# O6 — Đặc tả màn hình (vận hành, chốt tiền, báo cáo)

Ngày: 2026-10-10. Bổ sung cho spec [`phases/phase-ordering-6-ops-golive.md`](../phases/phase-ordering-6-ops-golive.md),
kế hoạch [`ordering-o6-ops-golive.md`](ordering-o6-ops-golive.md), mockup [`mockups/ordering-o6-ops-golive.html`](mockups/ordering-o6-ops-golive.html).
Nghiên cứu: [`ordering-reference.md` mục U6](ordering-reference.md). **Quy ước chung** như mục đầu của
[`ordering-o3-screens.md`](ordering-o3-screens.md).

## V1. Tình trạng vận hành

- Route: `/plugins/ordering/ops`. Quyền `ops.read`. API `GET /ordering/admin/ops/status`.
- Hàng thẻ (`Card`): Outbox đang chờ (số + tuổi cũ nhất, đỏ khi > ngưỡng); Webhook thành công gần nhất theo từng
  provider (badge Bình thường / Chậm / Lỗi); Đối soát gần nhất và lần tới; Cảnh báo đang mở (số, nghiêm trọng).
- Bảng job (theo Action Scheduler): tên job, lần chạy gần nhất, kết quả, thời lượng, lần tới; thao tác **Chạy ngay**
  (`POST /ordering/admin/ops/jobs/:name/run`, có xác nhận) cho job an toàn chạy lại (gửi outbox, đối soát, nhả hold).
- Bảng outbox lỗi (tab "Lỗi"): loại event, mã đơn (nếu có), số lần thử, lỗi gần nhất (đã che PII), thao tác **Thử
  lại** (`POST /ordering/admin/ops/outbox/:id/retry`).
- Tự làm mới mỗi 30 giây; có nút làm mới.

## V2. Cảnh báo

- Route: `/plugins/ordering/alerts`. Quyền: xem theo vai trò người nhận (mục 19.2); `ops.read` thấy hết.
- API: `GET /ordering/admin/alerts?status=open|acknowledged|resolved`, `POST /ordering/admin/alerts/:id/acknowledge`.
- Bảng (theo Saleor AppProblem): mức (`Badge` Nghiêm trọng / Cảnh báo), nội dung, số lần, lần đầu / gần nhất, gửi tới,
  trạng thái; thao tác **Đã biết** (ghi người và thời điểm).
- Ngưỡng: Settings → Bán hàng (S9 của O3) thêm khối "Cảnh báo": bảng rule (bật, ngưỡng, ngưỡng nghiêm trọng, cửa sổ
  gộp, người nhận theo vai trò).

## V3. Chốt tiền mặt cuối ngày

- Route: `/plugins/ordering/cash-closing`. Quyền `report.read`.
- API: `GET /ordering/admin/cash-closing?branch=&businessDate=` → số theo người thu; `POST /ordering/admin/cash-closing`.

Bố cục (theo Odoo "Closing Register"):

| Cột | Nội dung |
| --- | --- |
| Người thu | nhân viên quầy / người giao |
| Số đơn | |
| Hệ thống tính | tổng tiền mặt đã ghi |
| Hoàn tiền mặt | âm |
| Phải có | = hệ thống − hoàn |
| Đếm được * | `NumberInput` |
| Chênh lệch | tự tính; đỏ khi khác 0 |

- Ô ghi chú bắt buộc khi có chênh lệch. Nút **Chốt** (xác nhận "Sau khi chốt không sửa được; sai thì tạo bản điều
  chỉnh có lý do"). Đã chốt: bảng chỉ đọc + người chốt + thời điểm; nút "Điều chỉnh" tạo bản ghi điều chỉnh.
- Chọn chi nhánh và ngày kinh doanh ở đầu trang; ngày đã chốt có `Badge`.

## V4. Báo cáo

- Route: `/plugins/ordering/reports`. Quyền `report.read`. API `GET /ordering/admin/reports/sales?branch=&from=&to=&groupBy=`.
- Lọc: chi nhánh, khoảng ngày kinh doanh, nhóm theo (Ngày · Danh mục · Món · Cách trả · Cách nhận).
- Thẻ tổng: doanh thu, số đơn, giá trị đơn trung bình, đã hoàn. Bảng theo nhóm đã chọn. Ghi chú nhỏ: "Theo ngày kinh
  doanh và tên tại lúc đặt".

## V5. Xuất CSV đơn

`Modal` (theo lead export đã có của app): từ ngày, đến ngày (ngày kinh doanh), chi nhánh; cảnh báo "File có tên và số
điện thoại khách. Tối đa 10.000 dòng."; nút Tải. Quyền `export`. API `GET /ordering/admin/orders/export?from=&to=&branch=`.
