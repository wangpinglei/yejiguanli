import { useState } from 'react';

import { CalendarClock, Eye, Loader2, Plus, Send, Trash2 } from 'lucide-react';

import { financeNoticeApi } from '@/lib/api';

import { formatDateTime } from '@/lib/format';

import type {
  FinanceDutyRow,
  FinanceNoticeContent,
  FinanceNoticePushOptions,
  FinanceNoticePushTask,
} from '@/types/financeNoticeTypes';

import {
  countPushMessages,
  createEmptyFinanceNoticeForm,
  getPushMessageLabels,
  localInputToIso,
  taskPreviewContent,
} from '@/types/financeNoticeTypes';

import { Button } from '@/components/ui/button';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { Checkbox } from '@/components/ui/checkbox';

import { Input } from '@/components/ui/input';

import { Label } from '@/components/ui/label';

import { Textarea } from '@/components/ui/textarea';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  FinanceNoticePreviewBody,
  getTotalPendingMessageCount,
} from './m-finance-notice-preview';

interface Props {
  tasks: FinanceNoticePushTask[];
  onTasksChange: (tasks: FinanceNoticePushTask[]) => void;
  onLogsRefresh: () => Promise<void>;
}

export default function MFinanceNoticePushTaskPanel({
  tasks,
  onTasksChange,
  onLogsRefresh,
}: Props) {
  const [taskContent, setTaskContent] = useState<FinanceNoticeContent>(() =>
    createEmptyFinanceNoticeForm(),
  );
  const [pushOptions, setPushOptions] = useState<FinanceNoticePushOptions>({
    pushIncludeNotice: true,
    pushIncludeDuty: false,
  });
  const [scheduleInput, setScheduleInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  function updateDuty(index: number, field: keyof FinanceDutyRow, value: string) {
    setTaskContent({
      ...taskContent,
      dutyRoster: taskContent.dutyRoster.map((row, i) =>
        i === index ? { ...row, [field]: value } : row,
      ),
    });
  }

  function addDutyRow() {
    setTaskContent({
      ...taskContent,
      dutyRoster: [...taskContent.dutyRoster, { date: '', name: '', phone: '' }],
    });
  }

  function removeDutyRow(index: number) {
    const dutyRoster = taskContent.dutyRoster.filter((_, i) => i !== index);
    setTaskContent({
      ...taskContent,
      dutyRoster: dutyRoster.length ? dutyRoster : [{ date: '', name: '', phone: '' }],
    });
  }

  function handlePushIncludeDutyChange(checked: boolean) {
    setPushOptions({ ...pushOptions, pushIncludeDuty: checked })
    if (!checked) {
      setTaskContent({
        ...taskContent,
        dutyRoster: [{ date: '', name: '', phone: '' }],
      })
    }
  }

  function buildTaskPayload(scheduledAt: string) {
    return {
      noticeText: pushOptions.pushIncludeNotice ? taskContent.noticeText : '',
      dutyRoster: pushOptions.pushIncludeDuty ? taskContent.dutyRoster : [],
      scheduledAt,
      pushIncludeNotice: pushOptions.pushIncludeNotice,
      pushIncludeDuty: pushOptions.pushIncludeDuty,
    }
  }

  function getPushSelectionSummary() {
    const notice = pushOptions.pushIncludeNotice ? '已勾选' : '未勾选'
    const duty = pushOptions.pushIncludeDuty ? '已勾选' : '未勾选'
    return `推送通知：${notice}；推送值班表：${duty}`
  }

  function buildConfirmTip(action: string, messageCount: number, labels: string[]) {
    return `${getPushSelectionSummary()}\n\n${action} ${labels.join('、')}，共 ${messageCount} 条钉钉消息。\n\n若只需推送通知，请先取消勾选「推送值班表」。确定继续？`
  }

  async function handleCreateTask() {
    const scheduledAt = localInputToIso(scheduleInput);
    if (!scheduledAt) {
      alert('请选择推送时间');
      return;
    }
    if (!pushOptions.pushIncludeNotice && !pushOptions.pushIncludeDuty) {
      alert('请至少勾选一项推送内容');
      return;
    }
    const messageCount = countPushMessages(pushOptions);
    const labels = getPushMessageLabels(pushOptions);
    const tip = buildConfirmTip(
      `将创建定时任务：${formatDateTime(scheduledAt)} 推送`,
      messageCount,
      labels,
    );
    if (!window.confirm(tip)) return;

    setCreating(true);
    try {
      const res = await financeNoticeApi.createPushTask(buildTaskPayload(scheduledAt));
      onTasksChange(res.tasks);
      await onLogsRefresh();
      setScheduleInput('');
      alert('推送任务已创建，已加入待推送预览，可继续创建下一条');
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  }

  async function handlePushNow() {
    if (!pushOptions.pushIncludeNotice && !pushOptions.pushIncludeDuty) {
      alert('请至少勾选一项推送内容');
      return;
    }
    const messageCount = countPushMessages(pushOptions);
    const labels = getPushMessageLabels(pushOptions);
    const tip = buildConfirmTip('将立即推送', messageCount, labels);
    if (!window.confirm(tip)) return;

    setPushing(true);
    try {
      const res = await financeNoticeApi.pushNow({
        ...buildTaskPayload(''),
        saveBeforePush: false,
      });
      onTasksChange(res.tasks || tasks);
      await onLogsRefresh();
      alert(`已推送 ${messageCount} 条消息到钉钉群`);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '推送失败');
    } finally {
      setPushing(false);
    }
  }

  async function handleCancelTask(taskId: string) {
    if (!window.confirm('确定取消该待推送任务？取消后不会推送到钉钉群。')) return;
    setCancellingId(taskId);
    try {
      const res = await financeNoticeApi.cancelPushTask(taskId);
      onTasksChange(res.tasks);
      await onLogsRefresh();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '取消失败');
    } finally {
      setCancellingId(null);
    }
  }

  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const pendingMessageCount = getTotalPendingMessageCount(pendingTasks);
  const selectedPushLabels = getPushMessageLabels(pushOptions);
  const selectedPushCount = countPushMessages(pushOptions);

  return (
    <div className="space-y-6">
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="text-lg">创建推送任务</CardTitle>
          <CardDescription>
            每次保存为独立任务，不会覆盖已有任务；勾选并编辑内容、设定时间后点保存。通知与值班表各发一条消息。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="taskPushNotice"
                checked={pushOptions.pushIncludeNotice}
                onCheckedChange={(checked) =>
                  setPushOptions({ ...pushOptions, pushIncludeNotice: checked === true })
                }
              />
              <Label htmlFor="taskPushNotice" className="cursor-pointer font-normal">
                推送通知
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="taskPushDuty"
                checked={pushOptions.pushIncludeDuty}
                onCheckedChange={(checked) => handlePushIncludeDutyChange(checked === true)}
              />
              <Label htmlFor="taskPushDuty" className="cursor-pointer font-normal">
                推送值班表
              </Label>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            当前勾选：
            {selectedPushCount > 0
              ? `${selectedPushLabels.join('、')}（${selectedPushCount} 条消息）`
              : '未选择任何内容'}
            。仅填写通知内容不会自动排除值班表，请确认上方「推送值班表」为未勾选。
          </p>

          {pushOptions.pushIncludeNotice && (
            <div className="space-y-2">
              <Label htmlFor="taskNoticeText">通知内容</Label>
              <Textarea
                id="taskNoticeText"
                rows={8}
                className="min-h-[180px] font-normal leading-relaxed"
                value={taskContent.noticeText}
                onChange={(e) =>
                  setTaskContent({ ...taskContent, noticeText: e.target.value })
                }
              />
            </div>
          )}

          {pushOptions.pushIncludeDuty && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>值班表</Label>
                <Button type="button" variant="outline" size="sm" onClick={addDutyRow}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  添加行
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">值班日期</TableHead>
                    <TableHead>值班人员</TableHead>
                    <TableHead>联系电话</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taskContent.dutyRoster.map((row, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Input
                          value={row.date}
                          placeholder="2026/8/22"
                          onChange={(e) => updateDuty(index, 'date', e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.name}
                          onChange={(e) => updateDuty(index, 'name', e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.phone}
                          onChange={(e) => updateDuty(index, 'phone', e.target.value)}
                        />
                      </TableCell>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="space-y-2">
              <Label htmlFor="taskScheduleAt">推送时间</Label>
              <Input
                id="taskScheduleAt"
                type="datetime-local"
                className="w-[220px]"
                value={scheduleInput}
                onChange={(e) => setScheduleInput(e.target.value)}
              />
            </div>
            <Button onClick={handleCreateTask} disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              <CalendarClock className="mr-2 h-4 w-4" />
              保存推送任务
            </Button>
            <Button variant="secondary" onClick={handlePushNow} disabled={pushing}>
              {pushing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              立即推送
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-blue-200/80 bg-blue-50/25">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-blue-900">
            <Eye className="h-5 w-5" />
            待推送内容预览
          </CardTitle>
          <CardDescription>
            已保存的任务会保留在此；不需要推送的任务可点「取消推送」
          </CardDescription>
          <p className="text-xs text-blue-800/80">
            共 {pendingTasks.length} 个待推送任务
            {pendingMessageCount > 0 ? `，合计 ${pendingMessageCount} 条消息` : ''}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {pendingTasks.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无待推送内容，请在上方创建任务</p>
          )}

          {pendingTasks.map((task, index) => {
            const { content, pushOptions: opts } = taskPreviewContent(task);
            return (
              <div
                key={task.id}
                className="rounded-lg border border-blue-100 bg-white/90 p-4 shadow-sm"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium text-blue-900">任务 {index + 1}</span>
                    <span className="mx-2 text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      计划 {formatDateTime(task.scheduledAt)}
                    </span>
                    <span className="mx-2 text-muted-foreground">·</span>
                    <span className="text-blue-800/80">
                      {getPushMessageLabels(opts).join('、')} {countPushMessages(opts)} 条
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={cancellingId === task.id}
                    onClick={() => handleCancelTask(task.id)}
                  >
                    {cancellingId === task.id ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : null}
                    取消推送
                  </Button>
                </div>
                <FinanceNoticePreviewBody content={content} pushOptions={opts} />
              </div>
            );
          })}

        </CardContent>
      </Card>
    </div>
  );
}
