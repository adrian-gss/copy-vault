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

const SPANISH_EVERY = 20;     // every Nth post is in Spanish (Rule 3)
const RICH_THRESHOLD = 5;     // score >= this counts as a "rich" (high-info) copy
const RECENT_BRANDS = 5;      // avoid brands used in the last N posts (soft)

// ── SELECT NEXT COPY ──────────────────────────────────
// Hard filters (must all pass), then soft ranking, then graceful fallback.
//   HARD:  1. not posted this cycle
//          2. brand != previous post's brand
//          3. language = Spanish on every 20th post, English otherwise
//          4. if the last two posts had no year, this one must have a year
//   SOFT (tie-breakers, in order): brand not used in last 5 posts, different
//          sector, alternate info level, then most complete.
//   FALLBACK: soft prefs relax naturally; as a last resort allow the same brand
//          / a published copy.
function selectNext(corpus, state) {
  const all = corpus.map((entry, idx) => ({ entry, idx }));
  const isSpanishSlot = (state.postIndex + 1) % SPANISH_EVERY === 0;
  const wantLang = isSpanishSlot ? 'es' : 'en';
  const needYear = state.lastTwoHadYear[0] === false && state.lastTwoHadYear[1] === false;
  const recent = new Set(state.recentBrands || []);

  // ── HARD FILTERS ──
  const hard = (c, { allowSameBrand = false, anyLang = false, allowPosted = false } = {}) => {
    if (!allowPosted && state.posted.includes(c.idx)) return false;
    if (!allowSameBrand && c.entry.brand === state.lastBrand) return false;
    if (!anyLang && c.entry.lang !== wantLang) return false;
    if (needYear && !c.entry.year) return false;
    return true;
  };

  // Progressive relaxation so we never deadlock.
  let pool = all.filter(c => hard(c));
  if (!pool.length) pool = all.filter(c => hard(c, { anyLang: true }));            // language yields first
  if (!pool.length) pool = all.filter(c => hard(c, { anyLang: true, allowSameBrand: true }));
  if (!pool.length) {                                                              // whole cycle exhausted → reset
    state.posted = [];
    pool = all.filter(c => hard(c, { anyLang: true, allowPosted: true }));
  }

  // ── SOFT RANKING ──
  const prevRich = state.lastScore >= RICH_THRESHOLD;
  const rank = (c) => {
    const s = score(c.entry);
    const brandFresh = recent.has(c.entry.brand) ? 0 : 1;                         // not used in last 5 posts
    const sectorDiff = c.entry.sector && c.entry.sector !== state.lastSector ? 1 : 0;
    // alternate info level: if previous was rich, prefer a lighter one now, and vice versa
    const altMatch = prevRich ? (s < RICH_THRESHOLD ? 1 : 0) : (s >= RICH_THRESHOLD ? 1 : 0);
    return { brandFresh, sectorDiff, altMatch, s };
  };
  pool.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (rb.brandFresh !== ra.brandFresh) return rb.brandFresh - ra.brandFresh;    // spread brands out first
    if (rb.sectorDiff !== ra.sectorDiff) return rb.sectorDiff - ra.sectorDiff;    // different sector
    if (rb.altMatch !== ra.altMatch) return rb.altMatch - ra.altMatch;            // alternate info level
    return rb.s - ra.s;                                                          // then most complete
  });

  return pool[0];
}

// ── BUILD CAPTION ─────────────────────────────────────
function buildCaption(entry, counter) {
  const lines = [`(${counter}/365) "${entry.copy}"`, ''];
  if (entry.brand && entry.year) lines.push(`Brand: ${entry.brand} · ${entry.year}`);
  else if (entry.brand) lines.push(`Brand: ${entry.brand}`);
  if (entry.agency) lines.push(`Agency: ${entry.agency}`);
  if (entry.campaign) lines.push(`Campaign: ${entry.campaign}`);
  if (entry.sector) lines.push(`Sector: ${entry.sector.charAt(0).toUpperCase() + entry.sector.slice(1)}`);
  if (entry.festival_or_note) lines.push(`Award: ${entry.festival_or_note}`);
  lines.push('', 'Find this and more at: the-copy-vault.com', '', '#advertising #copywriting #thecopyvault');
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

// ── STATE (with migration of older state.json shapes) ─
function loadState(statePath, corpus) {
  const s = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  s.counter = s.counter || 0;
  s.posted = s.posted || [];
  if (s.postIndex == null) s.postIndex = s.posted.length;     // total posts ever
  // derive continuity fields from the last posted entry if missing
  const last = s.posted.length ? corpus[s.posted[s.posted.length - 1]] : null;
  if (s.lastBrand == null) s.lastBrand = last ? last.brand : null;
  if (s.lastSector == null) s.lastSector = last ? last.sector : null;
  if (s.lastScore == null) s.lastScore = last ? score(last) : 0;
  if (!Array.isArray(s.lastTwoHadYear)) {
    const prev2 = s.posted.slice(-2).map(i => !!corpus[i].year);
    while (prev2.length < 2) prev2.unshift(true);             // assume year present before history
    s.lastTwoHadYear = prev2;
  }
  if (!Array.isArray(s.recentBrands)) {
    s.recentBrands = s.posted.slice(-RECENT_BRANDS).map(i => corpus[i].brand);
  }
  return s;
}

// ── MAIN ──────────────────────────────────────────────
async function main() {
  const corpus = loadCorpus();
  const statePath = path.join(__dirname, 'state.json');
  const state = loadState(statePath, corpus);

  const { entry, idx } = selectNext(corpus, state);

  // advance counters and continuity tracking
  state.counter = (state.counter % 365) + 1;
  state.postIndex += 1;
  state.posted.push(idx);
  state.lastBrand = entry.brand || null;
  state.lastSector = entry.sector || null;
  state.lastScore = score(entry);
  state.lastTwoHadYear = [state.lastTwoHadYear[1], !!entry.year];
  state.recentBrands = [...state.recentBrands, entry.brand].slice(-RECENT_BRANDS);

  const caption = buildCaption(entry, state.counter);
  const imageBuf = await renderImage(entry.copy, entry.brand, entry.year);

  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'output/post.jpg'), imageBuf);
  fs.writeFileSync(path.join(__dirname, 'output/caption.txt'), caption);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  console.log(`Generated post ${state.counter}/365 (${entry.lang}): "${entry.copy.slice(0, 60)}" — ${entry.brand}`);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { loadCorpus, loadState, selectNext, buildCaption, score, SPANISH_EVERY };
