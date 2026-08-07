/**
 * 粘贴/合并进 /opt/dingtalk-push/src/index.js 的片段参考
 * （请按现有文件结构手工合并，避免覆盖进账/旧战报逻辑）
 */

/*
--- require 区增加 ---
const yejiBattleReport = require('./yejiBattleReport');
const yejiBattleReportScheduler = require('./yejiBattleReportScheduler');

--- 路由区增加（与现有 war-report 接口并列） ---
app.get('/api/yeji-battle/preview', async (req, res) => {
  try {
    const data = await yejiBattleReport.generatePreview(req.query.month);
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/yeji-battle/push', async (req, res) => {
  try {
    const result = await yejiBattleReport.pushAll({
      month: req.query.month || (req.body && req.body.month),
      force: String(req.query.force) === '1' || !!(req.body && req.body.force),
      slot: req.query.slot || 'manual',
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

--- 启动区增加 ---
yejiBattleReportScheduler.start();
*/
