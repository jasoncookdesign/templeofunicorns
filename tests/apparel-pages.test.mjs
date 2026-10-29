import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  RECIPIENT, builtFixture, elementTexts, listed, pageText, read, resolveReference, tagsNamed, tokenize,
} from './helpers.mjs';

const pageOf = (design) => `apparel/${design.handle}/index.html`;

test('a detail page exists for every listed design and for no other design', async () => {
  const { outDir, designs } = await builtFixture();
  const expected = listed(designs).map((d) => d.handle).sort();
  assert.ok(expected.length >= 4);
  for (const handle of expected) assert.ok(existsSync(join(outDir, 'apparel', handle, 'index.html')), handle);
  const dirs = readdirSync(join(outDir, 'apparel'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(dirs, expected);
  for (const d of designs.filter((x) => !x.listed)) assert.ok(!existsSync(join(outDir, 'apparel', d.handle)));
});

test('a detail page shows its title in the page title and the heading', async () => {
  const { outDir, designs } = await builtFixture();
  for (const d of listed(designs)) {
    const tokens = tokenize(read(outDir, pageOf(d)));
    assert.ok(elementTexts(tokens, 'title')[0].includes(d.title), `title of ${d.handle}`);
    assert.ok(elementTexts(tokens, 'h1')[0].includes(d.title), `h1 of ${d.handle}`);
  }
});

test('a detail page shows every description paragraph as its own paragraph', async () => {
  const { outDir, designs } = await builtFixture();
  let checked = 0;
  for (const d of listed(designs)) {
    const paragraphs = elementTexts(tokenize(read(outDir, pageOf(d))), 'p');
    for (const text of d.description) {
      assert.ok(paragraphs.includes(text), `${d.handle}: paragraph ${JSON.stringify(text)}`);
      checked++;
    }
  }
  assert.ok(checked >= 6);
});

test('a detail page lists every option name and value as plain list items', async () => {
  const { outDir, designs } = await builtFixture();
  for (const d of listed(designs)) {
    const items = elementTexts(tokenize(read(outDir, pageOf(d))), 'li');
    for (const option of d.options) {
      assert.ok(items.some((t) => t.includes(option.name)), `${d.handle}: option name ${option.name}`);
      for (const value of option.values) {
        assert.ok(items.some((t) => t === value || t.includes(value)), `${d.handle}: value ${value}`);
      }
    }
  }
});

test('a detail page shows every image in data order with its alt text', async () => {
  const { outDir, designs } = await builtFixture();
  for (const d of listed(designs)) {
    const rel = pageOf(d);
    const imgs = tagsNamed(tokenize(read(outDir, rel)), 'img');
    assert.deepEqual(
      imgs.map((i) => resolveReference(outDir, rel, i.attrs.src)),
      d.images.map((i) => i.file),
      `${d.handle}: image files in order`,
    );
    assert.deepEqual(imgs.map((i) => i.attrs.alt), d.images.map((i) => i.alt), `${d.handle}: alt text`);
  }
});

test('on-request pages carry exactly one mailto link to the shop address', async () => {
  const { outDir, designs } = await builtFixture();
  const onRequest = listed(designs).filter((d) => d.availability === 'on-request');
  assert.ok(onRequest.length >= 4);
  for (const d of onRequest) {
    const html = read(outDir, pageOf(d));
    const links = tagsNamed(tokenize(html), 'a').filter((a) => (a.attrs.href || '').toLowerCase().startsWith('mailto:'));
    assert.equal(links.length, 1, `${d.handle}: one mailto link`);
    assert.equal((html.match(/mailto:/gi) || []).length, 1, `${d.handle}: mailto appears once in the markup`);
    const [address] = links[0].attrs.href.slice('mailto:'.length).split('?');
    assert.equal(address, RECIPIENT);
  }
});

function mailtoParts(href) {
  const [, query = ''] = href.split('?');
  const params = {};
  const raw = {};
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    raw[pair.slice(0, eq)] = pair.slice(eq + 1);
    params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
  }
  return { params, raw };
}

test('the mailto subject contains the design title and the body asks about that design', async () => {
  const { outDir, designs } = await builtFixture();
  for (const d of listed(designs).filter((x) => x.availability === 'on-request')) {
    const link = tagsNamed(tokenize(read(outDir, pageOf(d))), 'a').find((a) => (a.attrs.href || '').startsWith('mailto:'));
    const { params } = mailtoParts(link.attrs.href);
    assert.ok(params.subject.includes(d.title), `${d.handle}: subject ${JSON.stringify(params.subject)}`);
    assert.ok(params.body.includes(d.title), `${d.handle}: body ${JSON.stringify(params.body)}`);
    assert.ok(params.body.length > d.title.length + 10, `${d.handle}: body is a sentence, not just the title`);
  }
});

test('the mailto URL is percent-encoded for spaces, ampersands, quotes and non-ASCII text', async () => {
  const { outDir, designs } = await builtFixture();
  const byHandle = Object.fromEntries(designs.map((d) => [d.handle, d]));
  const hrefOf = (handle) =>
    tagsNamed(tokenize(read(outDir, pageOf(byHandle[handle]))), 'a').find((a) => a.attrs.href.startsWith('mailto:')).attrs.href;

  for (const d of listed(designs).filter((x) => x.availability === 'on-request')) {
    const href = hrefOf(d.handle);
    // Everything after the address uses only URL-safe characters, so no raw space, quote or accent survives.
    assert.match(href, /^mailto:[A-Za-z0-9@._-]+\?(?:subject|body)=[A-Za-z0-9%._~!*'()-]*&(?:subject|body)=[A-Za-z0-9%._~!*'()-]*$/, d.handle);
    const { raw } = mailtoParts(href);
    assert.equal(raw.subject.includes('+'), false, `${d.handle}: spaces are %20, never +`);
    assert.doesNotMatch(raw.subject, /%(?![0-9A-F]{2})/);
  }
  const ampersand = mailtoParts(hrefOf('rock-and-roll-hoodie')).raw.subject;
  assert.ok(ampersand.includes('%26'), 'ampersand becomes %26');
  assert.ok(ampersand.includes('%22'), 'double quote becomes %22');
  assert.ok(ampersand.includes('%20'), 'space becomes %20');
  assert.ok(mailtoParts(hrefOf('cafe-cosmos-crewneck')).raw.subject.includes('Caf%C3%A9'), 'e-acute becomes UTF-8 percent bytes');
  assert.equal(mailtoParts(hrefOf('dnfnb-oversized-graff-tee')).params.subject.includes("DnF'nB Oversized Graff Tee"), true);
});

test('archive pages have no mailto link while still showing the full design', async () => {
  const { outDir, designs } = await builtFixture();
  const archive = listed(designs).filter((d) => d.availability === 'archive');
  assert.ok(archive.length >= 1);
  for (const d of archive) {
    const html = read(outDir, pageOf(d));
    assert.doesNotMatch(html, /mailto:/i, d.handle);
    assert.ok(elementTexts(tokenize(html), 'h1')[0].includes(d.title));
    assert.ok(elementTexts(tokenize(html), 'p').includes(d.description[0]));
  }
});

test('titles are HTML-escaped in text and attributes on every page that shows them', async () => {
  const { outDir, designs } = await builtFixture();
  const rock = designs.find((d) => d.handle === 'rock-and-roll-hoodie');
  const less = designs.find((d) => d.handle === 'less-than-tee');
  const cafe = designs.find((d) => d.handle === 'cafe-cosmos-crewneck');
  const dnfnb = designs.find((d) => d.handle === 'dnfnb-oversized-graff-tee');

  for (const rel of [pageOf(rock), pageOf(less), pageOf(cafe), pageOf(dnfnb), 'apparel/index.html']) {
    const html = read(outDir, rel);
    tokenize(html); // throws on stray "<", unbalanced quotes, or bare "&"
    assert.ok(!html.includes('Rock & Roll'), `${rel}: raw ampersand`);
    assert.ok(!html.includes('"Unicorn"'), `${rel}: raw double quotes from the title`);
    assert.ok(!html.includes('<Than>'), `${rel}: raw angle brackets from the title`);
    assert.ok(!html.includes('& garment'), `${rel}: raw ampersand from the description`);
    assert.ok(!html.includes('< 5'), `${rel}: raw less-than from the description`);
  }
  const rockHtml = read(outDir, pageOf(rock));
  assert.ok(rockHtml.includes('Rock &amp; Roll'));
  assert.ok(read(outDir, pageOf(less)).includes('Less &lt;Than&gt; Tee'));
  // Round trip: decoding the escaped markup gives back the exact original strings.
  assert.equal(elementTexts(tokenize(rockHtml), 'h1')[0], rock.title);
  assert.equal(elementTexts(tokenize(read(outDir, pageOf(less))), 'h1')[0], less.title);
  assert.equal(elementTexts(tokenize(read(outDir, pageOf(cafe))), 'h1')[0], cafe.title);
  assert.equal(elementTexts(tokenize(read(outDir, pageOf(dnfnb))), 'h1')[0], dnfnb.title);
  assert.ok(pageText(tokenize(rockHtml)).includes(rock.description[0]));
  const alt = tagsNamed(tokenize(rockHtml), 'img')[0].attrs.alt;
  assert.equal(alt, rock.images[0].alt);
});
