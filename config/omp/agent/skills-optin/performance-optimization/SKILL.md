---
name: performance-optimization
description: "[S3.5] Tối ưu performance có phương pháp — Trigger: chậm, slow, optimize, bottleneck"
vi_triggers: "chậm, tối ưu, performance, nhanh hơn, giảm tải"
hide: true
---


<!-- TIER-1: OVERVIEW — luôn load khi skill được trigger -->
# Performance Optimization

## Overview

Measure first, optimize second. Never optimize without data.
The bottleneck is almost never where you think it is.

## When to Use

- Code is measurably slow or resource-heavy
- Profiling has revealed specific bottlenecks
- Designing a system with known performance requirements
- Reviewing code for performance before production


<!-- TIER-2: PROCESS — load khi bắt đầu thực thi skill -->
## When NOT to Use

- You "feel like" code might be slow but haven't measured
- Premature optimization during initial implementation
- Micro-optimizations that don't move the needle

## The Process

**1. Measure baseline**
Before touching anything, establish a benchmark.
- Record current performance numbers (time, memory, CPU)
- Document the test conditions (data size, concurrency, hardware)
- Save results as your baseline

**2. Profile to find the bottleneck**
Use profiling tools appropriate to your stack:
- Python: `cProfile`, `py-spy`, `memory_profiler`
- Node.js: `--prof`, `clinic.js`, Chrome DevTools
- Go: `pprof`
- Generic: timing instrumentation, APM tools

The bottleneck is the one place where optimization actually matters.

**3. Form hypothesis**
State explicitly: "I believe X is slow because Y."
Don't optimize something you can't explain.

**4. Apply targeted fix**
Change ONE thing at a time.
Common high-impact areas:
- Database: N+1 queries, missing indexes, over-fetching
- Network: unnecessary round trips, large payloads, no caching
- Memory: leaks, excessive allocation, large objects in hot paths
- Algorithms: O(n²) where O(n log n) is possible
- I/O: synchronous blocking, missing batching

**5. Measure again**
Compare to baseline. Did it improve?
If not, revert and try something else.

**6. Document the change**
Record what you changed, why, and the before/after numbers.


<!-- TIER-3: EXAMPLES & EDGE CASES — load khi cần reference chi tiết -->
## Common High-Impact Wins

| Area | Look For |
|------|----------|
| Database | N+1 queries, full table scans, missing indexes |
| Caching | Repeated expensive computations with same inputs |
| Network | Chatty APIs, large payloads, synchronous chains |
| Algorithms | Nested loops over large collections |
| Memory | Objects created in tight loops, large in-memory datasets |

## Red Flags

| Thought | Reality |
|---------|---------|
| "This looks slow" | Measure it. Looks are deceiving. |
| "I'll optimize as I go" | Premature optimization obscures intent. Measure first. |
| "I fixed the bottleneck" | Did you measure? Fix without measurement isn't a fix. |
| "This is the obvious bottleneck" | Profile anyway. You're probably wrong. |

## Integration

- **Rules**: `execution-integrity-core` (evidence gate), `auto-continue-loop` (post-task protocol)
- **Loaded by**: `agent-routing` rule (implicit keyword detection), workflow `STANDARD_PREAMBLE` (explicit)
- **Combines with**: See `agent-routing.md` Step 1c for multi-skill combo patterns
- **Memory**: Check `learned-rules/lessons.md` for relevant past lessons
