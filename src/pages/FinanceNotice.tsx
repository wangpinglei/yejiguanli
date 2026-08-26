import { useEffect, useState } from 'react';

import {

  Loader2,

  Megaphone,

  Phone,

  Plus,

  Save,

  Send,

  Trash2,

  Users,

} from 'lucide-react';



import { financeNoticeApi } from '@/lib/api';

import { formatDateTime } from '@/lib/format';

import { usePermissions } from '@/hooks/usePermissions';

import type {

  FinanceNoticeConfig,

  FinanceNoticeContent,

  FinanceNoticePushLog,

  FinanceNoticePushOptions,

} from '@/types/financeNoticeTypes';

import {

  configToForm,

  isoToLocalInput,

  localInputToIso,

} from '@/types/financeNoticeTypes';

import { Button } from '@/components/ui/button';

import {

  Card,

  CardContent,

  CardDescription,

  CardFooter,

  CardHeader,

  CardTitle,

} from '@/components/ui/card';

import { Input } from '@/components/ui/input';

import { Label } from '@/components/ui/label';

import { Checkbox } from '@/components/ui/checkbox';

import { Textarea } from '@/components/ui/textarea';

import {

  Table,

  TableBody,

  TableCell,

  TableHead,

  TableHeader,

  TableRow,

} from '@/components/ui/table';

import MFinanceNoticePreview from './FinanceNotice/components/m-finance-notice-preview';



const PUSH_STATUS_LABEL: Record<string, string> = {

  none: '未安排推送',

  scheduled: '已确认定时推送',

  sent: '已推送',

  failed: '推送失败',

};



export default function FinanceNotice() {

  const { canEditFinanceNotice } = usePermissions();

  const [loading, setLoading] = useState(true);

  const [savingNotice, setSavingNotice] = useState(false);

  const [savingDuty, setSavingDuty] = useState(false);

  const [scheduling, setScheduling] = useState(false);

  const [pushing, setPushing] = useState(false);

  const [form, setForm] = useState<FinanceNoticeContent | null>(null);

  const [config, setConfig] = useState<FinanceNoticeConfig | null>(null);

  const [logs, setLogs] = useState<FinanceNoticePushLog[]>([]);

  const [scheduleInput, setScheduleInput] = useState('');

  const [saveBeforePush, setSaveBeforePush] = useState(true);

  const [pushOptions, setPushOptions] = useState<FinanceNoticePushOptions>({

    pushIncludeNotice: true,

    pushIncludeDuty: true,

  });



  useEffect(() => {

    loadData();

  }, []);



  async function loadData() {

    setLoading(true);

    try {

      const res = await financeNoticeApi.get();

      setConfig(res.config);

      setForm(configToForm(res.config));

      setLogs(res.logs);

      setScheduleInput(isoToLocalInput(res.config.scheduledAt));

      setPushOptions({

        pushIncludeNotice: res.config.pushIncludeNotice !== false,

        pushIncludeDuty: res.config.pushIncludeDuty !== false,

      });

    } catch (e: unknown) {

      alert(e instanceof Error ? e.message : '加载失败');

    } finally {

      setLoading(false);

    }

  }



  function updateDuty(index: number, field: 'date' | 'name' | 'phone', value: string) {

    if (!form) return;

    const dutyRoster = form.dutyRoster.map((row, i) =>

      i === index ? { ...row, [field]: value } : row,

    );

    setForm({ ...form, dutyRoster });

  }



  function addDutyRow() {

    if (!form) return;

    setForm({

      ...form,

      dutyRoster: [...form.dutyRoster, { date: '', name: '', phone: '' }],

    });

  }



  function removeDutyRow(index: number) {

    if (!form) return;

    const dutyRoster = form.dutyRoster.filter((_, i) => i !== index);

    setForm({

      ...form,

      dutyRoster: dutyRoster.length ? dutyRoster : [{ date: '', name: '', phone: '' }],

    });

  }



  async function handleSaveNotice() {

    if (!form) return;

    setSavingNotice(true);

    try {

      const res = await financeNoticeApi.saveNotice(form.noticeText);

      setConfig(res.config);

      setForm((prev) =>

        prev ? { ...prev, noticeText: res.config.noticeText } : configToForm(res.config),

      );

      setLogs(res.logs);

      alert('通知已保存');

    } catch (e: unknown) {

      alert(e instanceof Error ? e.message : '保存失败');

    } finally {

      setSavingNotice(false);

    }

  }



  async function handleSaveDuty() {

    if (!form) return;

    setSavingDuty(true);

    try {

      const res = await financeNoticeApi.saveDuty(form.dutyRoster);

      setConfig(res.config);

      setForm((prev) =>

        prev

          ? {

              ...prev,

              dutyRoster: res.config.dutyRoster.length

                ? res.config.dutyRoster

                : [{ date: '', name: '', phone: '' }],

            }

          : configToForm(res.config),

      );

      setLogs(res.logs);

      alert('值班表已保存');

    } catch (e: unknown) {

      alert(e instanceof Error ? e.message : '保存失败');

    } finally {

      setSavingDuty(false);

    }

  }



  async function handleConfirmSchedule() {

    const iso = localInputToIso(scheduleInput);

    if (!iso) {

      alert('请选择推送时间');

      return;

    }

    if (!pushOptions.pushIncludeNotice && !pushOptions.pushIncludeDuty) {

      alert('请至少勾选一项推送内容');

      return;

    }

    setScheduling(true);

    try {

      const res = await financeNoticeApi.schedule(iso, pushOptions);

      setConfig(res.config);

      setLogs(res.logs);

      setScheduleInput(isoToLocalInput(res.config.scheduledAt));

      alert('已确认定时推送，到点将按已保存内容推送到钉钉群');

    } catch (e: unknown) {

      alert(e instanceof Error ? e.message : '设置失败');

    } finally {

      setScheduling(false);

    }

  }



  async function handleCancelSchedule() {

    setScheduling(true);

    try {

      const res = await financeNoticeApi.cancelSchedule();

      setConfig(res.config);

      setLogs(res.logs);

      setScheduleInput('');

      alert('已取消定时推送');

    } catch (e: unknown) {

      alert(e instanceof Error ? e.message : '取消失败');

    } finally {

      setScheduling(false);

    }

  }



  async function handlePushNow() {

    if (!form) return;

    if (!pushOptions.pushIncludeNotice && !pushOptions.pushIncludeDuty) {

      alert('请至少勾选一项推送内容');

      return;

    }

    const parts: string[] = [];

    if (pushOptions.pushIncludeNotice) parts.push('通知');

    if (pushOptions.pushIncludeDuty) parts.push('值班表');

    const tip = saveBeforePush

      ? `将推送「${parts.join('、')}」到钉钉群，并保存对应板块的修改。确定？`

      : `将推送「${parts.join('、')}」到钉钉群，但不保存修改。确定？`;

    if (!window.confirm(tip)) return;

    setPushing(true);

    try {

      const res = await financeNoticeApi.pushNow({

        noticeText: form.noticeText,

        dutyRoster: form.dutyRoster,

        ...pushOptions,

        saveBeforePush,

      });

      setConfig(res.config);

      setLogs(res.logs);

      setForm(configToForm(res.config));

      alert(saveBeforePush ? '已推送到钉钉群，对应内容已保存' : '已推送到钉钉群（未保存修改）');

    } catch (e: unknown) {

      alert(e instanceof Error ? e.message : '推送失败');

    } finally {

      setPushing(false);

    }

  }



  if (loading || !form || !config) {

    return (

      <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">

        <Loader2 className="mr-2 h-5 w-5 animate-spin" />

        加载中...

      </div>

    );

  }



  const isScheduled = config.pushStatus === 'scheduled';



  return (

    <div className="space-y-6">

      {canEditFinanceNotice && (

        <Card className="border-primary/20">

          <CardHeader>

            <CardTitle className="text-lg">钉钉群推送</CardTitle>

            <CardDescription>

              通知和值班表分开保存；推送时可勾选只推其中一块。定时推送使用各板块已保存的内容。

            </CardDescription>

          </CardHeader>

          <CardContent className="space-y-4">

            <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/30 px-4 py-3">

              <div className="flex items-center gap-2">

                <Checkbox

                  id="pushIncludeNotice"

                  checked={pushOptions.pushIncludeNotice}

                  onCheckedChange={(checked) =>

                    setPushOptions({ ...pushOptions, pushIncludeNotice: checked === true })

                  }

                  disabled={isScheduled}

                />

                <Label htmlFor="pushIncludeNotice" className="cursor-pointer font-normal">

                  推送通知

                </Label>

              </div>

              <div className="flex items-center gap-2">

                <Checkbox

                  id="pushIncludeDuty"

                  checked={pushOptions.pushIncludeDuty}

                  onCheckedChange={(checked) =>

                    setPushOptions({ ...pushOptions, pushIncludeDuty: checked === true })

                  }

                  disabled={isScheduled}

                />

                <Label htmlFor="pushIncludeDuty" className="cursor-pointer font-normal">

                  推送值班表

                </Label>

              </div>

            </div>

            <div className="flex flex-wrap items-end gap-3">

              <div className="space-y-2">

                <Label htmlFor="scheduleAt">推送时间</Label>

                <Input

                  id="scheduleAt"

                  type="datetime-local"

                  className="w-[220px]"

                  value={scheduleInput}

                  onChange={(e) => setScheduleInput(e.target.value)}

                  disabled={isScheduled}

                />

              </div>

              <Button onClick={handleConfirmSchedule} disabled={scheduling || isScheduled}>

                {scheduling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}

                确认定时推送

              </Button>

              {isScheduled && (

                <Button variant="outline" onClick={handleCancelSchedule} disabled={scheduling}>

                  取消定时

                </Button>

              )}

              <Button variant="secondary" onClick={handlePushNow} disabled={pushing}>

                {pushing ? (

                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />

                ) : (

                  <Send className="mr-2 h-4 w-4" />

                )}

                立即推送

              </Button>

              <div className="flex items-center gap-2 pb-1">

                <Checkbox

                  id="saveBeforePush"

                  checked={saveBeforePush}

                  onCheckedChange={(checked) => setSaveBeforePush(checked === true)}

                />

                <Label htmlFor="saveBeforePush" className="cursor-pointer font-normal">

                  推送后保存对应板块

                </Label>

              </div>

            </div>

            <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm">

              <p>

                状态：

                <span className="font-medium">

                  {PUSH_STATUS_LABEL[config.pushStatus] || config.pushStatus}

                </span>

              </p>

              {config.scheduledAt && (

                <p className="mt-1 text-muted-foreground">

                  计划推送：{formatDateTime(config.scheduledAt)}

                </p>

              )}

              {config.pushedAt && (

                <p className="mt-1 text-muted-foreground">

                  最近推送：{formatDateTime(config.pushedAt)}

                </p>

              )}

              {config.pushError && (

                <p className="mt-1 text-destructive">{config.pushError}</p>

              )}

            </div>

          </CardContent>

        </Card>

      )}



      <MFinanceNoticePreview

        content={form}

        pushOptions={pushOptions}

        isDraft={canEditFinanceNotice}

      />



      <Card className="border-amber-200/80 bg-amber-50/40">

        <CardHeader>

          <CardTitle className="flex items-center gap-2 text-lg">

            <Megaphone className="h-5 w-5 text-amber-600" />

            一、通知

          </CardTitle>

          <CardDescription>

            电子签提醒、录单截止等文字通知，单独保存，不影响值班表

          </CardDescription>

        </CardHeader>

        <CardContent>

          {canEditFinanceNotice ? (

            <Textarea

              rows={16}

              className="min-h-[320px] font-normal leading-relaxed"

              placeholder="请输入通知内容..."

              value={form.noticeText}

              onChange={(e) => setForm({ ...form, noticeText: e.target.value })}

            />

          ) : (

            <p className="whitespace-pre-wrap text-sm leading-relaxed">{form.noticeText}</p>

          )}

        </CardContent>

        {canEditFinanceNotice && (

          <CardFooter className="justify-end border-t bg-amber-50/60">

            <Button onClick={handleSaveNotice} disabled={savingNotice}>

              {savingNotice ? (

                <Loader2 className="mr-2 h-4 w-4 animate-spin" />

              ) : (

                <Save className="mr-2 h-4 w-4" />

              )}

              保存通知

            </Button>

          </CardFooter>

        )}

      </Card>



      <Card>

        <CardHeader>

          <div className="flex items-center justify-between">

            <div>

              <CardTitle className="flex items-center gap-2 text-lg">

                <Users className="h-5 w-5" />

                二、值班表

              </CardTitle>

              <CardDescription>单独保存值班人员，不必每次连同通知一起更新</CardDescription>

            </div>

            {canEditFinanceNotice && (

              <Button type="button" variant="outline" size="sm" onClick={addDutyRow}>

                <Plus className="mr-1 h-3.5 w-3.5" />

                添加行

              </Button>

            )}

          </div>

        </CardHeader>

        <CardContent>

          <Table>

            <TableHeader>

              <TableRow>

                <TableHead className="w-[140px]">值班日期</TableHead>

                <TableHead>值班人员</TableHead>

                <TableHead>联系电话</TableHead>

                {canEditFinanceNotice && <TableHead className="w-[60px]" />}

              </TableRow>

            </TableHeader>

            <TableBody>

              {form.dutyRoster.map((row, index) => (

                <TableRow key={index}>

                  <TableCell>

                    {canEditFinanceNotice ? (

                      <Input

                        value={row.date}

                        placeholder="2026/8/22"

                        onChange={(e) => updateDuty(index, 'date', e.target.value)}

                      />

                    ) : (

                      row.date

                    )}

                  </TableCell>

                  <TableCell>

                    {canEditFinanceNotice ? (

                      <Input

                        value={row.name}

                        onChange={(e) => updateDuty(index, 'name', e.target.value)}

                      />

                    ) : (

                      row.name

                    )}

                  </TableCell>

                  <TableCell>

                    {canEditFinanceNotice ? (

                      <Input

                        value={row.phone}

                        onChange={(e) => updateDuty(index, 'phone', e.target.value)}

                      />

                    ) : (

                      <a

                        href={`tel:${row.phone}`}

                        className="inline-flex items-center gap-1.5 text-primary hover:underline"

                      >

                        <Phone className="h-3.5 w-3.5" />

                        {row.phone}

                      </a>

                    )}

                  </TableCell>

                  {canEditFinanceNotice && (

                    <TableCell>

                      <Button

                        type="button"

                        variant="ghost"

                        size="icon"

                        onClick={() => removeDutyRow(index)}

                      >

                        <Trash2 className="h-4 w-4" />

                      </Button>

                    </TableCell>

                  )}

                </TableRow>

              ))}

            </TableBody>

          </Table>

        </CardContent>

        {canEditFinanceNotice && (

          <CardFooter className="justify-end border-t">

            <Button onClick={handleSaveDuty} disabled={savingDuty}>

              {savingDuty ? (

                <Loader2 className="mr-2 h-4 w-4 animate-spin" />

              ) : (

                <Save className="mr-2 h-4 w-4" />

              )}

              保存值班表

            </Button>

          </CardFooter>

        )}

      </Card>



      <Card>

        <CardHeader>

          <CardTitle className="text-lg">推送记录</CardTitle>

        </CardHeader>

        <CardContent>

          {logs.length === 0 ? (

            <p className="text-sm text-muted-foreground">暂无推送记录</p>

          ) : (

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>推送时间</TableHead>

                  <TableHead>操作人</TableHead>

                  <TableHead>内容</TableHead>

                  <TableHead>状态</TableHead>

                  <TableHead>备注</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {logs.map((log) => {

                  const contentParts: string[] = [];

                  if (log.pushIncludeNotice !== false) contentParts.push('通知');

                  if (log.pushIncludeDuty !== false) contentParts.push('值班表');

                  return (

                    <TableRow key={log.id}>

                      <TableCell>{formatDateTime(log.pushedAt)}</TableCell>

                      <TableCell>{log.operator}</TableCell>

                      <TableCell>{contentParts.join('、') || '—'}</TableCell>

                      <TableCell>{log.status === 'sent' ? '成功' : '失败'}</TableCell>

                      <TableCell className="text-muted-foreground">

                        {log.error ||

                          (log.scheduledAt

                            ? `定时 ${formatDateTime(log.scheduledAt)}`

                            : '立即推送')}

                      </TableCell>

                    </TableRow>

                  );

                })}

              </TableBody>

            </Table>

          )}

        </CardContent>

      </Card>

    </div>

  );

}

