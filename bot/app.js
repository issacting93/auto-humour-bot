const { App, ExpressReceiver } = require('@slack/bolt');
const { Octokit } = require('octokit');
require('dotenv').config();

const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    processBeforeResponse: true
});

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver
});

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Helper: Fetch Ledger
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

// Helper: Mark Image as Used
async function markImageAsUsed(batchId, imageId, link, user) {
    const ledgerInfo = await getBatchLedger(batchId);
    if (!ledgerInfo) {
        return { success: false, message: `Batch \`${batchId}\` not found.` };
    }

    const { data: ledger, sha } = ledgerInfo;
    const itemIndex = ledger.items.findIndex(i => i.image_id === imageId);

    if (itemIndex === -1) {
        return { success: false, message: `Image \`${imageId}\` not found in batch \`${batchId}\`.` };
    }

    if (ledger.items[itemIndex].status === 'used') {
        return { success: false, message: `Image \`${imageId}\` is already marked as used.` };
    }

    // Update Request
    ledger.items[itemIndex].status = 'used';
    ledger.items[itemIndex].used_at = new Date().toISOString();
    ledger.items[itemIndex].used_in = link;
    ledger.items[itemIndex].used_by = user;

    try {
        // Commit back to GitHub
        const newContent = Buffer.from(JSON.stringify(ledger, null, 2)).toString('base64');

        await octokit.rest.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: `batches/${batchId}.json`,
            message: `Mark ${imageId} used in ${batchId} (via ${user})`,
            content: newContent,
            sha: sha
        });

        const total = ledger.items.length;
        const usedCount = ledger.items.filter(i => i.status === 'used').length;
        const remaining = total - usedCount;

        let message = `✅ Marked \`${imageId}\` as used!\nRemaining in batch: ${remaining}/${total}`;
        if (remaining === 0) {
            message += `\n🚨 Batch \`${batchId}\` is exhausted — need more images!`;
        } else if (total > 0 && remaining / total <= 0.2) {
            message += `\n⚠️ Batch \`${batchId}\` is running low!`;
        }

        return { success: true, message };

    } catch (error) {
        console.error('Error updating GitHub:', error);
        return { success: false, message: `❌ Failed to update GitHub ledger: ${error.message}` };
    }
}

const bodyParser = require('body-parser');

// 1. Status Endpoint (GET)
receiver.app.get('/webhook/status/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;
        const ledgerInfo = await getBatchLedger(batchId);

        if (!ledgerInfo) {
            return res.status(404).json({ error: `Batch ${batchId} not found` });
        }

        const { data: ledger } = ledgerInfo;
        const total = ledger.items.length;
        const used = ledger.items.filter(i => i.status === 'used').length;
        const remaining = total - used;

        let status = 'healthy';
        if (remaining === 0) status = 'empty';
        else if (remaining / total <= 0.2) status = 'low';

        return res.json({
            batchId,
            total,
            used,
            remaining,
            status,
            updated_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('[webhook] Status error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// 2. Upload Endpoint (POST)
receiver.app.post('/webhook/upload', bodyParser.json({ limit: '50mb' }), async (req, res) => {
    try {
        // Validate Secret
        const authHeader = req.headers.authorization;
        if (!WEBHOOK_SECRET || authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { batchId, filename, image } = req.body;
        if (!batchId || !filename || !image) {
            return res.status(400).json({ error: 'Missing batchId, filename, or image (base64)' });
        }

        console.log(`[webhook] Uploading ${filename} to ${batchId}`);

        // Remove data:image/...;base64, prefix if present
        const base64Content = image.replace(/^data:image\/\w+;base64,/, "");
        const path = `images/inbox/${batchId}/${filename}`;

        // Create file on GitHub
        await octokit.rest.repos.createOrUpdateFileContents({
            owner: REPO_OWNER,
            repo: REPO_NAME,
            path: path,
            message: `Upload ${filename} to ${batchId} via webhook`,
            content: base64Content
        });

        return res.json({
            success: true,
            message: `File uploaded to ${path}. Ingestion workflow triggered.`
        });

    } catch (error) {
        console.error('[webhook] Upload error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Webhook Endpoint - Attach directly to Express app with specific body parser
receiver.app.post('/webhook/ledger', bodyParser.json(), async (req, res) => {
    try {
        // 1. Validate Secret
        const authHeader = req.headers.authorization;
        if (!WEBHOOK_SECRET || authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
            console.warn('[webhook] Unauthorized attempt');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 2. Parse Body
        console.log('[webhook] Body:', req.body);
        if (!req.body) {
            return res.status(400).json({ error: 'No body provided' });
        }

        const { batchId, imageId, action, link, user } = req.body;

        if (!batchId || !imageId || !action) {
            return res.status(400).json({ error: 'Missing required fields: batchId, imageId, action' });
        }

        if (action === 'mark_used') {
            console.log(`[webhook] Request to mark ${imageId} used in ${batchId}`);
            const result = await markImageAsUsed(batchId, imageId, link || 'N/A', user || 'webhook');

            if (result.success) {
                return res.json({ success: true, message: result.message });
            } else {
                return res.status(404).json({ success: false, error: result.message });
            }
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (error) {
        console.error('[webhook] Error processing request:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

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
                await reply("🚨 This batch is exhausted — need more images!");
            } else if (total > 0 && remaining / total <= 0.2) {
                await reply(`⚠️ This batch is running low — only ${remaining} image(s) left!`);
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

            const result = await markImageAsUsed(batchId, imageId, link, command.user_name);
            await reply(result.message);
        }

        else {
            await reply("Unknown command. Try `status <batch_id>` or `used <batch_id> <image_id> [link]`.");
        }
    } catch (err) {
        console.error('[meme] Error:', err);
        await reply(`❌ Error: ${err.message}`).catch(() => { });
    }
});

(async () => {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Bolt app is running!');
})();
