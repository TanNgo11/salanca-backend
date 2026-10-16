# Nghiên cứu: trang "SEO" trong admin (2026-10-16)

Mục đích: rút best practice từ các sản phẩm có sẵn trước khi vẽ mockup cho trang SEO của admin Strapi. Không phải spec cuối.

Quy ước độ tin cậy: **[đọc]** = đã đọc trang gốc hoặc kết quả tìm kiếm trích rõ. **[tìm]** = chỉ qua kết quả tìm kiếm, nguồn thứ cấp. **[chưa]** = không lấy được, đừng dựa vào.

## 1. Bảng so sánh theo chủ đề

### A. Công tắc "chặn index" (go-live)

| Nguồn | Cách làm | Độ tin cậy |
| --- | --- | --- |
| WordPress | Ô "Discourage search engines from indexing this site" trong Settings > Reading. Core không cảnh báo; phải cài thêm plugin *Search Engines Blocked Warning* để hiện cảnh báo ở header admin khi ô này bật. Lý do tồn tại plugin: bật ở staging rồi quên tắt khi lên production. | [đọc] |
| Yoast | Chuyển phần lớn check kỹ thuật sang WordPress Site Health, nhưng **giữ thông báo "blocking access to robots" riêng trên dashboard vì "too important to miss"**. | [đọc] |
| Webflow | Site settings > SEO > Indexing, tắt indexing cho staging (subdomain `webflow.io`). Cơ chế là `robots.txt` riêng cho subdomain, **không phải thẻ noindex**, không áp cho custom domain. Muốn gỡ trang đã index thì dùng toggle sitemap, không dùng robots.txt. | [tìm] (trang help trả 403) |
| Shopify | Ẩn từng sản phẩm bằng metafield `seo.hidden = 1` để thêm noindex/nofollow và loại khỏi sitemap. Không thấy công tắc native trong ô "Search engine listing". | [tìm] |
| Google Search Console | Lý do "Excluded by 'noindex' tag" và "Alternate page with proper canonical tag" thường là chủ ý, không phải lỗi. | [tìm] |

**Rút ra**
1. Trạng thái nguy hiểm (đang chặn index ở production, hoặc đang mở index ở staging) phải hiện **trên mọi trang admin**, không chỉ trong trang SEO. Yoast tách riêng đúng vì lý do này.
2. Cơ chế chặn nên nhất quán: noindex + khỏi sitemap, không chỉ robots.txt. Webflow cho thấy robots.txt không gỡ được trang đã index.
3. Phân biệt "chặn có chủ ý" với "chặn do quên". Search Console coi noindex nhiều khi là bình thường; audit của mình cần biết trang nào mình chủ ý noindex để khỏi báo lỗi giả.

### B. Điểm tổng và bộ đếm

| Nguồn | Cách làm | Độ tin cậy |
| --- | --- | --- |
| Ahrefs Site Audit | Health Score = số URL nội bộ **không có lỗi** / tổng URL nội bộ × 100. Chia dải: 0-30 yếu, 91-100 rất tốt. Ba mức: Errors (đỏ), Warnings (vàng), Notices (xanh). | [đọc] |
| Semrush Site Audit | Điểm 0-100%, lỗi nặng hơn cảnh báo. Ba mức Errors / Warnings / Notices. Khuyên làm Errors trước. Bảy widget chuyên đề trong Overview (Crawlability, HTTPS, International SEO, Performance, Internal Linking, Markups, Core Web Vitals). | [tìm] |
| Rank Math SEO Analyzer | Điểm 0-100 + biểu đồ cột đếm Passed / Warnings / Failed. Nút "View Issues" lọc: All / Passed / Warnings & Failed. Easy mode 17 test, Advanced 25 test. | [tìm] |
| Screaming Frog | Mỗi issue có **type** (Error / Warning / Opportunity) và **priority** (High / Medium / Low) **độc lập nhau**. Ví dụ: "internal URL bị robots.txt chặn" là Warning nhưng priority High. Cảnh báo rằng priority chỉ là gợi ý. | [tìm] |

**Rút ra**
1. Công thức điểm kiểu Ahrefs (tỉ lệ trang sạch lỗi) dễ giải thích cho owner hơn điểm có trọng số ẩn. Salanca chỉ có khoảng vài chục URL, nên điểm sẽ dao động mạnh khi một trang lỗi: ghi rõ "x/y trang sạch lỗi" bên cạnh con số.
2. Ba mức Lỗi / Cảnh báo / Lưu ý là chuẩn ngành. Nên theo, không phát minh.
3. Mô hình type tách khỏi priority (Screaming Frog) đáng cân nhắc cho check kiểu "canonical trỏ staging": bản chất là cảnh báo nhưng hậu quả lớn. Với MVP có thể gộp thành hai mức, nhưng thiết kế dữ liệu nên chừa chỗ cho priority.

### C. Danh sách vấn đề và đi sâu vào từng URL

| Nguồn | Cách làm | Độ tin cậy |
| --- | --- | --- |
| Ahrefs | Overview có bảng **Top 10 issues** xếp theo số URL bị ảnh hưởng. Bấm số hoặc "View affected URLs" mở Page Explorer. Bấm một trang mở panel chi tiết, tab Issues liệt kê mọi lỗi của trang đó. Dấu "?" cạnh issue hiện giải thích và cách sửa. Export ở ba cấp: tất cả issue, một issue, một URL. | [đọc] |
| Screaming Frog | Cột xuất: Issue Name, Issue Type, Issue Priority, URLs, % of Total, Description, **How To Fix**. | [tìm] |
| Search Console | Bảng "Why pages aren't indexed": mỗi lý do kèm số trang; bấm ra URL; sửa xong bấm **Validate Fix**. | [tìm] |
| Yoast Site Health | Bấm một issue để xem thông tin và cách sửa. Tách "issues to fix" khỏi "improvements to make". Mỗi check gắn nhãn plugin nguồn. Không có thông báo, phải tự vào xem. | [đọc] |
| Webflow Audit panel | Chỉ báo đỏ (vuông) cho nghiêm trọng, vàng (tam giác) cho vừa. Bấm vào mục thì nhảy tới phần tử cần sửa. Không kiểm tra bên trong component. | [tìm] một phần, trang gốc 403 |

**Rút ra**
1. Hai chiều xem: **theo loại lỗi** (bảng top issues) và **theo trang** (mọi lỗi của một trang). Owner thường nghĩ theo trang ("trang Menu có vấn đề gì"), dev thường nghĩ theo loại lỗi. Cần cả hai.
2. Mỗi issue có sẵn: mô tả, **cách sửa**, số trang, % tổng. Đây là bộ cột Screaming Frog đã ổn định qua nhiều phiên bản.
3. Nút **"Sửa"** nhảy thẳng tới màn sửa đúng entry (Webflow làm với phần tử; Strapi làm được với content manager URL). Đây là điểm mình tự rút ra, vì Ahrefs/Semrush không sửa được nội dung nên không có.
4. "Validate Fix" của Search Console: sau khi sửa, cho phép chạy lại chỉ issue đó thay vì audit cả site.

### D. So sánh giữa các lần chạy

| Nguồn | Cách làm | Độ tin cậy |
| --- | --- | --- |
| Ahrefs | Chọn hai crawl bất kỳ bằng dropdown. Cột Change / Added / New / Removed / Missing. Biểu đồ Health Score tối đa 10 lần gần nhất. Trong một issue: **Highlight new** và **Show lost**. Tab **What's new** chỉ liệt kê issue tăng số URL. | [đọc] |
| Semrush | Tab Compare Crawls, hai dropdown ngày, cột **Fixed** và **New**. | [tìm] |

**Rút ra**
1. Tối thiểu cần: điểm các lần trước (sparkline) và "mới / đã sửa" so với lần trước. Đây là phần thưởng tâm lý làm owner quay lại.
2. Chưa cần chọn hai crawl tùy ý. Chỉ so với lần liền trước là đủ cho MVP.
3. Cần lưu lịch sử kết quả audit (bảng DB riêng), nên là append-only giống `audit-event`.

### E. Checklist có hướng dẫn

| Nguồn | Cách làm | Độ tin cậy |
| --- | --- | --- |
| Wix SEO Setup Checklist | Tạo từ 3 câu hỏi (tên doanh nghiệp, có địa chỉ vật lý hay online, 3 từ khóa). Chia ba phần: nền tảng trang chủ + kết nối Google, nội dung, mẹo xếp hạng. Bước bỏ qua hiện chưa hoàn thành; mỗi bước có hướng dẫn. Tiến độ theo "achievement updates", **không thấy** thanh phần trăm trong bài help. | [đọc] |
| Yoast | Task list riêng: mỗi việc có thời lượng ước tính và độ ưu tiên; bấm xem vì sao quan trọng và cách làm. | [tìm] |

**Rút ra**
1. Checklist hợp với việc **một lần** (go-live) hơn audit liên tục. Nên là tab riêng, các mục tự tick từ kết quả audit nếu làm được, không bắt owner tick tay.
2. Mỗi mục: lý do, thời lượng ước tính, ai làm (owner hay dev).
3. Không bắt hoàn thành hết mới được đi tiếp (Wix thì chặn "finish"); mình nên cho phép bỏ qua có lý do.

### F. Xem trước và kiểm tra ngay trong màn sửa nội dung

| Nguồn | Cách làm | Độ tin cậy |
| --- | --- | --- |
| Strapi plugin SEO (chính thức) | Thẻ bên phải màn Content Manager: phân tích nhanh, xem trước SERP (title + description), xem trước Facebook/Twitter, modal phân tích đầy đủ. Cần component `shared.seo` đặt tên đúng và đã có dữ liệu mới thấy. | [đọc] |
| Yoast | Dashboard điểm SEO và readability theo từng trang, gom theo danh mục. | [tìm] |

**Rút ra**
1. Component `shared.seo` của Salanca (`metaTitle` ≤ 60, `metaDescription` ≤ 160, `shareImage`, `canonicalPath`, `noIndex`) **đụng tên** với plugin chính thức. README của plugin nói: nếu `shared.seo` đã tồn tại thì plugin không tạo mới, bạn phải đổi tên hoặc xóa; và nó cần thêm component con `shared.meta-social`. [đọc] Kết luận: không cắm plugin chính thức vào nguyên trạng. Tự viết panel (vùng `editView.right-links`) đọc thẳng schema hiện có là hướng ít rủi ro hơn.
2. Giới hạn ký tự đã nằm trong schema (60/160): bộ đếm ký tự chỉ cần đọc từ đó.

## 2. Khoảng trống (không tìm thấy hoặc không lấy được)

- Giao diện thật của Webflow Audit panel và trang Disable indexing: help.webflow.com trả 403.
- Cách Saleor, Medusa, Vendure, WooCommerce hiện SEO trong admin: chưa xác minh được. Tìm Saleor không ra tài liệu về giới hạn ký tự hay khối "Search Engine Preview". Cần mở sản phẩm thật hoặc đọc repo trước khi trích.
- Ảnh chụp màn hình: không có ảnh nào trong kết quả; mô tả bố cục ở trên suy ra từ văn bản, **không phải nhìn trực tiếp**. Mockup cho AI khác code nên dựa vào cấu trúc dữ liệu và hành vi, còn kiểu dáng thì tự thiết kế theo admin Strapi.
- Công thức trọng số của Semrush và Rank Math: không công khai đầy đủ.

## 3. Hệ quả cho thiết kế trang SEO của Salanca

Sắp theo mức độ chắc chắn (nhiều nguồn đồng ý trước):

1. Ba mức Lỗi / Cảnh báo / Lưu ý, điểm 0-100, kèm "x/y trang sạch lỗi". (Ahrefs, Semrush, Rank Math)
2. Hai chiều xem: theo loại lỗi và theo trang. (Ahrefs)
3. Mỗi issue có mô tả, cách sửa, số trang, % tổng. (Screaming Frog, Ahrefs)
4. Dải trạng thái go-live hiện trên **mọi trang admin** khi ở trạng thái nguy hiểm. (Yoast, plugin WP)
5. Nút "Sửa" nhảy tới entry trong Content Manager. (Webflow, mình mở rộng)
6. So với lần chạy trước: mới / đã sửa, sparkline điểm. (Ahrefs, Semrush)
7. Checklist go-live tự tick theo kết quả audit. (Wix, mình mở rộng)
8. Chạy lại riêng một issue sau khi sửa. (Search Console)
9. Trang chủ ý noindex không bị báo lỗi. (Search Console)

## 3b. Vòng 2: kiểm tra sâu (cùng ngày)

Vòng một còn nhiều chỗ hổng, nên đào thêm ba hướng: khả năng kỹ thuật trong Strapi của repo, tài liệu chính thức của Google, và code thật của Saleor.

### Strapi 5 và repo hiện tại

| Phát hiện | Nguồn | Độ tin cậy |
| --- | --- | --- |
| Tài liệu Strapi 5 chỉ liệt kê vùng chèn của Content Manager: `listView.actions`, `editView.right-links`, `preview.actions` và các modal. **Không có vùng chèn toàn cục** (banner trên mọi trang). Vùng tùy biến luôn thuộc một plugin cụ thể. | docs.strapi.io (admin-injection-zones) | [đọc] |
| Widget trang chủ: `app.widgets.register()`, cần Strapi 5.13 trở lên. Repo chạy `@strapi/strapi 5.51.1`. | docs.strapi.io + `package.json` | [đọc] |
| Repo **đã có sẵn** `app.addMenuLink`, `app.addSettingsLink` (mục Settings > Salanca), `app.widgets.register` (3 widget lead), `injectComponent('listView','actions')`, màn Nhật ký hoạt động (`src/admin/audit-log`) và bọc toàn bộ route bằng `router.addRoute` + Provider (`src/admin/app.tsx` quanh dòng 206). | code repo | [đọc] |
| Repo cũng dùng thủ thuật DOM/CSS có chủ đích (`setupMainNavLabels`, `watchLeadNavHighlight`), ghi chú rằng phải kiểm tra lại sau mỗi lần nâng `@strapi/*`. | `src/admin/main-nav-labels.css` | [đọc] |

**Hệ quả**
1. Banner go-live toàn cục: **không có đường chính thức**, nhưng có tiền lệ trong repo là lớp bọc route. Cần spike nhỏ (layout Strapi cao 100vh). Phương án dự phòng có tài liệu: widget trang chủ + chip ở `listView.actions` / `editView.right-links`.
2. Quy tắc trong `AGENTS.md` backend ("custom Admin UI chỉ sau workflow gap được chấp nhận") đã có tiền lệ được chấp nhận: lead, nhật ký, email thông báo. Vẫn cần bạn duyệt riêng cho SEO.
3. Làm theo khuôn `audit-log` để đồng bộ: Screen, Filters, Table, DetailDrawer, helper có test, `vi.ts`.

### Google (tài liệu chính thức)

| Phát hiện | Độ tin cậy |
| --- | --- |
| Muốn noindex có tác dụng, trang **không được bị robots.txt chặn**. Nếu chặn, "the crawler will never see the `noindex` rule" và trang vẫn có thể hiện nếu có link trỏ tới. Google không hỗ trợ noindex trong robots.txt. | [đọc] |
| Cách chặn index được khuyên: thẻ `<meta name="robots" content="noindex">` hoặc header `X-Robots-Tag`. Sau khi thêm, Googlebot có thể mất lâu mới quay lại nên trang vẫn hiện một thời gian. | [đọc] |
| Sitemap chỉ nên có URL canonical bạn muốn hiện trên Google. Giới hạn 50MB hoặc 50.000 URL mỗi file. **Google bỏ qua `priority` và `changefreq`**; chỉ dùng `lastmod` khi chính xác và kiểm chứng được. | [đọc] |
| Search Console Page indexing: bảng "Why pages aren't indexed" chia lý do thành **thường là chủ ý** (noindex, canonical đúng, redirect, blocked by robots.txt) và **thường là lỗi** (5xx, soft 404, 404, redirect error, crawled/discovered but not indexed). Có cột **Source** cho biết lỗi do Google hay do website. Cảnh báo: "Indexed, though blocked by robots.txt". | [đọc] |
| **Validate fix**: Google kiểm vài trang mẫu trước, rồi kiểm lại từng URL (Pending, Passed, Other). Trạng thái Started, Looking good, Passed, Failed. Thường mất khoảng hai tuần. Danh sách ví dụ giới hạn 1.000 URL. | [đọc] |
| Lighthouse "Page is blocked from indexing": chỉ báo khi noindex áp cho **mọi** crawler (meta robots hoặc `X-Robots-Tag`); chỉ thị riêng cho Googlebot thì chỉ cảnh báo. Hướng dẫn sửa bắt đầu bằng "xác nhận trang này có nên được index không". | [đọc] |

**Hệ quả**
1. **Đính chính cho thiết kế trước**: "Tắt index" sau khi đã live phải dùng noindex mà vẫn cho thu thập. `salanca-web/src/app/robots.ts` hiện trả `Disallow: /` khi `crawlIndexable` tắt: ổn cho staging, **sai** cho tình huống "production đã live rồi tắt" (trang đã vào Google sẽ nằm lại). Cần bạn quyết có đổi hành vi này không.
2. Thêm check "trang có noindex nhưng robots.txt chặn" vào audit.
3. Bỏ ý đưa `priority` / `changefreq` vào cấu hình sitemap (mình đề xuất ở đầu cuộc trò chuyện, nay rút lại). Chỉ `lastmod` thật từ `updatedAt`.
4. Nhóm "Cố ý / Cần xem" của Search Console xác nhận mức Lưu ý "Trang noindex có chủ ý" trong mockup là đúng hướng.
5. "Chạy lại check này" trong mockup là kiểm lại trong CMS, **khác** "Validate fix" của Google (hai tuần). Đặt tên khác nhau để owner khỏi nhầm.
6. Công thức Lighthouse (chỉ báo khi chặn mọi crawler) gợi ý cách tránh báo giả cho chỉ thị riêng từng bot.

### Saleor Dashboard (code thật, `SeoForm.tsx`)

| Phát hiện | Độ tin cậy |
| --- | --- |
| Ba ô: slug, title, description. Giới hạn **255 / 70 / 300**, nhãn kèm bộ đếm "(N of 70 characters)" chỉ khi ô không rỗng. Slug chỉ nhận `[a-zA-Z0-9-_]`. | [đọc] |
| Có nhãn **Complete / Incomplete** ở đầu thẻ SEO, true khi cả ba ô có giá trị. | [đọc] |
| File này **không có** thẻ xem trước kết quả Google (có thể nằm ở component khác, chưa kiểm). | [đọc] |

**Hệ quả**: giới hạn 60/160 của Salanca chặt hơn Saleor (70/300), phù hợp hướng dẫn hiển thị của Google. Chip Complete / Incomplete cho từng entry là mẫu rẻ, đặt ở `editView.right-links`.

### Vẫn chưa lấy được

- Webflow help (Audit panel, Disable indexing): vẫn 403 ở cả hai địa chỉ.
- Medusa, Vendure, WooCommerce lõi: tìm hai lần không ra tài liệu admin SEO. Có thể do các nền tảng này không có SEO sẵn trong admin lõi (Vendure và Woo dùng plugin), nhưng **đây là suy đoán**, chưa kiểm.
- Ảnh chụp giao diện thật của Ahrefs, Semrush, Yoast: chưa có.

## 4. Việc cần quyết định trước khi vẽ mockup

- Audit chạy ở đâu và đọc gì: crawl URL live hay đọc thẳng DB Strapi + registry route của web. Hai cách cho kết quả khác nhau (crawl thấy canonical thật đã render; đọc DB thấy được bản nháp nhưng không thấy lỗi do frontend).
- Nút admin cần duyệt theo `AGENTS.md` backend ("custom Admin UI chỉ sau workflow gap được chấp nhận").
- Công tắc go-live và biến môi trường `SEO_INDEXING` / `DEPLOYMENT_ENV` hiện có: công tắc admin không được vượt quyền env.
