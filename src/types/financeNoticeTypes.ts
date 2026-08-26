export interface FinanceDutyRow {
  date: string;
  name: string;
  phone: string;
}

export type FinancePushStatus = 'none' | 'scheduled' | 'sent' | 'failed';

export type FinanceNoticeSection = 'notice' | 'duty';

export interface FinanceNoticePushOptions {
  pushIncludeNotice: boolean;
  pushIncludeDuty: boolean;
}

export interface FinanceNoticeContent {
  noticeText: string;
  dutyRoster: FinanceDutyRow[];
}

export interface FinanceNoticeConfig extends FinanceNoticeContent, FinanceNoticePushOptions {
  scheduledAt: string | null;
  pushStatus: FinancePushStatus;
  pushedAt: string | null;
  pushError: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface FinanceNoticePushLog {
  id: string;
  pushedAt: string;
  scheduledAt: string | null;
  operator: string;
  status: 'sent' | 'failed';
  error: string | null;
  snapshot: FinanceNoticeContent;
  pushIncludeNotice?: boolean;
  pushIncludeDuty?: boolean;
}

export type FinanceNoticePushTaskStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export interface FinanceNoticePushTask {
  id: string;
  noticeText: string;
  dutyRoster: FinanceDutyRow[];
  pushIncludeNotice: boolean;
  pushIncludeDuty: boolean;
  scheduledAt: string;
  status: FinanceNoticePushTaskStatus;
  pushError: string | null;
  pushedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreateFinanceNoticePushTaskInput {
  noticeText: string;
  dutyRoster: FinanceDutyRow[];
  pushIncludeNotice: boolean;
  pushIncludeDuty: boolean;
  scheduledAt: string;
}

export interface FinanceNoticeResponse {
  config: FinanceNoticeConfig;
  logs: FinanceNoticePushLog[];
  tasks: FinanceNoticePushTask[];
}

export function countPushMessages(options: FinanceNoticePushOptions): number {
  let count = 0;
  if (options.pushIncludeNotice) count += 1;
  if (options.pushIncludeDuty) count += 1;
  return count;
}

export function getPushMessageLabels(options: FinanceNoticePushOptions): string[] {
  const labels: string[] = [];
  if (options.pushIncludeNotice) labels.push('通知');
  if (options.pushIncludeDuty) labels.push('值班表');
  return labels;
}

export const DEFAULT_NOTICE_TEXT = `【本周电子签温馨提醒】🤪🤪🤪

主动向客户传递公司背景，能有效增强信任——建议您在发起或跟进电子签时，顺带说明：「我们使用的是国家认可的电子签平台，合同合法有效，流程规范透明。」客户了解得越清楚，签约越放心！💪

在此基础上，也请及时跟进签约进度：
- 已发起未签：客户可能只是暂时忙忘了，一次善意的提醒往往就能推动完成。
- 未发起签约：机会不等人，现在就发起，让客户第一时间收到邀请。
- 已过期未签：请主动了解原因，反馈至财务登记。
- 遇到问题：随时联系财务部小伙伴协助 🤝

感谢大家的配合！！！👏👏👏

8月生态圈录单截止时间为「9月2日24:00前」，请所有成交人员在规定时间内录好各自订单（包括电子合同的签署、收款/备注的填写规范！！）`;

export function createEmptyFinanceNoticeForm(): FinanceNoticeContent {
  return {
    noticeText: '',
    dutyRoster: [{ date: '', name: '', phone: '' }],
  };
}

export function configToForm(config: FinanceNoticeConfig): FinanceNoticeContent {
  return {
    noticeText: config.noticeText || '',
    dutyRoster: config.dutyRoster.length
      ? config.dutyRoster
      : [{ date: '', name: '', phone: '' }],
  };
}

/** 兼容旧版多字段快照 */
export function normalizeNoticeContent(raw: Record<string, unknown>): FinanceNoticeContent {
  if (typeof raw.noticeText === 'string') {
    return {
      noticeText: raw.noticeText,
      dutyRoster: Array.isArray(raw.dutyRoster) ? (raw.dutyRoster as FinanceDutyRow[]) : [],
    };
  }
  const parts: string[] = [];
  if (raw.esignTitle) parts.push(String(raw.esignTitle));
  if (raw.esignIntro) parts.push(String(raw.esignIntro));
  const items = Array.isArray(raw.followUpItems) ? raw.followUpItems : [];
  if (items.length) {
    parts.push('\n在此基础上，也请及时跟进签约进度：');
    items.forEach((item: { label?: string; text?: string }) => {
      if (item?.label || item?.text) parts.push(`- ${item.label || ''}：${item.text || ''}`);
    });
  }
  if (raw.esignClosing) parts.push(String(raw.esignClosing));
  if (raw.deadlineText) parts.push(String(raw.deadlineText));
  return {
    noticeText: parts.join('\n\n').trim(),
    dutyRoster: Array.isArray(raw.dutyRoster) ? (raw.dutyRoster as FinanceDutyRow[]) : [],
  };
}

export function localInputToIso(localValue: string): string {
  if (!localValue) return '';
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
