/** 人员在岗 / 离职判定（选择器与列表共用） */

export type DutyPersonLike = {
  id?: string
  name?: string
  position?: string
  hireDate?: string
  resignDate?: string
  status?: string
}

/**
 * 指定日期（默认今天）是否在岗。
 * - 有离职日：离职日当天仍算在岗，次日起离职
 * - 无离职日：status !== inactive 视为在岗
 */
export function isOnDutyPerson(
  person: DutyPersonLike,
  asOfDate?: string,
): boolean {
  const asOf = (asOfDate || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const hire = (person.hireDate || '').slice(0, 10)
  const resign = (person.resignDate || '').slice(0, 10)
  if (hire && hire > asOf) return false
  if (resign) return resign >= asOf
  return person.status !== 'inactive'
}

export function formatPersonnelOptionLabel(
  person: DutyPersonLike,
  options?: { withPosition?: boolean; asOfDate?: string },
): string {
  const onDuty = isOnDutyPerson(person, options?.asOfDate)
  const base = options?.withPosition && person.position
    ? `${person.name || '-'} - ${person.position}`
    : (person.name || '-')
  if (onDuty) return base
  const resign = (person.resignDate || '').slice(0, 10)
  return resign ? `${base}（离职 ${resign}）` : `${base}（离职）`
}

/** 选择器用：默认藏离职；可强制保留已选 id；在职排前 */
export function filterPersonnelForSelect<T extends DutyPersonLike & { id: string }>(
  list: T[],
  options: {
    includeResigned?: boolean
    asOfDate?: string
    keepIds?: Array<string | undefined | null>
  } = {},
): T[] {
  const includeResigned = Boolean(options.includeResigned)
  const asOfDate = options.asOfDate
  const keep = new Set(
    (options.keepIds || []).filter((id): id is string => Boolean(id)),
  )
  return list
    .filter(
      (p) => includeResigned || isOnDutyPerson(p, asOfDate) || keep.has(p.id),
    )
    .sort((a, b) => {
      const aOn = isOnDutyPerson(a, asOfDate) ? 0 : 1
      const bOn = isOnDutyPerson(b, asOfDate) ? 0 : 1
      if (aOn !== bOn) return aOn - bOn
      return (a.name || '').localeCompare(b.name || '', 'zh-CN')
    })
}

export function partitionPersonnelByDuty<T extends DutyPersonLike>(
  list: T[],
  asOfDate?: string,
): { onDuty: T[]; resigned: T[] } {
  const onDuty: T[] = []
  const resigned: T[] = []
  for (const p of list) {
    if (isOnDutyPerson(p, asOfDate)) onDuty.push(p)
    else resigned.push(p)
  }
  return { onDuty, resigned }
}
