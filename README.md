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

Requires `.env` with Slack and (optionally) GitHub tokens — see `bot/` for config.
