# Document Ingest Protocol — File Reading, Size Tiers, Encoding

## Per-Extension Routing

| Extension | Method | Tool / Command | Notes |
|---|---|---|---|
| `.md`, `.txt` | Read tool directly | `Read(file_path)` | No conversion needed; read in chunks if >500 lines. **Check for Visio-MD pattern (see below)** |
| `.pdf` | markitdown convert | `mcp__markitdown__convert_to_markdown(uri="file:///abs/path/file.pdf")` | Always use triple-slash URI format |
| `.docx`, `.doc` | markitdown convert | `mcp__markitdown__convert_to_markdown(uri="file:///abs/path/file.docx")` | Preserves tables and headings |
| `.pptx`, `.ppt` | markitdown convert | `mcp__markitdown__convert_to_markdown(uri="file:///abs/path/file.pptx")` | Each slide becomes a section |
| `.xlsx`, `.xls`, `.csv` | markitdown convert | `mcp__markitdown__convert_to_markdown(uri="file:///abs/path/file.xlsx")` | Tables preserved as markdown tables |
| `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp` | AI multimodal OCR | `ck:ai-multimodal` with image path | Use for scanned docs, photos of whiteboards, screenshots |
| `.html`, `.htm` | markitdown convert | `mcp__markitdown__convert_to_markdown(uri="file:///abs/path/file.html")` | Strips nav/footer; keeps content |
| Unknown extension | Attempt markitdown first | `mcp__markitdown__convert_to_markdown(uri=...)` | If fails → run `file "path"` via Bash to detect type → retry or log unsupported |

**markitdown URI format:** always `file:///absolute/path/to/file.ext` — three forward slashes after `file:`. For Google Drive paths with spaces, the full path must be double-quoted in Bash but passed as-is to the MCP tool.

---

## Size Tiers

### Tier 1 — Small (<50KB)

- Read or convert directly in main context
- Process inline — no subagent needed
- Save raw extract only if conversion produces >300 lines (evidence rule still applies)

### Tier 2 — Medium (50KB–500KB)

1. Convert using appropriate tool per extension table above
2. **MANDATORY: Save raw converted content** to `plans/reports/raw-extract-{YYMMDD}-{slug}.md` before any analysis
3. Spawn a summarizer subagent with the raw extract path as input
4. Subagent produces structured summary (key sections, requirements, decisions, open items)
5. **Save subagent summary** to `plans/reports/raw-extract-{YYMMDD}-{slug}-summary.md`
6. Use the summary in main context for synthesis — never lose the raw extract

### § Inline Text Input

When the user pastes document content directly into the conversation (no file path provided).

**Metadata Header Format** — optional but recommended before pasting BRD/URD inline:

```
ProjectName: [project name]
Stakeholders: [names and roles]
Deadline: [YYYY-MM-DD or "TBD"]
TechStack: [technologies / platforms / "N/A"]
---
[BRD/URD/document content here]
```

If the header is present, the skill extracts these values as slot fills. If absent, slots are inferred from document content or prompted via `AskUserQuestion`.

**[REDACTED] Convention** — replace sensitive values before pasting:

| Type Tag | Example | Use When |
|----------|---------|----------|
| `[REDACTED:password]` | `password: [REDACTED:password]` | Passwords, passphrases |
| `[REDACTED:PII-name]` | `Nguyễn Văn A → [REDACTED:PII-name]` | Full names, personal identifiers |
| `[REDACTED:PII-id]` | `CCCD: [REDACTED:PII-id]` | ID card numbers, passport numbers |
| `[REDACTED:api-key]` | `token: [REDACTED:api-key]` | API keys, access tokens |
| `[REDACTED:internal-id]` | `AccountID: [REDACTED:internal-id]` | Internal system IDs |

The `[REDACTED:type]` tag lets AI recognize what class of data was redacted, enabling accurate classification without exposing the actual value.

**Large Inline Text Chunking** — if inline text exceeds 5,000 words, split into sequential parts:

```
PART 1/3: [section name — e.g., "Executive Summary + Scope"]
[content]

PART 2/3: [section name — e.g., "Functional Requirements §3.1–§3.8"]
[content]
```

AI consolidates all parts into a unified analysis after receiving the final part. For file-based chunking (>500KB files), see Tier 3 below.

---

### Tier 3 — Large (>500KB)

1. Do not attempt full conversion in one call
2. Identify logical chunk boundaries: chapters, sections, page ranges, or sheet tabs
3. For PDFs: use page ranges (e.g., pages 1–20, 21–40, …)
4. For DOCX/XLSX: convert full file → split resulting markdown by heading level
5. For each chunk:
   - Convert or extract chunk
   - Save to `plans/reports/raw-extract-{YYMMDD}-{slug}-chunk-{N}.md`
   - Spawn subagent to summarize chunk
   - Save chunk summary to `plans/reports/raw-extract-{YYMMDD}-{slug}-chunk-{N}-summary.md`
6. After all chunks: synthesize all chunk summaries into a master summary
7. Save master summary to `plans/reports/raw-extract-{YYMMDD}-{slug}-master-summary.md`
8. Use master summary in main context

---

## Visio-Converted Markdown (Special Case)

**Detection:** When reading a `.md` file, check the first 5 lines for either of these markers:
- `> ⚠️ Auto-generated from Visio`
- `%% No connections found`
- `%% Source: *.vsdx`

**Why special:** Visio → Mermaid conversion loses all edge connections. The diagram contains shapes (nodes) but NO arrows/links. Standard Mermaid rendering is useless; the file must be analyzed as a **structured label inventory**, not a flow diagram.

**Analysis Protocol for Visio-MD:**
1. Do NOT attempt to render or validate Mermaid — connections are missing by design
2. For each `## Page N: {PageName}` section, extract:
   - **Page name** → maps to a specific subprocess or swimlane view
   - **Shape labels** (the quoted strings in `ShapeID["..."]`) → these are the actual process steps/actors
   - **Numbered prefixes in labels** (e.g., `"1. Tổng hợp"`, `"2.1. Phân giao"`) → infer step sequence
   - **Swimlane headers** (shapes with no action verb, only role names) → identify actors
3. Infer flow from:
   - Numbered step labels (sequential ordering)
   - Shape naming patterns (Start/End/YES/NO → decision points)
   - Repeated label patterns across pages (same step = shared subprocess)
4. Flag loss of connections explicitly in the report: `⚠️ Flow inferred from labels — connections lost in Visio conversion. Verify with source .vsdx before implementing.`
5. Save raw shape inventory to `plans/reports/raw-extract-{date}-{slug}.md` before synthesis
6. Route to `references/35-output-task-triaging.md` after extraction if ambiguities found

**Common patterns in Visio-MD:**
- `S{N}["Start"]` / `S{N}["End"]` / `S{N}["END"]` → flow start/end
- `S{N}["YES"]` / `S{N}["NO"]` → decision branch labels (gate outcomes)
- `S{N}["Y/c sửa lại"]` / `S{N}["Từ chối"]` → rejection/rework outcomes
- `S{N}["Phê duyệt"]` → approval action
- Pages with the same shape set but different actor swimlane headers → same flow, different actor context (e.g., KHCN vs KHDN variant)

---

## Evidence-Saving Rule (MANDATORY)

Before ANY analysis of a document:

1. Convert the document using the appropriate method above
2. Save the raw converted content to `plans/reports/raw-extract-{YYMMDD}-{source-slug}.md`
3. This file is the **evidence file** — it preserves exact quotes, section numbers, and original structure
4. Never perform synthesis using only in-memory content
5. All subsequent analysis must be traceable back to quotes in the evidence file
6. When citing a requirement or decision in an output artifact, include a reference like: `(source: raw-extract-260517-brd-module-vay.md §3.2)`

---

## Folder Scanning Protocol

When a user provides a folder path instead of a file:

1. Run `find "folder_path" -type f` via Bash to list all files recursively
2. Filter out: `.DS_Store`, `.git/*`, `*.tmp`, `~$*` (Office temp files), `.localized`
3. Triage by extension priority:
   - Priority 1: `.pdf`, `.docx` (most structured content)
   - Priority 2: `.xlsx`, `.pptx` (tabular/slide content)
   - Priority 3: `.md`, `.txt` (plain text)
   - Priority 4: images (`.png`, `.jpg`) — OCR if needed
4. If total file count > 10: display folder manifest to user → ask which documents to prioritize
5. Process in priority order; track each file's ingest status in a temporary manifest table
6. Aggregate all evidence files; proceed with synthesis once all priority files are processed

---

## Vietnamese Encoding

Vietnamese filenames and content can cause issues on macOS with certain tools:

- **File paths with diacritics**: always double-quote in Bash commands: `find "/path/with/Tiếng Việt/"` 
- **Garbled output detection**: if converted content contains sequences like `á»›`, `Ä'`, or `Ã` — this is a UTF-8 double-encoding issue
- **Fix command**: `iconv -f utf-8 -t utf-8 -c "file.txt" > "file-clean.txt"` — removes invalid byte sequences
- **Verify encoding**: `file -I "document.md"` should return `charset=utf-8`
- **markitdown**: generally handles UTF-8 correctly for DOCX/PDF; if garbled, save raw output and apply iconv before reading
- **Normalize filenames**: avoid creating new files with Vietnamese diacritics in filenames — transliterate to ASCII for artifact names (e.g., `Hợp-Đồng` → `hop-dong`)

---

## Path Safety

- **Always double-quote** all file paths in Bash commands: `"path with spaces/file.docx"`
- **Google Drive paths**: macOS Google Drive sync paths contain spaces — they work fine when quoted: `"/Users/user/Google Drive/My Drive/project/doc.pdf"`
- **Symlink awareness**: Google Drive paths may be symlinks — `realpath` can resolve if needed: `realpath "/Users/.../file.pdf"`
- **Test before bulk**: when processing a new file type for the first time in a session, test markitdown on a small file first to verify the tool is available
- **Never construct paths with string concatenation** in Bash without quoting — use variables: `FILE="/path/to/file.pdf"` then `"$FILE"`

---

## Path Resolution

All input paths resolved via `.claude/pm-ba.config.json`:
- Root: `config.input_root` (absolute)
- Subfolders: `config.input_subfolders.{type}`
- Combined example: `${config.input_root}/${config.input_subfolders.brd}/`

Skill loads config at start of every mode run. Cache for session lifetime.

---

## Input Folder Scanning Protocol

`{config.input_root}` (resolved from `.claude/pm-ba.config.json`) is the primary root for all raw source documents from stakeholders.

### Scan Rules (per subfolder)

Subfolder paths are relative keys in `config.input_subfolders`; combined path = `${config.input_root}/${config.input_subfolders.{key}}/`.

| Subfolder Key | Condition | Suggested Mode |
|-----------|-----------|----------------|
| `contract` | Files present AND no MAP entry in `io-mapping.json` | `--contract` |
| `brd` | Files present AND no BRD analysis in output registry | `--brd` |
| `urd` | Files present AND no URD analysis in output registry | `--urd` |
| `meeting` | Files newer than last `--meeting-post` run | `--meeting-post` |
| `process-flow` | Files present AND not in output registry | `--process-map` |
| `screen-spec` | Files present AND not in output registry | `--screen` |
| `contract` | Files present AND MAP entry EXISTS but file newer than `output_mtime` | `--contract --force` |

### Mtime Tracking

Detect stale outputs vs. new inputs:
1. Get source mtime: `stat -f "%m" "${config.input_root}/${config.input_subfolders.contract}/file.pdf"` (macOS) / `stat -c "%Y" ...` (Linux)
2. Get output mtime: read `docs/.pm-ba/io-mapping.json` → find MAP entry with matching `input_file`
3. If source mtime > output mtime → flag for reprocessing

### Backward Compatibility

Legacy `inputs/` paths are recognized as advisory only — they do not drive behavior:
- `docs/BRD_*.pdf` → treated as `--brd` source (advisory: "Consider moving to config input_root/brd/")
- `plans/reports/*.docx` → processed normally
- `inputs/*` → if found, warn user: "Legacy path detected. Move files to `${config.input_root}/` for full io-mapping support."
- Existing projects work without folder migration — skill falls back to scanning current directory if config missing
