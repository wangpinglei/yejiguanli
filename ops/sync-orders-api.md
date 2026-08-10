# 业绩管理系统 · 销售记录同步接口文档

| 项 | 说明 |
|----|------|
| 文档版本 | v1.0 |
| 更新日期 | 2026-08-07 |
| 生产 Base URL | `https://isales.santi.ren/yeji/api` |
| 内网 Base URL | `http://127.0.0.1:8100/api` |
| Content-Type | `application/json; charset=utf-8` |

---

## 1. 概述

外部业务系统可将订单同步到业绩管理系统的 **销售记录**，用于业绩、战报、成本等计算。

同步后的记录：

- 写入表 `sales_records`，`synced = 1`
- 在「销售记录」页面可见（标记为同步订单）
- 按销售单位名、销售人员名自动匹配；产品不存在时自动建档

---

## 2. 鉴权

除特别说明外，写操作需鉴权。

| 方式 | 说明 |
|------|------|
| Header（推荐） | `X-API-Key: <密钥>` |
| Query（备选） | `?apiKey=<密钥>` |

| 环境变量 | 默认值 |
|----------|--------|
| `SYNC_API_KEY` | `eco-sync-2026-secret` |

鉴权失败：

```json
HTTP 401
{ "success": false, "message": "API Key 无效" }
```

---

## 3. 订单字段规范

请求体中每笔订单支持 **中文字段名** 或 **英文字段名**（二选一或混用，同义字段取到即用）。

### 3.1 业务字段（自动同步销售记录所需）

| 中文 | 英文 / 别名 | 类型 | 必填 | 说明 |
|------|-------------|------|------|------|
| 客户姓名 | `customerName` / `客户名称` | string | 建议 | 客户名称 |
| 购买产品 | `productName` / `产品名称` | string | 建议 | 产品名；系统无同名产品时自动创建 |
| 订单金额 | `orderAmount` | number | 否 | 订单原价 |
| 实收金额 | `totalAmount` / `实收` | number | 建议 | **业绩口径**使用该字段；未传时回退为订单金额 |
| 订单类型 | `orderType` | string | 否 | 如：新购 / 续费 / 升级 |
| 销售单位 | `salesUnitName` | string | 建议 | 与业绩系统「销售单位」名称一致方可匹配 ID |
| 销售人员 | `salesPersonName` / `销售员` | string | 建议 | 与「人员管理」姓名一致；优先同单位同名 |
| 成交日期 | `saleDate` / `orderDate` | string | 建议 | `YYYY-MM-DD`；缺省为当天 |
| 参加活动 | `activityName` / `活动` | string | 否 | 活动名称 |

### 3.2 推荐附加字段

| 中文 / 英文 | 类型 | 说明 |
|-------------|------|------|
| `orderId` / `订单号` / `订单编号` | string | **强烈建议**。用于去重与更新；不传则按业务字段生成指纹 ID |
| `quantity` / `数量` | number | 默认 `1` |
| `unitPrice` / `单价` | number | 未传时用 `实收金额 / 数量` |
| `remark` / `备注` | string | 默认 `外部同步` |

### 3.3 单笔订单示例（中文）

```json
{
  "客户姓名": "张三",
  "购买产品": "拆单软件",
  "订单金额": 12800,
  "实收金额": 9800,
  "订单类型": "新购",
  "销售单位": "海南运营中心",
  "销售人员": "李四",
  "成交日期": "2026-08-07",
  "参加活动": "暑期活动",
  "orderId": "EXT-20260807-001"
}
```

### 3.4 单笔订单示例（英文）

```json
{
  "orderId": "EXT-20260807-001",
  "customerName": "张三",
  "productName": "拆单软件",
  "orderAmount": 12800,
  "totalAmount": 9800,
  "orderType": "新购",
  "salesUnitName": "海南运营中心",
  "salesPersonName": "李四",
  "saleDate": "2026-08-07",
  "activityName": "暑期活动"
}
```

---

## 4. 接口列表

### 4.1 推送同步（推荐：由外部系统调用）

将订单写入业绩系统销售记录。

| 项 | 值 |
|----|-----|
| Method | `POST` |
| Path | `/sync-orders` |
| 完整 URL（生产） | `https://isales.santi.ren/yeji/api/sync-orders` |
| 鉴权 | 需要 `X-API-Key` |

#### 请求体

支持以下任一形态：

1. `{ "orders": [ {...}, ... ] }`
2. `{ "data": [ {...}, ... ] }`
3. 直接传数组 `[ {...}, ... ]`
4. 单笔对象 `{ ... }`

#### 成功响应 `200`

```json
{
  "success": true,
  "message": "同步完成：新增 1 笔，更新 0 笔，跳过 0 笔",
  "added": 1,
  "updated": 0,
  "skipped": 0,
  "errors": ["可选：跳过原因列表"]
}
```

| 字段 | 说明 |
|------|------|
| `added` | 新增条数 |
| `updated` | 按订单号/指纹更新条数 |
| `skipped` | 无法识别或校验失败条数 |
| `errors` | 有跳过时返回原因数组 |

#### 错误响应

| HTTP | 场景 |
|------|------|
| 401 | API Key 无效 |
| 400 | 订单数据为空 |

#### curl 示例

```bash
curl -X POST 'https://isales.santi.ren/yeji/api/sync-orders' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: eco-sync-2026-secret' \
  -d '{
    "orders": [
      {
        "客户姓名": "张三",
        "购买产品": "拆单软件",
        "订单金额": 12800,
        "实收金额": 9800,
        "订单类型": "新购",
        "销售单位": "海南运营中心",
        "销售人员": "李四",
        "成交日期": "2026-08-07",
        "参加活动": "暑期活动",
        "orderId": "EXT-20260807-001"
      }
    ]
  }'
```

---

### 4.2 主动拉取同步（业绩系统拉取外部）

由业绩系统请求外部接口，拿到订单列表后写入销售记录。

| 项 | 值 |
|----|-----|
| Method | `POST` |
| Path | `/sync-orders/pull` |
| 完整 URL（生产） | `https://isales.santi.ren/yeji/api/sync-orders/pull` |
| 鉴权 | 需要 `X-API-Key` |

#### 环境变量 / 请求体

| 配置 | 说明 |
|------|------|
| `SYNC_SOURCE_URL` | 外部订单列表地址（优先） |
| `SYNC_SOURCE_API_KEY` | 请求外部时带的 `X-API-Key`（可选） |
| body.`sourceUrl` | 未配环境变量时可临时传入 |
| body.`sourceApiKey` | 临时外部密钥 |

#### 对外部接口的要求

- Method：`GET`
- 返回：JSON 数组，或 `{ "orders": [...] }` / `{ "data": [...] }`
- 元素字段：与本文 **§3 订单字段规范** 相同

#### 成功响应 `200`

```json
{
  "success": true,
  "message": "拉取同步完成：新增 2 笔，更新 1 笔，跳过 0 笔",
  "added": 2,
  "updated": 1,
  "skipped": 0,
  "sourceUrl": "https://example.com/api/orders"
}
```

#### curl 示例

```bash
curl -X POST 'https://isales.santi.ren/yeji/api/sync-orders/pull' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: eco-sync-2026-secret' \
  -d '{}'
```

---

### 4.3 查询已同步记录

| 项 | 值 |
|----|-----|
| Method | `GET` |
| Path | `/synced-orders` |
| 完整 URL（生产） | `https://isales.santi.ren/yeji/api/synced-orders` |
| 鉴权 | 当前可不传 Key（只读） |

#### Query 参数

| 参数 | 说明 |
|------|------|
| `yearMonth` | 可选，如 `2026-08`，按成交日期前缀筛选 |
| `salesUnitName` | 可选，按销售单位名称精确筛选 |

#### 成功响应 `200`

```json
{
  "success": true,
  "count": 1,
  "orders": [
    {
      "id": "sr_xxx",
      "externalOrderId": "EXT-20260807-001",
      "synced": true,
      "salesUnitId": "unit_xxx",
      "salesUnitName": "海南运营中心",
      "personnelId": "person_xxx",
      "salesPersonName": "李四",
      "productId": "prod_xxx",
      "productName": "拆单软件",
      "quantity": 1,
      "unitPrice": 9800,
      "totalAmount": 9800,
      "orderAmount": 12800,
      "orderType": "新购",
      "activityName": "暑期活动",
      "saleDate": "2026-08-07",
      "customerName": "张三",
      "remark": "外部同步",
      "syncedAt": "2026-08-07T09:00:00.000Z"
    }
  ]
}
```

---

## 5. 匹配与去重规则

| 规则 | 说明 |
|------|------|
| 销售单位 | 按 `销售单位` 名称匹配（不区分大小写） |
| 销售人员 | 按姓名匹配；若有单位 ID，优先同单位同名 |
| 购买产品 | 同名复用；否则自动创建产品（售价/提成默认 0，需后续在系统内配置结算/提成） |
| 去重 · 有订单号 | `external_order_id = orderId`，存在则 **更新**，不存在则 **新增** |
| 去重 · 无订单号 | 用「客户+产品+订单金额+实收+类型+单位+人员+日期+活动」生成稳定指纹 ID |

> 单位名、人员名请与业绩系统保持一致，否则只能写入名称文本，单位/人员 ID 为空，可能影响按单位筛选与提成归属。

---

## 6. 联调检查清单

1. 用测试 Key 调用 `POST /sync-orders`，返回 `success: true`
2. 打开业绩系统 → **销售记录**，能看到该单，且为同步订单
3. `GET /synced-orders` 能查到对应 `externalOrderId`
4. 再推同一 `orderId`，`updated` +1，`added` 为 0
5. 确认销售单位、销售人员名称与系统中完全一致

---

## 7. 联系与变更

- 实现文件：`server/src/routes/syncOrders.ts`
- 密钥生产环境请通过 `SYNC_API_KEY` 配置，勿使用文档默认值长期裸奔
- 字段或路径变更时同步更新本文档版本号
