import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FIXTURE_ASSETS, FIXTURE_SRC, REPO, assertPageBasics, builtFixture, htmlFiles, isExternal, isFile, isTextFile,
  listed, read, referencesOf, resolveReference, tagsNamed, tokenize, walk,
} from './helpers.mjs';

const HAND_WRITTEN = ['index.html', '404.html', 'site.css', 'site.js'];
const FORBIDDEN = [
  ['a dollar sign followed by a digit', /\$\d/],
  ['myshopify', /myshopify/i],
  ['cdn.shopify', /cdn\.shopify/i],
  ['shopify', /shopify/i],
  ['/cart', /\/cart/i],
  ['checkout', /checkout/i],
  ['add to cart', /add\s+to\s+cart/i],
  ['price or pricing', /\bpric(?:e|es|ing)\b/i],
];

function forbiddenIn(files, read) {
  const hits = [];
  for (const rel of files) {
    const text = read(rel);
    for (const [name, pattern] of FORBIDDEN) if (pattern.test(text)) hits.push(`${rel}: ${name}`);
  }
  return hits;
}

test('every page has lang, a title, one heading, a viewport meta and alt text on images', async () => {
  const { outDir, designs } = await builtFixture();
  const pages = htmlFiles(outDir);
  // 2 hand-written + apparel index + one page per listed design + one stub per design
  assert.equal(pages.length, 2 + 1 + listed(designs).length + designs.length);
  let images = 0;
  for (const rel of pages) images += assertPageBasics(assert, rel, read(outDir, rel)).imgs.length;
  assert.ok(images >= 8, 'image-bearing pages were really checked');
});

test('generated output contains no commerce, price or Shopify strings', async () => {
  const { outDir, designs } = await builtFixture();
  const generated = walk(outDir).filter((f) => isTextFile(f) && !HAND_WRITTEN.includes(f));
  assert.ok(generated.length >= 1 + listed(designs).length + designs.length + 2);
  assert.deepEqual(forbiddenIn(generated, (rel) => read(outDir, rel)), []);
  // The pages carry real content, so an empty result is not an empty build.
  assert.ok(read(outDir, 'apparel/percolator-classic-tee/index.html').includes('Percolator Classic Tee'));
});

test('hand-written source files contain no commerce, price or Shopify strings', () => {
  const dirs = [FIXTURE_SRC, join(REPO, 'src')].filter((d) => existsSync(d));
  assert.ok(dirs.includes(FIXTURE_SRC));
  for (const dir of dirs) {
    const files = walk(dir).filter(isTextFile);
    assert.ok(files.length >= 4, `${dir} has source files`);
    assert.deepEqual(forbiddenIn(files, (rel) => readFileSync(join(dir, rel), 'utf8')), []);
  }
});

test('every internal href and src in the output resolves to a file', async () => {
  const { outDir } = await builtFixture();
  let checked = 0;
  const broken = [];
  for (const rel of htmlFiles(outDir)) {
    for (const ref of referencesOf(tokenize(read(outDir, rel)))) {
      if (isExternal(ref.value)) continue;
      checked++;
      if (!resolveReference(outDir, rel, ref.value)) broken.push(`${rel} -> ${ref.value}`);
    }
  }
  assert.deepEqual(broken, []);
  assert.ok(checked >= 30, `checked ${checked} internal references`);
});

test('the story page links to the apparel index', async () => {
  const { outDir } = await builtFixture();
  const hrefs = tagsNamed(tokenize(read(outDir, 'index.html')), 'a').map((a) => a.attrs.href);
  assert.ok(hrefs.includes('/apparel/'));
  assert.ok(isFile(join(outDir, 'apparel', 'index.html')));
});

test('the 404 page links to the home page', async () => {
  const { outDir } = await builtFixture();
  const hrefs = tagsNamed(tokenize(read(outDir, '404.html')), 'a').map((a) => a.attrs.href);
  assert.ok(hrefs.includes('/'));
  assert.ok(isFile(join(outDir, 'index.html')));
});

test('the hand-written pages and assets are copied byte for byte', async () => {
  const { outDir } = await builtFixture();
  for (const f of HAND_WRITTEN) {
    assert.deepEqual(readFileSync(join(outDir, f)), readFileSync(join(FIXTURE_SRC, f)), f);
  }
});

test('the CNAME file holds the custom domain', async () => {
  const { outDir } = await builtFixture();
  assert.equal(read(outDir, 'CNAME').trim(), 'templeofunicorns.com');
});

test('a .nojekyll file is present so Pages serves the output as is', async () => {
  const { outDir } = await builtFixture();
  assert.ok(isFile(join(outDir, '.nojekyll')));
});

test('design images are copied byte for byte to their published paths', async () => {
  const { outDir, designs } = await builtFixture();
  let copied = 0;
  for (const d of listed(designs)) {
    for (const image of d.images) {
      const source = join(FIXTURE_ASSETS, image.file.replace(/^assets\//, ''));
      assert.deepEqual(readFileSync(join(outDir, image.file)), readFileSync(source), image.file);
      copied++;
    }
  }
  assert.equal(copied, 6);
  const sources = new Set(listed(designs).flatMap((d) => d.images.map((i) => readFileSync(join(outDir, i.file)).toString('base64'))));
  assert.equal(sources.size, copied, 'every published image is distinct content');
});
