# 人员固定成本跨单位比例分摊

## 目标

内部员工的底薪、保密费、绩效、岗位补贴、社保/公积金企业部分，可按比例拆到多个销售单位计入成本；提成仍跟成交单位。支持档案默认比例 + 月度覆盖。

## 规则

- 模式：`ratio`（按比例，合计 100%）或 `fixedAmount`（固定金额，每行 >0）。
- 固定金额：各行合计须等于人员固定成本；与当月实际成本不一致时按配置比例缩放摊完，不再把差额塞给主单位。
- 配置 ≥1 个单位且校验通过时启用（可只配成本单位 100%/全额）；否则沿用调岗按天归属。
- 仅内部员工；合作方不参与。
- 请假扣款随分摊；其他加减项挂主单位（`salesUnitId`）。
- 成本管理 / 盈亏分析通过 `getUnitSalaryCost` 同源计入。

## 数据

`personnel.cost_allocation_json`：

```json
{
  "mode": "ratio",
  "shares": [{ "salesUnitId": "u1", "ratio": 60 }],
  "monthOverrides": [{ "yearMonth": "2026-11", "mode": "fixedAmount", "shares": [{ "salesUnitId": "u1", "amount": 3000 }] }]
}
```

## 非本期

单位成本预算录入与对比。
