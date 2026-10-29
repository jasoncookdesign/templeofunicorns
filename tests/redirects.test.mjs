import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { builtFixture, elementTexts, listed, read, tagsNamed, tokenize } from './helpers.mjs';

const stubOf = (d) => `products/${d.handle}/index.html`;
const targetOf = (d) => (d.listed ? `/apparel/${d.handle}/` : '/apparel/');

test('one redirect stub exists for every design, listed or not, and no others', async () => {
  const { outDir, designs } = await builtFixture();
  const dirs = readdirSync(join(outDir, 'products'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(dirs, designs.map((d) => d.handle).sort());
  assert.ok(designs.some((d) => !d.listed));
  for (const d of designs) assert.ok(read(outDir, stubOf(d)).length > 0);
});

test('each stub refreshes immediately to its destination', async () => {
  const { outDir, designs } = await builtFixture();
  for (const d of designs) {
    const metas = tagsNamed(tokenize(read(outDir, stubOf(d))), 'meta').filter((m) => (m.attrs['http-equiv'] || '').toLowerCase() === 'refresh');
    assert.equal(metas.length, 1, d.handle);
    assert.equal(metas[0].attrs.content, `0; url=${targetOf(d)}`, d.handle);
  }
});

test('each stub declares the canonical URL of its destination', async () => {
  const { outDir, designs } = await builtFixture();
  for (const d of designs) {
    const links = tagsNamed(tokenize(read(outDir, stubOf(d))), 'link').filter((l) => l.attrs.rel === 'canonical');
    assert.equal(links.length, 1, d.handle);
    assert.equal(links[0].attrs.href, `https://templeofunicorns.com${targetOf(d)}`, d.handle);
  }
});

test('each stub shows a visible link to its destination', async () => {
  const { outDir, designs } = await builtFixture();
  for (const d of designs) {
    const tokens = tokenize(read(outDir, stubOf(d)));
    const body = tokens.slice(tokens.findIndex((t) => t.type === 'tag' && t.name === 'body'));
    const anchors = tagsNamed(body, 'a').filter((a) => a.attrs.href === targetOf(d));
    assert.ok(anchors.length >= 1, `${d.handle}: anchor to ${targetOf(d)}`);
    assert.ok(elementTexts(body, 'a').some((t) => t.length > 0), `${d.handle}: link has text`);
  }
});

test('stubs for unlisted designs never point at a per-design page', async () => {
  const { outDir, designs } = await builtFixture();
  const unlisted = designs.filter((d) => !d.listed);
  assert.ok(unlisted.length >= 1);
  assert.ok(listed(designs).length >= 4);
  for (const d of unlisted) assert.ok(!read(outDir, stubOf(d)).includes(`/apparel/${d.handle}`));
  // Positive counterpart: a listed stub does point at its page.
  assert.ok(read(outDir, stubOf(listed(designs)[0])).includes(`/apparel/${listed(designs)[0].handle}/`));
});
