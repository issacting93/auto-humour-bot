const { App } = require('@slack/bolt');
const { Octokit } = require('octokit');
require('dotenv').config();

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const REPO_OWNER = process.env.REPO_OWNER; // e.g. 'zac'
const REPO_NAME = process.env.REPO_NAME;   // e.g. 'Auto-Humour-Bot'

async function getBatchLedger(batchId) {
    try {
        const { data } = await octokit.rest.repos.getContent({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: `batches/${batchId}.json`,
        });

        // GitHub API returns content in base64
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return { data: JSON.parse(content), sha: data.sha };
    } catch (error) {
        console.error(`Error fetching ledger for ${batchId}:`, error);
        return null;
    }
}

// Command: /meme status <batch_id>
app.command('/meme', async ({ command, ack, say }) => {
    await ack();

    const args = command.text.split(' ');
    const subCommand = args[0];
    const batchId = args[1];

    if (subCommand === 'status') {
        if (!batchId) {
            await say("Usage: `/meme status <batch_id>`");
            return;
        }

        const ledgerInfo = await getBatchLedger(batchId);
        if (!ledgerInfo) {
            await say(`❌ Batch \`${batchId}\` not found.`);
            return;
        }

        const { data: ledger } = ledgerInfo;
        const total = ledger.items.length;
        const used = ledger.items.filter(i => i.status === 'used').length;
        const remaining = total - used;

        await say(`📊 *Batch Status: ${batchId}*\nTotal: ${total} | Used: ${used} | Remaining: ${remaining}`);

        if (remaining === 0) {
            await say("⚠️ This batch is empty!");
        }
    }

    else if (subCommand === 'used') {
        // Usage: /meme used <batch_id> <image_id> [link]
        const imageId = args[2];
        const link = args[3] || 'N/A';

        if (!batchId || !imageId) {
            await say("Usage: `/meme used <batch_id> <image_id> [link]`");
            return;
        }

        const ledgerInfo = await getBatchLedger(batchId);
        if (!ledgerInfo) {
            await say(`❌ Batch \`${batchId}\` not found.`);
            return;
        }

        const { data: ledger, sha } = ledgerInfo;
        const itemIndex = ledger.items.findIndex(i => i.image_id === imageId);

        if (itemIndex === -1) {
            await say(`❌ Image \`${imageId}\` not found in batch \`${batchId}\`.`);
            return;
        }

        if (ledger.items[itemIndex].status === 'used') {
            await say(`ℹ️ Image \`${imageId}\` is already marked as used.`);
            return;
        }

        // Update Request
        ledger.items[itemIndex].status = 'used';
        ledger.items[itemIndex].used_at = new Date().toISOString();
        ledger.items[itemIndex].used_in = link;
        ledger.items[itemIndex].used_by = command.user_name;

        try {
            // Commit back to GitHub
            const newContent = Buffer.from(JSON.stringify(ledger, null, 2)).toString('base64');

            await octokit.rest.repos.createOrUpdateFileContents({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: `batches/${batchId}.json`,
                message: `Mark ${imageId} used in ${batchId} (via Slack)`,
                content: newContent,
                sha: sha
            });

            const usedCount = ledger.items.filter(i => i.status === 'used').length;
            const remaining = ledger.items.length - usedCount;

            await say(`✅ Marked \`${imageId}\` as used!\nRemaining in batch: ${remaining}`);

        } catch (error) {
            console.error('Error updating GitHub:', error);
            await say(`❌ Failed to update GitHub ledger: ${error.message}`);
        }
    }

    else {
        await say("Unknown command. Try `status` or `used`.");
    }
});

(async () => {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Bolt app is running!');
})();
