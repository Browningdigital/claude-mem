# Package Golden Nugget into Product

Take the next unpackaged golden nugget and turn it into a sellable digital product.

## 1. Select the Nugget
```sql
SELECT id, title, description, detailed_explanation, implementation_steps,
       target_audience, productization_potential, estimated_value
FROM golden_nuggets
WHERE pipeline_stage = 'backlog' AND is_packaged = false
ORDER BY priority DESC, created_at ASC
LIMIT 1;
```

## 2. Research Supporting Content
```sql
-- Find related ingested content for depth
SELECT id, raw_text, metadata, word_count
FROM raw_content
WHERE processing_status = 'processed'
  AND raw_text ILIKE '%<keywords from nugget>%'
ORDER BY created_at DESC
LIMIT 20;

-- Find related gold content for additional angles
SELECT title, source, url, score, pillars, breakdown
FROM v2_gold_content
WHERE pillars::text ILIKE '%<matching pillar>%'
ORDER BY score DESC
LIMIT 10;
```

## 3. Determine Product Format
Based on the nugget type and audience:
- `framework` or `process` → Starter Kit (template + guide) at $47-97
- `insight` → Mini Guide (PDF) at $7-27
- `template` → Template Bundle at $27-47
- High `estimated_value` → Full Course outline at $197-497

## 4. Build the Product
- Write clear, actionable content
- Include real examples from Browning Digital's experience
- Every section must have a "do this now" action step
- Add implementation checklists
- Format: Markdown → deploy as web page or generate PDF

## 5. Create Landing Page
Build a simple, high-converting landing page:
- Headline: Problem → Solution
- 3-5 bullet points of what's included
- Social proof (if available)
- Clear CTA with price
- Deploy on Cloudflare Pages or as a Worker

## 6. Set Up Checkout
- Create product on payment platform (Lemon Squeezy preferred, or Stripe)
- Configure webhook to POST sale data to Supabase
- Test the full purchase flow with Playwright

## 7. Register in Database
```sql
-- Create product
INSERT INTO products (name, slug, description, tier, price, pillar, format, status, source_nugget_id, landing_page_url, checkout_url)
VALUES (...);

-- Update nugget
UPDATE golden_nuggets SET is_packaged = true, pipeline_stage = 'deployed', product_id = '<product_id>'
WHERE id = '<nugget_id>';

-- Create pipeline entry
INSERT INTO product_pipeline (nugget_id, product_id, stage) VALUES (...);
```

## 8. Create Launch Content
Generate 5 social posts for the product launch:
```sql
INSERT INTO content_queue (platform, content_type, title, body, product_id, status)
VALUES
    ('twitter', 'thread', 'Launch: ...', '...', '<product_id>', 'queued'),
    ('linkedin', 'post', 'Launch: ...', '...', '<product_id>', 'queued'),
    ('reddit', 'post', 'Launch: ...', '...', '<product_id>', 'queued');
```

## 9. Log and Report
Log the milestone and output what was built.
