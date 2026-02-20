# Auto-Humour-Bot

Automated meme-caption workflow: image ingestion, batch ledgers, humour-flavour caption generation, and Slack + GitHub integration.

---

## Table of contents

- [Overview](#overview)
- [Repository structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Image ingestion workflow](#image-ingestion-workflow)
- [Slack bot](#slack-bot)
- [Slack notifications](#slack-notifications)
- [Webhook endpoint](#webhook-endpoint)
- [Handoff](#handoff)
- [Troubleshooting](#troubleshooting)
- [Quick reference](#quick-reference)

---

## Overview

The system tracks meme images in batches. Each batch has a ledger that records every image and its status (`new` or `used`).

| Role | Action |
|------|--------|
| **Person A** | Adds images to `images/inbox/<batch_id>/` and pushes to GitHub |
| **GitHub Action** | Runs on push, updates `batches/<batch_id>.json`, optionally posts to Slack |
| **Slack bot** | Responds to `/meme status` and `/meme used` to query and update ledgers |

Ledgers are stored as JSON files in the repo (or in a database; see [DATABASE_INTEGRATION.md](DATABASE_INTEGRATION.md)).

---

## Repository structure

```
repo/
  images/
    inbox/
      <batch_id>/          # e.g. winter_2026_01
        image01.jpg
        image02.jpg
    published/             # (future) published images
  batches/
    <batch_id>.json        # ledger: list of images + status
  flavours/                # (future) humour-flavour prompt templates
  generated/               # (future) generated captions per image
  .github/workflows/
    image-ingestion.yml    # runs on push to images/inbox/**
  bot/                     # Slack bot (Bolt)
  scripts/
    update-ledger.js       # scans inbox, updates batch JSON
    notify-slack-ingestion.js
```

**Rules:**

- Images must be placed only in `images/inbox/<batch_id>/`.
- Do not rename images after upload; filenames are used as image IDs.
- One ledger per batch: `batches/<batch_id>.json`.

---

## Prerequisites

| Requirement | Purpose |
|-------------|---------|
| **GitHub** account and repo access | Store images, ledgers, run workflows |
| **Slack** workspace | Create app, install bot, receive notifications |
| **Node.js** 18+ | Run the Slack bot |
| **Git** | Clone, commit, push |

---

## Configuration

### Clone the repository

```bash
git clone https://github.com/Nj-E/Workflow-example.git
cd Workflow-example
```

### Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**.
2. Choose your workspace.
3. Paste the contents of `bot/slack-app-manifest.json`.
4. **Install to Workspace** and copy:
   - **Bot User OAuth Token** (`xoxb-...`) → `SLACK_BOT_TOKEN`
   - **Signing Secret** (Basic Information) → `SLACK_SIGNING_SECRET`
5. Under **Slash Commands** → **/meme**, set **Request URL** to your bot's public URL (e.g. `https://your-ngrok-url/slack/events`).

See [bot/SLACK_SETUP.md](bot/SLACK_SETUP.md) for manifest options and troubleshooting.

### GitHub token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens).
2. Generate a token (classic or fine-grained) with **Contents** read + write for this repo.
3. Use as `GITHUB_TOKEN` in `bot/.env`.

### Bot environment

```bash
cd bot
cp .env.example .env
```

Edit `bot/.env`:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
GITHUB_TOKEN=ghp_your_github_token
REPO_OWNER=Nj-E
REPO_NAME=Workflow-example
WEBHOOK_SECRET=your-webhook-secret
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token from Slack |
| `SLACK_SIGNING_SECRET` | Yes | Signing Secret from Slack |
| `GITHUB_TOKEN` | Yes | GitHub token with Contents read + write |
| `REPO_OWNER` | Yes | GitHub repo owner (e.g. `Nj-E`) |
| `REPO_NAME` | Yes | GitHub repo name (e.g. `Workflow-example`) |
| `WEBHOOK_SECRET` | Yes | Shared secret for the webhook endpoint (see [WEBHOOK_INTEGRATION.md](WEBHOOK_INTEGRATION.md)) |
| `PORT` | No | Port for the Bolt app (default: `3000`) |

Never commit `.env`; it is listed in `.gitignore`.

---

## Image ingestion workflow

### Trigger

The workflow runs when a push includes changes under `images/inbox/**`. Pushes that only modify `batches/` or other paths do **not** trigger it.

### Steps

1. **GitHub Action** (`image-ingestion`) runs.
2. **`scripts/update-ledger.js`** scans `images/inbox/`, creates or updates `batches/<batch_id>.json` for each batch folder.
3. The workflow commits and pushes any changed `batches/*.json`.
4. If `SLACK_WEBHOOK_URL` is set, **`scripts/notify-slack-ingestion.js`** posts a message to Slack.

### Adding images

**New batch:**

```bash
mkdir -p images/inbox/winter_2026_01
cp ~/Downloads/photo1.jpg images/inbox/winter_2026_01/
git add images/inbox/winter_2026_01/
git commit -m "chore: add images to winter_2026_01"
git push origin main
```

**Existing batch:** Add files under `images/inbox/<batch_id>/`, commit, push.

**Supported formats:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`

---

## Slack bot

### Commands

| Command | Description |
|---------|-------------|
| `/meme status <batch_id>` | Show total, used, remaining, and image list with GitHub links |
| `/meme used <batch_id> <image_id> [link]` | Mark an image as used and update the ledger |

Replies are ephemeral (visible only to the user) unless the bot is invited into the channel.

### Batch alerts

The bot warns when a batch is running low:

| Condition | Alert |
|-----------|-------|
| Remaining = 0 | "batch is exhausted — need more images!" |
| Remaining ≤ 20% | "batch is running low!" |

Alerts appear in both `/meme status` and `/meme used` responses.

### Request URL

Slack sends slash commands to a **Request URL**. It must point to the running bot:

- **Local development:** Use ngrok: `ngrok http 3000`, then set Request URL to `https://<ngrok-host>/slack/events`.
- **Production:** Set Request URL to `https://<your-domain>/slack/events`.

### Running the bot locally

```bash
cd bot
npm install
npm start
```

Then expose with ngrok (or similar) and configure the Request URL in the Slack app.

### Marking images as used

```
/meme used winter_2026_01 image02.jpg
/meme used winter_2026_01 image02.jpg https://example.com/vote/123
```

The bot reads the ledger from GitHub, updates the item's `status`, `used_at`, `used_by`, and `used_in`, then commits and pushes the change.

---

## Slack notifications

When new images are pushed to `images/inbox/`, the workflow can post a message to Slack.

### Setup

1. In Slack: **Apps** → **Incoming Webhooks** (or [api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks)) → **Add to Slack** → choose channel → copy the webhook URL.
2. In GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository secret** → name: `SLACK_WEBHOOK_URL`, value: the webhook URL.

### Behavior

- Message format: *New images ingested - winter_2026_01: 2 new image(s) (5 total)* with a link to the inbox.
- If `SLACK_WEBHOOK_URL` is not set, the workflow still updates ledgers; the Slack step is skipped.

---

## Webhook endpoint

The bot exposes `POST /webhook/ledger` for external systems to mark images as used programmatically. See [WEBHOOK_INTEGRATION.md](WEBHOOK_INTEGRATION.md) for the full API reference.

---

## Handoff

When another developer hosts the bot on their platform, they create a new Slack app from the manifest. You do not need to share your Slack credentials.

### What you provide

| Item | Description |
|------|-------------|
| `bot/slack-app-manifest.json` | Slack app manifest |
| Repo access | Add as collaborator or share code |
| `REPO_OWNER` / `REPO_NAME` | Your values |
| GitHub token | Token with repo access, shared securely |
| `WEBHOOK_SECRET` | Shared secret for the webhook endpoint |

### What they do

1. Create the Slack app from the manifest at [api.slack.com/apps](https://api.slack.com/apps).
2. Install to workspace and copy Bot User OAuth Token and Signing Secret.
3. Deploy the bot with env vars: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `GITHUB_TOKEN` (or `DATABASE_URL`), `REPO_OWNER`, `REPO_NAME`, `WEBHOOK_SECRET`.
4. Set **Request URL** in Slack to `https://their-domain.com/slack/events`.

---

## Troubleshooting

### "Batch not found" in Slack

- Confirm `batches/<batch_id>.json` exists on GitHub.
- Confirm `GITHUB_TOKEN` has access to the repo (e.g. owner or collaborator).
- Confirm `REPO_OWNER` and `REPO_NAME` in `bot/.env` match the repo.

### Ledger not updated after pushing images

- The workflow runs only when the push includes changes under `images/inbox/**`.
- Check **Actions** for the "Image Ingestion" workflow run and any failed steps.

### Workflow fails on "Commit and Push Ledger Updates"

- Push may be rejected if the remote has new commits. The workflow pulls before pushing. Check run logs for merge conflicts or other Git errors.

### No Slack notification when pushing images

- Confirm `SLACK_WEBHOOK_URL` is set in repo secrets.
- Confirm the workflow run completed; the Slack step runs after the commit step.
- Check the channel the webhook is configured for.

### Bot does not respond to `/meme`

- Confirm the bot is running and the **Request URL** is correct.
- If using ngrok, the URL may change after restart; update the Request URL.
- Ephemeral replies are expected unless the bot is invited into the channel.

### Ledger out of sync with folder

- Run the update script locally, then commit and push:
  ```bash
  node scripts/update-ledger.js
  git add batches/
  git commit -m "chore: sync ledger with inbox"
  git push origin main
  ```
- Or push a small change under `images/inbox/<batch_id>/` to trigger the workflow.

---

## Quick reference

| Task | Command or action |
|------|--------------------|
| Add a new batch | `mkdir -p images/inbox/<batch_id>`, add images, commit, push |
| Add images to existing batch | Add files under `images/inbox/<batch_id>/`, commit, push |
| Check batch in Slack | `/meme status <batch_id>` |
| Mark image used | `/meme used <batch_id> <image_id> [link]` |
| Update ledger locally | `node scripts/update-ledger.js` |
| Run bot locally | `cd bot && npm start`; expose with `ngrok http 3000` |
| Enable Slack on push | Add repo secret `SLACK_WEBHOOK_URL` |

### Important paths

| Path | Purpose |
|------|---------|
| `images/inbox/<batch_id>/` | Image storage |
| `batches/<batch_id>.json` | Batch ledger |
| `.github/workflows/image-ingestion.yml` | Image ingestion workflow |
| `bot/.env` | Bot configuration (never commit) |

### Related documentation

- **[tasks.md](tasks.md)** — Product roadmap and design spec
- **[DATABASE_INTEGRATION.md](DATABASE_INTEGRATION.md)** — Switch from GitHub JSON to a database
- **[WEBHOOK_INTEGRATION.md](WEBHOOK_INTEGRATION.md)** — Webhook API reference
- **[bot/SLACK_SETUP.md](bot/SLACK_SETUP.md)** — Slack app manifest and setup details
