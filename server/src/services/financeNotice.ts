import { getDb, generateId } from "../db";

export interface FinanceDutyRow {
  date: string;
  name: string;
  phone: string;
}

export type FinancePushStatus = "none" | "scheduled" | "sent" | "failed";

export type FinanceNoticeSection = "notice" | "duty";

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
  status: "sent" | "failed";
  error: string | null;
  snapshot: FinanceNoticeContent;
  pushIncludeNotice: boolean;
  pushIncludeDuty: boolean;
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

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 旧版多字段合并为通知正文 */
function legacyRowToNoticeText(row: Record<string, unknown>): string {
  const parts: string[] = [];
  const title = String(row.esign_title || "").trim();
  const intro = String(row.esign_intro || "").trim();
  const closing = String(row.esign_closing || "").trim();
  const deadline = String(row.deadline_text || "").trim();
  const followItems = parseJson<Array<{ label?: string; text?: string }>>(
    String(row.followups_json || "[]"),
    [],
  );

  if (title) parts.push(title);
  if (intro) parts.push(intro);
  if (followItems.length) {
    parts.push("在此基础上，也请及时跟进签约进度：");
    followItems.forEach((item) => {
      if (item.label || item.text) {
        parts.push(`- ${item.label || ""}：${item.text || ""}`);
      }
    });
  }
  if (closing) parts.push(closing);
  if (deadline) parts.push(deadline);
  return parts.join("\n\n").trim();
}

function normalizeSnapshot(raw: Record<string, unknown>): FinanceNoticeContent {
  if (typeof raw.noticeText === "string") {
    return {
      noticeText: raw.noticeText,
      dutyRoster: Array.isArray(raw.dutyRoster) ? (raw.dutyRoster as FinanceDutyRow[]) : [],
    };
  }
  return {
    noticeText: legacyRowToNoticeText(raw),
    dutyRoster: Array.isArray(raw.dutyRoster) ? (raw.dutyRoster as FinanceDutyRow[]) : [],
  };
}

function rowToConfig(row: Record<string, unknown>): FinanceNoticeConfig {
  const noticeFromCol = String(row.notice_text || "").trim();
  const noticeText = noticeFromCol || legacyRowToNoticeText(row);

  return {
    noticeText,
    dutyRoster: parseJson<FinanceDutyRow[]>(String(row.duty_roster_json || "[]"), []),
    pushIncludeNotice: row.push_include_notice !== 0,
    pushIncludeDuty: row.push_include_duty !== 0,
    scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
    pushStatus: (String(row.push_status || "none") as FinancePushStatus) || "none",
    pushedAt: row.pushed_at ? String(row.pushed_at) : null,
    pushError: row.push_error ? String(row.push_error) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

function contentFromRow(row: Record<string, unknown>): FinanceNoticeContent {
  const cfg = rowToConfig(row);
  return {
    noticeText: cfg.noticeText,
    dutyRoster: cfg.dutyRoster,
  };
}

export function getFinanceNoticeConfig(): FinanceNoticeConfig {
  const db = getDb();
  const row = db.prepare("SELECT * FROM finance_notice_config WHERE id='default'").get() as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error("财务通知配置未初始化");
  }
  return rowToConfig(row);
}

export function getFinanceNoticePushLogs(limit = 20): FinanceNoticePushLog[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM finance_notice_push_logs ORDER BY pushed_at DESC LIMIT ?")
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    pushedAt: String(row.pushed_at || ""),
    scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
    operator: String(row.operator || ""),
    status: String(row.status) === "failed" ? "failed" : "sent",
    error: row.error ? String(row.error) : null,
    snapshot: normalizeSnapshot(parseJson(String(row.snapshot_json || "{}"), {})),
    pushIncludeNotice: row.push_include_notice !== 0,
    pushIncludeDuty: row.push_include_duty !== 0,
  }));
}

export function updateFinanceNoticeContent(
  content: FinanceNoticeContent,
  operator: string,
): FinanceNoticeConfig {
  const db = getDb();
  db.prepare(`
    UPDATE finance_notice_config SET
      notice_text=?, duty_roster_json=?, updated_by=?, updated_at=datetime('now')
    WHERE id='default'
  `).run(
    content.noticeText || "",
    JSON.stringify(content.dutyRoster || []),
    operator,
  );
  return getFinanceNoticeConfig();
}

export function updateFinanceNoticeSection(
  section: FinanceNoticeSection,
  partial: Partial<FinanceNoticeContent>,
  operator: string,
): FinanceNoticeConfig {
  const current = getFinanceNoticeConfig();
  const content: FinanceNoticeContent = {
    noticeText:
      section === "notice" ? String(partial.noticeText ?? "") : current.noticeText,
    dutyRoster:
      section === "duty"
        ? Array.isArray(partial.dutyRoster)
          ? partial.dutyRoster
          : current.dutyRoster
        : current.dutyRoster,
  };
  return updateFinanceNoticeContent(content, operator);
}

export function updateFinanceNoticePushOptions(
  options: FinanceNoticePushOptions,
  operator: string,
): FinanceNoticeConfig {
  const db = getDb();
  db.prepare(`
    UPDATE finance_notice_config SET
      push_include_notice=?, push_include_duty=?, updated_by=?, updated_at=datetime('now')
    WHERE id='default'
  `).run(options.pushIncludeNotice ? 1 : 0, options.pushIncludeDuty ? 1 : 0, operator);
  return getFinanceNoticeConfig();
}

export function scheduleFinanceNoticePush(
  scheduledAt: string,
  operator: string,
  pushOptions?: FinanceNoticePushOptions,
): FinanceNoticeConfig {
  const db = getDb();
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) {
    throw new Error("推送时间格式无效");
  }
  if (at.getTime() <= Date.now()) {
    throw new Error("推送时间须晚于当前时间");
  }
  if (pushOptions) {
    updateFinanceNoticePushOptions(pushOptions, operator);
  }
  db.prepare(`
    UPDATE finance_notice_config SET
      scheduled_at=?, push_status='scheduled', push_error='', updated_by=?, updated_at=datetime('now')
    WHERE id='default'
  `).run(scheduledAt, operator);
  return getFinanceNoticeConfig();
}

export function cancelFinanceNoticeSchedule(operator: string): FinanceNoticeConfig {
  const db = getDb();
  db.prepare(`
    UPDATE finance_notice_config SET
      scheduled_at=NULL, push_status='none', push_error='', updated_by=?, updated_at=datetime('now')
    WHERE id='default' AND push_status='scheduled'
  `).run(operator);
  return getFinanceNoticeConfig();
}

function getWebhookUrls(): string[] {
  const multi = (process.env.FINANCE_NOTICE_WEBHOOK_URLS || "").trim();
  const single = (process.env.FINANCE_NOTICE_WEBHOOK_URL || "").trim();
  const list = multi
    ? multi.split(",").map((s) => s.trim()).filter(Boolean)
    : single
      ? [single]
      : [];
  return list;
}

export function buildFinanceNoticeMarkdown(
  content: FinanceNoticeContent,
  options?: FinanceNoticePushOptions,
): string {
  const includeNotice = options?.pushIncludeNotice !== false;
  const includeDuty = options?.pushIncludeDuty !== false;
  const dutyLines = (content.dutyRoster || [])
    .filter((row) => row.date || row.name || row.phone)
    .map((row) => `| ${row.date} | ${row.name} | ${row.phone} |`)
    .join("\n");

  const parts: string[] = [];

  if (includeNotice) {
    parts.push("### 财务通知", "", content.noticeText?.trim() || "（暂无通知内容）");
  }

  if (includeNotice && includeDuty) {
    parts.push("", "---", "");
  }

  if (includeDuty) {
    parts.push(
      "**财务部值班表**",
      "",
      "| 值班日期 | 值班人员 | 联系电话 |",
      "| --- | --- | --- |",
      dutyLines || "| - | - | - |",
    );
  }

  if (!includeNotice && !includeDuty) {
    return "（未选择推送内容）";
  }

  return parts.join("\n");
}

async function sendMarkdownToWebhook(webhook: string, title: string, text: string) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { title, text },
    }),
  });
  const raw = await res.text();
  let data: { errcode?: number; errmsg?: string } = {};
  try {
    data = JSON.parse(raw);
  } catch {
  }
  if (!res.ok) {
    throw new Error(raw.slice(0, 200) || `HTTP ${res.status}`);
  }
  if (data.errcode && data.errcode !== 0) {
    throw new Error(data.errmsg || JSON.stringify(data));
  }
}

export async function pushFinanceNoticeToDingTalk(
  content: FinanceNoticeContent,
  operator: string,
  scheduledAt: string | null,
  pushOptions?: FinanceNoticePushOptions,
): Promise<void> {
  const options: FinanceNoticePushOptions = {
    pushIncludeNotice: pushOptions?.pushIncludeNotice !== false,
    pushIncludeDuty: pushOptions?.pushIncludeDuty !== false,
  };
  if (!options.pushIncludeNotice && !options.pushIncludeDuty) {
    throw new Error("请至少选择一项推送内容");
  }
  const webhooks = getWebhookUrls();
  if (webhooks.length === 0) {
    throw new Error("未配置 FINANCE_NOTICE_WEBHOOK_URL，请联系管理员在服务器设置钉钉机器人地址");
  }
  const title = options.pushIncludeNotice && !options.pushIncludeDuty
    ? "财务通知"
    : !options.pushIncludeNotice && options.pushIncludeDuty
      ? "财务部值班表"
      : "财务通知";
  const text = buildFinanceNoticeMarkdown(content, options);
  const errors: string[] = [];
  for (const webhook of webhooks) {
    try {
      await sendMarkdownToWebhook(webhook, title, text);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
    }
  }
  const db = getDb();
  const id = generateId("fnp");
  const status = errors.length === webhooks.length ? "failed" : "sent";
  const errorText = errors.join("; ");
  db.prepare(`
    INSERT INTO finance_notice_push_logs (
      id, snapshot_json, scheduled_at, operator, status, error,
      push_include_notice, push_include_duty
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    JSON.stringify(content),
    scheduledAt,
    operator,
    status,
    errorText,
    options.pushIncludeNotice ? 1 : 0,
    options.pushIncludeDuty ? 1 : 0,
  );
  if (status === "failed") {
    db.prepare(`
      UPDATE finance_notice_config SET
        push_status='failed', push_error=?, scheduled_at=NULL, updated_at=datetime('now')
      WHERE id='default'
    `).run(errorText);
    throw new Error(errorText || "钉钉推送失败");
  }
  db.prepare(`
    UPDATE finance_notice_config SET
      push_status='sent', pushed_at=datetime('now'), push_error=?, scheduled_at=NULL,
      updated_by=?, updated_at=datetime('now')
    WHERE id='default'
  `).run(errors.length ? `部分群推送失败: ${errorText}` : "", operator);
}

export async function pushFinanceNoticeNow(
  operator: string,
  overrideContent?: FinanceNoticeContent,
  pushOptions?: FinanceNoticePushOptions,
): Promise<FinanceNoticeConfig> {
  const db = getDb();
  const row = db.prepare("SELECT * FROM finance_notice_config WHERE id='default'").get() as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("财务通知配置不存在");
  const config = rowToConfig(row);
  const content = overrideContent ?? contentFromRow(row);
  const options: FinanceNoticePushOptions = pushOptions ?? {
    pushIncludeNotice: config.pushIncludeNotice,
    pushIncludeDuty: config.pushIncludeDuty,
  };
  await pushFinanceNoticeToDingTalk(content, operator, null, options);
  return getFinanceNoticeConfig();
}

export async function processScheduledFinanceNoticePushes(): Promise<void> {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM finance_notice_config WHERE id='default' AND push_status='scheduled' AND scheduled_at IS NOT NULL",
    )
    .get() as Record<string, unknown> | undefined;
  if (!row) return;
  const scheduledAt = String(row.scheduled_at || "");
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now()) return;
  const content = contentFromRow(row);
  const pushOptions: FinanceNoticePushOptions = {
    pushIncludeNotice: row.push_include_notice !== 0,
    pushIncludeDuty: row.push_include_duty !== 0,
  };
  try {
    await pushFinanceNoticeToDingTalk(content, "系统自动推送", scheduledAt, pushOptions);
    console.log(`[finance-notice] 定时推送成功 scheduled_at=${scheduledAt}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[finance-notice] 定时推送失败: ${msg}`);
  }
}

export function startFinanceNoticeScheduler() {
  const intervalMs = Number(process.env.FINANCE_NOTICE_POLL_MS || 30000);
  setInterval(() => {
    processScheduledFinanceNoticePushes().catch((e) => {
      console.error("[finance-notice] scheduler error", e);
    });
  }, intervalMs);
  processScheduledFinanceNoticePushes().catch(() => {});
}

export function migrateFinanceNoticeTextColumn() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(finance_notice_config)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("notice_text")) {
    db.exec("ALTER TABLE finance_notice_config ADD COLUMN notice_text TEXT DEFAULT ''");
  }
  if (!colNames.has("push_include_notice")) {
    db.exec("ALTER TABLE finance_notice_config ADD COLUMN push_include_notice INTEGER DEFAULT 1");
  }
  if (!colNames.has("push_include_duty")) {
    db.exec("ALTER TABLE finance_notice_config ADD COLUMN push_include_duty INTEGER DEFAULT 1");
  }
  const logCols = db.prepare("PRAGMA table_info(finance_notice_push_logs)").all() as Array<{ name: string }>;
  const logColNames = new Set(logCols.map((c) => c.name));
  if (!logColNames.has("push_include_notice")) {
    db.exec("ALTER TABLE finance_notice_push_logs ADD COLUMN push_include_notice INTEGER DEFAULT 1");
  }
  if (!logColNames.has("push_include_duty")) {
    db.exec("ALTER TABLE finance_notice_push_logs ADD COLUMN push_include_duty INTEGER DEFAULT 1");
  }
  const row = db.prepare("SELECT * FROM finance_notice_config WHERE id='default'").get() as
    | Record<string, unknown>
    | undefined;
  if (!row) return;
  const current = String(row.notice_text || "").trim();
  if (!current) {
    const merged = legacyRowToNoticeText(row);
    if (merged) {
      db.prepare("UPDATE finance_notice_config SET notice_text=? WHERE id='default'").run(merged);
    }
  }
}
