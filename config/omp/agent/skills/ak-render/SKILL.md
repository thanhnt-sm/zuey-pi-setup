---
name: ak-render
description: "Biên dịch và tạo giao diện HTML tương tác declarative từ Page Spec (YAML/JSON) cho AI agent bằng AK Render (@bestagentkits/render) và MCP Server. Tiết kiệm 60-73% tokens, tự động validate schema và sinh artifact độc lập."
vi_triggers: "tạo html, render trang, ak-render, page spec, tạo báo cáo trực quan, dashboard html, giao diện báo cáo, vẽ spec html"
en_triggers: "ak-render, render html, page spec, declarative html, agentkit render, html artifact, generate dashboard"
argument-hint: "<intent | recipe-name> [--theme <preset>] [--out <file.html>]"
category: frontend
keywords: [ak-render, html-compiler, page-spec, mcp, interactive-html, data-dashboard]
---

# AK Render: Declarative Page Spec & HTML Artifact Compiler

Kỹ năng điều phối AI Agent thiết kế, kiểm tra hợp lệ (validate) và biên dịch các giao diện HTML tương tác, độc lập (standalone) bằng công cụ **AK Render (`@bestagentkits/render`)** qua CLI hoặc MCP Server.

Thay vì bắt model tự sinh hàng ngàn dòng code HTML, CSS/Tailwind, JavaScript phức tạp (gây tốn 60–73% context tokens và dễ lỗi cú pháp), AI Agent chỉ cần khai báo một tài liệu cấu trúc nhẹ **Page Spec (YAML hoặc JSON)**. Compiler nội bộ sẽ lo toàn bộ layout, typography, theme, khả năng truy cập (a11y), responsive và bảo mật.

---

## 1. Vòng Lặp Chuẩn 5 Bước Của AI Agent (Standard 5-Step Loop)

Mọi tác vụ tạo giao diện qua `ak-render` bắt buộc phải tuân thủ nghiêm ngặt 5 bước sau:

```
[1. Khám Phá Block & Recipe] 
       │
       ▼
[2. Khảo Sát Hợp Đồng Schema (Describe)] 
       │
       ▼
[3. Khởi Tạo Page Spec (YAML/JSON) & Cấu Hình Options] 
       │
       ▼
[4. Pre-Flight Validation Gate (Bắt Buộc)] ◄─── (Nếu có lỗi: sửa theo JSON path và validate lại)
       │
       ▼
[5. Biên Dịch Độc Lập Ra File HTML (Render)]
```

### Bước 1: Khám Phá Block & Recipe
- Tìm kiếm block phù hợp với ý định người dùng:
  ```bash
  ak-render search-catalog "interactive table pricing kpi" --json
  # Hoặc qua MCP: search-catalog(query: "interactive table pricing kpi")
  ```
- Liệt kê toàn bộ block catalog theo danh mục (`layout`, `content`, `data`, `interaction`, `media`, `engineering`, `product`):
  ```bash
  ak-render catalog --category data --json
  # Hoặc qua MCP: catalog(category: "data")
  ```
- Xem danh sách starter templates có sẵn:
  ```bash
  ak-render recipes --json
  # Hoặc qua MCP: recipes()
  ```
  *(Các recipe phổ biến: `architecture-review`, `benchmark-report`, `dashboard`, `case-study`, `incident-report`, `pr-review`, `product-roadmap`, `spec-proposal`)*.

### Bước 2: Khảo Sát Hợp Đồng Schema (Contract Inspection)
Trước khi thêm một block mới vào spec, AI agent PHẢI kiểm tra schema của block đó để nắm rõ required properties, enums, dataRef:
```bash
ak-render describe data-table kpi risk-matrix --compact
# Hoặc lấy schema chi tiết dạng JSON qua MCP: describe(types: ["data-table", "kpi"], compact: true)
```

### Bước 3: Khởi Tạo Page Spec Chuẩn & Bổ Sung Options
Lấy khung sườn từ recipe hoặc tạo mới theo cấu trúc chuẩn:
```bash
ak-render recipe architecture-review > _output/drafts/my-page-spec.yaml
```

#### Cấu Trúc Khung Page Spec Bắt Buộc:
```yaml
version: 1
meta:
  title: "Tên Tiêu Đề Tài Liệu / Báo Cáo"
  description: "Mô tả ngắn gọn phạm vi và mục đích"
theme:
  preset: blueprint # Hoặc: data-console, editorial, executive-report, paper-ink, product-studio, research-notebook, swiss-clean, terminal-mono, warm-signal
policy:
  network: "deny" # Hoặc: { allow: ["https://example.com/*"] }
datasets:
  # Toàn bộ dữ liệu mảng/bảng đặt tại đây để tái sử dụng
  metricData:
    - { metric: "Latency p99", baseline: "120ms", current: "42ms", status: "success" }
    - { metric: "Error Rate", baseline: "0.85%", current: "0.01%", status: "success" }
blocks:
  - type: hero
    eyebrow: "Architecture Review"
    title: "Triển Khai Caching Phân Tán"
    description: "Tối ưu hóa throughput cho hệ thống thanh toán cốt lõi."
  - type: main-aside
    blocks:
      - type: data-table
        title: "Chỉ Số Đo Lường"
        dataRef: metricData
        columns:
          - { key: metric, label: "Metric" }
          - { key: baseline, label: "Baseline" }
          - { key: current, label: "Current" }
          - { key: status, label: "Trạng thái", type: badge, tones: { success: success } }
    aside:
      - type: key-value
        title: "Thông Tin Quyết Định"
        items:
          - { key: "Người phê duyệt", value: "Lead Architect" }
          - { key: "Trạng thái", value: "Approved" }
```

### Bước 4: Pre-Flight Validation Gate (Cổng Kiểm Tra Bắt Buộc)
**AI Agent TUYỆT ĐỐI KHÔNG ĐƯỢC PHÉP render nếu chưa chạy bước validate!**
```bash
ak-render validate _output/drafts/my-page-spec.yaml --json
# Hoặc qua MCP: validate(spec: "<yaml_or_json_content>")
```
Nếu `ok: false`:
- Duyệt qua mảng `diagnostics[]`.
- Xác định chính xác `path` (ví dụ: `blocks.0.columns.1.type`) và mã lỗi `code`.
- Sửa trực tiếp trường lỗi trong YAML/JSON spec.
- Chạy lại `validate` cho đến khi `ok: true`.

### Bước 5: Biên Dịch Độc Lập (Render & Compile)
```bash
ak-render _output/drafts/my-page-spec.yaml --out _output/docs/my-report.html --json
# Hoặc qua MCP: render(spec: "<spec_content>", out: "_output/docs/my-report.html")
```
Compiler trả về bản tóm tắt gọn gàng (kích thước bytes, SHA-256 hash, danh sách warning nếu có). File HTML sinh ra là file độc lập (self-contained), có thể mở trực tiếp bằng browser mà không cần web server.

---

## 2. Các Tùy Chọn & Options Hỗ Trợ Cho AI Agent

Khi nhận prompt từ người dùng, AI Agent có thể áp dụng các tùy chọn sau:

| Option | Cú pháp CLI | Tham số MCP | Mục đích |
|---|---|---|---|
| **Theme Preset** | `--theme <name>` | `theme: "<name>"` | Đổi giao diện hiển thị: `blueprint`, `data-console`, `editorial`, `executive-report`, `paper-ink`, `product-studio`, `research-notebook`, `swiss-clean`, `terminal-mono`, `warm-signal`. |
| **Output Path** | `--out <path>` | `out: "<path>"` | Đường dẫn file HTML sinh ra. Tuân thủ taxonomy: lưu vào `_output/docs/` hoặc `_output/drafts/`. |
| **Starter Recipe** | `recipe <name>` | `recipe(name: "<name>")` | Khởi tạo nhanh từ 1 trong 10+ recipe chuẩn thay vì viết từ đầu. |
| **Compact Contract** | `describe --compact` | `compact: true` | Tiết kiệm token khi tra cứu hợp đồng các block (chỉ hiển thị tên thuộc tính, required, type enum). |
| **Validate Only** | `validate` | `validate()` | Kiểm tra cú pháp, liên kết dữ liệu `dataRef` mà không xuất file. |
| **Category Filter** | `catalog --category <c>` | `category: "<c>"` | Lọc block theo nhóm: `layout`, `content`, `data`, `interaction`, `media`, `engineering`, `product`. |

---

## 3. Các Nguyên Tắc Vàng Khi Soạn Page Spec (Golden Rules)

1. **Tuyệt đối KHÔNG viết mã HTML, CSS hoặc script tùy ý**: Spec không có trường nào hỗ trợ chèn `<script>` hay thẻ HTML tự do. Compiler sở hữu toàn quyền về bảo mật và thẩm mỹ.
2. **Inline Code trong văn bản**: Chỉ sử dụng cặp dấu backticks (ví dụ: `` `apiKey` ``) để hiển thị inline code chip. Không dùng các tag HTML `<br>`, `<b>`, `<span>`.
3. **Quản lý dữ liệu qua `datasets`**: Các bảng số liệu, danh sách dữ liệu động lớn phải được định nghĩa trong `datasets: { id: [...] }` ở cấp cao nhất, sau đó các block gọi qua thuộc tính `dataRef: id`.
4. **Luôn kiểm tra thuộc tính bắt buộc**: Trước khi dùng block phức tạp như `chart`, `diagram-panel`, `risk-matrix`, `steps`, bắt buộc phải gọi `describe` để tránh thiếu required keys.
5. **Đảm bảo đường dẫn lưu trữ sạch**: Mọi file `.html` hoặc `.yaml` sinh ra phải đặt trong thư mục `_output/docs/` hoặc `_output/drafts/`, không làm ô nhiễm thư mục gốc.

---

## 4. Bảng Tra Cứu Nhanh 10 Themes Tiêu Biểu

| Theme Preset | Phong Cách & Ứng Dụng Phù Hợp |
|---|---|
| `blueprint` | Kỹ thuật, kiến trúc hệ thống, sơ đồ hạ tầng, RFC, ADR. (Tone xanh kỹ thuật) |
| `data-console` | Dashboard dữ liệu, giám sát metrics, telemetry, dark mode hiện đại. |
| `executive-report` | Báo cáo ban điều hành, KPI tài chính, chiến lược kinh doanh, tổng kết quý. |
| `editorial` | Tài liệu học thuật, nghiên cứu chuyên sâu, bài viết blog công nghệ dài kỳ. |
| `terminal-mono` | DevOps, CLI logs, phân tích sự cố bảo mật (incident analysis), hacker tone. |
| `paper-ink` | Thiết kế tối giản đen trắng, mô phỏng trang in cao cấp, thanh lịch. |
| `product-studio` | Giới thiệu tính năng sản phẩm, roadmap, thiết kế UX/UI showcase. |
| `research-notebook`| Ghi chú thí nghiệm, benchmark model AI, tài liệu phân tích số liệu. |
| `swiss-clean` | Thiết kế Thụy Sĩ chuẩn mực, lưới chặt chẽ, khoảng trắng thoáng đãng. |
| `warm-signal` | Tone màu ấm, thân thiện, phù hợp cho bài viết onboarding hoặc hướng dẫn. |
