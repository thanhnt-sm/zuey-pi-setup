# File Type Enforcement Rule

**MANDATORY — Áp dụng cho TẤT CẢ skills, modes, frameworks. KHÔNG có ngoại lệ.**

Trước khi xử lý BẤT KỲ file input nào, PHẢI thực thi enforcement flow dưới đây.

---

## Enforcement Flow

```
Input file(s) received
        │
        ▼
[1] Xác định extension
        │
        ├─ NATIVE (.md .txt .mermaid .mmd) ──────────────► [OK] Đọc trực tiếp bằng Read tool
        │
        ├─ CONVERTIBLE (xem bảng bên dưới) ─────────────► [2] Auto-convert → rồi xử lý
        │
        ├─ DIAGRAM (.vsdx .drawio .dia) ─────────────────► [STOP] Yêu cầu human convert
        │
        └─ UNSUPPORTED (binary, media, archive) ─────────► [STOP] Yêu cầu human convert
```

---

## [1] Native Types — Xử Lý Trực Tiếp

Không cần convert. Dùng `Read` tool ngay.

| Extension | Ghi chú |
|-----------|---------|
| `.md`, `.markdown` | Markdown |
| `.txt`, `.text` | Plain text |
| `.mermaid`, `.mmd` | Mermaid diagram |

---

## [2] Convertible Types — Bắt Buộc Convert Trước

KHÔNG đọc raw content vào context. PHẢI convert sang markdown trước.

| Extension | OMP Native Tool | Claude Code CLI Tool (`~/.omp/tools-venv`) | Ghi chú |
|-----------|-----------------|---------------------------------------------|---------|
| `.pdf` | `omp_office` (action: `to-md` / `extract-table`) | `python3 ~/.omp/agent/skills/office-doc-suite/scripts/office_cli.py --cmd to-md` | ✅ Pure-Python pypdf |
| `.docx`, `.doc` | `omp_office` (action: `docx2md`) | `python3 ~/.omp/agent/skills/office-doc-suite/scripts/office_cli.py --cmd docx2md` | ✅ python-docx |
| `.xlsx`, `.xls` | `omp_office` / `omp_pmo` (action: `to-md` / `xlsx-diff`) | `python3 ~/.omp/agent/skills/office-doc-suite/scripts/office_cli.py --cmd to-md` | ✅ openpyxl + CWE-1236 safe |
| `.drawio`, `.vsdx` | `omp_office` (action: `to-md`) | `python3 ~/.omp/agent/skills/office-doc-suite/scripts/office_cli.py --cmd to-md` | ✅ Mermaid SSR / XML parser |
| `.mpp`, `.xml` (schedule) | `omp_pmo` (action: `msp2xlsx` / `xlsx-diff`) | `python3 ~/.omp/agent/skills/pmo-project-suite/scripts/pmo_cli.py --cmd msp2xlsx` | ✅ COM (Win) / mpxj (Mac) |
| `.msg`, `.eml` | `omp_email` (action: `scan` / `threads` / `issues`) | `python3 ~/.omp/agent/skills/email-intelligence-suite/scripts/email_cli.py --cmd scan` | ✅ extract-msg |
| `.html`, `.htm` | `omp_office` (action: `to-md`) | `python3 ~/.omp/agent/skills/office-doc-suite/scripts/office_cli.py --cmd to-md` | ✅ |

### Conversion Protocol

**Single file**:
```
1. OMP: Gọi tool native tương ứng (`omp_office`, `omp_pmo`, `omp_email`)
   Claude Code: Gọi CLI tương ứng từ ~/.omp/agent/skills/<suite>/scripts/*_cli.py --json
2. Lấy file .md hoặc output JSON đã convert -> tiếp tục xử lý
3. Dùng tool `read` đọc file .md vừa convert khi cần nội dung
```

**Batch files (nhiều file)**:
```
1. OMP: Gọi `omp_office` action `batch` (hoặc `omp_email` scan folder)
   Claude Code: Gọi `office_cli.py --cmd batch --input <dir> --output <dir> --json`
2. Đọc kết quả từ thư mục output
```

KHÔNG load raw binary content vào context — chỉ dùng file paths đã convert.

**URI format**: luôn dùng `file:///` prefix cho local path:
```
file:///Users/<user>/.../document.pdf
```

---

## [STOP] Diagram Files — Yêu Cầu Human Convert

Extensions: `.dia`, `.svg` (khi chứa diagram logic)

**Auto-converted by omp_office:** `.vsdx`, `.drawio` → Mermaid (via `omp_office(action="to-md")` or `office_cli.py --cmd to-md`)

**Manual convert required:** `.dia` không có converter tốt.

Dừng luồng và thông báo:

```
⛔ File "[tên file]" là diagram file và không thể tự động convert.

Vui lòng thực hiện một trong các bước sau:
1. Export sang Mermaid (.mmd) — nếu tool hỗ trợ (draw.io có tính năng này)
2. Mô tả diagram bằng text hoặc Markdown
3. Screenshot + dùng /ck:ai-multimodal để OCR

Sau đó cung cấp file đã convert để tiếp tục.
```

---

## [STOP] Unsupported Types — Yêu Cầu Human Convert

| Nhóm | Extensions |
|------|-----------|
| Hình ảnh | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.tiff` |
| Video / Audio | `.mp4`, `.avi`, `.mov`, `.mp3`, `.wav`, `.m4a` |
| Archive | `.zip`, `.rar`, `.7z`, `.tar`, `.gz` |
| Binary / Executable | `.exe`, `.dll`, `.bin`, `.so`, `.app` |
| Database | `.sqlite`, `.db`, `.mdb`, `.accdb` |

**Ngoại lệ hình ảnh:** Nếu đây là ảnh chứa văn bản / tài liệu scan → gọi `ck:ai-multimodal` để OCR thay vì dừng.

**Dừng luồng và thông báo:**

```
⛔ File "[tên file]" (.[extension]) không được hỗ trợ và không thể tự động convert.

Vui lòng convert sang một trong các định dạng sau:
- .md hoặc .txt  (văn bản / tài liệu)
- .mermaid / .mmd (sơ đồ / diagram)

Sau đó cung cấp file đã convert để tiếp tục.
```

---

## Token Efficiency Contract

1. **KHÔNG** dùng `cat`, `Bash cat`, hay `Read` để đọc file binary/rich-text vào context
2. **KHÔNG** in markdown content từ file đã convert vào conversation
3. **LUÔN** write converted content ra disk trước, sau đó tham chiếu bằng file path
4. **CHỈ** đọc converted `.md` vào context khi thực sự cần phân tích nội dung
5. Bắt buộc dùng `omp_office` / `omp_pmo` / `omp_email` hoặc suite CLI, tuyệt đối KHÔNG tự viết script Python/PowerShell lặp lại

---

## Ví Dụ Áp Dụng

```
# ✅ ĐÚNG — PDF convert qua omp_office trước
omp_office(action="to-md", input="./docs/BRD.pdf", output="./docs/BRD_converted.md")
→ read("docs/BRD_converted.md") khi cần nội dung

# ✅ ĐÚNG — So sánh 2 file Excel lịch trình
omp_pmo(action="xlsx-diff", input="v1.xlsx", compare="v2.xlsx")

# ✅ ĐÚNG — Nhiều file DOCX
omp_office(action="batch", input="./docs/urd/", output="./docs/urd_md/", mode="docx2md")
# ❌ SAI — Đọc thẳng PDF
Read("/path/to/BRD.pdf")  ← FORBIDDEN

# ❌ SAI — Bash cat DOCX
Bash("cat ./docs/spec.docx")  ← FORBIDDEN
```

---

## Tích Hợp với pm-ba Skill

Rule này thay thế / bổ sung vào `references/document-ingest-protocol.md` của `pm-ba`:
- Tier 1 → Native types → Read trực tiếp
- Tier 2 → Convertible → `omp_office` / `omp_pmo` / `omp_email`
- Tier 3 → Lớn / batch → `omp_office(action="batch")` hoặc suite CLI tương ứng
- Tier 4 → Unsupported → STOP, yêu cầu human
