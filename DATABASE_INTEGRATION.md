# Database Integration

By default the bot stores batch ledgers as JSON files in the GitHub repo (`batches/<batch_id>.json`). This guide explains how to switch storage to your own database (PostgreSQL, MongoDB, MySQL, etc.).

---

## Data model

### Batch (one per batch)

| Field | Description |
|-------|-------------|
| `batch_id` | Name of the batch, e.g. `winter_2026_01` |
| `created_at` | When the batch was created |
| `context_tags` | Optional tags like `["winter", "office"]` |

### Image (one per image in a batch)

| Field | Description |
|-------|-------------|
| `image_id` | The filename, e.g. `image02.jpg` |
| `file_path` | Path in the repo, e.g. `images/inbox/winter_2026_01/image02.jpg` |
| `status` | `"new"` or `"used"` |
| `added_at` | When the image was added |
| `used_at` | When it was marked as used (optional) |
| `used_by` | Who marked it (optional) |
| `used_in` | Link where it was used (optional) |

---

## Adapter pattern

Instead of calling the GitHub API directly, the bot calls an **adapter** module that reads and writes your database. You need to implement three functions:

| Function | Purpose |
|----------|---------|
| `getBatchLedger(batchId)` | Fetch a batch and all its images. Return `null` if it doesn't exist. |
| `updateBatchLedger(batchId, ledger)` | Save the full ledger (e.g. after marking an image as used). |
| `upsertBatchItems(batchId, newItems)` | Add new images to a batch without overwriting existing ones. |

The **Slack bot** uses `getBatchLedger` and `updateBatchLedger`.
The **update-ledger script** (run by the GitHub Action) uses `getBatchLedger` and `upsertBatchItems`.

---

## Files to change

| File | Change |
|------|--------|
| **New: `lib/ledger-adapter.js`** | Your adapter with the three functions above, wired to your database. |
| **`bot/app.js`** | Replace GitHub API calls with adapter calls. |
| **`scripts/update-ledger.js`** | Replace file reads/writes with adapter calls. |
| **`bot/.env`** | Add `DATABASE_URL` (your connection string). |
| **`.github/workflows/image-ingestion.yml`** | Remove the ledger commit/push step. Add `DATABASE_URL` as a secret. |

---

## Step by step

### 1. Create the adapter

Create `lib/ledger-adapter.js` exporting the three functions. Inside each function, use your database client. See the PostgreSQL and MongoDB examples below.

### 2. Add the database URL

In `bot/.env`:

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

### 3. Wire up the bot

In `bot/app.js`, replace the GitHub API calls:

- Ledger fetch → `getBatchLedger(batchId)`
- Ledger update → `updateBatchLedger(batchId, ledger)`

### 4. Wire up the ledger script

In `scripts/update-ledger.js`, the inbox scan stays the same. Replace file writes with `upsertBatchItems(batchId, newItems)`.

### 5. Update the GitHub Action

- Add `DATABASE_URL` as a repository secret (Settings → Secrets → Actions).
- Pass it to the script: `env: { DATABASE_URL: ${{ secrets.DATABASE_URL }} }`
- Remove the step that commits and pushes `batches/*.json`.

---

## Example: PostgreSQL

### Tables

```sql
CREATE TABLE batches (
  batch_id     VARCHAR(255) PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context_tags TEXT[] DEFAULT '{}'
);

CREATE TABLE batch_items (
  batch_id   VARCHAR(255) NOT NULL REFERENCES batches(batch_id) ON DELETE CASCADE,
  image_id   VARCHAR(255) NOT NULL,
  file_path  VARCHAR(512) NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'new',
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at    TIMESTAMPTZ,
  used_by    VARCHAR(255),
  used_in    VARCHAR(512),
  PRIMARY KEY (batch_id, image_id)
);
```

### Adapter

- **`getBatchLedger`**: `SELECT` from `batches` and `batch_items`, build the ledger object.
- **`updateBatchLedger`**: `INSERT`/`UPDATE` rows in `batch_items` to match the ledger.
- **`upsertBatchItems`**: Load existing items, add any new ones, then save.

Your adapter translates between the bot's expected format and your tables.

---

## Example: MongoDB

- One collection: `batches`.
- Each document: `{ _id: "winter_2026_01", created_at: ..., context_tags: [...], items: [...] }`.
- **`getBatchLedger`**: `findOne` by `_id`, return the document in the expected shape.
- **`updateBatchLedger`**: `updateOne` with `$set` for `items`.
- **`upsertBatchItems`**: Load, merge new items, save.

---

## Workflow options

**Database only:** Store everything in the DB. Remove the `batches/*.json` commit/push step from the workflow.

**Hybrid:** Write to both the DB and JSON files. Useful for an audit trail in the repo.

**GitHub as source:** Use the DB only as a cache. More complex; usually not needed.

---

## Migrating existing data

If you already have `batches/*.json` in the repo:

1. Write a script that reads each JSON file and calls `upsertBatchItems` for that batch.
2. Run it once.
3. Switch the bot and scripts to the adapter.
4. Optionally add `batches/` to `.gitignore`.

---

## Quick reference

| Task | GitHub (default) | Database |
|------|------------------|----------|
| Read a batch | GitHub API | `getBatchLedger(batchId)` |
| Mark image used | GitHub API | `updateBatchLedger(batchId, ledger)` |
| Add new images | Script writes JSON, workflow commits | Script calls `upsertBatchItems`, no commit |
| Config | `GITHUB_TOKEN` | `DATABASE_URL` |

---

See the [README](README.md) and [tasks.md](tasks.md) for more on the product and workflow.
