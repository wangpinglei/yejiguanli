import { History } from 'lucide-react';

import { formatDateTime } from '@/lib/format';

import type { FinanceNoticePushLog, FinanceNoticePushTask } from '@/types/financeNoticeTypes';

import { getPushMessageLabels } from '@/types/financeNoticeTypes';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '待推送',
  sent: '已推送',
  failed: '推送失败',
  cancelled: '已取消',
};

interface Props {
  logs: FinanceNoticePushLog[];
  tasks: FinanceNoticePushTask[];
}

export default function MFinanceNoticePushHistory({ logs, tasks }: Props) {
  const historyTasks = tasks
    .filter((t) => t.status !== 'pending')
    .sort((a, b) => {
      const ta = new Date(a.pushedAt || a.scheduledAt).getTime();
      const tb = new Date(b.pushedAt || b.scheduledAt).getTime();
      return tb - ta;
    });

  const isEmpty = logs.length === 0 && historyTasks.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5" />
          历史推送记录
        </CardTitle>
        <CardDescription>已执行的钉钉推送与定时任务记录</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isEmpty ? (
          <p className="text-sm text-muted-foreground">暂无历史推送记录</p>
        ) : (
          <>
            {logs.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">推送明细</p>
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
                      if (log.pushIncludeNotice === true) contentParts.push('通知');
                      if (log.pushIncludeDuty === true) contentParts.push('值班表');
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
              </div>
            )}

            {historyTasks.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">定时任务</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>计划时间</TableHead>
                      <TableHead>内容</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>创建人</TableHead>
                      <TableHead>备注</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyTasks.map((task) => {
                      const opts = {
                        pushIncludeNotice: task.pushIncludeNotice,
                        pushIncludeDuty: task.pushIncludeDuty,
                      };
                      return (
                        <TableRow key={task.id}>
                          <TableCell>{formatDateTime(task.scheduledAt)}</TableCell>
                          <TableCell>{getPushMessageLabels(opts).join('、') || '—'}</TableCell>
                          <TableCell>
                            {TASK_STATUS_LABEL[task.status] || task.status}
                          </TableCell>
                          <TableCell>{task.createdBy || '—'}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {task.pushError ||
                              (task.pushedAt ? `推送于 ${formatDateTime(task.pushedAt)}` : '—')}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
