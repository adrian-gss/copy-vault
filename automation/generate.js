'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── LOAD CORPUS FROM index.html ───────────────────────
function loadCorpus() {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');
  const marker = 'const CORPUS = ';
  const start = html.indexOf(marker) + marker.length;
  let depth = 0, i = start;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return JSON.parse(html.slice(start, i + 1));
}

// ── COMPLETENESS SCORE ────────────────────────────────
function score(entry) {
  return ['copy', 'brand', 'sector', 'copy_type', 'year', 'campaign', 'agency', 'medium', 'festival_or_note']
    .filter(f => entry[f]).length;
}

// ── SELECT NEXT COPY ──────────────────────────────────
// English first, then by most-complete metadata. Never repeats until all posted.
function selectNext(corpus, state) {
  const sorted = corpus
    .map((entry, idx) => ({ entry, idx }))
    .sort((a, b) => {
      if (a.entry.lang !== b.entry.lang) return a.entry.lang === 'en' ? -1 : 1;
      return score(b.entry) - score(a.entry);
    });

  let pick = sorted.find(({ idx }) => !state.posted.includes(idx));
  if (!pick) {            // all posted → reset the cycle
    state.posted = [];
    pick = sorted[0];
  }
  return pick;
}

// ── BUILD CAPTION ─────────────────────────────────────
function buildCaption(entry, counter) {
  const lines = [`"${entry.copy}"`, ''];
  if (entry.brand && entry.year) lines.push(`Brand: ${entry.brand} · ${entry.year}`);
  else if (entry.brand) lines.push(`Brand: ${entry.brand}`);
  if (entry.agency) lines.push(`Agency: ${entry.agency}`);
  if (entry.campaign) lines.push(`Campaign: ${entry.campaign}`);
  if (entry.sector) lines.push(`Sector: ${entry.sector.charAt(0).toUpperCase() + entry.sector.slice(1)}`);
  if (entry.festival_or_note) lines.push(`Award: ${entry.festival_or_note}`);
  lines.push('', 'Find this and more at: the-copy-vault.com', '', `(${counter}/365) #advertising #copywriting #thecopyvault`);
  return lines.join('\n');
}

// ── RENDER VIA HEADLESS BROWSER ───────────────────────
// Loads the real index.html and calls window.renderPostImage — the exact same
// canvas code as the site's "download post" button. Returns a JPEG buffer.
async function renderImage(copy, brand, year) {
  const fileUrl = 'file://' + path.resolve(__dirname, '../index.html');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(fileUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const dataUrl = await page.evaluate(
      ([c, b, y]) => window.renderPostImage(c, b, y),
      [copy, brand, year]
    );
    const base64 = dataUrl.split(',')[1];
    return Buffer.from(base64, 'base64');
  } finally {
    await browser.close();
  }
}

// ── MAIN ──────────────────────────────────────────────
async function main() {
  const corpus = loadCorpus();
  const statePath = path.join(__dirname, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

  const { entry, idx } = selectNext(corpus, state);

  state.counter = (state.counter % 365) + 1;
  state.posted.push(idx);

  const caption = buildCaption(entry, state.counter);
  const imageBuf = await renderImage(entry.copy, entry.brand, entry.year);

  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'output/post.jpg'), imageBuf);
  fs.writeFileSync(path.join(__dirname, 'output/caption.txt'), caption);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  console.log(`Generated post ${state.counter}/365: "${entry.copy.slice(0, 60)}"`);
}

main().catch(err => { console.error(err); process.exit(1); });
