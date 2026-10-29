import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, DataError, errorOf, makeProject, loadFixtureDesigns, snapshot } from './helpers.mjs';

// Builds a project from mutated fixture data and asserts a DataError with the
// given code, with a pre-existing output folder left exactly as it was.
async function rejected(code, mutate) {
  const designs = structuredClone(loadFixtureDesigns());
  mutate(designs);
  const project = makeProject({ designs });
  mkdirSync(join(project.outDir, 'apparel', 'sentinel'), { recursive: true });
  writeFileSync(join(project.outDir, 'apparel', 'sentinel', 'index.html'), 'keep me');
  const before = snapshot(project.outDir);
  const error = await errorOf(() => build(project));
  assert.ok(error instanceof DataError, `expected DataError, got ${error && error.constructor.name}: ${error && error.message}`);
  assert.equal(error.code, code);
  assert.deepEqual(snapshot(project.outDir), before);
}

test('a description that is a string is rejected as missing-field', () =>
  rejected('missing-field', (d) => {
    d[0].description = 'text';
  }));

test('a description with a non-string entry is rejected as missing-field', () =>
  rejected('missing-field', (d) => {
    d[0].description = ['ok', 3];
  }));

test('an option whose values are a string is rejected as missing-field', () =>
  rejected('missing-field', (d) => {
    d[0].options = [{ name: 'Size', values: 'S,M' }];
  }));

test('an option value that is not a string is rejected as missing-field', () =>
  rejected('missing-field', (d) => {
    d[0].options = [{ name: 'Size', values: ['S', 4] }];
  }));

test('an option with an empty name is rejected as missing-field', () =>
  rejected('missing-field', (d) => {
    d[0].options = [{ name: '', values: ['S'] }];
  }));

test('collections that are not an array of strings are rejected as missing-field', () =>
  rejected('missing-field', (d) => {
    d[0].collections = 'The DJ Collection';
  }));

test('listed given as a string is rejected as missing-field', () =>
  rejected('missing-field', (d) => {
    d[0].listed = 'no';
  }));

test('an image file outside assets/ is rejected as missing-field', () =>
  rejected('missing-field', (d) => {
    d[0].images[0].file = d[0].images[0].file.replace(/^assets\//, 'designs-copy/');
  }));

test('a symlink in the assets folder that escapes it is refused before any write', async () => {
  const designs = loadFixtureDesigns();
  const project = makeProject({ designs });
  const target = designs.find((d) => d.listed).images[0].file;
  const outside = mkdtempSync(join(tmpdir(), 'tou-outside-'));
  try {
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    const link = join(project.root, target);
    rmSync(link);
    symlinkSync(join(outside, 'secret.txt'), link);
    mkdirSync(join(project.outDir, 'apparel', 'sentinel'), { recursive: true });
    writeFileSync(join(project.outDir, 'apparel', 'sentinel', 'index.html'), 'keep me');
    const before = snapshot(project.outDir);
    const error = await errorOf(() => build(project));
    assert.ok(error instanceof Error && !(error instanceof DataError), 'a plain Error');
    assert.match(error.message, /outside|symlink|escape/i);
    assert.deepEqual(snapshot(project.outDir), before);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a symlink that stays inside the assets folder is copied as a regular file', async () => {
  const designs = loadFixtureDesigns();
  const project = makeProject({ designs });
  const target = designs.find((d) => d.listed).images[0].file;
  const link = join(project.root, target);
  const real = join(project.root, 'assets', 'real-copy.bin');
  writeFileSync(real, 'inside');
  rmSync(link);
  symlinkSync(real, link);
  await build(project);
  assert.equal(lstatSync(join(project.outDir, target)).isSymbolicLink(), false);
  assert.equal(readFileSync(join(project.outDir, target), 'utf8'), 'inside');
});

test('a symlink in the source folder that escapes it is refused before any write', async () => {
  const project = makeProject({ designs: loadFixtureDesigns() });
  const outside = mkdtempSync(join(tmpdir(), 'tou-outside-'));
  try {
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    symlinkSync(join(outside, 'secret.txt'), join(project.srcDir, 'leak.txt'));
    const error = await errorOf(() => build(project));
    assert.ok(error instanceof Error && !(error instanceof DataError), 'a plain Error');
    assert.match(error.message, /outside/i);
    assert.deepEqual(snapshot(project.outDir), {});
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
