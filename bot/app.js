const { App, ExpressReceiver } = require('@slack/bolt');
const { Octokit } = require('octokit');
const bodyParser = require('body-parser');

// Helper: Post to Slack
async function postToSlack(text) {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) {
        console.log('[slack] SLACK_WEBHOOK_URL not set, skipping notification');
        return;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!response.ok) {
            console.error(`[slack] Failed to post: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        console.error('[slack] Error posting to Slack:', error);
    }
}
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
const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || 'main';

const ALLOWED_IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)$/i;
const VALID_ID = /^[a-zA-Z0-9_\-\.]+$/;

function isValidId(str) {
    return typeof str === 'string' && str.length > 0 && VALID_ID.test(str) && !str.includes('..');
}

// Helper: Fetch Ledger
async function getBatchLedger(batchId) {
    const path = `batches/${batchId}.json`;
    try {
        const { data } = await octokit.rest.repos.getContent({
            owner: REPO_OWNER, repo: REPO_NAME, path, ref: DEFAULT_BRANCH
        });
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return { data: JSON.parse(content), sha: data.sha };
    } catch (error) {
        if (error.status === 404) return null;
        console.error(`[meme] Error fetching ledger for ${batchId}:`, error.message);
        return null;
    }
}

// Helper: Mark Image as Used (with retry on SHA conflict)
async function markImageAsUsed(batchId, imageId, link, user, retries = 1) {
    const ledgerInfo = await getBatchLedger(batchId);
    if (!ledgerInfo) {
        return { success: false, reason: 'not_found', message: `Batch \`${batchId}\` not found.` };
    }

    const { data: ledger, sha } = ledgerInfo;
    const itemIndex = ledger.items.findIndex(i => i.image_id === imageId);

    if (itemIndex === -1) {
        return { success: false, reason: 'not_found', message: `Image \`${imageId}\` not found in batch \`${batchId}\`.` };
    }

    if (ledger.items[itemIndex].status === 'used') {
        return { success: false, reason: 'already_used', message: `Image \`${imageId}\` is already marked as used.` };
    }

    ledger.items[itemIndex].status = 'used';
    ledger.items[itemIndex].used_at = new Date().toISOString();
    ledger.items[itemIndex].used_in = link;
    ledger.items[itemIndex].used_by = user;

    try {
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
        if (error.status === 409 && retries > 0) {
            console.warn(`[meme] SHA conflict for ${batchId}, retrying...`);
            return markImageAsUsed(batchId, imageId, link, user, retries - 1);
        }
        console.error('[meme] Error updating GitHub:', error.message);
        return { success: false, reason: 'github_error', message: `❌ Failed to update GitHub ledger: ${error.message}` };
    }
}

// 1. Status Endpoint (GET) — unauthenticated
receiver.app.get('/webhook/status/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;
        if (!isValidId(batchId)) {
            return res.status(400).json({ error: 'Invalid batchId' });
        }

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
        console.error('[webhook] Status error:', error.message);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 2. Upload Endpoint (POST)
receiver.app.post('/webhook/upload', bodyParser.json({ limit: '50mb' }), async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!WEBHOOK_SECRET || authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { batchId, filename, image } = req.body;
        if (!batchId || !filename || !image) {
            return res.status(400).json({ error: 'Missing batchId, filename, or image (base64)' });
        }

        // Validate basic ID format
        if (!isValidId(batchId) || !isValidId(filename)) {
            return res.status(400).json({ error: 'Invalid batchId or filename. Use alphanumeric characters, hyphens, underscores, and dots only.' });
        }

        // Validate extension
        if (!ALLOWED_IMAGE_EXT.test(filename)) {
            return res.status(400).json({ error: 'Invalid file type. Allowed: jpg, jpeg, png, gif, webp' });
        }

        console.log(`[webhook] Uploading ${filename} to ${batchId}`);

        const base64Content = image.replace(/^data:image\/\w+;base64,/, "");
        const filePath = `images/inbox/${batchId}/${filename}`;

        try {
            await octokit.rest.repos.createOrUpdateFileContents({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: filePath,
                message: `Upload ${filename} to ${batchId} via webhook`,
                content: base64Content
            });
        } catch (ghError) {
            if (ghError.status === 422) {
                return res.status(409).json({ error: `File ${filename} already exists in batch ${batchId}` });
            }
            throw ghError;
        }

        // Slack Notification
        // Fetch current ledger to estimate stats (current + 1 for the new upload)
        const ledgerInfo = await getBatchLedger(batchId);
        let total = 1;
        let used = 0;

        if (ledgerInfo) {
            const { data: ledger } = ledgerInfo;
            total = ledger.items.length + 1; // Existing + this new one
            used = ledger.items.filter(i => i.status === 'used').length;
        }

        const remaining = total - used;

        let stockNote = 'healthy';
        if (remaining === 0) stockNote = 'empty';
        else if (remaining / total <= 0.2) stockNote = 'low';

        const inboxUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/${DEFAULT_BRANCH}/images/inbox/${batchId}`;

        let text = `🆕 Image uploaded via webhook\n` +
            `• Batch: *${batchId}*\n` +
            `• File: \`${filename}\`\n` +
            `• Remaining: *${remaining}/${total}* (${stockNote})\n` +
            `• Inbox: ${inboxUrl}`;

        if (stockNote === 'low') text += `\n⚠️ Batch *${batchId}* is running low.`;
        if (stockNote === 'empty') text += `\n🚨 Batch *${batchId}* is exhausted — need more images!`;

        await postToSlack(text);

        return res.json({
            success: true,
            message: `File uploaded to ${filePath}. Slack notification sent.`
        });

    } catch (error) {
        console.error('[webhook] Upload error:', error.message);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 3. Ledger Endpoint (POST)
receiver.app.post('/webhook/ledger', bodyParser.json(), async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!WEBHOOK_SECRET || authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
            console.warn('[webhook] Unauthorized attempt');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!req.body) {
            return res.status(400).json({ error: 'No body provided' });
        }

        const { batchId, imageId, action, link, user } = req.body;

        if (!batchId || !imageId || !action) {
            return res.status(400).json({ error: 'Missing required fields: batchId, imageId, action' });
        }

        if (!isValidId(batchId) || !isValidId(imageId)) {
            return res.status(400).json({ error: 'Invalid batchId or imageId. Use alphanumeric characters, hyphens, underscores, and dots only.' });
        }

        if (action === 'mark_used') {
            console.log(`[webhook] mark_used ${imageId} in ${batchId}`);
            const result = await markImageAsUsed(batchId, imageId, link || 'N/A', user || 'webhook');

            if (result.success) {
                return res.json({ success: true, message: result.message });
            } else if (result.reason === 'already_used') {
                return res.status(409).json({ success: false, error: result.message });
            } else if (result.reason === 'not_found') {
                return res.status(404).json({ success: false, error: result.message });
            } else {
                return res.status(500).json({ success: false, error: result.message });
            }
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (error) {
        console.error('[webhook] Error processing request:', error.message);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Command: /meme status <batch_id> | used <batch_id> <image_id> [link]
app.command('/meme', async ({ command, ack, say, respond }) => {
    console.log('[meme] Command received:', command.text || '(no text)');
    await ack();

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

            const baseUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${DEFAULT_BRANCH}`;
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
