import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO, build, errorOf, fixtureOptions, loadFixtureDesigns, makeProject, snapshot, tempDir, walk,
} from './helpers.mjs';

test('two builds of the same input are byte-identical', async () => {
  const a = join(tempDir('tou-det'), 'docs');
  const b = join(tempDir('tou-det'), 'docs');
  await build(fixtureOptions(a));
  await build(fixtureOptions(b));
  const first = snapshot(a);
  assert.ok(Object.keys(first).length > 25, 'a real site was produced');
  assert.deepEqual(snapshot(b), first);
});

test('rebuilding into the same directory leaves identical output', async () => {
  const out = join(tempDir('tou-det'), 'docs');
  await build(fixtureOptions(out));
  const first = snapshot(out);
  await build(fixtureOptions(out));
  assert.ok(first['apparel/index.html']);
  assert.deepEqual(snapshot(out), first);
});

test('output is the same when the designs are listed in a different order', async () => {
  const designs = loadFixtureDesigns();
  const forward = makeProject({ designs });
  const reversed = makeProject({ designs: [...designs].reverse() });
  await build(forward);
  await build(reversed);
  const files = walk(forward.outDir).filter((f) => f !== 'apparel/index.html');
  assert.ok(files.length > 20);
  const a = snapshot(forward.outDir);
  const b = snapshot(reversed.outDir);
  for (const f of files) assert.deepEqual(b[f], a[f], f);
});

test('rebuilding removes the pages of a design that left the data file', async () => {
  const designs = loadFixtureDesigns();
  const project = makeProject({ designs });
  await build(project);
  assert.ok(existsSync(join(project.outDir, 'apparel', 'less-than-tee', 'index.html')));
  assert.ok(existsSync(join(project.outDir, 'products', 'less-than-tee', 'index.html')));

  mkdirSync(join(project.outDir, 'apparel', 'ghost'), { recursive: true });
  writeFileSync(join(project.outDir, 'apparel', 'ghost', 'index.html'), 'stale');
  writeFileSync(join(project.outDir, 'products', 'ghost.html'), 'stale');

  const remaining = designs.filter((d) => d.handle !== 'less-than-tee');
  writeFileSync(project.dataPath, JSON.stringify({ designs: remaining }));
  await build(project);

  assert.ok(!existsSync(join(project.outDir, 'apparel', 'less-than-tee')));
  assert.ok(!existsSync(join(project.outDir, 'products', 'less-than-tee')));
  assert.ok(!existsSync(join(project.outDir, 'apparel', 'ghost')));
  assert.ok(!existsSync(join(project.outDir, 'products', 'ghost.html')));
  assert.ok(existsSync(join(project.outDir, 'apparel', 'percolator-classic-tee', 'index.html')));
  assert.ok(existsSync(join(project.outDir, 'products', 'percolator-classic-tee', 'index.html')));
  assert.ok(existsSync(join(project.outDir, 'CNAME')));
  assert.ok(walk(project.outDir).includes('apparel/index.html'));
});

test('a design switched to unlisted loses its page and its index entry on rebuild', async () => {
  const designs = loadFixtureDesigns();
  const project = makeProject({ designs });
  await build(project);
  const target = designs.find((d) => d.handle === 'cafe-cosmos-crewneck');
  target.listed = false;
  writeFileSync(project.dataPath, JSON.stringify({ designs }));
  await build(project);
  assert.ok(!existsSync(join(project.outDir, 'apparel', target.handle)));
  assert.ok(existsSync(join(project.outDir, 'products', target.handle, 'index.html')));
  const index = readFileSync(join(project.outDir, 'apparel', 'index.html'), 'utf8');
  assert.ok(index.includes('Percolator Classic Tee'));
  assert.ok(!index.includes('Cosmos Crewneck'));
});

// Only meaningful once the data file and the committed output exist.
const hasData = existsSync(join(REPO, 'data', 'designs.json'));
test('the committed docs directory equals a fresh build of the repository data', { skip: !hasData && 'data/designs.json is not present yet' }, async () => {
  const out = join(tempDir('tou-fresh'), 'docs');
  const error = await errorOf(() =>
    build({
      dataPath: join(REPO, 'data', 'designs.json'),
      srcDir: join(REPO, 'src'),
      assetsDir: join(REPO, 'assets'),
      outDir: out,
    }),
  );
  assert.equal(error, null);
  const fresh = snapshot(out);
  assert.ok(Object.keys(fresh).length > 10);
  assert.deepEqual(snapshot(join(REPO, 'docs')), fresh);
});
