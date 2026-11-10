# KPI Decompose Strategies — 4 Approaches

> Phase 08 v1.5. Strategies for `--kpi-decompose`. Default: `hybrid`.
> Heuristic NER backend v1.5 (defer spaCy/AI to v2, decision 8.1).

---

## 1. CRUD Strategy

**When:** Single entity, form/screen task
**Axis:** Create / Read / Update / Delete / List
**Output:** Up to 5 subtasks (CRUDL)

```
Parent: "Quản lý hồ sơ khách hàng"
→ T-PARENT-S01: Create hồ sơ KH form
→ T-PARENT-S02: Read/detail hồ sơ KH
→ T-PARENT-S03: Update hồ sơ KH
→ T-PARENT-S04: Delete/archive hồ sơ KH
→ T-PARENT-S05: List + filter hồ sơ KH
```

**Heuristic detection:** parent description mentions "quản lý / CRUD / form / nhập liệu" + 1 entity name.

---

## 2. Layer Strategy

**When:** Full-stack feature spanning UI/API/DB
**Axis:** UI / API / Service / DB / Test
**Output:** 3-5 subtasks (typically 3)

```
Parent: "Tra cứu khoản vay theo CMND"
→ T-PARENT-S01: API endpoint /loans/search
→ T-PARENT-S02: UI form + result table
→ T-PARENT-S03: Service layer logic + cache
```

**Heuristic detection:** parent mentions multiple layers (UI + API + DB) OR P-level ≥ 5.

---

## 3. Verb Strategy

**When:** Process/workflow task with action steps
**Axis:** Action verbs (Authenticate / Validate / Transform / Notify / Audit)
**Output:** N subtasks per verb count

```
Parent: "Process đăng ký mở thẻ tín dụng"
→ T-PARENT-S01: Authenticate KYC
→ T-PARENT-S02: Validate hồ sơ
→ T-PARENT-S03: Score credit
→ T-PARENT-S04: Notify result KH
→ T-PARENT-S05: Audit log
```

**Heuristic detection:** parent description has ≥ 3 distinct verbs / luồng-step keywords.

---

## 4. Hybrid Strategy (Default)

**When:** Multi-entity + multi-layer task (most enterprise features at [ORG])
**Axis:** Entity × Layer matrix
**Output:** 6-9 subtasks (cap N×L=9)

```
Parent: "Báo cáo dư nợ + lãi suất + phí dịch vụ tháng"
Entities: dư nợ / lãi suất / phí
Layers: API / Aggregation / UI
→ T-PARENT-S01: API dư nợ + agg
→ T-PARENT-S02: API lãi suất + agg
→ T-PARENT-S03: API phí + agg
→ T-PARENT-S04: UI dashboard composite
```

**Heuristic detection:** parent ≥ 2 entities AND mentions report/dashboard/aggregate.

---

## 5. Strategy Selection Auto-Detect

```python
def select_strategy(parent_task):
    entities = count_entities(parent_task.description)
    layers = count_layers(parent_task.description)
    verbs = count_action_verbs(parent_task.description)
    p_level = parent_task.p

    if entities >= 2 and (layers >= 2 or has_report_keyword(parent_task)):
        return "hybrid"
    if layers >= 2 and entities == 1:
        return "layer"
    if verbs >= 3 and "luồng" in parent_task.description.lower():
        return "verb"
    if has_crud_keyword(parent_task):
        return "crud"
    return "hybrid"  # safe default
```

**PM override:** `--strategy crud|layer|verb|hybrid` flag.

---

## 6. Heuristic NER (v1.5, decision 8.1)

```python
ENTITY_PATTERNS = [
    r"\b(khách hàng|tài khoản|khoản vay|thẻ|giao dịch|hồ sơ|báo cáo|hợp đồng)\b",
    r"\b(KH|TK|KV|GD|HS|BC|HD)\b",  # abbreviations
]
LAYER_KEYWORDS = ["API", "UI", "service", "DB", "database", "tầng", "layer", "frontend", "backend"]
VERB_KEYWORDS = ["xác thực", "kiểm tra", "tính toán", "gửi", "log", "audit", "transform", "validate"]
CRUD_KEYWORDS = ["CRUD", "quản lý", "form", "nhập liệu", "danh sách"]
REPORT_KEYWORDS = ["báo cáo", "report", "dashboard", "tổng hợp", "thống kê"]

def count_entities(text):
    return len(set(re.findall("|".join(ENTITY_PATTERNS), text, re.I)))

# Similar for count_layers, count_verbs, has_crud_keyword, has_report_keyword
```

Heuristic accuracy target: ≥ 70% on [ORG] domain corpus. PM confirms via proposal file before lock — catches remaining 30%.

---

## 7. Anti-Patterns per Strategy

| Strategy | Over-decomp Risk | Under-decomp Risk |
|----------|------------------|-------------------|
| CRUD | List + filter split too granular (5 → 8) | Forgetting D (archive) |
| Layer | UI + API + DB + Tests + Migration (5 → 6) | UI-only no API path |
| Verb | 1 verb / sub-step granularity | Multi-verb collapsed into 1 |
| Hybrid | N×M = 9 cap exceeded | Missing entity coverage |

All flagged in proposal file `Anti-pattern check` section.
