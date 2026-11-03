import { useEffect, useMemo, useState } from 'react'
import { Receipt } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/format'
import {
  calcSpecialAdditionalMonthly,
  createEmptySpecialAdditional,
  loadTaxProfile,
  saveTaxProfile,
  SPECIAL_ADDITIONAL_STANDARDS as S,
  type ContinuingEduMode,
  type PersonnelTaxProfile,
  type SpecialAdditionalDeduction,
} from '@/lib/payrollTax'
import type { Personnel } from '@/types'

type Props = {
  person: Personnel | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function MTaxProfileDialog({ person, open, onOpenChange }: Props) {
  const [special, setSpecial] = useState<SpecialAdditionalDeduction>(createEmptySpecialAdditional())
  const [socialPersonal, setSocialPersonal] = useState(0)
  const [housingPersonal, setHousingPersonal] = useState(0)

  useEffect(() => {
    if (!open || !person) return
    const profile = loadTaxProfile(person.id, {
      socialInsurance: person.socialInsurance,
      housingFund: person.housingFund,
    })
    setSpecial({ ...createEmptySpecialAdditional(), ...profile.special })
    setSocialPersonal(profile.socialInsurancePersonal)
    setHousingPersonal(profile.housingFundPersonal)
  }, [open, person])

  const monthlySpecial = useMemo(() => calcSpecialAdditionalMonthly(special), [special])

  function patchSpecial(patch: Partial<SpecialAdditionalDeduction>) {
    setSpecial((prev) => {
      const next = { ...prev, ...patch }
      // 房贷与租金互斥
      if (patch.housingLoanEnabled) next.housingRentEnabled = false
      if (patch.housingRentEnabled) next.housingLoanEnabled = false
      return next
    })
  }

  function handleSave() {
    if (!person) return
    const profile: PersonnelTaxProfile = {
      personnelId: person.id,
      special,
      socialInsurancePersonal: Number(socialPersonal) || 0,
      housingFundPersonal: Number(housingPersonal) || 0,
      updatedAt: new Date().toISOString(),
    }
    saveTaxProfile(profile)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex !max-h-[92vh] !w-[920px] !max-w-[96vw] flex-col gap-3 overflow-hidden p-5 sm:!max-w-[920px]">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            个税扣除档案{person ? ` · ${person.name}` : ''}
          </DialogTitle>
        </DialogHeader>

        {person && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <p className="text-sm text-muted-foreground">
              专项附加按固定标准勾选；社保/公积金个人默认用于工资表代扣（一期用档案金额预填，可改）。
              数据暂存本机，未上线同步服务器。
            </p>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label>社保 · 个人缴纳默认</Label>
                <Input
                  type="number"
                  value={socialPersonal}
                  onChange={(e) => setSocialPersonal(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1">
                <Label>公积金 · 个人缴纳默认</Label>
                <Input
                  type="number"
                  value={housingPersonal}
                  onChange={(e) => setHousingPersonal(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground">档案社保（单位成本参考）</Label>
                <Input type="number" value={person.socialInsurance || 0} disabled />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground">档案公积金（单位成本参考）</Label>
                <Input type="number" value={person.housingFund || 0} disabled />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">专项附加扣除</Label>
                <span className="text-sm font-medium text-emerald-700">
                  本月合计 {formatCurrency(monthlySpecial)}
                </span>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">启用</TableHead>
                      <TableHead>项目</TableHead>
                      <TableHead>录入</TableHead>
                      <TableHead className="text-right">标准</TableHead>
                      <TableHead className="text-right">本月</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>
                        <Checkbox
                          checked={special.childEducationEnabled}
                          onCheckedChange={(v) =>
                            patchSpecial({ childEducationEnabled: Boolean(v) })
                          }
                        />
                      </TableCell>
                      <TableCell>子女教育</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">子女数</span>
                          <Input
                            type="number"
                            min={0}
                            className="h-8 w-20"
                            value={special.childEducationCount}
                            onChange={(e) =>
                              patchSpecial({
                                childEducationCount: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(S.childEducationPerChild)}×人
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(
                          special.childEducationEnabled
                            ? special.childEducationCount * S.childEducationPerChild
                            : 0,
                        )}
                      </TableCell>
                    </TableRow>

                    <TableRow>
                      <TableCell>
                        <Checkbox
                          checked={special.infantCareEnabled}
                          onCheckedChange={(v) =>
                            patchSpecial({ infantCareEnabled: Boolean(v) })
                          }
                        />
                      </TableCell>
                      <TableCell>3岁以下婴幼儿照护</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">人数</span>
                          <Input
                            type="number"
                            min={0}
                            className="h-8 w-20"
                            value={special.infantCareCount}
                            onChange={(e) =>
                              patchSpecial({
                                infantCareCount: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(S.infantCarePerChild)}×人
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(
                          special.infantCareEnabled
                            ? special.infantCareCount * S.infantCarePerChild
                            : 0,
                        )}
                      </TableCell>
                    </TableRow>

                    <TableRow>
                      <TableCell>
                        <Checkbox
                          checked={special.elderSupportEnabled}
                          onCheckedChange={(v) =>
                            patchSpecial({ elderSupportEnabled: Boolean(v) })
                          }
                        />
                      </TableCell>
                      <TableCell>赡养老人</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              checked={special.elderIsOnlyChild}
                              onCheckedChange={(v) =>
                                patchSpecial({ elderIsOnlyChild: Boolean(v) })
                              }
                            />
                            独生子女
                          </label>
                          {!special.elderIsOnlyChild && (
                            <Input
                              type="number"
                              className="h-8 w-28"
                              placeholder="本人分摊"
                              value={special.elderSupportAmount || ''}
                              onChange={(e) =>
                                patchSpecial({
                                  elderSupportAmount: Number(e.target.value) || 0,
                                })
                              }
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-xs">
                        独生 {formatCurrency(S.elderOnlyChild)} / 非独生 ≤
                        {formatCurrency(S.elderNonOnlyChildMax)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(
                          special.elderSupportEnabled
                            ? (special.elderIsOnlyChild
                              ? S.elderOnlyChild
                              : Math.min(S.elderNonOnlyChildMax, special.elderSupportAmount || 0))
                            : 0,
                        )}
                      </TableCell>
                    </TableRow>

                    <TableRow>
                      <TableCell>
                        <Checkbox
                          checked={special.housingLoanEnabled}
                          onCheckedChange={(v) =>
                            patchSpecial({ housingLoanEnabled: Boolean(v) })
                          }
                        />
                      </TableCell>
                      <TableCell>住房贷款利息</TableCell>
                      <TableCell className="text-xs text-muted-foreground">与租金互斥</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(S.housingLoanInterest)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(special.housingLoanEnabled ? S.housingLoanInterest : 0)}
                      </TableCell>
                    </TableRow>

                    <TableRow>
                      <TableCell>
                        <Checkbox
                          checked={special.housingRentEnabled}
                          onCheckedChange={(v) =>
                            patchSpecial({ housingRentEnabled: Boolean(v) })
                          }
                        />
                      </TableCell>
                      <TableCell>住房租金</TableCell>
                      <TableCell className="text-xs text-muted-foreground">与房贷互斥</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(S.housingRent)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(special.housingRentEnabled ? S.housingRent : 0)}
                      </TableCell>
                    </TableRow>

                    <TableRow>
                      <TableCell>
                        <Checkbox
                          checked={special.continuingEduMode !== 'none'}
                          onCheckedChange={(v) =>
                            patchSpecial({
                              continuingEduMode: v ? 'degree' : 'none',
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>继续教育</TableCell>
                      <TableCell>
                        <Select
                          value={special.continuingEduMode}
                          onValueChange={(v) =>
                            patchSpecial({ continuingEduMode: v as ContinuingEduMode })
                          }
                        >
                          <SelectTrigger className="h-8 w-[200px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">未启用</SelectItem>
                            <SelectItem value="degree">学历教育 400/月</SelectItem>
                            <SelectItem value="qualification">职业资格 3600/年÷12</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-xs">
                        {formatCurrency(S.continuingEduDegree)} 或年
                        {formatCurrency(S.continuingEduQualificationYear)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(
                          special.continuingEduMode === 'degree'
                            ? S.continuingEduDegree
                            : special.continuingEduMode === 'qualification'
                              ? S.continuingEduQualificationYear / 12
                              : 0,
                        )}
                      </TableCell>
                    </TableRow>

                    <TableRow>
                      <TableCell>
                        <Checkbox
                          checked={(special.seriousIllnessMonthly || 0) > 0}
                          onCheckedChange={(v) =>
                            patchSpecial({
                              seriousIllnessMonthly: v ? special.seriousIllnessMonthly || 0 : 0,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>大病医疗（手工月摊）</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="h-8 w-28"
                          value={special.seriousIllnessMonthly || ''}
                          onChange={(e) =>
                            patchSpecial({
                              seriousIllnessMonthly: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-xs text-amber-700">一期手工</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(special.seriousIllnessMonthly || 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave}>保存到本机</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
