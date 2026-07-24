'use strict';

// ── PUBLISH TO LINKEDIN (company page) ────────────────
// Independent from post.js (which still publishes to Instagram via Make).
// Reads the image + caption that generate.js already produced and publishes
// them to the Copy Vault LinkedIn *organization* page using LinkedIn's API:
//   1. initializeUpload  → get an upload URL + image URN
//   2. PUT the JPEG bytes to that upload URL
//   3. (poll) wait until the image finishes processing
//   4. POST /rest/posts  → create the image post as the organization
//
// Docs: https://learn.microsoft.com/linkedin/marketing/community-management/shares/images-api
//
// Required env:
//   LINKEDIN_ACCESS_TOKEN   token with w_organization_social (org page ADMIN)
//   LINKEDIN_ORG_URN        e.g. "urn:li:organization:12345"  (or LINKEDIN_ORG_ID=12345)
// Optional env (auto-refresh so the token never silently expires):
//   LINKEDIN_REFRESH_TOKEN + LINKEDIN_CLIENT_SECRET (+ LINKEDIN_CLIENT_ID)
//   LINKEDIN_VERSION        API version YYYYMM (default below)

const fs = require('fs');
const path = require('path');

const API = 'https://api.linkedin.com';
const LINKEDIN_VERSION = process.env.LINKEDIN_VERSION || '202606';
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '786ptou2qnkjc3';

function orgUrn() {
  if (process.env.LINKEDIN_ORG_URN) return process.env.LINKEDIN_ORG_URN;
  if (process.env.LINKEDIN_ORG_ID) return `urn:li:organization:${process.env.LINKEDIN_ORG_ID}`;
  throw new Error('Missing LINKEDIN_ORG_URN (or LINKEDIN_ORG_ID) env var');
}

// If a refresh token is configured, mint a fresh access token at runtime so the
// daily job never dies when the 60-day access token expires. Otherwise fall
// back to the static LINKEDIN_ACCESS_TOKEN.
async function getAccessToken() {
  const refresh = process.env.LINKEDIN_REFRESH_TOKEN;
  const secret = process.env.LINKEDIN_CLIENT_SECRET;
  if (refresh && secret) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: CLIENT_ID,
      client_secret: secret,
    });
    const r = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok || !data.access_token) {
      throw new Error(`Token refresh failed (${r.status}): ${JSON.stringify(data)}`);
    }
    console.log('Refreshed LinkedIn access token.');
    return data.access_token;
  }
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) throw new Error('Missing LINKEDIN_ACCESS_TOKEN (or a refresh-token config)');
  return token;
}

function headers(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra,
  };
}

// 1. Register the upload → { uploadUrl, image URN }
async function initializeUpload(token, owner) {
  const r = await fetch(`${API}/rest/images?action=initializeUpload`, {
    method: 'POST',
    headers: headers(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const data = await r.json();
  if (!r.ok || !data.value) {
    throw new Error(`initializeUpload failed (${r.status}): ${JSON.stringify(data)}`);
  }
  return { uploadUrl: data.value.uploadUrl, imageUrn: data.value.image };
}

// 2. Upload the raw JPEG bytes to the signed URL.
async function uploadBytes(uploadUrl, buffer, token) {
  const r = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: buffer,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Image upload failed (${r.status}): ${text}`);
  }
}

// 3. Best-effort wait until LinkedIn finishes processing the image, so the post
//    isn't created before the media is ready. Non-fatal if it can't be checked.
async function waitAvailable(imageUrn, token, { tries = 12, delayMs = 2000 } = {}) {
  const url = `${API}/rest/images/${encodeURIComponent(imageUrn)}`;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: headers(token) });
      if (r.ok) {
        const data = await r.json();
        if (data.status === 'AVAILABLE') return true;
        if (data.status === 'PROCESSING_FAILED') {
          throw new Error(`Image processing failed for ${imageUrn}`);
        }
      }
    } catch (e) {
      if (String(e).includes('processing failed')) throw e;
      // transient GET error → keep polling
    }
    await new Promise(res => setTimeout(res, delayMs));
  }
  console.warn(`Image ${imageUrn} not confirmed AVAILABLE after polling; posting anyway.`);
  return false;
}

// 4. Create the organization image post.
async function createPost(token, author, caption, imageUrn) {
  const body = {
    author,
    commentary: caption,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    content: {
      media: {
        altText: caption.split('\n')[0].slice(0, 300),
        id: imageUrn,
      },
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  const r = await fetch(`${API}/rest/posts`, {
    method: 'POST',
    headers: headers(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (r.status !== 201) {
    const text = await r.text().catch(() => '');
    throw new Error(`Create post failed (${r.status}): ${text}`);
  }
  return r.headers.get('x-restli-id');
}

async function main() {
  const caption = fs.readFileSync(path.join(__dirname, 'output/caption.txt'), 'utf-8');
  const imageBuf = fs.readFileSync(path.join(__dirname, 'output/post.jpg'));

  const owner = orgUrn();
  const token = await getAccessToken();

  const { uploadUrl, imageUrn } = await initializeUpload(token, owner);
  console.log('Image URN:', imageUrn);
  await uploadBytes(uploadUrl, imageBuf, token);
  await waitAvailable(imageUrn, token);
  const postId = await createPost(token, owner, caption, imageUrn);

  console.log('Published to LinkedIn:', postId || '(id in x-restli-id header not returned)');
}

main().catch(err => { console.error(err); process.exit(1); });
