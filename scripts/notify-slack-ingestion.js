#!/usr/bin/env node
/**
 * Reads .ingestion-summary.json (from update-ledger.js) and posts to Slack webhook.
 * Usage: SLACK_WEBHOOK_URL=... REPO=owner/name node scripts/notify-slack-ingestion.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const summaryPath = path.join(__dirname, '../.ingestion-summary.json');
const webhookUrl = process.env.SLACK_WEBHOOK_URL;
const repo = process.env.GITHUB_REPOSITORY || process.env.REPO || 'Nj-E/Workflow-example';

if (!webhookUrl) {
  console.log('SLACK_WEBHOOK_URL not set, skipping Slack notification');
  process.exit(0);
}

if (!fs.existsSync(summaryPath)) {
  console.log('.ingestion-summary.json not found, skipping');
  process.exit(0);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const batches = summary.batches || [];

let text;
if (batches.length === 0) {
  text = '📁 Ledgers updated (no new images in this push).';
} else {
  const lines = ['🖼 *New images ingested*\n'];
  batches.forEach(b => {
    lines.push(`• *${b.batchId}*: ${b.newCount} new image(s) (${b.total} total)`);
    lines.push(`  ${(b.newImages || []).join(', ')}`);
  });
  lines.push(`\n<https://github.com/${repo}/tree/main/images/inbox|View inbox on GitHub>`);
  text = lines.join('\n');
}

const payload = JSON.stringify({ text });
const url = new URL(webhookUrl);
const isHttps = url.protocol === 'https:';
const lib = isHttps ? https : http;

const req = lib.request({
  hostname: url.hostname,
  port: url.port || (isHttps ? 443 : 80),
  path: url.pathname + url.search,
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
}, res => {
  if (res.statusCode >= 200 && res.statusCode < 300) {
    console.log('Slack notification sent');
  } else {
    console.error('Slack webhook failed:', res.statusCode, res.statusMessage);
    process.exit(1);
  }
});

req.on('error', err => {
  console.error('Slack request error:', err.message);
  process.exit(1);
});
req.write(payload);
req.end();
