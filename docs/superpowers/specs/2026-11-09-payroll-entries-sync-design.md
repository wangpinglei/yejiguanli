# 工资核算录入多人同步

## 目标

工资核算「保存本月录入」写入服务端，多人同看同改；记录修改人、修改时间、首次上传时间。

## 范围

整份月度录入：考勤/考核/加减项/个税覆盖与快照；纳入核算单位名单（按年月）。

## 数据

- `payroll_month_entries`：`(year_month, personnel_id)` + `entry_json` + `updated_by` / `updated_at` / `uploaded_at`
- `payroll_month_scopes`：`year_month` + `unit_ids_json` + 同上审计字段

## API

- `GET /api/payroll-entries?yearMonth=` → entries + scopeUnitIds + audits
- `PUT /api/payroll-entries` → 整月 upsert（编辑权 `payroll`）；后写覆盖

## 前端

- 打开/切月拉取服务端；保存写服务端并镜像 localStorage
- 服务端为空且本机有数据时提示一键上传迁移
- 页内展示最近修改人/时间
