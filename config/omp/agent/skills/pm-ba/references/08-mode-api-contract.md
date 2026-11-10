# Mode: API Contract / Integration Specification

## 1. Trigger

Activated when:
- CLI flag `--api <path>` is provided
- Natural language patterns detected: "API contract", "integration spec", "đặc tả API", "API integration", "REST API spec", "kết nối hệ thống"

## 2. Required Slots

| Slot | Description | Prompt if Missing |
|------|-------------|-------------------|
| `api_spec_path` | Path to integration spec or URD with API info | "Vui lòng cung cấp đường dẫn đến file đặc tả API/integration:" |
| `project_slug` | Short project identifier | Infer from filename |

## 3. API Surface Table (per endpoint)

For each API endpoint, document:

| Field | Content |
|-------|---------|
| **API ID** | API-XXX (API-001, API-002, ...) |
| **Endpoint** | Full HTTP path (e.g. `/api/v1/contracts`) |
| **Method** | GET / POST / PUT / PATCH / DELETE |
| **Purpose** | What this endpoint does (business action) |
| **Auth** | Authentication method: Bearer JWT / API Key / mTLS / None |
| **Request Payload** | Fields + types + required/optional (see sub-table) |
| **Query Parameters** | For GET: filter/pagination params |
| **Response Payload (200)** | Success response fields (see sub-table) |
| **Error Codes** | HTTP status codes + error codes + meaning |
| **Idempotency** | Yes (with idempotency key field) / No |
| **SLA** | Max response time target (e.g. < 500ms) |
| **Rate Limit** | Calls per minute/hour if applicable |
| **Integration System** | Which external system this connects to (T24, CIC, CBTD, etc.) |
| **Trigger** | When is this API called (which US/process step) |
| **Linked URD** | URD section reference |
| **Linked FR** | FR-XXX |

### Request Payload Sub-Table

| Field Name | Type | Required | Description (VN) | Validation | Example |
|-----------|------|----------|-----------------|------------|---------|

### Response Payload Sub-Table

| Field Name | Type | Always Present | Description (VN) | Notes |
|-----------|------|----------------|-----------------|-------|

### Error Response Sub-Table

| HTTP Status | Error Code | Message | Trigger Condition |
|-------------|------------|---------|-------------------|
| 400 | ERR_VALIDATION | | |
| 401 | ERR_UNAUTHORIZED | | |
| 403 | ERR_FORBIDDEN | | |
| 404 | ERR_NOT_FOUND | | |
| 409 | ERR_CONFLICT | | |
| 422 | ERR_BUSINESS_RULE | | |
| 500 | ERR_INTERNAL | | |

## 4. Workflow Steps

### Step a — Ingest Integration Spec

1. Convert to markdown: `mcp__markitdown__convert_to_markdown(uri)`
2. Identify integration points: internal APIs vs external system APIs
3. Classify:
   - **Internal APIs**: system-to-system within the project
   - **External APIs**: T24 core banking, CIC, NAPAS, SMS gateway, etc.
4. Save raw extract to `plans/reports/raw-extract-{date}-api-{slug}.md`

### Step b — Extract API Surface

Invoke `/ck:ask` with:

```
Từ tài liệu đặc tả API/integration sau, extract API surface đầy đủ:

[API_SPEC_CONTENT]

Cho MỖI endpoint/API, cung cấp:

1. ENDPOINT OVERVIEW:
   - API ID (API-XXX) | Method + Path | Mục đích nghiệp vụ
   - Hệ thống tích hợp | Auth method | SLA

2. REQUEST SPECIFICATION:
   - Headers bắt buộc
   - Request body fields: tên | type | required | validation | example
   - Query params (nếu GET): tên | type | required | default | mô tả

3. RESPONSE SPECIFICATION (200 OK):
   - Response fields: tên | type | luôn có? | mô tả | example

4. ERROR RESPONSES:
   - Tất cả HTTP error codes | Error code string | Message | Điều kiện xảy ra

5. BUSINESS RULES:
   - Điều kiện gọi API (pre-conditions)
   - Validation business (không chỉ format validation)
   - Idempotency handling
   - Retry policy (nếu mention)

6. OPEN ISSUES / UNDEFINED CONTRACTS:
   - Fields không rõ type hoặc validation
   - Error codes không có trong spec
   - SLA không được định nghĩa
   - Auth method chưa rõ
   → Mỗi item thành Q-XXX (Directed to: nhà cung cấp nếu external API)
```

### Step c — Produce OpenAPI YAML Sketch

For each API endpoint, generate a partial OpenAPI 3.0 YAML sketch:

Invoke `/ck:ask` with:

```
Tạo OpenAPI 3.0 YAML sketch cho API sau:

[API_DETAILS FROM STEP b]

Yêu cầu:
- Chỉ cần skeleton: paths + requestBody + responses (không cần đầy đủ OpenAPI spec)
- Sử dụng $ref cho shared components nếu fields tái sử dụng nhiều
- Comment bằng tiếng Việt cho business meaning
- Mark fields chưa rõ với: # TODO: confirm with provider
- Format:

paths:
  /api/v1/[endpoint]:
    [method]:
      summary: [VN description]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [...]
              properties:
                fieldName:
                  type: string
                  description: [VN description]
      responses:
        '200':
          description: [VN description]
          content:
            application/json:
              schema:
                ...
        '400':
          ...
```

### Step d — Flag Undefined Contracts

Add to clarification register all undefined items:
- Unknown field types → Q-XXX (Category: Technical, Directed to: Dev/nhà cung cấp)
- Missing error codes → Q-XXX
- Undefined SLA → Q-XXX
- Missing auth spec → Q-XXX (Priority: P1)

### Step e — Save API Contract

Save to `docs/ba-api-contract.md`:

```markdown
# API Contract / Integration Specification — {Module/Project}
**Date:** YYYY-MM-DD | **Source:** {path}

## Integration Overview
| System | Direction | Protocol | Auth | Status |
|--------|-----------|----------|------|--------|
| T24 | Outbound | REST | mTLS | Confirmed |

## API Inventory
| API-ID | Method | Path | Purpose | System | SLA | Status |
|--------|--------|------|---------|--------|-----|--------|

## API Details

### API-001 — [Endpoint Name]
{Overview table}
{Request payload table}
{Response payload table}
{Error codes table}
{Business rules}
{OpenAPI YAML sketch}
{Open issues}

*(Repeat for each endpoint)*

## Open Issues for External Provider
{List of Q-XXX directed to external API providers}
```

## 5. Outputs

| Artifact | Location | Description |
|----------|----------|-------------|
| Raw extract | `plans/reports/raw-extract-{date}-api-{slug}.md` | Verbatim |
| API Contract | `docs/ba-api-contract.md` | Tables + YAML sketches + open issues |
| Clarification items | `plans/reports/pm-ba-clarification-register.md` | Q-XXX for provider/internal |

## 6. Deliverables Checklist

- [ ] All API endpoints identified and assigned API-XXX IDs
- [ ] Request payload documented (all fields, types, required flags)
- [ ] Response payload documented (200 + error codes)
- [ ] Business rules per endpoint captured
- [ ] OpenAPI YAML sketch generated for each endpoint
- [ ] Undefined contracts flagged as Q-XXX in clarification register
- [ ] Provider-directed questions separated and highlighted
- [ ] `docs/ba-api-contract.md` saved
- [ ] Each API linked to FR-XXX / US-XXX in traceability matrix
