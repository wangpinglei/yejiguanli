import { useEffect, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { financeNoticeApi } from '@/lib/api';

import { usePermissions } from '@/hooks/usePermissions';

import type { FinanceNoticePushLog, FinanceNoticePushTask } from '@/types/financeNoticeTypes';

import MFinanceNoticePushHistory from './FinanceNotice/components/m-finance-notice-push-history';

import MFinanceNoticePushTaskPanel from './FinanceNotice/components/m-finance-notice-push-task-panel';

export default function FinanceNotice() {
  const { canEditFinanceNotice } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<FinanceNoticePushLog[]>([]);
  const [tasks, setTasks] = useState<FinanceNoticePushTask[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await financeNoticeApi.get();
      setLogs(res.logs);
      setTasks(res.tasks || []);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function refreshLogs() {
    const res = await financeNoticeApi.get();
    setLogs(res.logs);
    setTasks(res.tasks || []);
  }

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {canEditFinanceNotice && (
        <MFinanceNoticePushTaskPanel
          tasks={tasks}
          onTasksChange={setTasks}
          onLogsRefresh={refreshLogs}
        />
      )}

      <MFinanceNoticePushHistory logs={logs} tasks={tasks} />
    </div>
  );
}
