import { getIitCycleMonthIndex } from './payrollTax'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

{
  const hire = '2026-06-28'
  assert(getIitCycleMonthIndex('2026-06', hire) === 1, '6月 N=1')
  assert(getIitCycleMonthIndex('2026-07', hire) === 2, '7月 N=2')
  assert(getIitCycleMonthIndex('2026-10', hire) === 5, '10月 N=5')
  assert(getIitCycleMonthIndex('2026-11', hire) === 6, '11月 N=6')
  assert(getIitCycleMonthIndex('2026-12', hire) === 1, '12月新周期 N=1')
  assert(getIitCycleMonthIndex('2027-01', hire) === 2, '次年1月 N=2')
}

{
  // 入职早于周期起点：整周期序号
  const hire = '2025-03-01'
  assert(getIitCycleMonthIndex('2025-12', hire) === 1, '老员工12月 N=1')
  assert(getIitCycleMonthIndex('2026-10', hire) === 11, '老员工10月 N=11')
  assert(getIitCycleMonthIndex('2026-11', hire) === 12, '老员工11月 N=12')
}

{
  // 无入职：与自然周期一致
  assert(getIitCycleMonthIndex('2026-10') === 11, '无入职10月 N=11')
  assert(getIitCycleMonthIndex('2026-12') === 1, '无入职12月 N=1')
}

console.log('payrollIitN.test.ts ok')
