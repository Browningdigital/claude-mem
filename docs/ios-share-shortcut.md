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

### Alternative: Simple One-Step Shortcut

If you just want the quickest possible setup:

```
1. [Receive] Share Sheet Input → URL

2. [Web] Get Contents of URL
   URL: https://content-extractor.devin-b58.workers.dev/api/extract?url=[Share Sheet Input]

3. [Notification] Show Notification: "Content extracted!"
```

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/extract?url=<URL>` | GET | Extract content from any URL |
| `/api/upload-url` | POST | Store extracted content with metadata |
| `/api/upload` | POST | Upload a file (multipart form data) |
| `/c/<id>` | GET | Retrieve stored content by ID |

## Supported Content Types

The content extractor handles:
- **Articles/blogs** — Full text extraction via Jina reader
- **YouTube videos** — Title, description, transcript extraction
- **Twitter/X posts** — Tweet text and metadata
- **TikTok videos** — Description and metadata
- **Instagram posts** — Caption and metadata
- **LinkedIn posts** — Post content extraction
- **Threads posts** — OG meta extraction
- **PDFs** — Full text extraction via Cloudflare AI
- **Images** — OCR via Cloudflare AI

## Drop Zone Web UI

For manual uploads or desktop use:
**https://content-extractor.devin-b58.workers.dev/upload**

Features: drag-and-drop, clipboard paste, camera capture, URL paste.
