import express from "express";
import cors from "cors";
import path from "path";
import { getDb } from "./db";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import salesUnitRoutes from "./routes/salesUnits";
import personnelRoutes from "./routes/personnel";
import productRoutes from "./routes/products";
import salesRecordRoutes from "./routes/salesRecords";
import costRecordRoutes from "./routes/costRecords";
import migrateRoutes from "./routes/migrate";
import extraRoutes from "./routes/extra";

const app = express();
const PORT = process.env.PORT || 3001;

// ===================== 中间件 =====================
app.use(cors({
  origin: true, // 允许所有来源（生产环境应限制为前端域名）
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));

// 请求日志
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ===================== API 路由 =====================
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/sales-units", salesUnitRoutes);
app.use("/api/personnel", personnelRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales-records", salesRecordRoutes);
app.use("/api/cost-records", costRecordRoutes);
app.use("/api/migrate", migrateRoutes);

// 健康检查与占位接口需在 /api 通配路由之前注册，避免被 extra 的鉴权中间件拦截
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 生态圈同步订单（占位：当前返回空列表，真实同步逻辑可在后续接入）
app.get("/api/synced-orders", (_req, res) => {
  res.json({ success: true, orders: [] });
});

app.use("/api", extraRoutes);

// ===================== 静态文件服务（生产环境） =====================
// 优先从 dist（vite 构建输出）提供静态文件
const publicDir = path.join(__dirname, "..", "..", "dist");
app.use(express.static(publicDir));

// SPA 回退：非 API 路由返回 index.html
app.get("*", (req, res, next) => {
  if (req.url.startsWith("/api/")) {
    return next();
  }
  res.sendFile(path.join(publicDir, "index.html"), (err) => {
    if (err) {
      // 开发环境下 dist 可能不存在，返回提示
      res.status(404).json({
        message: "前端构建产物未找到。请先运行 npm run build。",
        publicDir,
      });
    }
  });
});

// ===================== 错误处理 =====================
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[ERROR]", err);
  res.status(err.status || 500).json({ error: err.message || "服务器内部错误" });
});

// ===================== 启动 =====================
getDb(); // 初始化数据库

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`\n========================================`);
  console.log(`  业绩管理系统后端已启动`);
  console.log(`  API: http://localhost:${PORT}/api`);
  console.log(`  健康检查: http://localhost:${PORT}/api/health`);
  console.log(`  数据库: ${path.join(__dirname, "..", "data", "database.db")}`);
  console.log(`========================================\n`);
});
