import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, DataError, errorOf, makeProject, loadFixtureDesigns, snapshot, tempDir, walk } from './helpers.mjs';

// Builds `mutate(designs)` through a fresh project and asserts the failure code and
// that the output directory is left exactly as it was found.
async function expectDataError(code, mutate) {
  const designs = structuredClone(loadFixtureDesigns());
  const result = mutate(designs);
  const project = makeProject({ designs: result ?? designs });

  // Pre-existing output must survive untouched, and a missing output dir must stay missing.
  mkdirSync(join(project.outDir, 'apparel', 'sentinel'), { recursive: true });
  writeFileSync(join(project.outDir, 'apparel', 'sentinel', 'index.html'), 'keep me');
  writeFileSync(join(project.outDir, 'CNAME'), 'keep.example');
  const before = snapshot(project.outDir);

  const error = await errorOf(() => build(project));
  assert.ok(error instanceof DataError, `expected DataError, got ${error && error.constructor.name}: ${error && error.message}`);
  assert.equal(error.code, code);
  assert.ok(error instanceof Error);
  assert.notEqual(error.message, '');
  assert.deepEqual(snapshot(project.outDir), before, 'outDir is unchanged after a rejected build');

  const fresh = { ...project, outDir: join(tempDir('tou-fresh'), 'docs') };
  const error2 = await errorOf(() => build(fresh));
  assert.ok(error2 instanceof DataError);
  assert.equal(error2.code, code);
  assert.deepEqual(snapshot(fresh.outDir), {}, 'no output directory is created for rejected data');
}

test('a valid data file builds without raising an error', async () => {
  const project = makeProject({ designs: loadFixtureDesigns() });
  const error = await errorOf(() => build(project));
  assert.equal(error, null);
  assert.ok(walk(project.outDir).includes('apparel/percolator-classic-tee/index.html'));
});

test('duplicate handles are rejected as duplicate-handle', () =>
  expectDataError('duplicate-handle', (d) => {
    d[1].handle = d[0].handle;
  }));

for (const field of ['title', 'description', 'listed', 'availability', 'status']) {
  test(`a design missing ${field} is rejected as missing-field`, () =>
    expectDataError('missing-field', (d) => {
      delete d[2][field];
    }));
}

test('an unknown availability value is rejected as bad-availability', () =>
  expectDataError('bad-availability', (d) => {
    d[0].availability = 'sold-out';
  }));

test('availability with different letter case is rejected as bad-availability', () =>
  expectDataError('bad-availability', (d) => {
    d[0].availability = 'On-Request';
  }));

test('an unknown status value is rejected as bad-status', () =>
  expectDataError('bad-status', (d) => {
    d[3].status = 'draft';
  }));

test('an image with an empty alt is rejected as missing-alt', () =>
  expectDataError('missing-alt', (d) => {
    d[0].images[1].alt = '';
  }));

test('an image with a blank alt is rejected as missing-alt', () =>
  expectDataError('missing-alt', (d) => {
    d[0].images[0].alt = '   ';
  }));

test('an image without an alt key is rejected as missing-alt', () =>
  expectDataError('missing-alt', (d) => {
    delete d[1].images[0].alt;
  }));

test('a design with an empty images list is rejected as no-images', () =>
  expectDataError('no-images', (d) => {
    d[4].images = [];
  }));

for (const key of ['price', 'prices', 'compareAtPrice', 'Price', 'unitPriceCents']) {
  test(`a design with a ${key} key is rejected as price-field`, () =>
    expectDataError('price-field', (d) => {
      d[1][key] = 25;
    }));
}

for (const handle of ['Has Space', 'UPPER-case', 'slash/inside', 'dot.dot']) {
  test(`the handle ${JSON.stringify(handle)} is rejected as bad-handle`, () =>
    expectDataError('bad-handle', (d) => {
      d[0].handle = handle;
    }));
}

for (const value of ['2024-13-45', '12/02/2024', '2024-2-3', 'yesterday']) {
  test(`publishedAt ${JSON.stringify(value)} is rejected as bad-published-at`, () =>
    expectDataError('bad-published-at', (d) => {
      d[0].publishedAt = value;
    }));
}

test('a null publishedAt is accepted', async () => {
  const designs = loadFixtureDesigns();
  assert.equal(designs[1].publishedAt, null);
  const project = makeProject({ designs });
  assert.equal(await errorOf(() => build(project)), null);
  assert.ok(walk(project.outDir).includes('apparel/dnfnb-oversized-graff-tee/index.html'));
});
