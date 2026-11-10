# KPI Assignment Optimizer

> Phase 08 v1.5. Algorithm for `--kpi-assign`. Cost function decision 8.4: **50% util + 30% senior balance + 20% upskill**.

---

## 1. Inputs

- `tasks[]`: locked task list with P-level + TP + mds + AC count
- `team_roster[]`: name, level, monthly_target, capacity, current_assignments
- `strategy`: balanced (default) | minimize-load | upskill-focused | senior-first

---

## 2. Hard Constraints (Block if Violated)

1. DEV level eligibility per quick-reference §3 (e.g., Junior02 cannot do P5)
2. DEV not on vacation/paused for task date range
3. Task dependency order respected (predecessor assigned first)

---

## 3. Soft Constraints (Cost-Weighted)

| Soft | Weight | Description |
|------|--------|-------------|
| Utilization variance | 50% | Per `(util_i - target_util)^2` summed across DEVs; target_util ≈ 90% |
| Senior balance | 30% | Penalize Senior util > 100% OR Senior util < 70% while Junior > 95% |
| Upskill | 20% | Reward assignment of stretch P-level to Junior (within eligibility) — e.g., Junior02 at P4 |

---

## 4. Cost Function

```python
def assignment_cost(assignment, team_roster, weights={"util": 0.5, "senior": 0.3, "upskill": 0.2}):
    util_cost = compute_utilization_variance(assignment, team_roster)
    senior_cost = compute_senior_balance_penalty(assignment, team_roster)
    upskill_cost = -compute_upskill_reward(assignment, team_roster)  # negative = reward
    
    return (weights["util"] * util_cost
          + weights["senior"] * senior_cost
          + weights["upskill"] * upskill_cost)
```

Cost normalized 0-100 (lower = better).

---

## 5. Optimization Algorithm

```python
def optimize(tasks, team, strategy="balanced", max_iter=100):
    assignment = initial_eligibility_assignment(tasks, team)  # greedy by P-level fit
    current_cost = assignment_cost(assignment, team)
    
    for i in range(max_iter):
        swap_pairs = find_potential_swaps(assignment, team)
        best_swap = None
        best_delta = 0
        
        for (a, b) in swap_pairs:
            new_assignment = swap(assignment, a, b)
            if respects_hard_constraints(new_assignment, team):
                new_cost = assignment_cost(new_assignment, team)
                delta = current_cost - new_cost
                if delta > best_delta:
                    best_swap = (a, b)
                    best_delta = delta
        
        if not best_swap or best_delta < epsilon:
            break  # converged
        assignment = swap(assignment, *best_swap)
        current_cost -= best_delta
    
    return assignment, current_cost, i  # iterations
```

**Termination:**
- Max 100 iterations (anti-thrashing)
- Or delta < epsilon (0.5 cost units)

---

## 6. Strategy Modifiers

| Strategy | Effect on Weights |
|----------|------------------|
| balanced (default) | weights = {util: 0.5, senior: 0.3, upskill: 0.2} |
| minimize-load | weights = {util: 0.8, senior: 0.2, upskill: 0.0} |
| upskill-focused | weights = {util: 0.3, senior: 0.2, upskill: 0.5}; stretch P-level prioritized |
| senior-first | Hard: assign all P5+ to Senior; util variance secondary |

---

## 7. Output Format

Per assignment:
```yaml
- task_id: T-001-S01
  assignee: "Nguyễn An"
  level: Junior02
  p_level: P3
  reasoning:
    - Eligible: Junior02 can do P3 ✅
    - Utilization: An is at 82% pre-assign; this task pushes to 92% (sweet spot)
    - Upskill: 0 (task at level, not stretch)
    - Senior balance: N/A (assignee not Senior)
```

Plus team summary:
- Utilization variance: σ = {value}
- Senior peak: {pct}
- Junior stretch ratio: {pct} of Junior tasks at +1 P-level
- Total cost: {value}

---

## 8. Anti-Patterns

- ❌ Optimizer thrashing: max_iter cap + epsilon termination
- ❌ Ignore hard constraints in cost minimization: hard-filter before scoring
- ❌ Over-assignment Senior (> 1.2× target): hard cap; warn if hit
- ❌ Stretch Junior beyond +1 level (Junior01 at P5): block; require explicit `--force-stretch`

---

## 9. Performance

| Metric | Target |
|--------|--------|
| Initial eligibility scan | ≤ 1s for 50 tasks × 10 DEVs |
| Cost compute per swap | ≤ 50ms |
| 100-iter convergence | ≤ 5s |
| Total --kpi-assign | ≤ 8s |
