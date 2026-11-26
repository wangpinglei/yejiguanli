import { PageHeader } from "@/components/PageHeader";

/** 各单位产品结算核对（记佣金额 × 结算比例）；明细与导出待接入 saleSettlementReconcile */
export default function ProductSettlementSales() {
  return (
    <div>
      <PageHeader
        title="产品结算"
        description="按各单位销售记录核对结算：记佣金额（实收 − 业绩扣除）× 结算比例 = 预估结算；单位手工调整后按占比分摊实际结算。"
      />
      <p className="text-sm text-muted-foreground">
        各单位明细表与 Excel 导出正在接入；口径与销售记录「记佣金额」一致（例：6980 × 45% = 3141）。
      </p>
    </div>
  );
}