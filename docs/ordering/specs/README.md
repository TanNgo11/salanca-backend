# Bộ spec plugin `ordering`

Ngày lập: 2026-10-11. Bản đồ tổng: `highlevel.md` ở thư mục workspace và trang tổng quan
(claude.ai artifact). Thiết kế chi tiết vẫn ở `docs/plans/ordering-core-contracts.md`; spec cũ theo phase ở
`docs/phases/phase-ordering-*.md` và `docs/plans/ordering-o*-*.md`. Bộ này **thay thế cách chia phase** của
roadmap cũ (thêm OF, tách O3) và ghi thêm các quyết định ngày 2026-10-11.

## Trạng thái

| Spec | Nội dung | Trạng thái | Ước lượng thô |
| --- | --- | --- | --- |
| [O0](O0-spike.md) | Thử nghiệm plugin trên Strapi 5.51.1 | ✅ Đóng 2026-10-10 | — |
| [O1](O1-core.md) | Lõi đơn hàng (service + test) | ✅ Đóng 2026-10-10 | — |
| [O2](O2-catalog.md) | Catalog + API menu | 🟡 2/11 bước | 1–1,5 tuần |
| [OF](OF-foundation.md) | Nền tảng generic: provider, keyring, cài đặt, thông báo, in | 📝 Mới | 1 tuần |
| [O3a](O3a-storefront-api.md) | API đặt hàng: chi nhánh, slot, quote, tạo đơn, tra cứu | 📝 Có spec cũ, cần sửa | 1–1,5 tuần |
| [O3b](O3b-staff-screen.md) | Màn nhân viên xử lý đơn | 📝 Viết lại cho đơn giản | 1,5–2 tuần |
| [O3c](O3c-email.md) | Kênh email theo khung thông báo | 📝 Thiết kế lại | 3–5 ngày |
| [O4](O4-sepay.md) | SePay (plugin riêng) + giao dịch bất thường | 📝 Có spec cũ, cần sửa | 1 tuần |
| [O5](O5-delivery.md) | Giao tận nơi, ship thủ công | 📝 Có spec cũ, cần sửa | 1–1,5 tuần |
| [O6](O6-ops-golive.md) | Báo cáo ngày, chốt tiền mặt, cảnh báo, go-live | 📝 Có spec cũ | 1–2 tuần |
| [OW](OW-storefront.md) | Bộ storefront mặc định + SDK | 📝 Đổi hướng | song song |
| [Later](later.md) | Để sau go-live | — | — |

Thứ tự: `O2 → OF → O3a → (O3b ∥ O3c) → O4 → O5 → O6`; OW chạy song song bằng mock.

## Khuôn mỗi spec

Mỗi file có đủ các mục sau. Phase đã làm ghi **sự thật đã xảy ra**; phase chưa làm ghi **dự kiến** và đánh
dấu rõ là dự kiến.

1. **Mục tiêu** — một đoạn: xong phase này thì ai làm được gì.
2. **Trạng thái** — đã làm / đang làm / chưa làm, kèm branch, commit.
3. **Input / Output** — API (method, path, body, response, lỗi), thao tác Admin, sự kiện outbox, cấu hình.
4. **Đã làm** — liệt kê kèm bằng chứng (test, script, commit).
5. **Chưa làm** — việc còn lại, theo thứ tự.
6. **Lỗi đã gặp và cách xử lý** (phase đã làm) / **Lỗi dự kiến và cách chặn** (phase chưa làm).
7. **Edge case** — các trường hợp biên phải có test.
8. **Lỗi tốn thời gian nhất và vì sao** — phase đã làm: lỗi thật, mất bao lâu (ước từ git), tại sao lâu.
   Phase chưa làm: phần dễ tốn thời gian nhất và lý do, để ước lượng và chia việc.
9. **Gate / Acceptance** — lệnh phải đạt và mục UAT.
10. **Tài liệu chi tiết** — link spec cũ, kế hoạch, mockup.

## Quy tắc chung cho mọi phase

- `AGENTS.md` mục "Server rules" và "React UI rules": không N+1, không tin client, validate ở server; React
  không `any`/`unknown`/`var`, `.tsx` ≤ 250 dòng, ≤ 1 `useEffect`, ≤ 3 `useState`, React Query cho dữ liệu
  server, thư mục `{Name}/{Name}.tsx + use{Name}.ts + {Name}.helper.ts + {Name}.types.ts + components/`.
- Lõi không import app hay provider; provider chỉ import `public.ts` của lõi (OF).
- Mọi secret xoay được (OF).
- Màn nhân viên phải đơn giản cho người làm part-time (O3b).
- Chỉ dùng DB `salanca_ordering_test` cho test; không chạm `salanca_cms` hay production.
- Commit không có dòng ghi tên AI.
