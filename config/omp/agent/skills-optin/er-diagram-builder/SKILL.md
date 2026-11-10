---
name: er-diagram-builder
description: "Use when reverse-engineering Oracle relational models from database Markdown and C# Entity/Biz/DAO evidence, or when source-code logic, method relationships, method matrices, PK/FK rows, *_ID columns, Mermaid output, Draw.io connectors, or relation parity are missing or invalid."
hide: true
---

# ER Diagram Builder

## Purpose and non-negotiable boundaries

Build an evidence-backed relational model and three synchronized review artifacts:
Mermaid ER, editable diagrams.net/Draw.io XML, and Oracle SQL Developer review XML.
Phase 1 also produces a frozen source-code logic inventory, method relationship
document, and sparse method/data-flow matrices for human source review.

- Never infer a confirmed FK only from a name ending in `_ID`.
- Never claim a physical Oracle constraint without catalog/DDL evidence.
- Never write application source, mutate database data, or print credentials.
- Keep `confirmed`, `proposed`, and `unresolved` evidence distinct.
- Oracle catalog/DDL wins over Entity, Biz, DAO, or profiling evidence.
- Unknown cardinality/nullability is not a mandatory Mermaid parent.

## Input gate

Require existing paths for `db_table`, Entity, Biz, and DAO sources; `--source-root`
is optional. Stop on a missing required path, ambiguous Entity mapping, or unresolved
DAO call. An Oracle connection is optional and must be read-only; do not log its
connection string, username, password, or query results containing secrets.

## Mandatory backup and two-phase boundary

Every PK/FK decision or redraw starts with a backup of both `_output/diagrams` and
`_output/db_table_mapped`:

```powershell
python .agent/skills/er-diagram-builder/scripts/pre-cycle-backup.py `
  --project-root . --reason phase1-or-redraw
```

The Python backup is the cross-platform authority. It copies files, compares
source/archive SHA-256 manifests, and exits non-zero on mismatch. Missing output
directories are recorded as `absent_before_first_generation`. The Phase 2
generator invokes this gate itself; do not use an old archive as current input.

### Phase 1 — logic extraction and evidence freeze

Run:

```powershell
python .agent/skills/er-diagram-builder/scripts/extract-evidence.py `
  --project-root . --design-dir <db_table> --entity-dir <Entity> `
  --biz-dir <Biz> --dao-dir <DAO> [--source-root <source>] `
  [--solution <solution.sln>] [--project <project.csproj>] `
  [--runtime-evidence <normalized-runtime.json>]
```

Read:

- Entity constructor `base("PHYSICAL_TABLE", "KEY_COLUMN")`.
- `[PropertyEntity(column, isKey, persistent)]`; skip `persistent=false`.
- Biz calls and assignments.
- Only DAO SQL methods reachable from Biz; inspect every reachable `JOIN`.
- Source-backed shared-table comparisons only when code contains the comparison/join.

Write one schemaVersion 2 intermediate JSON and evidence report per design partition,
plus `source-manifest.json` in `_output/db_table_mapped/`. A non-standard descriptive
partition is mapped to its matching Entity when source evidence is unambiguous.

#### Source-code and logic analysis

The same Phase 1 run also freezes a global, evidence-backed source analysis. It indexes
the configured Entity, Biz, DAO, and optional `source-root` C# files without writing
application code or database data. Method IDs remain stable
`layer:file:class.method:line`; each method also records `kind`, `overloadKey`,
source span, parser provenance, and compact risk flags.

The parser capability chain is `Tree-sitter C# AST → regex fallback`. Tree-sitter
handles syntax shapes such as constructors, expression-bodied methods, generic
invocations, and overload signatures; it does not perform symbol binding. Optional
`--solution`/`--project` inputs are inspected for Roslyn/MSBuildWorkspace capability
only; the core extractor does not restore, build, or claim a compiler graph.

Resolved method edges retain file/line evidence and parser provenance. Ambiguous or
external calls remain visible with reasons such as `overload`, `dependency-injection`,
`dynamic`, `reflection`, or `extension-method`; they never become confirmed database
relations. Generated files identified by marker or generated path are excluded from
static method/table evidence. Reports contain compact control-flow/SQL/table facts,
not full method bodies or credentials.

Table links are conservative: `read`, `join`, and `write` are emitted from static SQL
operation contexts; generic identifier mentions do not become table evidence.

The source graph is still not a compiler or runtime call graph. Runtime input is
optional normalized JSON only; accepted events are `RUNTIME_OBSERVED` sampled
evidence, not a complete graph. Binary `.nettrace` is rejected rather than parsed
heuristically. Method/table links remain source navigation evidence, not PK/FK proof.

Write these additional Phase 1 artifacts:

- `source-code-analysis.json` — machine-readable method inventory, compact logic
  facts, resolved method relationships, table links, field assignments, counts,
  and per-partition scopes.
- `source-code-analysis.md` — method inventory and compact logic summaries with
  stable anchors and source file/line references.
- `method-relationships.md` — resolved caller/callee edges, evidence lines, layer
  summary, and a bounded Mermaid call graph when it remains readable.
- `method-matrix.md` — sparse method adjacency, layer-to-layer counts,
  method-to-table operations, and method-to-field data-flow matrices. Matrix counts
  distinguish unique edges from call-site/table-reference evidence.
- `validate-source-analysis.py` — independent validator for the Phase 1 sidecar;
  it does not participate in Phase 2 rendering.

Review these artifacts in Phase 1. Confirmed database relations still require the
existing Entity/Biz/DAO evidence rules and human review; source method links are
navigation evidence, not Oracle constraint claims.
Stop here for human review or manual relationship decisions. A manual JSON decision
must retain evidence and status; it must not be silently presented as a physical
constraint.

### Phase 2 — deterministic artifact generation

Mỗi lần redraw sơ đồ, BẮT BUỘC phải thực hiện backup thư mục output trước tiên:

```powershell
python .agent/skills/er-diagram-builder/scripts/pre-cycle-backup.py `
  --project-root . --reason <reason>
```

Sau đó, chạy generator sinh artifact:

```powershell
python .agent/skills/er-diagram-builder/scripts/run-plc-model.py `
  --project-root . --reason <reason>
```

Cuối cùng, chạy validator để nghiệm thu cấu trúc và định hướng edge:

```powershell
python .agent/skills/er-diagram-builder/scripts/validate-artifacts.py .
```

Phase 2 reads only the frozen JSON partitions matching `db_table/*.md`; it never
re-parses C# and never reads legacy aggregate JSON. It normalizes identifiers,
deduplicates tables/columns/relations, sorts relations by stable relation ID, keeps
external/proposed evidence in the rejection/report path, and renders an edge only
when both endpoints exist in the current partition. Re-running Phase 2 must not
change Phase 1 JSON.

## Column and relationship contract

Chỉ hiển thị các cột đóng vai trò cấu trúc: PK, FK đã được relation chứng minh, và mọi cột có hậu tố `_ID`. Tuyệt đối không hiển thị Oracle data type hay cột thường.

Vai trò phải được ghi rõ bằng chữ, không chỉ dựa vào màu sắc: `PK`, `FK`, `PK/FK`, `ID`. 
Quy tắc xác định:
- `PK` lấy từ `is_pk` trong metadata.
- `FK` lấy từ endpoint `child.column` của relation trong cùng partition.
- Hậu tố `_ID` nếu không có relation đi kèm chỉ là `ID` candidate, tuyệt đối không được tự gọi là FK.

Một raw/proposed child endpoint vẫn hiển thị là `FK` ngay cả khi parent ở ngoài partition, nhưng không vẽ bảng parent ẩn. Mọi dòng hiển thị phải là dòng có thể kết nối được.

Relation identity is:

`<child>.<childColumn>_TO_<parent>.<parentColumn>`.

The child FK row is the source and the parent PK/REF row is the target. Duplicate
relation IDs and duplicate source-target connectors are rejected, never drawn twice.

## Static Design System

Áp dụng nhất quán Design System cho cả Mermaid v11 và Draw.io:
- **Chủ đề**: Minimalism/Swiss
- **Nền tổng thể**: `#F8FAFC`
- **Surface (Bảng)**: `#FFFFFF`
- **Header**: Nền `#0F172A` / Chữ `#FFFFFF`
- **Text cơ bản**: `#0F172A`
- **Border**: `#94A3B8`
- **PK row**: Nền `#FEF3C7` / Chữ `#78350F`
- **FK row**: Nền `#E0F2FE` / Chữ `#075985`
- **ID row**: Nền `#F1F5F9` / Chữ `#334155`
- **Confirmed edge**: `#334155` (nét liền)
- **Proposed/Unresolved edge**: `#B45309` (nét đứt)
- **Kiểu chữ**: Sans-serif của hệ thống cho tiêu đề, monospace cho tên cột.
- Chú ý: Dùng nhãn chữ cùng màu để không truyền nghĩa bằng màu đơn thuần.

## Draw.io Entity-Relationship geometry
Use table swimlanes and row-level `mxCell` vertices. Each row must have
`connectable="1"` and a deterministic ID such as
`table-<TABLE>-<COLUMN>`. Do not make color the only role indicator; the value must
start with `PK`, `PK/FK`, `FK`, `ID`, or `REF`.

Every edge must:

1. use Draw.io's native `edgeStyle=entityRelationEdgeStyle` and
   `portConstraint=eastwest` controls;
2. connect the child FK row as `source` to the parent PK/REF row as `target`;
3. use `ERmany` → `ERone` for known `1:N`, otherwise
   `ERzeroToMany` → `ERzeroToOne`;
4. contain `mxGeometry relative="1" as="geometry"`;
5. use `jumpStyle=arc`/`jumpSize` when perpendicular routes intersect.

The default `routingMode=native-editable` omits generated `<Array as="points">`
and `exitX`/`exitY`/`entryX`/`entryY` overrides. Draw.io's Entity Relation
router is therefore free to keep connectors orthogonal while users drag tables
or add, move, and remove right-angle waypoints. It guarantees routing metadata,
not collision-free geometry after an interactive edit.

The opt-in `routingMode=explicit-waypoints` retains the obstacle-aware grid
route, orthogonal endpoint anchors, and static geometry validation. It proves
that the generated artifact has no diagonal segments, edge-through-table
collisions, collinear overlaps, or undocumented perpendicular crossings.
Use it for frozen comparison exports, not the canonical editable file.

Use the deterministic core-periphery layout by default: normalized non-self
relations score hubs as `4*incoming + 2*outgoing + unique_neighbors`; at most
three hub families occupy the center x-band. Tables with the same normalized
name family as a selected hub remain in that center neighborhood. Other
families are assigned atomically to the left/right columns by relationship
affinity and balanced height, then ordered by barycenter. Relation-free
partitions stay in one centered column. Preserve the `layered` layout and
explicit routing modes as rollback paths. “No overlap” for native output is a
Draw.io runtime property; static validation proves XML structure, row
endpoints, table overlap, and all explicit routes.

## Artifact contract

For every `db_table/<stem>.md`, produce:

- `_output/db_table_mapped/<stem>.json`
- `_output/db_table_mapped/evidence-report-<stem>.md`
- `_output/diagrams/<stem>.mermaid.md`
- `_output/diagrams/<stem>.drawio.xml`
- `_output/diagrams/<stem>.oracle-sqldev.xml`
- synchronized compatibility copy `_output/diagrams/drawio/<stem>.drawio.xml`

The Phase 1 source-analysis sidecars are also part of the review contract:

- `_output/db_table_mapped/source-code-analysis.json`
- `_output/db_table_mapped/source-code-analysis.md`
- `_output/db_table_mapped/method-relationships.md`
- `_output/db_table_mapped/method-matrix.md`

They are generated once per extraction run and are intentionally not Phase 2 inputs.

Delete obsolete generated aggregates/copies only after the current stems are known;
keep historical backups under `_output/logs/archive/`. Canonical and compatibility
Draw.io files must have identical table/row/edge parity (byte parity is preferred).

### Mermaid

Keep YAML frontmatter inside the fenced ` ```mermaid ` block. Validate table and
column identifiers against `[A-Za-z_][A-Za-z0-9_]*`; reject descriptive text such
as `FEATURE_ID = 133101`. Render keys-only rows (`string` is a generic Mermaid
syntax token), relation IDs, status comments, and accessible `accTitle`/`accDescr`.

## Validation and recovery

Before handoff, run the specific regression and artifact gates:

```powershell
python -m py_compile .agent/skills/er-diagram-builder/scripts/csharp_syntax.py `
  .agent/skills/er-diagram-builder/scripts/source_code_analysis.py `
  .agent/skills/er-diagram-builder/scripts/extract-evidence.py `
  .agent/skills/er-diagram-builder/scripts/validate-source-analysis.py `
  .agent/skills/er-diagram-builder/scripts/run-plc-model.py `
  .agent/skills/er-diagram-builder/scripts/validate-artifacts.py `
  .agent/skills/er-diagram-builder/tests/test_reachable_dao.py
python -m pytest -q .agent/skills/er-diagram-builder/tests/test_reachable_dao.py
python .agent/skills/er-diagram-builder/scripts/validate-source-analysis.py .
python .agent/skills/er-diagram-builder/scripts/validate-artifacts.py .
powershell -NoProfile -ExecutionPolicy Bypass -File ./verify.ps1
```

Validation must prove: JSON/Mermaid/Draw.io/Oracle relation parity; XML parseability;
every expected PK/FK/`_ID` row; valid row endpoints; native routing metadata and
controls; no table overlap; no placeholders; and no stale compatibility copy. For
`explicit-waypoints`, additionally prove axis-aligned route points, no edge through
an unrelated table, no collinear overlap, and bridge metadata for every perpendicular
crossing. Native route collision avoidance is verified by opening the artifact in
Draw.io; it must not be falsely inferred from absent waypoint coordinates. Parse all
current Mermaid blocks with the available Mermaid v11 parser and all Markdown with
Pandoc/GFM when those tools are available. If repository convergence/watchdog scripts
are absent, hash the stable workspace twice, excluding archives and temporary files;
identical hashes are the fallback convergence proof.

The Phase 1 gate must additionally parse `source-code-analysis.json`, verify all four
analysis sidecars exist, check stable method/table anchors, and confirm reports do not
contain full method bodies, raw SQL, credentials, or connection strings.

On any backup, extractor, route, parser, or validator failure: stop; inspect the
failure and latest archive; fix the source/algorithm; rerun the affected phase and
all gates. Never suppress an error, draw a guessed edge, or declare completion from
one passing sample. Keep unresolved/external relations visible in evidence, but do
not render an endpoint that is not present in the current partition.

## Proven regression cases and anti-pattern defenses

- Reachability: DAO joins outside Biz call paths must not become relations.
- Multiple joins and Biz assignments must preserve every evidenced relation.
- Non-standard partition names must resolve from unambiguous Entity metadata.
- Invalid Mermaid identifiers must fail fast.
- Frontmatter outside the Mermaid fence must fail validation.
- Duplicate relations must collapse to one edge.
- PK, FK, PK/FK, and `_ID` rows must survive Draw.io rendering.
- Native Draw.io edges must use the Entity Relation router with no generated fixed route points; explicit routes must have unique orthogonal points and ER arrows.
- Never replace evidence extraction with filename matching, circular layout, generated fixed connector coordinates in the native artifact, color-only PK/FK markers, or stale aggregate files.

