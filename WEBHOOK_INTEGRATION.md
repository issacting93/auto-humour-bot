# Webhook Integration

The bot exposes webhook endpoints that allow external systems (scripts, Zapier, IFTTT, Shortcuts) to interact with the batch ledger programmatically.

**Base URL:** `https://auto-humour-bot.vercel.app`

---

## Use Cases

1. **Automate Social Posting** — Call `/webhook/ledger` after posting to Instagram/Twitter to mark the image as used and prevent duplicates.
2. **Custom Dashboard** — Fetch batches from GitHub, display status via `/webhook/status/:batchId`, and wire up "Mark Used" buttons to `/webhook/ledger`.
3. **Low-Code Integration (Zapier/Make)** — Trigger a webhook action when a row is added to a Google Sheet to update the ledger automatically.
4. **iOS Shortcuts** — Select an image ID and call the API to mark it as used.

---

## Authentication

Endpoints marked **Auth: required** use Bearer token authentication.

| Header          | Value                          |
|-----------------|--------------------------------|
| `Authorization` | `Bearer <WEBHOOK_SECRET>`      |

### Setting Up the Secret

1. Generate a secret: `openssl rand -hex 32`
2. **Vercel (Production)**: Go to **Settings** → **Environment Variables** and add `WEBHOOK_SECRET` (✅ Already configured).
3. **Local**: Add `WEBHOOK_SECRET=your_secret` to `bot/.env`

### Optional: Slack Notifications

To receive Slack alerts when files are uploaded via webhook:

1.  **Vercel**: Add `SLACK_WEBHOOK_URL` (Incoming Webhook URL from Slack App) (✅ Already configured).
2.  **Local**: Add `SLACK_WEBHOOK_URL=...` to `bot/.env`.

If not set, uploads will verify but fail to send the notification (silently logged).

If `WEBHOOK_SECRET` is not set in the environment, **all authenticated endpoints will reject every request** (fail-closed).

---

## Input Validation

All `batchId`, `imageId`, and `filename` parameters are validated against the pattern `[a-zA-Z0-9_\-\.]+`. Requests containing path traversal sequences (`..`) or slashes are rejected with `400 Bad Request`.

---

## API Reference

### `POST /webhook/ledger`

Mark an image as used in a batch ledger.

**Auth:** Required

#### Headers

| Header          | Value                          |
|-----------------|--------------------------------|
| `Content-Type`  | `application/json`             |
| `Authorization` | `Bearer <WEBHOOK_SECRET>`      |

#### Body

| Field     | Type   | Required | Description                                        |
|-----------|--------|----------|----------------------------------------------------|
| `batchId` | string | Yes      | Batch ID, e.g. `winter_2026_01`                    |
| `imageId` | string | Yes      | Image ID, e.g. `image01.jpg`                       |
| `action`  | string | Yes      | Must be `"mark_used"`                              |
| `link`    | string | No       | URL where the image was posted. Defaults to `N/A`. |
| `user`    | string | No       | Who performed the action. Defaults to `webhook`.   |

#### Example

```bash
curl -X POST https://auto-humour-bot.vercel.app/webhook/ledger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-here" \
  -d '{
    "batchId": "winter_2026_01",
    "imageId": "image01.jpg",
    "action": "mark_used",
    "link": "https://instagram.com/p/123",
    "user": "auto-poster"
  }'
```

#### Responses

**`200 OK`** — Image marked as used.

```json
{
  "success": true,
  "message": "Marked `image01.jpg` as used!\nRemaining in batch: 7/10"
}
```

The response message includes stock alerts when applicable:
- **<= 20% remaining:** `Batch winter_2026_01 is running low!`
- **0 remaining:** `Batch winter_2026_01 is exhausted — need more images!`

**`400 Bad Request`** — Missing required fields, invalid IDs, or unknown `action` value.

```json
{ "error": "Missing required fields: batchId, imageId, action" }
```

**`401 Unauthorized`** — Missing or incorrect `Authorization` header.

```json
{ "error": "Unauthorized" }
```

**`404 Not Found`** — Batch does not exist or image not found in batch.

```json
{ "success": false, "error": "Batch `winter_2026_01` not found." }
```

**`409 Conflict`** — Image is already marked as used.

```json
{ "success": false, "error": "Image `image01.jpg` is already marked as used." }
```

**`500 Internal Server Error`** — GitHub API failure or unexpected error.

```json
{ "error": "Internal Server Error" }
```

#### Concurrency

The ledger update uses GitHub's SHA-based optimistic locking. If two requests try to update the same batch simultaneously, the bot retries once automatically. If the retry also fails, a 500 is returned. Callers should retry on 500.

---

### `GET /webhook/status/:batchId`

Check the stock level of a batch.

**Auth:** None (public endpoint)

#### Example

```
GET https://auto-humour-bot.vercel.app/webhook/status/winter_2026_01
```

#### Responses

**`200 OK`**

```json
{
  "batchId": "winter_2026_01",
  "total": 50,
  "used": 10,
  "remaining": 40,
  "status": "healthy",
  "updated_at": "2026-02-20T10:00:00.000Z"
}
```

| Field        | Description                                       |
|--------------|---------------------------------------------------|
| `status`     | `healthy`, `low` (<= 20% remaining), or `empty`  |
| `updated_at` | Current server timestamp (not batch last-modified) |

**`400 Bad Request`** — Invalid `batchId`.

```json
{ "error": "Invalid batchId" }
```

**`404 Not Found`** — Batch does not exist.

```json
{ "error": "Batch winter_2026_01 not found" }
```

**`500 Internal Server Error`** — GitHub API failure.

```json
{ "error": "Internal Server Error" }
```

---

### `POST /webhook/upload`

Upload an image to a batch inbox via base64-encoded payload.
**If configured, this also sends a notification to Slack.**

**Auth:** Required
**Body size limit:** 50 MB
**Allowed file types:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`

#### Headers

| Header          | Value                          |
|-----------------|--------------------------------|
| `Content-Type`  | `application/json`             |
| `Authorization` | `Bearer <WEBHOOK_SECRET>`      |

#### Body

| Field      | Type   | Required | Description                                                       |
|------------|--------|----------|-------------------------------------------------------------------|
| `batchId`  | string | Yes      | Target batch ID, e.g. `summer_2026`                               |
| `filename` | string | Yes      | Filename for the image, e.g. `meme_001.jpg`                      |
| `image`    | string | Yes      | Base64-encoded image data. Data URI prefix is stripped if present. |

#### Example

```bash
curl -X POST https://auto-humour-bot.vercel.app/webhook/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-here" \
  -d '{
    "batchId": "summer_2026",
    "filename": "meme_001.jpg",
    "image": "<base64-string>"
  }'
```

#### Responses

**`200 OK`**

```json
{
  "success": true,
  "message": "File uploaded to images/inbox/summer_2026/meme_001.jpg. Slack notification sent."
}
```

> **Note:** The file is committed to GitHub. Whether an ingestion workflow runs depends on GitHub Actions configuration in the repo.

**`400 Bad Request`** — Missing required fields, invalid IDs, or unsupported file type.

```json
{ "error": "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" }
```

**`401 Unauthorized`**

```json
{ "error": "Unauthorized" }
```

**`409 Conflict`** — File already exists in that batch.

```json
{ "error": "File meme_001.jpg already exists in batch summer_2026" }
```

**`500 Internal Server Error`**

```json
{ "error": "Internal Server Error" }
```

---

## Managing Folders (Batches)

### Creating Folders

**Option A: Automatic (via Webhook)**

You don't need to explicitly create a folder. Upload an image to a new `batchId` and the folder is created automatically.

Send `POST /webhook/upload` with a `batchId` that doesn't exist yet:

```bash
curl -X POST https://auto-humour-bot.vercel.app/webhook/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-here" \
  -d '{
    "batchId": "spring_marketing_campaign",
    "filename": "launch_meme.jpg",
    "image": "<base64-string>"
  }'
```

GitHub creates `images/inbox/spring_marketing_campaign/` and places the file inside it. If GitHub Actions are configured, the ingestion workflow runs and the bot posts to Slack.

**Option B: Manual (via GitHub)**

1. Navigate to `images/inbox/` in your repository.
2. Click **Add file** > **Create new file**.
3. Type `new_folder_name/.gitkeep` as the filename.
4. Commit. This creates the folder.

### Deleting Folders

There is no webhook endpoint for deleting folders. This is intentional — deletion is manual to prevent accidental data loss.

1. Navigate to the folder under `images/inbox/` in your repository.
2. Delete all files inside it (Git removes empty directories automatically).
3. If you also want to remove the ledger, delete `batches/<batch_id>.json` separately.

> **Important:** Deleting `images/inbox/<batch_id>/` does **not** delete the corresponding ledger at `batches/<batch_id>.json`. Clean up both if you want the batch fully removed.

---

## Operational Notes

- **Auth comparison:** Token comparison uses simple string equality, not constant-time comparison. Acceptable for this threat model but not suitable for high-security contexts.
- **No rate limiting:** Endpoints have no built-in rate limiting. If exposed publicly, consider adding rate limiting at the Vercel or reverse-proxy layer.
- **Error messages:** 500 responses return `"Internal Server Error"` without implementation details. Check Vercel function logs for root cause.
