# 个人提成可选业绩梯度

## 规则

- **可选**：未配置梯度时，仍用原「(销售额 − 起算门槛) × 比例%」。
- **月度整段定档**：按当月该人该产品累计业绩，取「最低业绩 ≤ 累计」中最高档比例，**全部业绩**按该比例计佣。
- 例：`≥0 → 10%`，`≥30000 → 15%`；累计 3.5 万则 `35000 × 15%`。

## 不适用（提成不变）

以下情况即使配了梯度也不启用，保持原提成：

- **按件提成**（`personalCommissionType === fixed`）
- **按件结算**产品（单位×产品 `settlementType === fixed`）
- **不计入业绩**产品（`excludeFromPerformance`）

## 数据

`ProductPersonCommission.personalCommissionTiers?: { minSalesAmount, ratePercent }[]`  
空数组 / 未存 = 不启用。

## UI

比例模式下增加可选「业绩梯度」多行编辑；按件/不计入业绩时仅提示不适用。
