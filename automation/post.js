'use strict';

const fs = require('fs');
const path = require('path');

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const REPO = process.env.GITHUB_REPOSITORY || 'adrian-gss/copy-vault';
const COMMIT_SHA = process.argv[2];

if (!COMMIT_SHA) { console.error('Usage: node post.js <commit-sha>'); process.exit(1); }
if (!MAKE_WEBHOOK_URL) { console.error('Missing MAKE_WEBHOOK_URL env var'); process.exit(1); }

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// POST to the Make webhook, retrying on transient network failures (ECONNRESET,
// fetch failed, timeouts) and 5xx responses. Make's edge occasionally drops the
// connection mid-request; a single blip shouldn't kill the daily post.
async function postWithRetry(url, body, { tries = 5, baseDelayMs = 3000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return res;
      // 5xx → retry; 4xx → permanent, fail immediately
      const text = await res.text().catch(() => '');
      if (res.status >= 500 && attempt < tries) {
        lastErr = new Error(`Make webhook ${res.status}: ${text}`);
        console.warn(`Attempt ${attempt}/${tries} got ${res.status}; retrying...`);
      } else {
        throw new Error(`Make webhook failed (${res.status}): ${text}`);
      }
    } catch (err) {
      lastErr = err;
      if (attempt < tries) {
        console.warn(`Attempt ${attempt}/${tries} failed (${err.cause?.code || err.message}); retrying...`);
      }
    }
    if (attempt < tries) await sleep(baseDelayMs * attempt); // linear backoff: 3s, 6s, 9s, 12s
  }
  throw lastErr;
}

async function main() {
  const caption = fs.readFileSync(path.join(__dirname, 'output/caption.txt'), 'utf-8');
  const imageUrl = `https://raw.githubusercontent.com/${REPO}/${COMMIT_SHA}/automation/output/post.jpg`;

  console.log('Image URL:', imageUrl);

  await postWithRetry(MAKE_WEBHOOK_URL, { image_url: imageUrl, caption });

  console.log('Make webhook called successfully');
}

main().catch(err => { console.error(err); process.exit(1); });
