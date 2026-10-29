import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, build, tempDir, walk } from './helpers.mjs';

// These tests read the data file that the site is actually built from.
const DATA = join(REPO, 'data', 'designs.json');
const designs = JSON.parse(readFileSync(DATA, 'utf8')).designs;
const lines = designs.flatMap((d) => d.description.map((line) => ({ handle: d.handle, line })));

// Positive evidence for every "no line looks like X" check: the data is real and every design has text.
function assertRealData() {
  assert.ok(designs.length >= 60, 'the shipped data holds the full archive');
  assert.ok(lines.length > designs.length, 'descriptions hold real text');
  for (const d of designs) {
    assert.ok(Array.isArray(d.description) && d.description.length > 0, `${d.handle}: has description lines`);
    for (const line of d.description) assert.equal(typeof line, 'string');
    assert.ok(d.description.some((line) => line.trim().length > 40), `${d.handle}: has a real paragraph`);
  }
}
const offenders = (predicate) => lines.filter(({ line }) => predicate(line)).map(({ handle, line }) => `${handle}: ${line.slice(0, 60)}`);

const SIZE_ROW = /^\s*(?:[2-5]?X{0,3}S|[SML]|[2-5]?XL|XXL|XXXL|XXS)\s{2,}\d/i;

test('descriptions hold no made-to-order paragraph', () => {
  assertRealData();
  assert.deepEqual(offenders((l) => l.startsWith('This product is made especially for you when you place an order')), []);
});

test('descriptions hold no shipping line', () => {
  assertRealData();
  assert.deepEqual(offenders((l) => l.trim() === 'Free shipping anywhere in the US.'), []);
});

test('descriptions hold no size guide heading or rule lines', () => {
  assertRealData();
  assert.deepEqual(offenders((l) => l.trim() === 'Size guide'), []);
  assert.deepEqual(offenders((l) => /^[\s-]+$/.test(l) && /-/.test(l)), []);
});

test('descriptions hold no pasted table rows or unit headers', () => {
  assertRealData();
  assert.deepEqual(offenders((l) => SIZE_ROW.test(l)), []);
  assert.deepEqual(offenders((l) => /\(inches\)/i.test(l)), []);
});

// ---------- size guide shape ----------
function shapeProblems(d) {
  const g = d.sizeGuide;
  const problems = [];
  const label = d.handle;
  if (typeof g !== 'object' || g === null || Array.isArray(g)) return [`${label}: sizeGuide is not an object`];
  const text = (v) => typeof v === 'string' && v !== '';
  if (!Array.isArray(g.columns) || g.columns.length === 0 || !g.columns.every(text)) problems.push(`${label}: bad columns`);
  if (!Array.isArray(g.rows) || g.rows.length === 0) problems.push(`${label}: bad rows`);
  else
    g.rows.forEach((row, i) => {
      if (!Array.isArray(row) || row.length !== g.columns?.length || !row.every(text)) problems.push(`${label}: bad row ${i}`);
    });
  return problems;
}

test('every shipped size guide has the required shape', () => {
  const withGuide = designs.filter((d) => d.sizeGuide !== undefined && d.sizeGuide !== null);
  assert.ok(withGuide.length > 0, 'some designs have a size guide');
  assert.deepEqual(withGuide.flatMap(shapeProblems), []);
  for (const d of withGuide) assert.equal(d.sizeGuide.columns[0].length > 0, true);
});

test('at least 40 on-request designs have a size guide', () => {
  const onRequest = designs.filter((d) => d.availability === 'on-request');
  assert.ok(onRequest.length >= 40, 'enough on-request designs exist');
  const withGuide = onRequest.filter((d) => d.sizeGuide && Array.isArray(d.sizeGuide.rows) && d.sizeGuide.rows.length > 0);
  assert.ok(withGuide.length >= 40, `only ${withGuide.length} on-request designs have a size guide`);
});

test('no archive design has a size guide', () => {
  const archive = designs.filter((d) => d.availability === 'archive');
  assert.ok(archive.length >= 5, 'archive designs exist');
  for (const d of archive) assert.ok(d.description.some((line) => line.trim() !== ''), `${d.handle}: has a non-empty description`);
  assert.deepEqual(archive.filter((d) => d.sizeGuide !== undefined && d.sizeGuide !== null).map((d) => d.handle), []);
});

test('the shipped data builds into a complete site', async () => {
  const outDir = join(tempDir('tou-shipped'), 'docs');
  await build({ dataPath: DATA, srcDir: join(REPO, 'src'), assetsDir: join(REPO, 'assets'), outDir });
  const files = walk(outDir);
  assert.ok(files.includes('apparel/index.html'));
  assert.ok(files.includes('index.html'));
  for (const d of designs.filter((x) => x.listed)) assert.ok(files.includes(`apparel/${d.handle}/index.html`), d.handle);
  for (const d of designs) assert.ok(files.includes(`products/${d.handle}/index.html`), d.handle);
  const withGuide = designs.filter((d) => d.listed && d.sizeGuide);
  assert.ok(withGuide.length > 0, 'listed designs with a size guide exist');
  for (const d of withGuide) {
    const html = readFileSync(join(outDir, 'apparel', d.handle, 'index.html'), 'utf8');
    assert.equal((html.match(/<table[\s>]/g) || []).length, 1, `${d.handle}: one table`);
  }
});
