import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILD_MODULE, FIXTURE_ASSETS, FIXTURE_DATA, FIXTURE_SRC, loadFixtureDesigns, makeProject, snapshot, tempDir, walk,
} from './helpers.mjs';

const node = (args, options = {}) =>
  spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000, ...options });

test('the command line builds the whole site from the fixture inputs', () => {
  const out = join(tempDir('tou-cli'), 'docs');
  const run = node([BUILD_MODULE, '--data', FIXTURE_DATA, '--src', FIXTURE_SRC, '--assets', FIXTURE_ASSETS, '--out', out]);
  assert.equal(run.status, 0, run.stderr);

  const designs = loadFixtureDesigns();
  const files = walk(out);
  for (const f of ['index.html', '404.html', 'site.css', 'site.js', 'CNAME', '.nojekyll', 'apparel/index.html']) {
    assert.ok(files.includes(f), f);
  }
  for (const d of designs) {
    assert.ok(files.includes(`products/${d.handle}/index.html`), d.handle);
    assert.equal(files.includes(`apparel/${d.handle}/index.html`), d.listed, d.handle);
    for (const image of d.images.filter(() => d.listed)) assert.ok(files.includes(image.file), image.file);
  }
  const page = readFileSync(join(out, 'apparel', 'rock-and-roll-hoodie', 'index.html'), 'utf8');
  assert.ok(page.includes('Rock &amp; Roll'));
  assert.equal((page.match(/mailto:/g) || []).length, 1);
  assert.equal(readFileSync(join(out, 'CNAME'), 'utf8').trim(), 'templeofunicorns.com');
});

test('the command line uses data, src, assets and docs under the working directory by default', () => {
  const project = makeProject({ designs: loadFixtureDesigns() });
  const script = join(project.root, 'build.mjs');
  copyFileSync(BUILD_MODULE, script);
  const run = node([script], { cwd: project.root });
  assert.equal(run.status, 0, run.stderr);
  const files = walk(join(project.root, 'docs'));
  assert.ok(files.includes('apparel/percolator-classic-tee/index.html'));
  assert.ok(files.includes('products/hidden-prototype-hoodie/index.html'));
  assert.ok(files.includes('CNAME'));
  assert.ok(!existsSync(join(project.root, 'docs', 'apparel', 'hidden-prototype-hoodie')));
});

test('the command line exits non-zero, prints a message and writes nothing for invalid data', () => {
  const designs = loadFixtureDesigns();
  designs[1].handle = designs[0].handle;
  const project = makeProject({ designs });
  mkdirSync(project.outDir, { recursive: true });
  writeFileSync(join(project.outDir, 'CNAME'), 'keep.example');
  const before = snapshot(project.outDir);
  const run = node([BUILD_MODULE, '--data', project.dataPath, '--src', project.srcDir, '--assets', project.assetsDir, '--out', project.outDir]);
  assert.notEqual(run.status, 0);
  assert.notEqual(run.status, null);
  assert.ok((run.stderr + run.stdout).trim().length > 0, 'a message is printed');
  assert.ok(!/not implemented/i.test(run.stderr + run.stdout), 'the failure comes from validation');
  assert.ok((run.stderr + run.stdout).includes(designs[0].handle), 'the message names the duplicated handle');
  assert.deepEqual(snapshot(project.outDir), before);
});

test('a CLI run matches an in-process build of the same inputs', async () => {
  const { build } = await import('./helpers.mjs');
  const cliOut = join(tempDir('tou-cli'), 'docs');
  const apiOut = join(tempDir('tou-api'), 'docs');
  const run = node([BUILD_MODULE, '--data', FIXTURE_DATA, '--src', FIXTURE_SRC, '--assets', FIXTURE_ASSETS, '--out', cliOut]);
  assert.equal(run.status, 0, run.stderr);
  await build({ dataPath: FIXTURE_DATA, srcDir: FIXTURE_SRC, assetsDir: FIXTURE_ASSETS, outDir: apiOut });
  const cli = snapshot(cliOut);
  assert.ok(Object.keys(cli).length > 25);
  assert.deepEqual(snapshot(apiOut), cli);
});
