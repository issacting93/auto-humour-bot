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
    const path = `batches/${batchId}.json`;
    for (const ref of ['main', undefined, 'master']) {
        try {
            console.log(`[meme] Fetching ledger from ${REPO_OWNER}/${REPO_NAME} ${path}${ref ? ` (ref: ${ref})` : ' (default branch)'}`);
            const params = { owner: REPO_OWNER, repo: REPO_NAME, path };
            if (ref) params.ref = ref;
            const { data } = await octokit.rest.repos.getContent(params);

            // GitHub API returns content in base64
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            return { data: JSON.parse(content), sha: data.sha };
        } catch (error) {
            if (error.status === 404) continue;
            console.error(`[meme] Error fetching ledger for ${batchId} from ${REPO_OWNER}/${REPO_NAME}:`, error.message, error.status);
            return null;
        }
    }
    console.error(`[meme] Ledger ${batchId} not found on main, default branch, or master`);
    return null;
}

// Command: /meme status <batch_id>
app.command('/meme', async ({ command, ack, say, respond }) => {
    console.log('[meme] Command received:', command.text || '(no text)');
    await ack();

    // Use respond() so the bot works even when not in the channel (ephemeral reply to user)
    const reply = respond ? (msg) => respond(msg) : say;

    const args = (command.text || '').trim().split(/\s+/).filter(Boolean);
    const subCommand = args[0] || '';
    const batchId = args[1];

    try {
    if (subCommand === 'status') {
        if (!batchId) {
            await reply("Usage: `/meme status <batch_id>`");
            return;
        }

        const ledgerInfo = await getBatchLedger(batchId);
        if (!ledgerInfo) {
            await reply(`❌ Batch \`${batchId}\` not found.`);
            return;
        }

        const { data: ledger } = ledgerInfo;
        const total = ledger.items.length;
        const used = ledger.items.filter(i => i.status === 'used').length;
        const remaining = total - used;

        const baseUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main`;
        const imageLines = ledger.items
            .map(i => `• <${baseUrl}/${i.file_path}|${i.image_id}> (${i.status})`)
            .join('\n');

        await reply(`📊 *Batch Status: ${batchId}*\nTotal: ${total} | Used: ${used} | Remaining: ${remaining}\n\n*Images:*\n${imageLines || '_none_'}`);

        if (remaining === 0) {
            await reply("⚠️ This batch is empty!");
        }
    }

    else if (subCommand === 'used') {
        // Usage: /meme used <batch_id> <image_id> [link]
        const imageId = args[2];
        const link = args[3] || 'N/A';

        if (!batchId || !imageId) {
            await reply("Usage: `/meme used <batch_id> <image_id> [link]`");
            return;
        }

        const ledgerInfo = await getBatchLedger(batchId);
        if (!ledgerInfo) {
            await reply(`❌ Batch \`${batchId}\` not found.`);
            return;
        }

        const { data: ledger, sha } = ledgerInfo;
        const itemIndex = ledger.items.findIndex(i => i.image_id === imageId);

        if (itemIndex === -1) {
            await reply(`❌ Image \`${imageId}\` not found in batch \`${batchId}\`.`);
            return;
        }

        if (ledger.items[itemIndex].status === 'used') {
            await reply(`ℹ️ Image \`${imageId}\` is already marked as used.`);
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

            await reply(`✅ Marked \`${imageId}\` as used!\nRemaining in batch: ${remaining}`);

        } catch (error) {
            console.error('Error updating GitHub:', error);
            await reply(`❌ Failed to update GitHub ledger: ${error.message}`);
        }
    }

    else {
        await reply("Unknown command. Try `status <batch_id>` or `used <batch_id> <image_id> [link]`.");
    }
    } catch (err) {
        console.error('[meme] Error:', err);
        await reply(`❌ Error: ${err.message}`).catch(() => {});
    }
});

(async () => {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Bolt app is running!');
})();
