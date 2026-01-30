# Workflow-example (Auto-Humour-Bot)

Automated meme-caption workflow: image ingestion, batch ledgers, humour-flavour caption generation, and Slack + GitHub integration.

See **[tasks.md](tasks.md)** for the full workflow spec and design.

## Repo structure

- **`.github/workflows/`** — GitHub Actions (e.g. image ingestion → ledger update)
- **`bot/`** — Slack bot (Bolt, commands like `/meme status`, `/meme used`)
- **`scripts/`** — Ledger and automation scripts (e.g. `update-ledger.js`)
- **`tasks.md`** — System design, phases, and success criteria

## Quick start

```bash
cd bot && npm install && npm start
```

**Setup:** Copy `bot/.env.example` to `bot/.env` and add your Slack and GitHub tokens (see that file for where to get them).

## Slack notification when new images are pushed

The **image-ingestion** workflow can post to Slack when you push new images to `images/inbox/`. To enable it:

1. In Slack: **Apps** → **Incoming Webhooks** (or create one at [api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks)) → **Add to Slack** → pick a channel → copy the webhook URL.
2. In GitHub: repo **Settings** → **Secrets and variables** → **Actions** → **New repository secret** → name: `SLACK_WEBHOOK_URL`, value: your webhook URL.

After that, each push to `images/inbox/**` will post a message like: *New images ingested • winter_2026_01: 2 new image(s) (3 total)* and a link to the inbox.
