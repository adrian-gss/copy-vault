'use strict';
// Dry-run simulation of the selection algorithm (no rendering, no file writes).
const { loadCorpus, selectNext, score, SPANISH_EVERY } = require('./generate.js');

const N = Number(process.argv[2] || 60);
const corpus = loadCorpus();

let state = { counter: 0, postIndex: 0, posted: [], lastBrand: null, lastSector: null, lastScore: 0, lastTwoHadYear: [true, true], recentBrands: [] };

const seq = [];
for (let n = 0; n < N; n++) {
  const { entry, idx } = selectNext(corpus, state);
  state.counter = (state.counter % 365) + 1;
  state.postIndex += 1;
  state.posted.push(idx);
  state.lastBrand = entry.brand || null;
  state.lastSector = entry.sector || null;
  state.lastScore = score(entry);
  state.lastTwoHadYear = [state.lastTwoHadYear[1], !!entry.year];
  state.recentBrands = [...state.recentBrands, entry.brand].slice(-5);
  seq.push({ n: state.postIndex, lang: entry.lang, brand: entry.brand, sector: entry.sector, year: entry.year, sc: score(entry), copy: entry.copy.slice(0, 28) });
}

// ── PRINT ──
for (const p of seq) {
  const spanishSlot = p.n % SPANISH_EVERY === 0 ? ' ★ES-SLOT' : '';
  console.log(
    String(p.n).padStart(3),
    p.lang,
    (p.year || '----'),
    'sc' + p.sc,
    (p.brand || '').padEnd(20).slice(0, 20),
    (p.sector || '').padEnd(22).slice(0, 22),
    p.copy + spanishSlot
  );
}

// ── ASSERTIONS ──
let errors = [];
for (let i = 1; i < seq.length; i++) {
  if (seq[i].brand && seq[i].brand === seq[i - 1].brand) errors.push(`#${seq[i].n}: same brand twice (${seq[i].brand})`);
}
let brandWithin5 = 0;
for (let i = 0; i < seq.length; i++) {
  const window = seq.slice(Math.max(0, i - 5), i).map(p => p.brand);
  if (window.includes(seq[i].brand)) brandWithin5++;
}
for (let i = 2; i < seq.length; i++) {
  if (!seq[i].year && !seq[i - 1].year && !seq[i - 2].year) errors.push(`#${seq[i].n}: 3 in a row without year`);
}
for (const p of seq) {
  if (p.n % SPANISH_EVERY === 0 && p.lang !== 'es') errors.push(`#${p.n}: should be ES slot but was ${p.lang}`);
}
const dupes = seq.map(p => p.copy).filter((c, i, a) => a.indexOf(c) !== i);

console.log('\n── CHECKS ──');
console.log('ES posts:', seq.filter(p => p.lang === 'es').map(p => p.n).join(', '));
console.log('Repeated copies in run:', dupes.length ? dupes : 'none');
console.log('No year count:', seq.filter(p => !p.year).length, '/', seq.length);
console.log('Brand reused within last 5 posts:', brandWithin5, '(soft — lower is better)');
console.log(errors.length ? '❌ ERRORS:\n' + errors.join('\n') : '✅ All hard rules hold (no brand repeats, no 3-no-year runs, ES slots correct)');
