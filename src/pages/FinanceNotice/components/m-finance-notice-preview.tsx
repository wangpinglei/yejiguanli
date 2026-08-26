import { Megaphone, Users } from 'lucide-react';

import type {
  FinanceNoticeContent,
  FinanceNoticePushOptions,
} from '@/types/financeNoticeTypes';

import {
  countPushMessages,
  getPushMessageLabels,
  normalizePushOptions,
} from '@/types/financeNoticeTypes';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PreviewBodyProps {
  content: FinanceNoticeContent;
  pushOptions: FinanceNoticePushOptions;
}

export function FinanceNoticePreviewBody({ content, pushOptions }: PreviewBodyProps) {
  const dutyRoster = content.dutyRoster.filter((row) => row.date || row.name || row.phone);
  const normalized = normalizePushOptions(pushOptions);
  const showNotice = normalized.pushIncludeNotice;
  const showDuty = normalized.pushIncludeDuty;

  return (
    <div className="space-y-5 text-sm leading-relaxed">
      {showNotice && (
        <section>
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <Megaphone className="h-4 w-4 text-amber-600" />
            一、通知
          </h3>
          <p className="whitespace-pre-wrap text-foreground/90">
            {content.noticeText?.trim() || '（未填写通知内容）'}
          </p>
        </section>
      )}

      {showNotice && showDuty && <hr className="border-dashed" />}

      {showDuty && (
        <section>
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <Users className="h-4 w-4" />
            二、值班表
          </h3>
          {dutyRoster.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>值班日期</TableHead>
                  <TableHead>值班人员</TableHead>
                  <TableHead>联系电话</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dutyRoster.map((row, index) => (
                  <TableRow key={`${row.date}-${index}`}>
                    <TableCell>{row.date || '-'}</TableCell>
                    <TableCell>{row.name || '-'}</TableCell>
                    <TableCell>{row.phone || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground">（未填写值班人员）</p>
          )}
        </section>
      )}

      {!showNotice && !showDuty && (
        <p className="text-muted-foreground">请勾选要推送的板块</p>
      )}
    </div>
  );
}

interface Props {
  content: FinanceNoticeContent;
  pushOptions: FinanceNoticePushOptions;
  isDraft?: boolean;
  showMessageCount?: boolean;
}

export default function MFinanceNoticePreview({
  content,
  pushOptions,
  isDraft = false,
  showMessageCount = false,
}: Props) {
  const includeLabels = getPushMessageLabels(pushOptions);
  const messageCount = countPushMessages(pushOptions);

  return (
    <div className="rounded-lg border border-blue-100 bg-white/90 p-4">
      <p className="mb-3 text-xs text-blue-800/80">
        {isDraft ? '当前编辑' : '推送内容'}：
        {includeLabels.length
          ? showMessageCount
            ? `${includeLabels.join('、')} ${messageCount} 条`
            : includeLabels.join('、')
          : '未选择任何板块'}
        {showMessageCount && messageCount > 1 ? '（分条发送）' : ''}
      </p>
      <FinanceNoticePreviewBody content={content} pushOptions={pushOptions} />
    </div>
  );
}

export function getTotalPendingMessageCount(
  tasks: Array<{ pushIncludeNotice: boolean; pushIncludeDuty: boolean }>,
): number {
  return tasks.reduce(
    (sum, task) => sum + countPushMessages(normalizePushOptions(task)),
    0,
  );
}
