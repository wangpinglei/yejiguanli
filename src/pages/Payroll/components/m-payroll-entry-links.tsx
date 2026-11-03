/** 月度工资表顶部：考勤 / 绩效分数 / 社保公积金 / 个税扣除 录入入口 */

export type PayrollEntryMode =
  | 'all'
  | 'attendance'
  | 'score'
  | 'insurance'
  | 'tax'

type Props = {
  mode: PayrollEntryMode
  onChange: (mode: PayrollEntryMode) => void
}

const LINKS: Array<{ key: PayrollEntryMode; label: string }> = [
  { key: 'attendance', label: '考勤录入' },
  { key: 'score', label: '绩效分数录入' },
  { key: 'insurance', label: '社保公积金录入' },
  { key: 'tax', label: '个税扣除预报' },
]

function scrollToPayrollTable() {
  window.setTimeout(() => {
    document.getElementById('payroll-month-table')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }, 50)
}

export default function MPayrollEntryLinks({ mode, onChange }: Props) {
  function handleSelect(next: PayrollEntryMode) {
    onChange(next)
    scrollToPayrollTable()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {mode !== 'all' && (
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => handleSelect('all')}
        >
          ← 返回工资表
        </button>
      )}
      {LINKS.map((item) => {
        const active = mode === item.key
        return (
          <button
            key={item.key}
            type="button"
            className={
              active
                ? 'font-medium text-red-600 underline underline-offset-4'
                : 'text-red-600/90 hover:text-red-700 hover:underline underline-offset-4'
            }
            onClick={() => handleSelect(active ? 'all' : item.key)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
