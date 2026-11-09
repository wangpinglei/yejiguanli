import { useEffect, useMemo, useState } from 'react'
import { Receipt } from 'lucide-react'
import { toast } from 'sonner'

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
import { useData } from '@/context/DataContext'
import { formatCurrency } from '@/lib/format'
import {
  calcSpecialAdditionalMonthly,
  clearLocalTaxProfile,
  createEmptySpecialAdditional,
  getHousingRentMonthlyAmount,
  HOUSING_RENT_TIER_OPTIONS,
  loadTaxProfile,
  SPECIAL_ADDITIONAL_STANDARDS as S,
  type ContinuingEduMode,
  type HousingRentTier,
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
  const { updatePersonnel } = useData()
  const [special, setSpecial] = useState<SpecialAdditionalDeduction>(createEmptySpecialAdditional())
  const [socialPersonal, setSocialPersonal] = useState(0)
  const [housingPersonal, setHousingPersonal] = useState(0)
  const [socialEmployer, setSocialEmployer] = useState(0)
  const [housingEmployer, setHousingEmployer] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !person) return
    const profile = loadTaxProfile(
      person.id,
      {
        socialInsurance: person.socialInsurance,
        housingFund: person.housingFund,
      },
      person.taxProfile as Partial<PersonnelTaxProfile> | undefined,
    )
    setSpecial({ ...createEmptySpecialAdditional(), ...profile.special })
    setSocialPersonal(profile.socialInsurancePersonal)
    setHousingPersonal(profile.housingFundPersonal)
    setSocialEmployer(Number(person.socialInsurance) || 0)
    setHousingEmployer(Number(person.housingFund) || 0)
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

  async function handleSave() {
    if (!person) return
    const profile: PersonnelTaxProfile = {
      personnelId: person.id,
      special,
      socialInsurancePersonal: Number(socialPersonal) || 0,
      housingFundPersonal: Number(housingPersonal) || 0,
      updatedAt: new Date().toISOString(),
    }
    setSaving(true)
    try {
      await updatePersonnel(person.id, {
        taxProfile: profile,
        socialInsurance: Number(socialEmployer) || 0,
        housingFund: Number(housingEmployer) || 0,
      })
      clearLocalTaxProfile(person.id)
      toast.success('个税扣除档案已保存')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
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
              专项附加按固定标准勾选；个人缴纳默认用于工资代扣，档案社保/公积金作单位成本参考，均可编辑并保存到人员档案。
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
                <Label>档案社保（单位成本参考）</Label>
                <Input
                  type="number"
                  value={socialEmployer}
                  onChange={(e) => setSocialEmployer(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1">
                <Label>档案公积金（单位成本参考）</Label>
                <Input
                  type="number"
                  value={housingEmployer}
                  onChange={(e) => setHousingEmployer(Number(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-base">专项附加扣除</Label>
                <span className="text-sm font-medium text-emerald-700">
                  本月合计 {formatCurrency(monthlySpecial)}
                </span>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[88px]">启用</TableHead>
                      <TableHead>项目</TableHead>
                      <TableHead className="min-w-[160px]">人数/方式</TableHead>
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
                        <Input
                          type="number"
                          min={0}
                          className="h-8 w-20"
                          disabled={!special.childEducationEnabled}
                          value={special.childEducationCount}
                          onChange={(e) =>
                            patchSpecial({
                              childEducationCount: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(S.childEducationPerChild)} × 人
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
                        <Input
                          type="number"
                          min={0}
                          className="h-8 w-20"
                          disabled={!special.infantCareEnabled}
                          value={special.infantCareCount}
                          onChange={(e) =>
                            patchSpecial({
                              infantCareCount: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(S.infantCarePerChild)} × 人
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
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-1 text-xs">
                            <Checkbox
                              checked={special.elderIsOnlyChild}
                              disabled={!special.elderSupportEnabled}
                              onCheckedChange={(v) =>
                                patchSpecial({ elderIsOnlyChild: Boolean(v) })
                              }
                            />
                            独生
                          </label>
                          {!special.elderIsOnlyChild && (
                            <Input
                              type="number"
                              className="h-8 w-24"
                              disabled={!special.elderSupportEnabled}
                              placeholder={`≤${S.elderNonOnlyChildMax}`}
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
                      <TableCell className="text-right text-muted-foreground">
                        独生 {formatCurrency(S.elderOnlyChild)} / 非独生≤
                        {formatCurrency(S.elderNonOnlyChildMax)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(
                          special.elderSupportEnabled
                            ? (special.elderIsOnlyChild
                              ? S.elderOnlyChild
                              : Math.min(
                                S.elderNonOnlyChildMax,
                                Math.max(0, special.elderSupportAmount || 0),
                              ))
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
                      <TableCell className="text-xs text-muted-foreground">与房租互斥</TableCell>
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
                            patchSpecial({
                              housingRentEnabled: Boolean(v),
                              ...(v ? { housingLoanEnabled: false } : {}),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>住房租金</TableCell>
                      <TableCell>
                        <Select
                          value={special.housingRentTier || 'tier1100'}
                          disabled={!special.housingRentEnabled}
                          onValueChange={(v) =>
                            patchSpecial({ housingRentTier: v as HousingRentTier })
                          }
                        >
                          <SelectTrigger className="h-8 w-[220px]">
                            <SelectValue placeholder="选择城市档次" />
                          </SelectTrigger>
                          <SelectContent>
                            {HOUSING_RENT_TIER_OPTIONS.map((opt) => (
                              <SelectItem key={opt.key} value={opt.key}>
                                {opt.amount} 元 · {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-xs">
                        1500 / 1100 / 800（与房贷互斥）
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(getHousingRentMonthlyAmount(special))}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={2}>继续教育</TableCell>
                      <TableCell>
                        <Select
                          value={special.continuingEduMode}
                          onValueChange={(v) =>
                            patchSpecial({ continuingEduMode: v as ContinuingEduMode })
                          }
                        >
                          <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">未启用</SelectItem>
                            <SelectItem value="degree">学历教育</SelectItem>
                            <SelectItem value="qualification">职业资格</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-xs">
                        学历 {formatCurrency(S.continuingEduDegree)}/月；资格{' '}
                        {formatCurrency(S.continuingEduQualificationYear)}/年
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
                      <TableCell colSpan={2}>大病医疗</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="h-8 w-28"
                          placeholder="本月摊销"
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !person}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
