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

| Extension | Converter | Ghi chú |
|-----------|-----------|---------|
| `.pdf` | markitdown MCP | ✅ |
| `.docx` | markitdown MCP | ✅ |
| `.xlsx`, `.xls` | markitdown MCP | ✅ |
| `.pptx`, `.ppt` | markitdown MCP | ✅ |
| `.html`, `.htm` | markitdown MCP | ✅ |
| `.csv` | markitdown MCP | ✅ |
| `.json` | markitdown MCP | ✅ |
| `.xml` | markitdown MCP | ✅ |
| `.epub` | markitdown MCP | ✅ |
| `.msg`, `.eml` | markitdown MCP | ✅ |
| `.doc`, `.rtf` | markitdown MCP → textutil → pandoc | ⚠️ fallback chain |

### Conversion Protocol

**Single file** (file ≤ 500KB):
```
1. mcp__markitdown__convert_to_markdown(uri="file:///absolute/path/to/file")
2. Nếu kết quả là text → Write vào <file_stem>_converted.md
3. Nếu kết quả chứa temp file path → cp <temp_path> <file_stem>_converted.md
4. Dùng file .md đã convert → tiếp tục xử lý
```

**Single file lớn** (file > 500KB) hoặc **Batch files** (nhiều file):
```
1. Gọi skill /md-convert <source_path> --output <output_dir>
2. Đợi report từ /md-convert
   - Exit 0 → success, parse JSON plan
   - Exit 2 → mode/extension mismatch, dừng và hỏi user
   - Exit 3 → không tìm file convert được, dừng
3. Dùng các file .md output → tiếp tục xử lý
KHÔNG load content vào context — chỉ dùng file paths
```

**URI format**: luôn dùng `file:///` prefix cho local path:
```
file:///Users/<user>/.../document.pdf
```

---

## [STOP] Diagram Files — Yêu Cầu Human Convert

Extensions: `.dia`, `.svg` (khi chứa diagram logic)

**Auto-converted by md-convert:** `.vsdx`, `.drawio` → Mermaid (via `/md-convert` skill)

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
5. File > 500KB → dùng `/md-convert` (chunked), không inline MCP

---

## Ví Dụ Áp Dụng

```
# ✅ ĐÚNG — PDF convert trước
mcp__markitdown__convert_to_markdown("file:///path/to/BRD.pdf")
→ write to BRD_converted.md
→ Read("BRD_converted.md") khi cần nội dung

# ✅ ĐÚNG — Markdown đọc thẳng
Read("/path/to/requirements.md")

# ✅ ĐÚNG — Nhiều file DOCX
/md-convert ./docs/urd/ --output ./docs/urd_md/

# ❌ SAI — Đọc thẳng PDF
Read("/path/to/BRD.pdf")  ← FORBIDDEN

# ❌ SAI — Bash cat DOCX
Bash("cat ./docs/spec.docx")  ← FORBIDDEN
```

---

## Tích Hợp với pm-ba Skill

Rule này thay thế / bổ sung vào `references/document-ingest-protocol.md` của `pm-ba`:
- Tier 1 → Native types → Read trực tiếp
- Tier 2 → Convertible → markitdown MCP inline
- Tier 3 → Lớn / batch → `/md-convert` skill
- Tier 4 → Unsupported → STOP, yêu cầu human
