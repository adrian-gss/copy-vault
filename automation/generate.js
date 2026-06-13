'use strict';

const { createCanvas, registerFont, Path2D } = require('canvas');
const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.join(__dirname, 'fonts');

// ── LOAD CORPUS FROM index.html ───────────────────────
function loadCorpus() {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf-8');
  const marker = 'const CORPUS = ';
  const start = html.indexOf(marker) + marker.length;
  let depth = 0, i = start;
  while (i < html.length) {
    if (html[i] === '[' || html[i] === '{') depth++;
    else if (html[i] === ']' || html[i] === '}') { depth--; if (depth === 0) break; }
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
function selectNext(corpus, state) {
  const sorted = corpus
    .map((entry, idx) => ({ entry, idx }))
    .sort((a, b) => {
      if (a.entry.lang !== b.entry.lang) return a.entry.lang === 'en' ? -1 : 1;
      return score(b.entry) - score(a.entry);
    });

  let pick = sorted.find(({ idx }) => !state.posted.includes(idx));
  if (!pick) {
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

// ── GENERATE IMAGE ────────────────────────────────────
function generateImage(copy, brand, year) {
  registerFont(path.join(FONTS_DIR, 'Bitter-Medium.ttf'), { family: 'Bitter', weight: '500' });
  registerFont(path.join(FONTS_DIR, 'SpaceMono-Regular.ttf'), { family: 'Space Mono', weight: '400' });
  registerFont(path.join(FONTS_DIR, 'SpaceMono-Bold.ttf'), { family: 'Space Mono', weight: '700' });

  const W = 1080, H = 1080;
  const canvas = createCanvas(W, H);
  const c = canvas.getContext('2d');

  function wrapText(text, maxW) {
    const words = text.split(' ');
    let line = '', lines = [];
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; }
      else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  // Background
  c.fillStyle = '#EBEBE9'; c.fillRect(0, 0, W, H);

  // Branding box
  c.fillStyle = '#0A0A0A'; c.fillRect(82, 76, 468, 113);

  // Orange badge
  c.fillStyle = '#F04D23'; c.fillRect(109, 109, 48, 48);

  // Page icon outline
  c.strokeStyle = '#0A0A0A'; c.lineWidth = 2.8; c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath(); c.moveTo(123.6, 120.37); c.lineTo(138.6, 120.37); c.lineTo(145.6, 127.37);
  c.lineTo(145.6, 146.37); c.lineTo(123.6, 146.37); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(138.6, 120.37); c.lineTo(138.6, 127.37); c.lineTo(145.6, 127.37); c.stroke();

  // "?" on badge
  c.fillStyle = '#0A0A0A'; c.font = 'bold 15.18px "Courier New",monospace';
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillText('?', 130.04, 140.82);

  // Wordmark
  c.fillStyle = '#F0F0EE'; c.font = 'bold 33.73px "Space Mono"';
  c.letterSpacing = `${33.73 * 0.1}px`;
  c.textAlign = 'left';
  c.fillText('THE COPY VAULT', 177.51, 140.9);
  c.letterSpacing = '0px';

  // Orange underline
  c.strokeStyle = '#F04D23'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(179.89, 157.16); c.lineTo(523, 157.16); c.stroke();

  // Card shadow
  c.fillStyle = '#231F20'; c.fillRect(89.37, 263.11, 913.04, 595.03);

  // White card
  c.fillStyle = '#FFFFFF'; c.strokeStyle = '#231F20'; c.lineWidth = 5;
  c.fillRect(81, 255.74, 913.04, 595.03);
  c.strokeRect(81 + 2.5, 255.74 + 2.5, 913.04 - 5, 595.03 - 5);

  // Copy text
  const cardTop = 255.74, dividerY = 717.26;
  const textX = 151.4, textMaxW = 994.04 - textX - 70;
  const availH = dividerY - cardTop - 59 - 10;

  let fs = 74.16, lh = 88.99;
  const sizes = [[20, 110, 132], [40, 90, 108], [80, 74.16, 88.99], [140, 56, 67], [99999, 44, 53]];
  for (const [limit, size, lineH] of sizes) {
    if (copy.length <= limit) { fs = size; lh = lineH; break; }
  }
  c.font = `500 ${fs}px "Bitter"`;
  let copyLines = wrapText(copy, textMaxW);
  while (copyLines.length * lh > availH && fs > 28) {
    fs -= 4; lh = fs * 1.2;
    c.font = `500 ${fs}px "Bitter"`;
    copyLines = wrapText(copy, textMaxW);
  }
  const firstBaselineY = cardTop + 59 + fs * 0.85;
  c.fillStyle = '#231F20'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  copyLines.forEach((l, i) => c.fillText(l, textX, firstBaselineY + i * lh));

  // Divider
  c.strokeStyle = '#969696'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(157.04, 717.26); c.lineTo(922.01, 717.26); c.stroke();

  // Brand + Year
  c.fillStyle = '#969696'; c.font = '400 33.73px "Space Mono"';
  c.letterSpacing = `${33.73 * 0.1}px`;
  c.textAlign = 'left';
  c.fillText((brand || '').toUpperCase(), 151.4, 787.05);
  c.fillText(String(year || ''), 843.21, 787.05);
  c.letterSpacing = '0px';

  // Social icons (exact SVG paths from template)
  c.fillStyle = '#969696';
  c.fill(new Path2D('M934.8,920.48c-4.01,0-4.52.02-6.09.09-1.57.07-2.65.32-3.59.69-.97.38-1.8.88-2.62,1.7-.82.82-1.33,1.65-1.71,2.62-.37.94-.62,2.01-.69,3.59-.07,1.58-.09,2.08-.09,6.1s.02,4.52.09,6.09c.07,1.57.32,2.65.69,3.59.38.97.88,1.8,1.7,2.62.82.82,1.65,1.33,2.62,1.71.94.37,2.01.61,3.59.69,1.58.07,2.08.09,6.09.09s4.52-.02,6.09-.09c1.57-.07,2.65-.32,3.59-.69.97-.38,1.8-.88,2.62-1.71.82-.82,1.33-1.65,1.71-2.62.36-.94.61-2.01.69-3.59.07-1.58.09-2.08.09-6.09s-.02-4.52-.09-6.09c-.07-1.57-.32-2.65-.69-3.59-.38-.97-.88-1.8-1.71-2.62-.82-.82-1.64-1.33-2.62-1.7-.94-.37-2.02-.61-3.59-.69-1.58-.07-2.08-.09-6.09-.09h0ZM933.48,923.14c.39,0,.83,0,1.33,0,3.95,0,4.41.01,5.97.08,1.44.07,2.22.31,2.74.51.69.27,1.18.59,1.7,1.11.52.52.84,1.01,1.11,1.7.2.52.44,1.3.51,2.74.07,1.56.09,2.03.09,5.97s-.02,4.41-.09,5.97c-.07,1.44-.31,2.22-.51,2.74-.27.69-.59,1.18-1.11,1.7-.52.52-1.01.84-1.7,1.11-.52.2-1.3.44-2.74.51-1.56.07-2.03.09-5.97.09s-4.41-.02-5.97-.09c-1.44-.07-2.22-.31-2.74-.51-.69-.27-1.18-.59-1.7-1.11-.52-.52-.84-1.01-1.11-1.7-.2-.52-.44-1.3-.51-2.74-.07-1.56-.08-2.03-.08-5.97s.01-4.41.08-5.97c.07-1.44.31-2.22.51-2.74.27-.69.59-1.18,1.11-1.7.52-.52,1.01-.84,1.7-1.11.52-.2,1.3-.44,2.74-.51,1.36-.06,1.89-.08,4.65-.08h0ZM942.69,925.59c-.98,0-1.77.79-1.77,1.77s.79,1.77,1.77,1.77,1.77-.79,1.77-1.77-.79-1.77-1.77-1.77h0ZM934.8,927.67c-4.19,0-7.59,3.4-7.59,7.59s3.4,7.59,7.59,7.59c4.19,0,7.59-3.4,7.59-7.59s-3.4-7.59-7.59-7.59h0ZM934.8,930.33c2.72,0,4.93,2.21,4.93,4.93s-2.21,4.93-4.93,4.93-4.93-2.21-4.93-4.93,2.21-4.93,4.93-4.93Z'));
  c.fill(new Path2D('M994.23,920.35h-22.83c-1.8,0-3.26,1.46-3.26,3.26v22.83c0,1.8,1.46,3.26,3.26,3.26h22.83c1.8,0,3.26-1.46,3.26-3.26v-22.83c0-1.8-1.46-3.26-3.26-3.26ZM977.01,945.63h-4.38v-14.13h4.38v14.13ZM974.8,929.65c-1.43,0-2.59-1.17-2.59-2.61s1.16-2.61,2.59-2.61,2.59,1.17,2.59,2.61-1.16,2.61-2.59,2.61ZM993.42,945.63h-4.36v-7.42c0-2.03-.77-3.17-2.38-3.17-1.75,0-2.67,1.18-2.67,3.17v7.42h-4.2v-14.13h4.2v1.9s1.26-2.34,4.26-2.34,5.14,1.83,5.14,5.62v8.95Z'));

  // Footer text
  c.fillStyle = '#969696'; c.font = '400 27.98px "Space Mono"';
  c.letterSpacing = `${27.98 * 0.1}px`;
  c.textAlign = 'left'; c.fillText('FIND THIS AND MORE AT:', 90.97, 993.79);
  c.textAlign = 'right'; c.fillText('THE-COPY-VAULT.COM', 997.49, 993.79);
  c.letterSpacing = '0px';

  return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

// ── MAIN ──────────────────────────────────────────────
function main() {
  const corpus = loadCorpus();
  const statePath = path.join(__dirname, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

  const { entry, idx } = selectNext(corpus, state);

  state.counter = (state.counter % 365) + 1;
  state.posted.push(idx);

  const caption = buildCaption(entry, state.counter);
  const imageBuf = generateImage(entry.copy, entry.brand, entry.year);

  fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'output/post.jpg'), imageBuf);
  fs.writeFileSync(path.join(__dirname, 'output/caption.txt'), caption);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  console.log(`Generated post ${state.counter}/365: "${entry.copy.slice(0, 60)}"`);
}

main();
