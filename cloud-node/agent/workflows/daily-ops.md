# Daily Operations Check

Run the daily operations check for the Browning Digital autonomous business.

## 1. Revenue Check
```sql
SELECT COALESCE(SUM(amount), 0) as today_rev, COUNT(*) as today_sales
FROM product_sales WHERE created_at::date = CURRENT_DATE;

SELECT COALESCE(SUM(amount), 0) as week_rev, COUNT(*) as week_sales
FROM product_sales WHERE created_at > NOW() - INTERVAL '7 days';

SELECT COALESCE(SUM(amount), 0) as month_rev, COUNT(*) as month_sales
FROM product_sales WHERE created_at > NOW() - INTERVAL '30 days';
```

## 2. Pipeline Status
```sql
SELECT pipeline_stage, COUNT(*) FROM golden_nuggets GROUP BY pipeline_stage;
SELECT status, COUNT(*) FROM products GROUP BY status;
SELECT stage, COUNT(*) FROM product_pipeline GROUP BY stage;
```

## 3. Content Performance
```sql
SELECT platform, status, COUNT(*) FROM content_queue GROUP BY platform, status ORDER BY platform;
SELECT * FROM content_queue WHERE status = 'posted' AND engagement IS NOT NULL ORDER BY posted_at DESC LIMIT 5;
```

## 4. New Content to Process
```sql
SELECT COUNT(*) as pending FROM raw_content WHERE processing_status = 'pending';
```

## 5. System Health
- Check all workers are responding (curl health endpoints)
- Check Supabase connection
- Check any failed tasks in the last 24h:
```sql
SELECT id, LEFT(prompt, 80) as task, error FROM cloud_node_tasks
WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours';
```

## 6. Write Daily Snapshot
```sql
INSERT INTO revenue_daily (date, total_revenue, total_sales, products_deployed, content_posted)
SELECT
    CURRENT_DATE,
    COALESCE((SELECT SUM(amount) FROM product_sales WHERE created_at::date = CURRENT_DATE), 0),
    COALESCE((SELECT COUNT(*) FROM product_sales WHERE created_at::date = CURRENT_DATE), 0),
    COALESCE((SELECT COUNT(*) FROM products WHERE status = 'deployed'), 0),
    COALESCE((SELECT COUNT(*) FROM content_queue WHERE status = 'posted' AND posted_at::date = CURRENT_DATE), 0)
ON CONFLICT (date) DO UPDATE SET
    total_revenue = EXCLUDED.total_revenue,
    total_sales = EXCLUDED.total_sales,
    products_deployed = EXCLUDED.products_deployed,
    content_posted = EXCLUDED.content_posted;
```

## 7. Report
Output a concise status report that Devin can read in 10 seconds:
```
REVENUE: $X today | $X this week | $X this month
PIPELINE: X products deployed | X building | X in backlog
CONTENT: X posts today | X queued | best performer: [title]
HEALTH: [ok/issues]
ACTION: [what you're doing next]
```
