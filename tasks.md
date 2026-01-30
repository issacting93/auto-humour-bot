Here’s the full “what we want to do” plan, written as a detailed system + workflow spec.

---

# Goal

Build an automated meme-caption workflow where:

* Person A uploads batches of uncaptained images
* The team generates multiple “humour flavour” captions per image
* Person B curates, discards bad outputs, and sends finalists to a voting prototype
* The system tracks which images are used, what’s remaining, and when more images are needed
* Miscommunication about humour flavour / prompt / image is minimized by making everything structured + logged

---

# Core design principle

**Every image becomes a trackable unit** with:

* a batch ID
* an image ID
* a status (new → used)
* a record of where it was used (prototype link / PR / Vercel deploy)
* (optional) what humour flavour(s) were generated and selected

This tracking record lives in GitHub so it’s versioned and auditable.

---

# Tools we will use

1. **GitHub repo**

   * Stores images, batch ledgers, humour flavour prompt templates, generated captions, and “published” outputs.
2. **GitHub Actions**

   * Automates detection of new images and notifies Slack.
   * (Optional) auto-updates batch ledger files when images are added.
3. **Slack integration (bot + webhook)**

   * Notifies team when new images arrive.
   * Allows team/B to mark images as “used” and updates GitHub ledger automatically.
   * Warns when a batch is running low or empty.
4. **Prototype web app on Vercel**

   * Displays selected image + captions for voting.
   * Stores votes (in its own storage) and identifies winners.

---

# Repo structure (single source of truth)

We standardize how images and records are stored so automation is reliable.

```
repo/
  images/
    inbox/
      <batch_id>/
        IMG_0001.jpg
        IMG_0002.jpg
    published/
      <batch_id>/
        IMG_0002.jpg

  batches/
    <batch_id>.json

  flavours/
    deadpan_v1.md
    noir_detective_v1.md
    genz_v2.md

  generated/
    <batch_id>/
      IMG_0001/
        deadpan_v1.json
        noir_detective_v1.json
```

**Rules**

* A only uploads images into `images/inbox/<batch_id>/`.
* No one renames images after upload (the system uses filenames as stable IDs).
* Batch ledger is always located at `batches/<batch_id>.json`.

---

# Batch Ledger (what we track)

Each batch has a ledger file that tracks all images and their states.

`batches/winter_2026_01.json`

* batch metadata:

  * batch_id
  * created_at
  * context tags (winter / office / pets)
* items array:

  * image_id (derived from filename or assigned)
  * file path in repo
  * status: `new` or `used`
  * used_by, used_at, used_in (link)

This ledger is how we automate:

* “What’s new?”
* “What’s used?”
* “Do we need more images?”

---

# Automated workflow (end-to-end)

## Phase 1 — Image ingestion (Person A)

### What A does

1. Collect images from the internet (no captions).
2. Decide a batch context (e.g. “winter”).
3. Upload images into GitHub:

   * `images/inbox/winter_2026_01/`

### What the system does automatically

1. GitHub push triggers a GitHub Action.
2. Action identifies newly added images.
3. Action posts a Slack notification to the team with:

   * batch name
   * number of new images
   * link to the GitHub folder
   * list of file names

**Outcome:** B never has to ask “did you upload more?” — Slack will say it.

---

## Phase 2 — Batch registration (automated ledger update)

### What the system does

When new images land in `images/inbox/<batch_id>/…`, the system ensures the batch ledger is up-to-date.

Two possible implementations:

* (Preferred) GitHub Action auto-creates/updates `batches/<batch_id>.json`
* (Fallback) a person creates the batch ledger manually once

**Outcome:** every image has a tracking record.

---

## Phase 3 — Caption generation (humour flavours)

### Objective

For each image, generate **10–15 captions per humour flavour**, but in a consistent way.

### How we prevent miscommunication

* Humour flavours are stored as versioned prompt templates in `flavours/*.md`
* The flavour file is the “single source of truth”
* No one invents prompts in Slack chats

### What the system does

1. For each new image:

   * run the caption generator for selected flavours
2. Store outputs in GitHub:

   * `generated/<batch_id>/<image_id>/<flavour_id>.json`
3. Optionally post in Slack:

   * “Captions ready for review: link to generated outputs”

**Outcome:** “right flavour but wrong prompt” becomes almost impossible.

---

## Phase 4 — Curation (Person B)

### What B does

1. Review generated captions for each image.
2. Discard bad AI outputs.
3. Shortlist good ones for the voting prototype.

Where B does this review can evolve:

* v1: review via GitHub files (generated JSON)
* v2: review via a small web dashboard
* v3: review inside Slack via buttons

**Outcome:** B selects high quality finalists only.

---

## Phase 5 — Voting (prototype on Vercel)

### What happens

1. Shortlisted image+caption pairs are added to the voting set.
2. Humans vote for what’s funniest.
3. Top winners are marked “publish”.

**Outcome:** publishing is driven by human judgement, not only AI.

---

## Phase 6 — Usage tracking (Slack → GitHub)

### Objective

When an image is used in the prototype (or published), we mark it “used” so we don’t reuse it by accident and we know when to request more.

### What B/team does

Use Slack commands like:

* `/meme used winter_2026_01 IMG_0007 https://vercel.app/vote/123`

### What the bot does automatically

1. Update `batches/winter_2026_01.json`
2. Commit it to GitHub with a clear commit message:

   * “Mark IMG_0007 used in winter_2026_01”
3. Respond in Slack:

   * “✅ Marked used. Remaining: 8/20”

**Outcome:** usage tracking is as easy as a Slack message.

---

## Phase 7 — Batch completion alerts (automatic)

### Objective

Automatically highlight when:

* a batch is nearly depleted
* a batch is fully used

### What the system does

Every time an image is marked “used”, the bot checks the batch ledger.

Triggers:

* If remaining ≤ 20% → Slack warning: “running low”
* If remaining == 0 → Slack alert: “batch exhausted; need more images”

**Outcome:** A gets an automatic “please upload more” signal without B asking.

---

# Slack commands we want (final list)

Minimum commands:

* `/meme status <batch_id>`

  * returns remaining/total + list of unused images
* `/meme used <batch_id> <image_id> [link]`

  * marks used + commits ledger update

Nice-to-have:

* `/meme unused <batch_id>` (lists remaining)
* `/meme request-more <batch_id>` (pings A and opens new batch suggestion)
* `/meme batches` (shows active batches + remaining counts)

---

# What success looks like

* A uploads images → team gets Slack ping automatically
* B never hunts through messy folders
* Every image has a status and provenance
* Miscommunication about flavour/prompt is reduced because flavours are versioned assets
* When a batch runs out, Slack tells you automatically
* GitHub records everything: what was added, what was used, and when

---

If you want, I can turn this into:

* a one-page **PRD style workflow doc**
* the exact **JSON schema** for the batch ledger + generated captions
* and the concrete **GitHub Actions + Slack bot implementation plan** (step-by-step).
