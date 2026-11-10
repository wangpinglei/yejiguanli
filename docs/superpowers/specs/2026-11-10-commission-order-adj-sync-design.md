# 单笔订单提成调整同步设计

## 目标

工资核算「业绩提成明细」中的单笔调整（业绩/比例/提成金额）需多人可见：改一行先写本机，点「保存到线上」再同步服务器。

## 行为

1. 单元格编辑：立即写入 `localStorage`（`pm_commission_order_adj`），本机即时重算提成。
2. 「保存到线上」：上传当前人×单位×月份整份调整 Map；记录修改人/修改时间/上传时间。
3. 打开明细页：先拉服务器；有数据则覆盖写入本机；服务器空且本机有数据则提示「上传本机数据」。
4. 工资核算按月加载时：拉取该月全部 scope，写入本机，保证工资表个人提成与明细一致。

## 数据

表 `commission_order_adj_scopes`：

- `UNIQUE(year_month, personnel_id, unit_id)`
- `adj_json`：`Record<saleId, CommissionOrderAdj>`
- 审计：`updated_by` / `updated_by_id` / `updated_at` / `uploaded_at`

## API

- `GET /api/commission-order-adj?yearMonth=&personnelId=&unitId=`（可只传 yearMonth）
- `PUT /api/commission-order-adj`（需 payroll 编辑权限）

## 权限

与工资录入一致：查看需登录；保存需 `payroll` 编辑权。
