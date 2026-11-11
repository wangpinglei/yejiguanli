# 活动成本默认扣除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 活动级默认成本扣除配置页；新建/新同步订单固化到本单 override。

**Architecture:** `activity_cost_rules` 表 + CRUD API；创建单时若无显式 override 则按活动规则写入 `cost_deduction_override`；读单逻辑不变。

**Tech Stack:** Express + SQLite、React、既有 sales_records / sync-orders

## Global Constraints

- 只影响之后新单；老单保持原扣除
- 活动支持 fixed / percentage
- 未配活动规则 → 按产品自动（override null）
- 特殊单可本单手工改

---

### Task 1: DB + calc + API

- [ ] 表 `activity_cost_rules` + `rowToActivityCostRule`
- [ ] `server/src/lib/activityCost.ts` 与 `src/lib/activityCost.ts`
- [ ] `server/src/routes/activityCostRules.ts` 挂载

### Task 2: 固化写入

- [ ] `salesRecords` POST 应用规则
- [ ] `syncOrders` INSERT 应用规则（UPDATE 不动 override）

### Task 3: 前端页 + 权限

- [ ] modules / Layout / App 路由
- [ ] `ActivityCost.tsx` + api client
- [ ] 销售记录文案提示

### Task 4: 部署

- [ ] 构建推正式服
