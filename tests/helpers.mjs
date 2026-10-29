// Shared helpers for the build tests.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = join(REPO, 'tests', 'fixtures');
export const FIXTURE_DATA = join(FIXTURES, 'data', 'designs.json');
export const FIXTURE_SRC = join(FIXTURES, 'src');
export const FIXTURE_ASSETS = join(FIXTURES, 'assets');

// The module under test. TOU_BUILD_MODULE overrides the default entry point.
export const BUILD_MODULE = process.env.TOU_BUILD_MODULE
  ? resolve(process.env.TOU_BUILD_MODULE)
  : join(REPO, 'build.mjs');
const mod = await import(pathToFileURL(BUILD_MODULE).href);
export const build = mod.build;
export const DataError = mod.DataError;

export const RECIPIENT = 'templeofunicorns@jasoncookdesign.com';

// ---------- temp dirs ----------
const made = [];
export function tempDir(label = 'tou') {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  made.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

// ---------- data ----------
export function loadFixtureDesigns() {
  return JSON.parse(readFileSync(FIXTURE_DATA, 'utf8')).designs;
}
export const listed = (designs) => designs.filter((d) => d.listed);

// A complete project (data, src, assets) in a temp dir, so any reasonable
// resolution of image paths works. Returns option set for build().
export function makeProject(designsDoc) {
  const root = tempDir('tou-project');
  mkdirSync(join(root, 'data'), { recursive: true });
  const doc = typeof designsDoc === 'string' ? designsDoc : JSON.stringify(designsDoc, null, 2);
  writeFileSync(join(root, 'data', 'designs.json'), doc);
  cpSync(FIXTURE_SRC, join(root, 'src'), { recursive: true });
  cpSync(FIXTURE_ASSETS, join(root, 'assets'), { recursive: true });
  return {
    root,
    dataPath: join(root, 'data', 'designs.json'),
    srcDir: join(root, 'src'),
    assetsDir: join(root, 'assets'),
    outDir: join(root, 'docs'),
  };
}

export function fixtureOptions(outDir) {
  return { dataPath: FIXTURE_DATA, srcDir: FIXTURE_SRC, assetsDir: FIXTURE_ASSETS, outDir };
}

// Runs the fixture build once per test process; every test reads the same output.
let shared;
export async function builtFixture() {
  if (!shared) {
    const outDir = join(tempDir('tou-out'), 'docs');
    shared = (async () => {
      await build(fixtureOptions(outDir));
      return { outDir, designs: loadFixtureDesigns() };
    })();
  }
  return shared;
}

// Captures a thrown or rejected error from a sync or async call.
export async function errorOf(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return null;
}

// ---------- file trees ----------
export function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(full.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}
// Every entry (files and directories) with content, for exact before/after comparisons.
export function snapshot(dir) {
  const result = {};
  if (!existsSync(dir)) return result;
  const visit = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      const rel = full.slice(dir.length + 1);
      if (entry.isDirectory()) {
        result[rel + '/'] = null;
        visit(full);
      } else result[rel] = readFileSync(full).toString('base64');
    }
  };
  visit(dir);
  return result;
}
export const read = (outDir, rel) => readFileSync(join(outDir, rel), 'utf8');
export const isFile = (path) => existsSync(path) && statSync(path).isFile();
const TEXT_EXT = /\.(html|css|js|json|svg|txt|xml)$/i;
export const isTextFile = (rel) => TEXT_EXT.test(rel) || /(^|\/)(CNAME|\.nojekyll)$/.test(rel);

// ---------- strict HTML tokenizer ----------
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return String.fromCodePoint(code);
    }
    if (!(body in NAMED)) throw new Error(`unsupported entity ${m}`);
    return NAMED[body];
  });
}
const BARE_AMP = /&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/;
const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const RAW_TEXT = new Set(['script', 'style']);

// Throws on markup a browser would have to guess about: stray "<", unquoted
// quotes inside attributes, bare ampersands. Returns a flat token list.
export function tokenize(html) {
  const tokens = [];
  let i = 0;
  const pushText = (raw) => {
    if (!raw) return;
    if (BARE_AMP.test(raw)) throw new Error(`bare ampersand in text: ${JSON.stringify(raw.slice(0, 80))}`);
    tokens.push({ type: 'text', raw, text: decodeEntities(raw) });
  };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      pushText(html.slice(i));
      break;
    }
    pushText(html.slice(i, lt));
    const rest = html.slice(lt);
    let m;
    if (rest.startsWith('<!--')) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) throw new Error('unterminated comment');
      i = end + 3;
      continue;
    }
    if ((m = /^<!doctype[^>]*>/i.exec(rest))) {
      i = lt + m[0].length;
      continue;
    }
    if (!(m = TAG.exec(rest))) throw new Error(`malformed markup near ${JSON.stringify(rest.slice(0, 80))}`);
    const attrs = {};
    let a;
    ATTR.lastIndex = 0;
    while ((a = ATTR.exec(m[3]))) {
      const raw = a[2] ?? a[3] ?? a[4] ?? '';
      if (BARE_AMP.test(raw)) throw new Error(`bare ampersand in attribute ${a[1]}: ${JSON.stringify(raw.slice(0, 80))}`);
      attrs[a[1].toLowerCase()] = decodeEntities(raw);
    }
    const name = m[2].toLowerCase();
    tokens.push({ type: 'tag', name, close: m[1] === '/', attrs, raw: m[0] });
    i = lt + m[0].length;
    if (m[1] !== '/' && RAW_TEXT.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, i);
      if (end === -1) throw new Error(`unterminated <${name}>`);
      tokens.push({ type: 'rawtext', raw: html.slice(i, end), text: '' });
      i = end;
    }
  }
  return tokens;
}
export const tagsNamed = (tokens, name) => tokens.filter((t) => t.type === 'tag' && !t.close && t.name === name);

// Text content of every element with this name (nested markup flattened).
export function elementTexts(tokens, name) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'tag' || t.close || t.name !== name) continue;
    let depth = 1;
    let text = '';
    for (let j = i + 1; j < tokens.length && depth > 0; j++) {
      const u = tokens[j];
      if (u.type === 'tag' && u.name === name) depth += u.close ? -1 : 1;
      else if (u.type === 'text') text += u.text;
    }
    out.push(text.replace(/\s+/g, ' ').trim());
  }
  return out;
}
export const pageText = (tokens) => tokens.filter((t) => t.type === 'text').map((t) => t.text).join(' ');

export function parseHtml(html) {
  return tokenize(html);
}

// ---------- link resolution ----------
export function referencesOf(tokens) {
  const refs = [];
  for (const t of tokens) {
    if (t.type !== 'tag' || t.close) continue;
    for (const key of ['href', 'src']) if (t.attrs[key] !== undefined) refs.push({ tag: t.name, key, value: t.attrs[key] });
    if (t.name === 'meta' && (t.attrs['http-equiv'] || '').toLowerCase() === 'refresh') {
      const m = /url\s*=\s*(.+)$/i.exec(t.attrs.content || '');
      if (m) refs.push({ tag: 'meta', key: 'refresh', value: m[1].trim() });
    }
  }
  return refs;
}
export const isExternal = (value) => /^([a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)/.test(value);

// Resolves a reference found on page `fromRel` (path relative to outDir) to an
// output-relative file path, or null when it points nowhere.
export function resolveReference(outDir, fromRel, value) {
  const clean = value.split('#')[0].split('?')[0];
  if (clean === '') return fromRel;
  let target = clean.startsWith('/') ? posix.normalize(clean) : posix.normalize(posix.join(posix.dirname(fromRel), clean));
  target = target.replace(/^\/+/, '');
  if (target.startsWith('..')) return null;
  const full = join(outDir, target);
  if (existsSync(full) && statSync(full).isDirectory()) target = posix.join(target, 'index.html');
  else if (clean.endsWith('/')) target = posix.join(target, 'index.html');
  return isFile(join(outDir, target)) ? target : null;
}

// ---------- page rules ----------
export function assertPageBasics(assert, rel, html) {
  const tokens = tokenize(html);
  const root = tagsNamed(tokens, 'html')[0];
  assert.ok(root, `${rel}: has an <html> element`);
  assert.equal(root.attrs.lang, 'en', `${rel}: html lang is en`);
  const titles = elementTexts(tokens, 'title');
  assert.equal(titles.length, 1, `${rel}: exactly one <title>`);
  assert.notEqual(titles[0], '', `${rel}: non-empty <title>`);
  const h1 = elementTexts(tokens, 'h1');
  assert.equal(h1.length, 1, `${rel}: exactly one <h1>`);
  assert.notEqual(h1[0], '', `${rel}: non-empty <h1>`);
  assert.ok(
    tagsNamed(tokens, 'meta').some((m) => m.attrs.name === 'viewport' && m.attrs.content),
    `${rel}: viewport meta`,
  );
  const imgs = tagsNamed(tokens, 'img');
  for (const img of imgs) assert.ok((img.attrs.alt ?? '').trim() !== '', `${rel}: img ${img.attrs.src} has alt text`);
  return { tokens, imgs };
}

export function htmlFiles(outDir) {
  return walk(outDir).filter((f) => f.endsWith('.html'));
}
