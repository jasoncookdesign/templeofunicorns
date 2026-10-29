import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  build,
  DataError,
  builtFixture,
  errorOf,
  expectRejectedBuild,
  htmlFiles,
  loadFixtureDesigns,
  makeProject,
  read,
  tokenize,
  tagsNamed,
  elementTexts,
} from './helpers.mjs';

// ---------- a small element tree over the strict tokenizer ----------
const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input']);
function tree(html) {
  const root = { name: '#root', attrs: {}, children: [], parent: null };
  let node = root;
  for (const t of tokenize(html)) {
    if (t.type === 'tag' && !t.close) {
      const el = { name: t.name, attrs: t.attrs, children: [], parent: node, raw: t.raw };
      node.children.push(el);
      if (!VOID.has(t.name)) node = el;
    } else if (t.type === 'tag' && t.close) {
      if (VOID.has(t.name)) continue;
      assert.equal(node.name, t.name, `closing </${t.name}> matches the open <${node.name}>`);
      node = node.parent;
    } else if (t.type === 'text') {
      node.children.push({ name: '#text', text: t.text, raw: t.raw, parent: node });
    }
  }
  assert.equal(node, root, 'every element is closed');
  return root;
}
const elements = (node, name, out = []) => {
  for (const c of node.children ?? []) {
    if (c.name === name) out.push(c);
    elements(c, name, out);
  }
  return out;
};
const textOf = (node) =>
  node.name === '#text' ? node.text : (node.children ?? []).map(textOf).join('');
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const kids = (node, ...names) => node.children.filter((c) => names.includes(c.name));

const pageOf = (d) => `apparel/${d.handle}/index.html`;
const byHandle = (designs, handle) => designs.find((d) => d.handle === handle);

// The row elements of a table, whatever sections (thead/tbody) wrap them.
function rowsOf(table) {
  const rows = [];
  const visit = (n) => {
    for (const c of n.children) {
      if (c.name === 'tr') rows.push(c);
      else if (['thead', 'tbody', 'tfoot'].includes(c.name)) visit(c);
    }
  };
  visit(table);
  return rows;
}

// Asserts that the single table on `html` renders `guide` faithfully.
function assertTableMatches(html, guide, label) {
  const root = tree(html);
  const tables = elements(root, 'table');
  assert.equal(tables.length, 1, `${label}: exactly one table`);
  assert.equal((html.match(/<table[\s>]/gi) || []).length, 1, `${label}: one <table> in the markup`);
  const [table] = tables;

  const captions = kids(table, 'caption');
  assert.equal(captions.length, 1, `${label}: one caption`);
  assert.equal(clean(textOf(captions[0])), 'Size guide', `${label}: caption text`);

  const rows = rowsOf(table);
  assert.equal(rows.length, guide.rows.length + 1, `${label}: header row plus one row per data row`);

  const [header, ...body] = rows;
  const headCells = kids(header, 'th', 'td');
  assert.deepEqual(
    headCells.map((c) => c.name),
    guide.columns.map(() => 'th'),
    `${label}: header row is all th`,
  );
  headCells.forEach((c) => assert.equal(c.attrs.scope, 'col', `${label}: header cells have scope=col`));
  assert.deepEqual(headCells.map((c) => clean(textOf(c))), guide.columns.map(clean), `${label}: columns in order`);

  body.forEach((tr, i) => {
    const cells = kids(tr, 'th', 'td');
    assert.deepEqual(
      cells.map((c) => c.name),
      guide.columns.map((_, j) => (j === 0 ? 'th' : 'td')),
      `${label}: row ${i} is one th then td cells`,
    );
    assert.equal(cells[0].attrs.scope, 'row', `${label}: row ${i} first cell has scope=row`);
    cells.slice(1).forEach((c) => assert.equal(c.attrs.scope, undefined, `${label}: data cells carry no scope`));
    assert.deepEqual(cells.map((c) => clean(textOf(c))), guide.rows[i].map(clean), `${label}: row ${i} text in order`);
  });
  assert.equal(elements(table, 'th').length, guide.columns.length + guide.rows.length, `${label}: th count`);
  return { root, table };
}

// ---------- rendering ----------
test('a design with a size guide shows one table with the stated columns and rows', async () => {
  const { outDir, designs } = await builtFixture();
  const withGuide = designs.filter((d) => d.listed && d.sizeGuide);
  assert.ok(withGuide.length >= 3);
  for (const d of withGuide) assertTableMatches(read(outDir, pageOf(d)), d.sizeGuide, d.handle);
});

test('size guides with two and three measurement columns keep their column count', async () => {
  const { outDir, designs } = await builtFixture();
  const three = byHandle(designs, 'percolator-classic-tee');
  const two = byHandle(designs, 'dnfnb-oversized-graff-tee');
  assert.equal(three.sizeGuide.columns.length, 4);
  assert.equal(two.sizeGuide.columns.length, 3);
  const { table: t3 } = assertTableMatches(read(outDir, pageOf(three)), three.sizeGuide, three.handle);
  const { table: t2 } = assertTableMatches(read(outDir, pageOf(two)), two.sizeGuide, two.handle);
  assert.equal(kids(rowsOf(t3)[1], 'td').length, 3);
  assert.equal(kids(rowsOf(t2)[1], 'td').length, 2);
});

test('the size guide table is wrapped in a scroll container that is its direct parent', async () => {
  const { outDir, designs } = await builtFixture();
  for (const d of designs.filter((x) => x.listed && x.sizeGuide)) {
    const { table } = assertTableMatches(read(outDir, pageOf(d)), d.sizeGuide, d.handle);
    const wrapper = table.parent;
    assert.equal(wrapper.name, 'div', `${d.handle}: wrapper is a div`);
    assert.match(wrapper.attrs.class ?? '', /table/i, `${d.handle}: wrapper class mentions table`);
    assert.equal(kids(wrapper, 'table').length, 1);
    assert.equal(wrapper.children.filter((c) => c.name !== '#text' || c.text.trim() !== '').length, 1, `${d.handle}: wrapper holds only the table`);
  }
});

test('size guide text with markup characters is escaped and round-trips to the original', async () => {
  const { outDir, designs } = await builtFixture();
  const d = byHandle(designs, 'rock-and-roll-hoodie');
  const html = read(outDir, pageOf(d));
  const { table } = assertTableMatches(html, d.sizeGuide, d.handle);

  // The data really contains the troublesome characters.
  const everything = [...d.sizeGuide.columns, ...d.sizeGuide.rows.flat()].join('|');
  for (const ch of ['&', '"', '<', "'", '⅝']) assert.ok(everything.includes(ch), `fixture contains ${ch}`);

  // In the markup, text between the table tags carries no raw <, & or ".
  const source = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
  const textOnly = source.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  assert.equal(/[<"]/.test(textOnly), false, 'no raw < or " in table text');
  assert.equal(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/.test(textOnly), false, 'no bare & in table text');
  assert.ok(textOnly.includes('&lt;'), 'less-than is written as an entity');
  assert.ok(/&amp;/.test(textOnly), 'ampersand is written as an entity');
  assert.ok(/&quot;|&#34;|&#x22;/.test(textOnly), 'double quote is written as an entity');
  assert.ok(textOnly.includes('⅝'), 'the fraction character survives as written');

  const cells = elements(table, 'th').concat(elements(table, 'td')).map((c) => clean(textOf(c)));
  for (const value of [...d.sizeGuide.columns, ...d.sizeGuide.rows.flat()]) assert.ok(cells.includes(clean(value)), `round-trip of ${JSON.stringify(value)}`);
});

test('designs without a size guide have a page with no table and no size guide text', async () => {
  const { outDir, designs } = await builtFixture();
  const without = designs.filter((d) => d.listed && !d.sizeGuide);
  assert.ok(without.some((d) => d.availability === 'on-request'));
  assert.ok(without.some((d) => d.availability === 'archive'));
  for (const d of without) {
    const html = read(outDir, pageOf(d));
    assert.deepEqual(elementTexts(tokenize(html), 'h1'), [d.title], `${d.handle}: page exists with its title`);
    assert.equal(tagsNamed(tokenize(html), 'table').length, 0, `${d.handle}: no table`);
    assert.equal(/<table|<caption/i.test(html), false);
    assert.equal(/size guide/i.test(html), false, `${d.handle}: no size guide text`);
  }
});

test('an archive design that has a size guide renders the table too', async () => {
  const designs = loadFixtureDesigns();
  const archive = designs.find((d) => d.availability === 'archive');
  archive.sizeGuide = { columns: ['Size', 'Length (in)'], rows: [['L', '30'], ['XL', '31']] };
  const project = makeProject({ designs });
  await build(project);
  const html = read(project.outDir, pageOf(archive));
  assertTableMatches(html, archive.sizeGuide, archive.handle);
  assert.equal((html.match(/mailto:/g) || []).length, 0, 'the archive page keeps no mailto link');
});

test('a single-row guide with one measurement column is accepted and rendered', async () => {
  const designs = loadFixtureDesigns();
  designs[3].sizeGuide = { columns: ['Size', 'Length (in)'], rows: [['One size', '30']] };
  const project = makeProject({ designs });
  assert.equal(await errorOf(() => build(project)), null);
  assertTableMatches(read(project.outDir, pageOf(designs[3])), designs[3].sizeGuide, designs[3].handle);
});

test('a null or absent size guide is accepted and renders nothing', async () => {
  const designs = loadFixtureDesigns();
  designs[0].sizeGuide = null;
  delete designs[1].sizeGuide;
  designs[2].sizeGuide = null;
  const project = makeProject({ designs });
  assert.equal(await errorOf(() => build(project)), null);
  for (const i of [0, 1, 2]) {
    const html = read(project.outDir, pageOf(designs[i]));
    assert.deepEqual(elementTexts(tokenize(html), 'h1'), [designs[i].title]);
    assert.equal(/<table/i.test(html), false);
    assert.equal(/size guide/i.test(html), false);
  }
});

test('only detail pages of designs with a guide contain a table', async () => {
  const { outDir, designs } = await builtFixture();
  const holders = new Set(designs.filter((d) => d.listed && d.sizeGuide).map(pageOf));
  assert.ok(holders.size >= 3);
  const pages = htmlFiles(outDir);
  assert.ok(pages.includes('apparel/index.html') && pages.includes('index.html') && pages.includes('404.html'));
  assert.ok(pages.some((p) => p.startsWith('products/')));
  for (const rel of pages) {
    const html = read(outDir, rel);
    if (holders.has(rel)) {
      assert.equal(tagsNamed(tokenize(html), 'table').length, 1, rel);
      continue;
    }
    assert.equal(/<table|<caption|<th[\s>]/i.test(html), false, `${rel}: no table markup`);
    assert.equal(/size guide/i.test(html), false, `${rel}: no size guide text`);
  }
  const catalog = read(outDir, 'apparel/index.html');
  for (const d of designs.filter((x) => x.listed)) assert.ok(catalog.includes(`/apparel/${d.handle}/`), `catalog still lists ${d.handle}`);
});

// ---------- validation ----------
const GOOD = () => ({ columns: ['Size', 'Length (in)', 'Width (in)'], rows: [['S', '28', '18'], ['M', '29', '20']] });
const reject = (name, mutate) =>
  test(`a size guide ${name} is rejected as bad-size-guide`, () => expectRejectedBuild(assert, 'bad-size-guide', (d) => {
      mutate(d[0]);
    }));

reject('that is a string', (d) => (d.sizeGuide = 'S 28 18'));
reject('that is a number', (d) => (d.sizeGuide = 5));
reject('that is a boolean', (d) => (d.sizeGuide = true));
reject('that is an array', (d) => (d.sizeGuide = [GOOD().columns, ...GOOD().rows]));
reject('without columns', (d) => ((d.sizeGuide = GOOD()), delete d.sizeGuide.columns));
reject('with an empty columns list', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.columns = [])));
reject('with columns that is not a list', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.columns = 'Size')));
reject('with an empty column name', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.columns[1] = '')));
reject('with an empty first column name', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.columns[0] = '')));
reject('with a numeric column name', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.columns[2] = 12)));
reject('with a null column name', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.columns[1] = null)));
reject('without rows', (d) => ((d.sizeGuide = GOOD()), delete d.sizeGuide.rows));
reject('with an empty rows list', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.rows = [])));
reject('with rows that is not a list', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.rows = 'S 28 18')));
reject('with a row that is a string', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.rows[1] = 'M 29 20')));
reject('with a row that is an object', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.rows[0] = { size: 'S' })));
reject('with a row that is too short', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.rows[1] = ['M', '29'])));
reject('with a row that is too long', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.rows[1] = ['M', '29', '20', '40'])));
reject('with an empty cell', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.rows[1][2] = '')));
reject('with an empty size label', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.rows[0][0] = '')));
reject('with a numeric cell', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.rows[1][1] = 29)));
reject('with a null cell', (d) => ((d.sizeGuide = GOOD()), (d.sizeGuide.rows[0][2] = null)));

test('an invalid size guide on the last design is rejected as bad-size-guide', () =>
  expectRejectedBuild(assert, 'bad-size-guide', (d) => {
    d[d.length - 1].sizeGuide = { columns: ['Size', 'Length (in)'], rows: [['M', '']] };
  }));

test('an invalid size guide on an unlisted design is rejected as bad-size-guide', () =>
  expectRejectedBuild(assert, 'bad-size-guide', (d) => {
    const hidden = d.find((x) => !x.listed);
    hidden.sizeGuide = { columns: [], rows: [['M']] };
  }));

test('a rejected size guide leaves the specific error type and message intact', async () => {
  const designs = loadFixtureDesigns();
  designs[0].sizeGuide = { columns: ['Size', 'Length (in)'], rows: [['M']] };
  const error = await errorOf(() => build(makeProject({ designs })));
  assert.ok(error instanceof DataError);
  assert.equal(error.name, 'DataError');
  assert.equal(error.code, 'bad-size-guide');
});
