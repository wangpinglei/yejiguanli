const http = require("http");
const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "..", "dist");
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "synced-orders.json");
const PORT = 5180;

// API Key for 生态圈 to authenticate (change in production)
const API_KEY = "eco-sync-2026-secret";

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure orders file exists
if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2), "utf-8");
}

// ===================== Data helpers =====================

function loadOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
}

function generateId() {
  return "sync_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

// ===================== API handlers =====================

function handleSyncOrders(body, apiKey) {
  // Validate API key
  if (apiKey !== API_KEY) {
    return { status: 401, data: { success: false, message: "API Key 无效" } };
  }

  let orders;
  try {
    orders = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return { status: 400, data: { success: false, message: "JSON 格式错误" } };
  }

  // Support both single order and array of orders
  const orderList = Array.isArray(orders) ? orders : (orders.orders ? orders.orders : [orders]);

  if (orderList.length === 0) {
    return { status: 400, data: { success: false, message: "订单数据为空" } };
  }

  const existing = loadOrders();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const order of orderList) {
    // Validate required fields
    if (!order.orderId) {
      skipped++;
      errors.push(`缺少 orderId 字段`);
      continue;
    }

    // Build synced order record
    const record = {
      id: generateId(),
      externalOrderId: String(order.orderId),
      synced: true,
      salesUnitId: String(order.salesUnitId || order.salesUnitName || ""),
      salesUnitName: String(order.salesUnitName || ""),
      personnelId: String(order.personnelId || order.salesPersonId || ""),
      salesPersonName: String(order.salesPersonName || ""),
      productId: String(order.productId || ""),
      productName: String(order.productName || ""),
      quantity: Number(order.quantity) || 1,
      unitPrice: Number(order.unitPrice) || 0,
      totalAmount: Number(order.totalAmount) || (Number(order.quantity) || 1) * (Number(order.unitPrice) || 0),
      saleDate: order.orderDate || order.saleDate || new Date().toISOString().slice(0, 10),
      customerName: String(order.customerName || ""),
      remark: String(order.remark || "生态圈同步"),
      syncedAt: new Date().toISOString(),
    };

    // Dedup by externalOrderId — update if exists, add if new
    const existIdx = existing.findIndex((o) => o.externalOrderId === record.externalOrderId);
    if (existIdx >= 0) {
      record.id = existing[existIdx].id; // Keep original ID
      record.syncedAt = existing[existIdx].syncedAt; // Keep original sync time
      record.updatedAt = new Date().toISOString();
      existing[existIdx] = record;
      updated++;
    } else {
      existing.push(record);
      added++;
    }
  }

  saveOrders(existing);

  return {
    status: 200,
    data: {
      success: true,
      message: `同步完成：新增 ${added} 笔，更新 ${updated} 笔，跳过 ${skipped} 笔`,
      added,
      updated,
      skipped,
      total: existing.length,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
}

function handleGetSyncedOrders(query) {
  const orders = loadOrders();

  // Optional filters
  let result = orders;
  if (query.yearMonth) {
    result = result.filter((o) => (o.saleDate || "").startsWith(query.yearMonth));
  }
  if (query.salesUnitName) {
    result = result.filter((o) => o.salesUnitName === query.salesUnitName);
  }

  return {
    status: 200,
    data: {
      success: true,
      count: result.length,
      orders: result,
    },
  };
}

function handleDeleteSyncedOrder(orderId, apiKey) {
  if (apiKey !== API_KEY) {
    return { status: 401, data: { success: false, message: "API Key 无效" } };
  }

  const orders = loadOrders();
  const filtered = orders.filter((o) => o.id !== orderId && o.externalOrderId !== orderId);

  if (filtered.length === orders.length) {
    return { status: 404, data: { success: false, message: "订单不存在" } };
  }

  saveOrders(filtered);
  return {
    status: 200,
    data: { success: true, message: "已删除", remaining: filtered.length },
  };
}

function handleClearSyncedOrders(apiKey) {
  if (apiKey !== API_KEY) {
    return { status: 401, data: { success: false, message: "API Key 无效" } };
  }
  saveOrders([]);
  return { status: 200, data: { success: true, message: "已清空所有同步订单" } };
}

// ===================== HTTP helpers =====================

function parseQuery(url) {
  const queryStr = url.split("?")[1];
  if (!queryStr) return {};
  const params = {};
  queryStr.split("&").forEach((pair) => {
    const [k, v] = pair.split("=");
    params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });
  return params;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

// ===================== Static file serving =====================

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  let filePath = path.join(DIST, urlPath);
  if (urlPath === "/" || urlPath === "") {
    filePath = path.join(DIST, "index.html");
  }

  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const ext = path.extname(urlPath);
    if (ext && ext !== ".html") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // SPA fallback
    const indexPath = path.join(DIST, "index.html");
    fs.stat(indexPath, (err2, stats2) => {
      if (err2 || !stats2.isFile()) {
        res.writeHead(404);
        res.end("index.html not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(indexPath).pipe(res);
    });
  });
}

// ===================== Main server =====================

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    });
    res.end();
    return;
  }

  const urlPath = req.url.split("?")[0];
  const query = parseQuery(req.url);
  const apiKey = req.headers["x-api-key"];

  // ===================== API Routes =====================
  if (urlPath === "/api/sync-orders" && req.method === "POST") {
    const body = await readBody(req);
    const result = handleSyncOrders(body, apiKey);
    sendJson(res, result.status, result.data);
    return;
  }

  if (urlPath === "/api/synced-orders" && req.method === "GET") {
    const result = handleGetSyncedOrders(query);
    sendJson(res, result.status, result.data);
    return;
  }

  if (urlPath.startsWith("/api/synced-orders/") && req.method === "DELETE") {
    const orderId = urlPath.split("/api/synced-orders/")[1];
    const result = handleDeleteSyncedOrder(orderId, apiKey);
    sendJson(res, result.status, result.data);
    return;
  }

  if (urlPath === "/api/synced-orders/clear" && req.method === "DELETE") {
    const result = handleClearSyncedOrders(apiKey);
    sendJson(res, result.status, result.data);
    return;
  }

  // API info endpoint (no auth needed)
  if (urlPath === "/api/info" && req.method === "GET") {
    const orders = loadOrders();
    sendJson(res, 200, {
      service: "业绩管理系统 - 订单同步API",
      version: "1.0",
      endpoints: {
        "POST /api/sync-orders": "推送订单（需 X-API-Key）",
        "GET /api/synced-orders": "查询已同步订单",
        "DELETE /api/synced-orders/:id": "删除单条（需 X-API-Key）",
        "DELETE /api/synced-orders/clear": "清空全部（需 X-API-Key）",
      },
      totalSyncedOrders: orders.length,
    });
    return;
  }

  // ===================== Static files =====================
  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API info: http://localhost:${PORT}/api/info`);
  console.log(`Sync endpoint: POST http://localhost:${PORT}/api/sync-orders (X-API-Key required)`);
});
