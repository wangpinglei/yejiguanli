import {
  filterPersonnelForSelect,
  formatPersonnelOptionLabel,
  isOnDutyPerson,
} from './personnelDuty'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

{
  const active = { id: '1', name: '在职甲', status: 'active' }
  const resigned = {
    id: '2',
    name: '离职乙',
    status: 'inactive',
    resignDate: '2026-09-01',
  }
  assert(isOnDutyPerson(active), '在职应在岗')
  assert(!isOnDutyPerson(resigned), '已过离职日应不在岗')
  assert(
    isOnDutyPerson(resigned, '2026-08-31'),
    '离职日前一天仍应在岗',
  )
  assert(
    isOnDutyPerson(resigned, '2026-09-01'),
    '离职日当天仍应在岗',
  )
  assert(
    !isOnDutyPerson(resigned, '2026-09-02'),
    '离职次日应不在岗',
  )
}

{
  const list = [
    { id: 'r', name: '张离职', status: 'inactive', resignDate: '2026-01-01' },
    { id: 'a', name: '李在职', status: 'active' },
  ]
  const hidden = filterPersonnelForSelect(list, { includeResigned: false })
  assert(hidden.length === 1 && hidden[0].id === 'a', '默认应隐藏离职')
  const kept = filterPersonnelForSelect(list, {
    includeResigned: false,
    keepIds: ['r'],
  })
  assert(kept.length === 2 && kept[0].id === 'a', '已选离职应保留且在职排前')
  assert(
    formatPersonnelOptionLabel(list[0]).includes('离职'),
    '离职标签应带离职字样',
  )
}

console.log('personnelDuty.test.ts: ok')
