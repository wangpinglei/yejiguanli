/** 月度工资表：去核算 → 依次录入 → 生成工资表 */

export type PayrollEntryMode =
  | 'all'
  | 'attendance'
  | 'score'
  | 'insurance'
  | 'otherDeduct'
  | 'tax'

export type PayrollCalcPhase = 'idle' | 'wizard' | 'result'

export const PAYROLL_ENTRY_STEPS: Array<{
  key: Exclude<PayrollEntryMode, 'all'>
  label: string
}> = [
  { key: 'attendance', label: '考勤录入' },
  { key: 'score', label: '绩效分数录入' },
  { key: 'insurance', label: '社保公积金录入' },
  { key: 'otherDeduct', label: '其他预扣项目' },
  { key: 'tax', label: '个税扣除预报' },
]

type Props = {
  phase: PayrollCalcPhase
  mode: PayrollEntryMode
  onPhaseChange: (phase: PayrollCalcPhase) => void
  onModeChange: (mode: PayrollEntryMode) => void
}

function scrollToPayrollTable() {
  window.setTimeout(() => {
    document.getElementById('payroll-month-table')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }, 50)
}

export default function MPayrollEntryLinks({
  phase,
  mode,
  onPhaseChange,
  onModeChange,
}: Props) {
  const stepIndex = PAYROLL_ENTRY_STEPS.findIndex((s) => s.key === mode)
  const currentStep = stepIndex >= 0 ? PAYROLL_ENTRY_STEPS[stepIndex] : null

  function handleStart() {
    onPhaseChange('wizard')
    onModeChange('attendance')
    scrollToPayrollTable()
  }

  function handleGotoStep(key: Exclude<PayrollEntryMode, 'all'>) {
    onPhaseChange('wizard')
    onModeChange(key)
    scrollToPayrollTable()
  }

  function handlePrev() {
    if (stepIndex <= 0) {
      onPhaseChange('idle')
      onModeChange('all')
      return
    }
    onModeChange(PAYROLL_ENTRY_STEPS[stepIndex - 1].key)
    scrollToPayrollTable()
  }

  function handleNext() {
    if (stepIndex < 0) return
    if (stepIndex >= PAYROLL_ENTRY_STEPS.length - 1) {
      onPhaseChange('result')
      onModeChange('all')
      scrollToPayrollTable()
      return
    }
    onModeChange(PAYROLL_ENTRY_STEPS[stepIndex + 1].key)
    scrollToPayrollTable()
  }

  function handleGenerate() {
    onPhaseChange('result')
    onModeChange('all')
    scrollToPayrollTable()
  }

  function handleRecalc() {
    onPhaseChange('wizard')
    onModeChange('attendance')
    scrollToPayrollTable()
  }

  if (phase === 'idle') {
    return (
      <button
        type="button"
        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        onClick={handleStart}
      >
        去核算工资
      </button>
    )
  }

  if (phase === 'result') {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">工资表已生成</span>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-700 hover:bg-slate-50"
          onClick={handleRecalc}
        >
          重新核算
        </button>
      </div>
    )
  }

  // wizard
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {PAYROLL_ENTRY_STEPS.map((item, i) => {
          const active = mode === item.key
          const done = stepIndex > i
          return (
            <button
              key={item.key}
              type="button"
              className={
                active
                  ? 'font-medium text-red-600 underline underline-offset-4'
                  : done
                    ? 'text-red-600/70 hover:underline underline-offset-4'
                    : 'text-red-600/40 hover:text-red-600/70'
              }
              onClick={() => handleGotoStep(item.key)}
            >
              {i + 1}. {item.label}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          onClick={handlePrev}
        >
          {stepIndex <= 0 ? '取消核算' : '上一步'}
        </button>
        <button
          type="button"
          className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
          onClick={handleNext}
        >
          {stepIndex >= PAYROLL_ENTRY_STEPS.length - 1
            ? '生成工资表'
            : `下一步：${PAYROLL_ENTRY_STEPS[stepIndex + 1]?.label || ''}`}
        </button>
        {currentStep && stepIndex < PAYROLL_ENTRY_STEPS.length - 1 && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={handleGenerate}
          >
            跳过剩余，直接生成
          </button>
        )}
      </div>
    </div>
  )
}
