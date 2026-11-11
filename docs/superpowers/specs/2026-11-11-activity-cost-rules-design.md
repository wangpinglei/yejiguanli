# 活动成本默认扣除设计

## 目标

按活动名维护默认成本扣除规则（固定金额或实收比例）。新建/生态圈新同步订单在写入时固化到本单 `costDeductionOverride`；之后改规则不影响老单。特殊单仍可在销售记录里手工改。

## 优先级（新建时）

1. 请求已显式带 `costDeductionOverride`（含 0）→ 用该值
2. 否则活动名有规则且非「无活动」→ 按规则算出金额并写入 override
3. 否则 override 为 null → 读时仍按产品自动

## 读单（不变）

`resolveOrderCostDeduction`：有 override 用 override，否则产品系统成本。活动规则不参与读时计算（靠新建时固化实现「只影响新单」）。

## 数据

表 `activity_cost_rules`：

- `activity_name` TEXT PRIMARY KEY（trim 后精确匹配）
- `cost_type` TEXT：`fixed` | `percentage`
- `cost_value` REAL：固定金额（元）或比例（%）
- 审计：`updated_by` / `updated_by_id` / `updated_at`

## API

- `GET /api/activity-cost-rules` 列表
- `PUT /api/activity-cost-rules` body: `{ activityName, costType, costValue }` 新建/更新
- `DELETE /api/activity-cost-rules/:activityName` 删除规则

权限：查看需登录；写操作需 `activity_cost` 编辑权。

## 固化入口

- `POST /api/sales-records`：若未显式 override，按活动规则写入
- 生态圈 `upsertSyncedOrder` **仅 INSERT**：按活动规则写入；UPDATE 不改 `cost_deduction_override`

## 前端

- 独立页 `/activity-cost`「活动成本」：按活动名配置固定/比例；活动名可从已有销售记录活动汇总 + 手输
- 导航：分仓管理组；权限模块 `activity_cost`
- 销售记录成本区文案补充：有活动规则时，新建且选「按产品自动」会在保存时按活动规则固化

## 非目标

- 不回刷历史单
- 不在读时动态套用活动规则
- 不做活动规则版本历史
