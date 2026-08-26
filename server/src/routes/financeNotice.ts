import { Router } from "express";

import { authMiddleware } from "../auth";

import { requireModuleEdit, requireModuleView } from "../middleware";

import {

  cancelFinanceNoticeSchedule,

  cancelFinanceNoticePushTask,

  createFinanceNoticePushTask,

  getFinanceNoticeConfig,

  getFinanceNoticePushLogs,

  getFinanceNoticePushTasks,

  pushFinanceNoticeNow,

  scheduleFinanceNoticePush,

  updateFinanceNoticeContent,

  updateFinanceNoticeSection,

  type CreateFinanceNoticePushTaskInput,

  type FinanceNoticeContent,

  type FinanceNoticePushOptions,

  type FinanceNoticeSection,

} from "../services/financeNotice";



const router = Router();

router.use(authMiddleware);



router.get(

  "/finance-notice",

  requireModuleView("finance_notice"),

  (_req, res) => {

    res.json({

      config: getFinanceNoticeConfig(),

      logs: getFinanceNoticePushLogs(30),

      tasks: getFinanceNoticePushTasks(50),

    });

  },

);



router.put(

  "/finance-notice",

  requireModuleEdit("finance_notice"),

  (req, res) => {

    const body = req.body as Partial<FinanceNoticeContent> & { section?: FinanceNoticeSection };

    const section = body.section;

    let config;

    if (section === "notice") {

      config = updateFinanceNoticeSection(

        "notice",

        { noticeText: String(body.noticeText ?? "") },

        req.user!.name,

      );

    } else if (section === "duty") {

      config = updateFinanceNoticeSection(

        "duty",

        { dutyRoster: Array.isArray(body.dutyRoster) ? body.dutyRoster : [] },

        req.user!.name,

      );

    } else {

      const content: FinanceNoticeContent = {

        noticeText: String(body.noticeText || ""),

        dutyRoster: Array.isArray(body.dutyRoster) ? body.dutyRoster : [],

      };

      config = updateFinanceNoticeContent(content, req.user!.name);

    }

    res.json({ config, logs: getFinanceNoticePushLogs(30), tasks: getFinanceNoticePushTasks(50) });

  },

);



router.post(

  "/finance-notice/schedule",

  requireModuleEdit("finance_notice"),

  (req, res) => {

    const scheduledAt = String(req.body?.scheduledAt || "");

    if (!scheduledAt) {

      return res.status(400).json({ error: "请填写推送时间" });

    }

    const pushOptions: FinanceNoticePushOptions = {

      pushIncludeNotice: req.body?.pushIncludeNotice !== false,

      pushIncludeDuty: req.body?.pushIncludeDuty !== false,

    };

    if (!pushOptions.pushIncludeNotice && !pushOptions.pushIncludeDuty) {

      return res.status(400).json({ error: "请至少选择一项推送内容" });

    }

    try {

      const config = scheduleFinanceNoticePush(scheduledAt, req.user!.name, pushOptions);

      res.json({ config, logs: getFinanceNoticePushLogs(30), tasks: getFinanceNoticePushTasks(50) });

    } catch (e: unknown) {

      const msg = e instanceof Error ? e.message : "设置失败";

      res.status(400).json({ error: msg });

    }

  },

);



router.delete(

  "/finance-notice/schedule",

  requireModuleEdit("finance_notice"),

  (_req, res) => {

    const config = cancelFinanceNoticeSchedule(_req.user!.name);

    res.json({ config, logs: getFinanceNoticePushLogs(30), tasks: getFinanceNoticePushTasks(50) });

  },

);



router.post(

  "/finance-notice/push-now",

  requireModuleEdit("finance_notice"),

  async (req, res) => {

    try {

      const body = req.body as Partial<

        FinanceNoticeContent & FinanceNoticePushOptions & { saveBeforePush?: boolean }

      >;

      const pushOptions: FinanceNoticePushOptions = {

        pushIncludeNotice: body.pushIncludeNotice !== false,

        pushIncludeDuty: body.pushIncludeDuty !== false,

      };

      if (!pushOptions.pushIncludeNotice && !pushOptions.pushIncludeDuty) {

        return res.status(400).json({ error: "请至少选择一项推送内容" });

      }



      const hasContentOverride =

        body &&

        (typeof body.noticeText === "string" || Array.isArray(body.dutyRoster));



      if (body.saveBeforePush !== false && hasContentOverride) {

        if (pushOptions.pushIncludeNotice && typeof body.noticeText === "string") {

          updateFinanceNoticeSection(

            "notice",

            { noticeText: body.noticeText },

            req.user!.name,

          );

        }

        if (pushOptions.pushIncludeDuty && Array.isArray(body.dutyRoster)) {

          updateFinanceNoticeSection(

            "duty",

            { dutyRoster: body.dutyRoster },

            req.user!.name,

          );

        }

      }



      let overrideContent: FinanceNoticeContent | undefined;

      if (hasContentOverride) {

        const saved = getFinanceNoticeConfig();

        overrideContent = {

          noticeText: pushOptions.pushIncludeNotice

            ? String(body.noticeText ?? saved.noticeText)

            : saved.noticeText,

          dutyRoster: pushOptions.pushIncludeDuty

            ? Array.isArray(body.dutyRoster)

              ? body.dutyRoster

              : saved.dutyRoster

            : saved.dutyRoster,

        };

      }



      const config = await pushFinanceNoticeNow(req.user!.name, overrideContent, pushOptions);

      res.json({ config, logs: getFinanceNoticePushLogs(30), tasks: getFinanceNoticePushTasks(50) });

    } catch (e: unknown) {

      const msg = e instanceof Error ? e.message : "推送失败";

      res.status(400).json({ error: msg });

    }

  },

);



router.post(

  "/finance-notice/push-tasks",

  requireModuleEdit("finance_notice"),

  (req, res) => {

    const body = req.body as Partial<CreateFinanceNoticePushTaskInput>;

    const input: CreateFinanceNoticePushTaskInput = {

      noticeText: String(body.noticeText ?? ""),

      dutyRoster: Array.isArray(body.dutyRoster) ? body.dutyRoster : [],

      pushIncludeNotice: body.pushIncludeNotice !== false,

      pushIncludeDuty: body.pushIncludeDuty !== false,

      scheduledAt: String(body.scheduledAt || ""),

    };

    if (!input.scheduledAt) {

      return res.status(400).json({ error: "请填写推送时间" });

    }

    try {

      const task = createFinanceNoticePushTask(input, req.user!.name);

      res.json({

        config: getFinanceNoticeConfig(),

        logs: getFinanceNoticePushLogs(30),

        tasks: getFinanceNoticePushTasks(50),

        task,

      });

    } catch (e: unknown) {

      const msg = e instanceof Error ? e.message : "创建失败";

      res.status(400).json({ error: msg });

    }

  },

);



router.delete(

  "/finance-notice/push-tasks/:id",

  requireModuleEdit("finance_notice"),

  (req, res) => {

    try {

      const task = cancelFinanceNoticePushTask(String(req.params.id), req.user!.name);

      res.json({

        config: getFinanceNoticeConfig(),

        logs: getFinanceNoticePushLogs(30),

        tasks: getFinanceNoticePushTasks(50),

        task,

      });

    } catch (e: unknown) {

      const msg = e instanceof Error ? e.message : "取消失败";

      res.status(400).json({ error: msg });

    }

  },

);



export default router;

