const fs = require('fs');
const path = require('path');

const INBOX_DIR = path.join(__dirname, '../images/inbox');
const BATCHES_DIR = path.join(__dirname, '../batches');

if (!fs.existsSync(BATCHES_DIR)) {
  fs.mkdirSync(BATCHES_DIR, { recursive: true });
}

function getBatchIds() {
  if (!fs.existsSync(INBOX_DIR)) return [];
  return fs.readdirSync(INBOX_DIR).filter(file => {
    return fs.statSync(path.join(INBOX_DIR, file)).isDirectory();
  });
}

function updateLedger(batchId) {
  const batchDir = path.join(INBOX_DIR, batchId);
  const ledgerPath = path.join(BATCHES_DIR, `${batchId}.json`);

  let ledger = {
    batch_id: batchId,
    created_at: new Date().toISOString(),
    context_tags: [],
    items: []
  };

  if (fs.existsSync(ledgerPath)) {
    try {
      ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    } catch (e) {
      console.error(`Error reading ledger for ${batchId}:`, e);
    }
  }

  const images = fs.readdirSync(batchDir).filter(file => {
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(file);
  });

  // Remove orphaned entries (image in ledger but file no longer on disk)
  const beforeCount = ledger.items.length;
  ledger.items = ledger.items.filter(item => {
    const stillExists = images.includes(item.image_id);
    if (!stillExists) {
      console.log(`Batch [${batchId}]: Removed orphaned entry ${item.image_id}`);
    }
    return stillExists;
  });
  const orphanedCount = beforeCount - ledger.items.length;

  // Add new images
  let newCount = 0;
  const newImages = [];

  images.forEach(image => {
    const existingItem = ledger.items.find(item => item.image_id === image);

    if (!existingItem) {
      ledger.items.push({
        image_id: image,
        file_path: `images/inbox/${batchId}/${image}`,
        status: 'new',
        added_at: new Date().toISOString()
      });
      newCount++;
      newImages.push(image);
    }
  });

  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  if (newCount > 0 || orphanedCount > 0) {
    console.log(`Batch [${batchId}]: Added ${newCount} new, removed ${orphanedCount} orphaned.`);
  } else {
    console.log(`Batch [${batchId}]: No changes.`);
  }

  return { batchId, newCount, total: ledger.items.length, newImages };
}

const batchIds = getBatchIds();
const summaries = [];

if (batchIds.length === 0) {
  console.log("No batches found in images/inbox.");
} else {
  console.log(`Found batches: ${batchIds.join(', ')}`);
  batchIds.forEach(batchId => {
    const summary = updateLedger(batchId);
    if (summary && summary.newCount > 0) {
      summaries.push(summary);
    }
  });
}

// Write summary for Slack notification (used by GitHub Actions)
const summaryPath = path.join(__dirname, '../.ingestion-summary.json');
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) {
  console.warn('GITHUB_REPOSITORY not set, summary will omit repo link');
}
fs.writeFileSync(summaryPath, JSON.stringify({ repo: repo || '', batches: summaries }, null, 2));
