import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, FIXTURE_SRC, RECIPIENT, builtFixture, htmlFiles, isTextFile, read, tagsNamed, tokenize, walk } from './helpers.mjs';

const CONTACT = 'contact@templeofunicorns.com';
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Built from parts so a repo-wide search for the old address finds nothing here.
const OLD_ADDRESS = ['templeofunicorns', 'jasoncookdesign.com'].join('@');

const emailsIn = (dir) =>
  walk(dir)
    .filter(isTextFile)
    .flatMap((rel) => (readFileSync(join(dir, rel), 'utf8').match(EMAIL) ?? []).map((address) => ({ rel, address })));

const mailtosOf = (html) => tagsNamed(tokenize(html), 'a').filter((a) => (a.attrs.href ?? '').startsWith('mailto:'));
const recipientOf = (href) => href.slice('mailto:'.length).split('?')[0];

test('the recipient constant is the contact address', () => {
  assert.equal(RECIPIENT, CONTACT);
});

test('the built fixture site holds no email address except the contact address', async () => {
  const { outDir } = await builtFixture();
  const found = emailsIn(outDir);
  assert.ok(found.length >= 2, 'on-request pages carry the contact address');
  assert.deepEqual(found.filter((f) => f.address !== CONTACT), []);
});

test('fixture sources hold no other email address', () => {
  assert.ok(walk(FIXTURE_SRC).filter(isTextFile).length >= 4, 'fixture sources were scanned');
  assert.deepEqual(emailsIn(FIXTURE_SRC).filter((f) => f.address !== CONTACT), []);
});

for (const folder of ['src', 'docs']) {
  test(`the real ${folder}/ folder holds no email address except the contact address`, () => {
    const dir = join(REPO, folder);
    assert.ok(walk(dir).filter(isTextFile).length >= 5, `${folder}/ text files were scanned`);
    assert.deepEqual(emailsIn(dir).filter((f) => f.address !== CONTACT), []);
  });
}

test('the real docs/ has many on-request pages, each with exactly one mailto to the contact address', () => {
  const dir = join(REPO, 'docs');
  const pages = htmlFiles(dir).filter((f) => /^apparel\/[^/]+\/index\.html$/.test(f));
  let withAsk = 0;
  for (const rel of pages) {
    const mailtos = mailtosOf(read(dir, rel));
    assert.ok(mailtos.length <= 1, `${rel}: at most one mailto`);
    if (mailtos.length === 1) {
      withAsk++;
      assert.equal(recipientOf(mailtos[0].attrs.href), CONTACT, `${rel}: recipient`);
    }
  }
  assert.ok(withAsk >= 20, `expected at least 20 on-request pages, found ${withAsk}`);
});

test('the built fixture has on-request pages, each with exactly one mailto to the contact address', async () => {
  const { outDir, designs } = await builtFixture();
  const requestable = designs.filter((d) => d.listed && d.availability === 'on-request');
  assert.ok(requestable.length >= 2, 'fixture has on-request designs');
  for (const d of requestable) {
    const mailtos = mailtosOf(read(outDir, `apparel/${d.handle}/index.html`));
    assert.equal(mailtos.length, 1, `${d.handle}: one mailto`);
    assert.equal(recipientOf(mailtos[0].attrs.href), CONTACT);
  }
});

test('the previous address appears in no tracked file', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(files.length > 50, 'tracked files were listed');
  const offenders = [];
  for (const rel of files) {
    const buf = readFileSync(join(REPO, rel));
    if (buf.includes(0)) continue;
    if (buf.toString('utf8').toLowerCase().includes(OLD_ADDRESS)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

for (const folder of ['src', 'docs']) {
  test(`the real ${folder}/ home page links its "send an email" call to action to the contact address`, () => {
    const mailtos = mailtosOf(read(join(REPO, folder), 'index.html'));
    assert.equal(mailtos.length, 1, 'one mailto on the home page');
    assert.equal(mailtos[0].attrs.href, `mailto:${CONTACT}`);
  });
}
