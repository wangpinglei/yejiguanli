-- 无锡 2026-08：列出销售记录及关联人员当前单位（便于肉眼核对）
-- 用法：sqlite3 /root/yejiguanli/server/data/database.db < ops/diagnose-wuxi-sales.sql

.headers on
.mode column
.width 12 12 10 24 16 20 12

SELECT
  substr(sr.sale_date, 1, 10) AS sale_date,
  printf('%.0f', sr.total_amount) AS amount,
  COALESCE(NULLIF(TRIM(sr.sales_person_name), ''), '-') AS ui_sales_name,
  COALESCE(NULLIF(TRIM(sr.personnel_id), ''), '-') AS personnel_id,
  COALESCE(p.name, '-') AS linked_name,
  COALESCE(u.name, '-') AS linked_unit,
  COALESCE(p.position, '-') AS position
FROM sales_records sr
LEFT JOIN personnel p ON p.id = sr.personnel_id
LEFT JOIN sales_units u ON u.id = p.sales_unit_id
WHERE sr.sales_unit_id = (
  SELECT id FROM sales_units WHERE name LIKE '%无锡运营中心%' LIMIT 1
)
AND sr.sale_date LIKE '2026-08%'
ORDER BY sr.total_amount DESC;

SELECT '---合计---' AS info;
SELECT
  COUNT(*) AS cnt,
  printf('%.2f', SUM(total_amount)) AS team_total
FROM sales_records
WHERE sales_unit_id = (
  SELECT id FROM sales_units WHERE name LIKE '%无锡运营中心%' LIMIT 1
)
AND sale_date LIKE '2026-08%';
