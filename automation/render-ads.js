'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ADS = path.join(__dirname, '../ad-assets');
const OUT = path.join(ADS, 'png');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(ADS).filter(f => f.endsWith('.svg'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const f of files) {
    const svg = fs.readFileSync(path.join(ADS, f), 'utf-8');
    const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    const w = +m[1], h = +m[2];
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(svg, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(OUT, f.replace('.svg', '.png'));
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h } });
    console.log(`rendered ${f} → png/${path.basename(out)} (${w}x${h})`);
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
