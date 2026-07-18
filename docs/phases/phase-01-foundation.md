# Phase 1 — Foundation: Strapi và PostgreSQL

## 1. Mục tiêu

Tạo một Strapi backend TypeScript chạy ổn định trên PostgreSQL tại repository độc lập `salanca-backend`, có thể build, restart và tạo tài khoản quản trị mà không ảnh hưởng sibling prototype repository.

Phase này chỉ dựng nền móng. Chưa tạo content type nghiệp vụ, chưa bật public API và chưa tích hợp frontend.

**Ước lượng:** 1–2 ngày làm việc của một backend developer, với điều kiện PostgreSQL local chạy được và quyết định hosting có owner phản hồi trong ngày.

## 2. Kết quả bàn giao

- Strapi 5 project ngay repository root.
- PostgreSQL local có cách khởi động lặp lại được.
- Runtime và dependency versions được khóa.
- `.env.example` đầy đủ nhưng không chứa secret thật.
- Admin panel hoạt động.
- Health check hoạt động.
- Build và typecheck pass.
- Tài liệu quyết định kỹ thuật và hướng dẫn local setup.

## 3. Điều kiện bắt đầu

- Đã chụp `git status` và ghi nhận toàn bộ WIP frontend hiện tại.
- Không có kế hoạch di chuyển file frontend trong phase này.
- Máy triển khai có runtime đáp ứng compatibility matrix của phiên bản Strapi được khóa.
- Có PostgreSQL local hoặc Docker-compatible runtime.
- Có owner cho staging hosting, managed PostgreSQL và object storage, dù tài nguyên chưa cần tạo trong Phase 1.

## 4. Quyết định bắt buộc

### 4.1 Runtime

- Dùng phiên bản Node LTS được Strapi 5 hỗ trợ tại ngày bắt đầu implementation.
- Ghi chính xác version vào `.node-version` và `engines.node`.
- Không dùng tag dependency trôi nổi sau khi scaffold; commit lockfile.
- Dùng một package manager duy nhất trong repository.

Không ghi cứng một Node version vào spec dài hạn rồi mặc định nó còn đúng. Người triển khai phải đối chiếu compatibility matrix chính thức trước khi scaffold và ghi bằng chứng vào pull request.

### 4.2 Database

- PostgreSQL cho development, staging và production.
- Local ưu tiên Docker Compose để onboarding nhất quán.
- Không dùng Strapi quickstart nếu quickstart tạo SQLite.
- Tên database local đề xuất: `salanca_cms`.
- Mỗi environment dùng database user riêng.
- Production không dùng superuser để chạy ứng dụng.

### 4.3 Repository boundary

- Backend nằm ngay root của repository `salanca-backend`.
- Không chuyển các file HTML/CSS/asset hiện tại vào `apps/web`.
- Không sửa `build.mjs`, `.openai/hosting.json` hoặc frontend routes.
- Không đưa `public/uploads` runtime vào Git.

## 5. Work breakdown

### P1-01 — Baseline repository

#### Thực hiện

- Lưu kết quả branch, commit hiện tại và `git status` vào implementation notes.
- Xác định rõ file frontend đang modified/untracked trước khi scaffold.
- Kiểm tra `.gitignore` hiện tại và chỉ bổ sung rule dành cho backend.

#### Nghiệm thu

- Diff Phase 1 chỉ chứa source Strapi, tài liệu backend và cấu hình local infrastructure cần thiết.
- Không có thay đổi ngoài scope bị trộn vào commit Phase 1.

### P1-02 — Runtime decision record

#### Thực hiện

- Kiểm tra Strapi 5 installation requirements chính thức.
- Chọn Node version và package manager.
- Khóa Strapi version được scaffold trong `package.json` và lockfile.
- Ghi quyết định vào `docs/cms-technical-decisions.md`.

#### Nghiệm thu

- Checkout mới có thể nhận đúng runtime version.
- Dependency install không tự nâng Strapi sang version khác ngoài lockfile.

### P1-03 — Scaffold Strapi TypeScript

#### Thực hiện

- Scaffold tại repository root bằng CLI chính thức.
- Chọn TypeScript và PostgreSQL trong quá trình tạo project.
- Không dùng `--quickstart` nếu nó chọn SQLite.
- Loại bỏ sample content type nếu scaffold tạo ra nhưng project không dùng.
- Giữ cấu trúc chuẩn của Strapi; không tự chế framework wrapper.

#### Cấu trúc tối thiểu mong đợi

```text
salanca-backend/
├── config/
├── database/
├── public/
├── src/
│   ├── admin/
│   ├── api/
│   ├── components/
│   └── index.ts
├── types/
├── .env.example
├── compose.yaml
├── package.json
└── tsconfig.json
```

#### Nghiệm thu

- Strapi project nhận diện là TypeScript.
- Không có SQLite database file hoặc SQLite dependency dùng cho runtime chính.
- Admin build được mà chưa có business schema.

### P1-04 — PostgreSQL local

#### Thực hiện

- Thêm cấu hình PostgreSQL local có volume bền vững.
- Thêm health check cho database container nếu dùng Compose.
- Không hard-code password production.
- Tạo hướng dẫn start, stop và reset local database có cảnh báo destructive rõ ràng.

#### Environment variables tối thiểu

```text
HOST
PORT
APP_KEYS
API_TOKEN_SALT
ADMIN_JWT_SECRET
TRANSFER_TOKEN_SALT
JWT_SECRET
DATABASE_CLIENT
DATABASE_HOST
DATABASE_PORT
DATABASE_NAME
DATABASE_USERNAME
DATABASE_PASSWORD
DATABASE_SSL
```

Có thể hỗ trợ `DATABASE_URL`, nhưng phải chọn một source of truth rõ ràng cho mỗi environment; không để URL và các biến rời cạnh tranh nhau.

#### Nghiệm thu

- CMS kết nối được PostgreSQL từ database trống.
- Restart CMS và database không làm mất admin/data đã tạo.
- Sai credential tạo lỗi rõ ràng và process không giả vờ healthy.

### P1-05 — Secrets và environment hygiene

#### Thực hiện

- Commit `.env.example` với placeholder an toàn.
- Ignore `.env`, `.env.*` chứa secret; cho phép rõ ràng file example.
- Ghi cách tạo secret ngẫu nhiên, không commit secret mẫu có thể dùng nhầm.
- Tách development, staging và production config bằng environment variables.

#### Nghiệm thu

- Search repository không thấy credential thật.
- Project boot được sau khi copy `.env.example` sang `.env` và điền giá trị local.
- Build output không chứa admin secret hoặc database password.

### P1-06 — Scripts và quality gates

#### Scripts yêu cầu

- `develop`: chạy development server.
- `build`: build Strapi Admin/backend.
- `start`: chạy production build.
- `typecheck`: TypeScript check không emit.
- `check`: gom các check không mutating phù hợp với project.

Lint chỉ được thêm nếu có cấu hình thực tế và chạy được. Đừng thêm script `lint` giả chỉ để checklist đẹp.

#### Nghiệm thu

- Install từ lockfile pass trên checkout sạch.
- `build` pass.
- `typecheck` pass.
- `check` pass.

### P1-07 — Health và startup behavior

#### Thực hiện

- Xác nhận health endpoint có sẵn của phiên bản Strapi đã khóa.
- Nếu endpoint mặc định không đáp ứng yêu cầu hosting, thêm endpoint tối thiểu không lộ version, secret hoặc database detail.
- Health chỉ trả healthy khi application đã boot đúng.
- Ghi startup, shutdown và expected port trong local setup guide.

#### Nghiệm thu

- Health endpoint trả success khi CMS sẵn sàng.
- Trả failure hoặc connection failure khi CMS chưa chạy.
- Endpoint không trả stack trace hoặc cấu hình nhạy cảm.

### P1-08 — Admin bootstrap test

#### Thực hiện

- Tạo admin đầu tiên qua flow setup chính thức.
- Không seed email/password admin vào source.
- Tạo một record thử nghiệm kỹ thuật nếu cần, restart và xác nhận persistence; xóa record trước khi kết thúc phase.

#### Nghiệm thu

- Admin login/logout hoạt động.
- Refresh và restart không làm mất session/data ngoài hành vi dự kiến.
- Không tồn tại default credential.

## 6. Verification matrix

| Kịch bản | Kết quả mong đợi |
| --- | --- |
| Install từ checkout sạch | Dependency được cài đúng lockfile |
| Boot với PostgreSQL trống | Strapi khởi động và mở setup admin |
| Restart ứng dụng | Admin/data còn nguyên |
| Restart PostgreSQL | Dữ liệu còn nguyên |
| Database credential sai | Startup fail rõ ràng |
| Build production | Pass |
| Typecheck | Pass |
| Secret scan thủ công | Không có secret thật |
| Kiểm tra Git diff | Không sửa frontend WIP |

## 7. Không làm trong Phase 1

- Không tạo menu, campaign hoặc page schemas.
- Không bật anonymous/public permissions.
- Không tạo reservation/contact models.
- Không cấu hình production media provider.
- Không deploy staging.
- Không custom Strapi Admin.
- Không tích hợp frontend.

## 8. Exit gate

Phase 1 chỉ hoàn tất khi toàn bộ điều kiện sau đạt:

- [ ] Runtime và Strapi version đã khóa.
- [ ] PostgreSQL được dùng thật, không phải SQLite.
- [ ] Checkout sạch có thể install, build và boot theo tài liệu.
- [ ] Admin setup/login hoạt động.
- [ ] Persistence qua restart đã được chứng minh.
- [ ] Health check hoạt động.
- [ ] Không có secret thật trong Git/build output.
- [ ] Không có frontend file nào bị sửa bởi Phase 1.
- [ ] Các blocker hosting/storage còn lại có owner và deadline.

Nếu một checkbox chưa đạt, Phase 1 chưa xong. “Chạy được trên máy dev” không phải Definition of Done.
