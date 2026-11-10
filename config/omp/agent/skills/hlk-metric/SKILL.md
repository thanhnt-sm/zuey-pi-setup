---
name: hlk-metric
description: Chạy vòng tối ưu theo chỉ số (/ck:loop) cho item dạng metric (token/cost/pass-rate) với hàng rào harness — dùng cho item kiểu #81 baseline benchmark. Interactive-only.
allowed-tools: Read, Bash, Glob, Grep
---

## Vì sao tồn tại

Item dạng "đo & tối ưu MỘT chỉ số cơ học" (vd #81: baseline token/cost/retry/pass
median) không hợp FSM thường (không có acceptance dạng test) — đúng địa hạt của
`/ck:loop` (vòng lặp tự trị theo metric, decision 0018 mục 2a). Skill này bọc
`/ck:loop` trong hàng rào harness để không phá kỷ luật.

## Cách chạy

1. **Intake trước** (nếu item chưa có): `harness-cli intake --type maintenance-request
   --lane tiny ...` — item metric vẫn là work item.
2. **Chọn metric TẤT ĐỊNH + nguồn đọc read-only**, ví dụ:
   - cost/run: `loop/.state/cost.history` (median cost_usd các run gần nhất)
   - pass-rate: đếm `RECORD ok` / tổng item trong `loop/.state/events.jsonl`
   - token CLASSIFY: các event `CLASSIFY usage` trong events.jsonl
3. **Gọi**: `/ck:loop "<mô tả metric + cách đo bằng lệnh đọc file trên>" --iterations 3`
4. **Kết quả** ghi `plans/reports/k1-baseline-*.md` (hoặc theo naming hook).

## Hàng rào CỨNG (vi phạm = dừng)

- CHỈ interactive. KHÔNG bao giờ nhúng /ck:loop vào chặng headless (wrapper đã
  disallow `ck:loop` — loop-trong-loop vô kiểm soát).
- Vòng /ck:loop CHỈ được đọc `loop/.state/*` + đo; MỌI thay đổi engine/config nó
  đề xuất phải đi qua intake + FSM thường (KHÔNG auto-keep thay đổi vào loop/*.sh).
  Khai báo rõ ràng trong prompt gọi /ck:loop: "đề xuất thay đổi, KHÔNG tự sửa file
  ngoài plans/reports/".
- KHÔNG commit/push từ trong vòng; commit báo cáo là việc của orchestrator sau khi xem.
- Trần: --iterations ≤ 3 mỗi đợt; muốn thêm → đợt mới có xem xét giữa chừng.

## Gỡ item khỏi skiplist trước khi chạy

`grep -vx '81' loop/.state/skip_items > /tmp/sk && mv /tmp/sk loop/.state/skip_items`
(hoặc số item tương ứng) — item metric thường bị skiplist để loop thường không nhặt.
