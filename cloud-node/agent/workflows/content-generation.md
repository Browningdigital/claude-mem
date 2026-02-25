# Content Generation & Distribution

Generate and queue social content across platforms to drive traffic to products.

## 1. Check What Needs Content
```sql
-- Products with no content in the last 7 days
SELECT p.id, p.name, p.tier, p.price, p.landing_page_url,
       COUNT(cq.id) as recent_posts
FROM products p
LEFT JOIN content_queue cq ON cq.product_id = p.id
    AND cq.created_at > NOW() - INTERVAL '7 days'
WHERE p.status = 'deployed'
GROUP BY p.id, p.name, p.tier, p.price, p.landing_page_url
HAVING COUNT(cq.id) < 3
ORDER BY p.created_at ASC;

-- Content queue status
SELECT platform, status, COUNT(*) FROM content_queue
GROUP BY platform, status ORDER BY platform;
```

## 2. Source Material
```sql
-- High-scoring content for inspiration
SELECT title, source, url, score, pillars, breakdown
FROM v2_gold_content WHERE score >= 75 ORDER BY score DESC LIMIT 10;

-- Recent golden nuggets for authentic takes
SELECT title, description, target_audience FROM golden_nuggets
ORDER BY created_at DESC LIMIT 5;

-- AI learnings for data-backed posts
SELECT category, insight, confidence FROM rm_ai_learnings
WHERE confidence::numeric > 70 ORDER BY confidence DESC;
```

## 3. Generate Content Per Platform

### Twitter/X (2-3 posts)
- **Thread**: Take a golden nugget, expand into 5-7 tweets. Hook → Problem → Solution → Result → CTA
- **Hot take**: Contrarian opinion backed by data from AI learnings
- **Build-in-public**: Share what the agent is building, real metrics

### LinkedIn (1 post)
- **Framework post**: "Here's the framework I use for X" — professional tone, bullet points
- **Case study**: Real results from Browning Digital's systems
- **Insight**: Data-backed observation with business implications

### Reddit (1-2 posts)
- **Problem-solving**: Genuinely help in relevant subreddits (r/SaaS, r/Entrepreneur, r/ClaudeAI, r/solopreneur)
- **No spam**: Provide real value, link only when relevant
- **r/SideProject**: Show what's being built

## 4. Queue Content
```sql
INSERT INTO content_queue (platform, content_type, title, body, product_id, hashtags, status, scheduled_for)
VALUES
    ('twitter', 'thread', $1, $2, $3, ARRAY['AI', 'automation'], 'queued', NOW() + INTERVAL '2 hours'),
    ('linkedin', 'post', $1, $2, $3, ARRAY['AI', 'solopreneur'], 'queued', NOW() + INTERVAL '4 hours');
```

## 5. Review Existing Performance
```sql
SELECT platform, title, body, engagement, posted_at
FROM content_queue
WHERE status = 'posted' AND engagement IS NOT NULL
ORDER BY (engagement->>'likes')::int DESC NULLS LAST
LIMIT 5;
```

Use top performers as templates for new content.

## 6. Content Calendar Rules
- Never post the same product CTA more than 2x/week per platform
- 80% value content, 20% promotional
- Alternate platforms throughout the day
- Morning (8-10am EST) for LinkedIn, Afternoon (1-3pm EST) for Twitter
- Always include a hook in the first line
