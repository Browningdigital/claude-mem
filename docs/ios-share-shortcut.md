# iOS Share Sheet → Content Extractor

Send any URL from your iPhone directly to the Browning Digital content pipeline using an Apple Shortcut.

## How It Works

When you see a video, article, or any content on your phone:
1. Tap the **Share** button (in any app)
2. Select **"Save to Browning"** from your shortcuts
3. The URL is automatically extracted, processed, and stored

The content appears in your pipeline — accessible via `content_feed` MCP tool, content routes API, or the Drop Zone UI.

## Setup Instructions

### Create the Shortcut

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** to create a new shortcut
3. Name it **"Save to Browning"**
4. Set it to **Show in Share Sheet** (tap the info icon at top)
5. Set **"Receive: URLs"** from share sheet input

### Add These Actions

```
1. [Receive] Share Sheet Input → URL

2. [Web] Get Contents of URL
   URL: https://content-extractor.devin-b58.workers.dev/api/extract?url=[Share Sheet Input]
   Method: GET

3. [Web] Get Contents of URL
   URL: https://content-extractor.devin-b58.workers.dev/api/upload-url
   Method: POST
   Headers:
     Content-Type: application/json
   Request Body (JSON):
     {
       "url": "[Share Sheet Input]",
       "title": "[Get Dictionary Value: title from Step 2]",
       "content": "[Get Dictionary Value: content from Step 2]",
       "content_type": "[Get Dictionary Value: content_type from Step 2]",
       "metadata": {
         "shared_from": "ios-share-sheet",
         "shared_at": "[Current Date as ISO 8601]"
       }
     }

4. [Notification] Show Notification
   Title: "Saved to Browning"
   Body: "[Get Dictionary Value: title from Step 3] — [Get Dictionary Value: link from Step 3]"
```

### Alternative: Simple One-Step via claude-mem Share Endpoint

The claude-mem worker now includes a `/api/content/share` endpoint with built-in social media extraction. This is the recommended approach — it handles platform detection, oEmbed/embed page extraction, and Jina fallback automatically:

```
1. [Receive] Share Sheet Input → URL

2. [Web] Get Contents of URL
   URL: http://<claude-mem-host>:37777/api/content/share?url=[Share Sheet Input]&source=ios-shortcut
   Method: GET

3. [Notification] Show Notification
   Title: "Saved to Browning"
   Body: "[Get Dictionary Value: title from Step 2]"
```

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/content/share` | POST/GET | Share a URL (auto-detects social platforms, extracts, stores) |
| `/api/content/feed` | GET | Full content feed summary |
| `/api/content/digest` | GET | Formatted digest for context injection |
| `/api/content/search?query=...` | GET | Search raw content and nuggets |
| `/api/extract?url=<URL>` | GET | Extract content from any URL (content-extractor worker) |
| `/api/upload-url` | POST | Store extracted content with metadata (content-extractor worker) |

## Social Media Extraction

Social URLs are automatically detected and extracted using free, auth-free methods before falling back to Jina:

| Platform | Method | Auth Required |
|----------|--------|---------------|
| **Twitter/X** | fxtwitter API + oEmbed | No |
| **YouTube** | oEmbed + noembed fallback | No |
| **TikTok** | oEmbed | No |
| **Reddit** | JSON API (.json suffix) | No |
| **Instagram** | Embed page scraping + ddinstagram | No |
| **Facebook** | Embed plugin page + mobile og:tags | No |
| **Threads** | Embed page scraping | No |
| **LinkedIn** | og:meta via Googlebot UA | No |

Short URL resolution (fb.watch, redd.it, instagr.am, vm.tiktok.com) is handled automatically.

## Supported Content Types

The content pipeline handles:
- **Social media posts** — Automatic platform detection + free API extraction (see table above)
- **Articles/blogs** — Full text extraction via Jina reader (fallback for non-social URLs)
- **PDFs** — Full text extraction via Cloudflare AI
- **Images** — OCR via Cloudflare AI

## Drop Zone Web UI

For manual uploads or desktop use:
**https://content-extractor.devin-b58.workers.dev/upload**

Features: drag-and-drop, clipboard paste, camera capture, URL paste.
