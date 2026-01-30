const fs = require('fs');
const path = require('path');

const INBOX_DIR = path.join(__dirname, '../images/inbox');
const BATCHES_DIR = path.join(__dirname, '../batches');

// Ensure batches directory exists
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

  let newCount = 0;

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
    }
  });

  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  
  if (newCount > 0) {
    console.log(`Batch [${batchId}]: Added ${newCount} new images.`);
    // specific output format for GitHub Actions to capture if needed
    console.log(`::set-output name=new_images_${batchId}::${newCount}`); 
  } else {
    console.log(`Batch [${batchId}]: No new images.`);
  }
}

const batchIds = getBatchIds();
if (batchIds.length === 0) {
  console.log("No batches found in images/inbox.");
} else {
  console.log(`Found batches: ${batchIds.join(', ')}`);
  batchIds.forEach(updateLedger);
}
