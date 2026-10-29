import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { builtFixture, elementTexts, listed, read, resolveReference, tagsNamed, tokenize } from './helpers.mjs';

const INDEX = 'apparel/index.html';

function entries(outDir) {
  const tokens = tokenize(read(outDir, INDEX));
  const anchors = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'tag' && !t.close && t.name === 'a') {
      const target = resolveReference(outDir, INDEX, t.attrs.href);
      let text = '';
      for (let j = i + 1; j < tokens.length && !(tokens[j].type === 'tag' && tokens[j].name === 'a'); j++) {
        if (tokens[j].type === 'text') text += tokens[j].text;
      }
      anchors.push({ target, text: text.replace(/\s+/g, ' ').trim() });
    }
  }
  return { tokens, anchors };
}

test('the apparel index links to exactly the listed designs', async () => {
  const { outDir, designs } = await builtFixture();
  const { anchors } = entries(outDir);
  const detail = anchors.map((a) => a.target).filter((t) => t && /^apparel\/[^/]+\/index\.html$/.test(t)).sort();
  const expected = listed(designs).map((d) => `apparel/${d.handle}/index.html`).sort();
  assert.ok(expected.length >= 4);
  assert.deepEqual(detail, expected);
});

test('the apparel index shows each listed design title as link text', async () => {
  const { outDir, designs } = await builtFixture();
  const { anchors } = entries(outDir);
  for (const d of listed(designs)) {
    const anchor = anchors.find((a) => a.target === `apparel/${d.handle}/index.html` && a.text.includes(d.title));
    assert.ok(anchor, `link text for ${d.handle}`);
  }
});

test('the apparel index shows the first image of each listed design', async () => {
  const { outDir, designs } = await builtFixture();
  const { tokens } = entries(outDir);
  const imgs = tagsNamed(tokens, 'img');
  const shown = imgs.map((i) => resolveReference(outDir, INDEX, i.attrs.src)).sort();
  assert.deepEqual(shown, listed(designs).map((d) => d.images[0].file).sort());
  for (const d of listed(designs)) {
    const img = imgs.find((i) => resolveReference(outDir, INDEX, i.attrs.src) === d.images[0].file);
    assert.equal(img.attrs.alt, d.images[0].alt);
  }
});

test('the apparel index omits unlisted designs in every form', async () => {
  const { outDir, designs } = await builtFixture();
  const unlisted = designs.filter((d) => !d.listed);
  assert.ok(unlisted.length >= 1);
  const html = read(outDir, INDEX);
  assert.ok(html.includes('Percolator Classic Tee'), 'the page really lists designs');
  for (const d of unlisted) {
    assert.ok(!html.includes(d.title), `title of ${d.handle}`);
    assert.ok(!html.includes(d.handle), `handle of ${d.handle}`);
    assert.ok(!html.toLowerCase().includes(d.images[0].alt.toLowerCase()));
    assert.ok(!existsSync(join(outDir, 'apparel', d.handle)));
  }
});

test('the apparel index has a single heading', async () => {
  const { outDir } = await builtFixture();
  assert.equal(elementTexts(tokenize(read(outDir, INDEX)), 'h1').length, 1);
});
