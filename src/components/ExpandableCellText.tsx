import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function lineClampClass(lineClamp: number): string {
  if (lineClamp >= 3) return "line-clamp-3";
  if (lineClamp === 2) return "line-clamp-2";
  if (lineClamp === 1) return "line-clamp-1";
  return "truncate";
}

/** 长文本列内折行（line-clamp），超出或另有 detailText 时可点击查看全文 */
export function ExpandableCellText({
  text,
  detailText,
  emptyText = "-",
  label = "完整内容",
  maxLen = 10,
  lineClamp = 2,
  className = "w-full min-w-0",
  textClassName = "text-base",
  align = "left",
}: {
  text?: string;
  /** 弹层全文（可与列内 brief 不同） */
  detailText?: string;
  emptyText?: string;
  label?: string;
  maxLen?: number;
  /** 0 = 单行省略；2/3 = 多行折行 */
  lineClamp?: number;
  className?: string;
  textClassName?: string;
  align?: "left" | "center";
}) {
  const value = (text || "").trim();
  if (!value) {
    return <span className={`${textClassName} text-muted-foreground`}>{emptyText}</span>;
  }
  const full = (detailText || value).trim();
  const hasDetail = full.length > 0 && full !== value;
  const needPopover = hasDetail || value.length > maxLen;
  const wrap = `box-border max-w-full block break-words whitespace-normal overflow-hidden ${lineClampClass(lineClamp)}`;
  const alignCls = align === "center" ? "text-center" : "text-left";
  if (!needPopover) {
    return <span className={`${textClassName} ${wrap} ${alignCls} ${className}`}>{value}</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${textClassName} ${alignCls} text-primary hover:underline cursor-pointer ${wrap} ${className}`}
          title="点击查看完整内容"
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[min(24rem,92vw)] p-3">
        <p className="mb-1 text-sm text-muted-foreground">{label}</p>
        <p className="text-base break-words whitespace-pre-wrap">{full}</p>
      </PopoverContent>
    </Popover>
  );
}