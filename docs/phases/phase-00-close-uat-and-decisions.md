# Phase 0 — Close Phase 1–3 UAT và platform decisions

## 1. Mục tiêu

Đóng các gate còn mở của Phase 1–3 và ghi nhận quyết định nền tảng bắt buộc trước khi implement Phase 4 (hardening / media / roles).

Phase này **gần như không viết feature code**. Kết quả là evidence + decisions, không phải schema mới.

**Ước lượng:** 0.5–1 ngày làm việc backend + thời gian chờ owner/editor.

## 2. Phụ thuộc

- Phase 1–3 implementation đã có trong repo (xem [`../STATUS.md`](../STATUS.md)).
- Automated gates Phase 2–3 đã từng pass theo verification reports.
- Có editor đại diện cho manual Admin UAT (hoặc owner waive có văn bản).

## 3. Non-goals

- Không implement S3, seed full, public API, staging deploy.
- Không sửa content model lớn.
- Không tích hợp frontend.

## 4. Work breakdown

### P0-01 — Re-run automated baseline (optional nhưng khuyến nghị)

#### Thực hiện

```powershell
npm ci
npm run check:phase3
```

#### Nghiệm thu

- Lệnh pass trên máy clean hoặc machine dev chuẩn.
- Nếu fail: ghi blocker vào STATUS, sửa trước khi coi Phase 0 complete.

### P0-02 — Manual Admin UAT (Phase 2–3)

#### Checklist

- [ ] Chỉ có locale `vi` và `en`; `vi` là default.
- [ ] Luồng tạo VI → thêm localization EN hoàn tất trong Admin.
- [ ] Draft / publish / unpublish độc lập theo locale.
- [ ] Một media asset dùng chung; alt/caption khác nhau theo locale.
- [ ] Required field, duplicate slug, protected relation (menu category/item) có UX lỗi rõ.
- [ ] Giá decimal save/reload đúng.
- [ ] Search, filter, sort, labels đủ dùng cho editor.

Tham chiếu: [`../cms-editor-guide.md`](../cms-editor-guide.md), manual sections trong phase-02/03 verification.

#### Nghiệm thu

- Checklist được tick và ghi ngày + người UAT vào verification note hoặc STATUS.
- Issue phát hiện được phân loại: fix-now (trước Phase 4) vs defer (ticket riêng).

### P0-03 — Functional follow-up triage

#### Hiện trạng đã biết

- Cross-field campaign validation `endsAt >= startsAt` chưa có.

#### Thực hiện

- Quyết định: **fix-in-Phase-4A** (Document middleware + test) hoặc ticket defer có owner.
- Không im lặng bỏ qua.

### P0-04 — Platform decisions record

Ghi vào [`../cms-technical-decisions.md`](../cms-technical-decisions.md) với **tên người** + giá trị (hoặc “TBD date + blocker”):

| Decision | Required before |
| --- | --- |
| Strapi hosting provider | Phase 7 implement |
| Managed PostgreSQL + backup retention | Phase 7 |
| S3/R2 provider, bucket/prefix strategy per env | Phase 4B implement |
| Staging/production domains + CORS origins | Phase 4A CORS fail-fast non-local; Phase 7 |
| Node staging validation owner | First staging deploy |

#### Pattern decision (từ plan lift)

Xác nhận hoặc reject có ghi chú:

- S3 mọi env (kể cả local) — default plan: **accept**.
- API prefix `/api/v1` — default plan: **accept**.
- Public permissions via bootstrap — default plan: **accept**.

### P0-05 — Authorize Phase 4

#### Thực hiện

- Update [`../STATUS.md`](../STATUS.md):
  - Phase 1–3: closed hoặc “closed with waivers”.
  - Next authorized work: Phase 4A (và 4B nếu S3 vendor đã chọn).
- Link approved specs: phase-04…07.

#### Nghiệm thu

- STATUS không còn câu “Do not begin Phase 4 until … detailed Phase 4 specification” dưới dạng blocker — vì spec đã có và entry gates đã pass/waive.

## 5. Exit gate

Phase 0 **closed** khi:

1. Manual UAT done hoặc waiver recorded.  
2. Platform decision table updated (values or explicit blockers).  
3. D1–D4 pattern decisions accepted/rejected in writing.  
4. STATUS authorizes Phase 4A.

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| UAT không có editor | Owner UAT hoặc time-boxed self-UAT + note residual risk |
| S3 vendor chưa chọn | Vẫn authorize 4A; block 4B explicitly |
| Muốn “code luôn Phase 4” | Không skip P0-04/P0-05; config sai env tốn hơn 1 buổi UAT |
