'use strict';

const fs = require('fs');
const path = require('path');

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const REPO = process.env.GITHUB_REPOSITORY || 'adrian-gss/copy-vault';
const COMMIT_SHA = process.argv[2];

if (!COMMIT_SHA) { console.error('Usage: node post.js <commit-sha>'); process.exit(1); }
if (!MAKE_WEBHOOK_URL) { console.error('Missing MAKE_WEBHOOK_URL env var'); process.exit(1); }

async function main() {
  const caption = fs.readFileSync(path.join(__dirname, 'output/caption.txt'), 'utf-8');
  const imageUrl = `https://raw.githubusercontent.com/${REPO}/${COMMIT_SHA}/automation/output/post.jpg`;

  console.log('Image URL:', imageUrl);

  const res = await fetch(MAKE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Make webhook failed (${res.status}): ${text}`);
  }

  console.log('Make webhook called successfully');
}

main().catch(err => { console.error(err); process.exit(1); });
