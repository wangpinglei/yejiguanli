# 个税 12月–次年11月周期 Implementation Plan

> **For agentic workers:** 按 task 顺序执行；改完部署。

**Goal:** 工资个税累计按「应发所属月」的 12 月–次年 11 月周期计算，并展示 C/A/B。

**Files:**
- Modify: `src/lib/payrollTax.ts` — 周期工具、公式明细
- Modify: `src/lib/payrollTaxApply.ts` — 用周期月数替代自然年录入月数
- Modify: `src/pages/Payroll.tsx` — 个税步骤提示与可选明细
- Spec: `docs/superpowers/specs/2026-11-04-payroll-iit-cycle-design.md`

## Task 1: 周期与公式 API
## Task 2: resolvePayrollTax 接入
## Task 3: 个税步骤 UI
## Task 4: 提交部署
