// Static site generator for the Temple of Unicorns design archive.
// Usage: node build.mjs [--data <file>] [--src <dir>] [--assets <dir>] [--out <dir>]
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export class DataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DataError';
    this.code = code;
  }
}

export const DEFAULTS = {
  dataPath: 'data/designs.json',
  srcDir: 'src',
  assetsDir: 'assets',
  outDir: 'docs',
};

const RECIPIENT = 'contact@templeofunicorns.com';
const SITE = 'https://templeofunicorns.com';
const REQUIRED = ['handle', 'title', 'description', 'listed', 'availability', 'status'];
// Folders in the output that the build owns and recreates on every run.
// Optional brand files in the source folder. Generated pages use them when present.
const MARK_FILE = 'logo/wordmark-white.svg';
const ICON_FILE = 'logo/favicon.svg';
const GENERATED_DIRS = ['apparel', 'products', 'assets'];

// ---------- validation ----------
function fail(code, message) {
  throw new DataError(code, message);
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
}

const isText = (value) => typeof value === 'string' && value !== '';

function validateSizeGuide(label, guide) {
  const bad = (why) => fail('bad-size-guide', `${label}: sizeGuide ${why}.`);
  if (typeof guide !== 'object' || Array.isArray(guide)) bad('must be an object with "columns" and "rows"');
  const { columns, rows } = guide;
  if (!Array.isArray(columns) || columns.length === 0 || !columns.every(isText)) {
    bad('needs a non-empty "columns" list of non-empty strings');
  }
  if (!Array.isArray(rows) || rows.length === 0) bad('needs a non-empty "rows" list');
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== columns.length || !row.every(isText)) {
      bad(`every row needs exactly ${columns.length} non-empty strings`);
    }
  }
}

function validate(designs) {
  if (!Array.isArray(designs)) fail('missing-field', 'The data file must contain a "designs" array.');
  const seen = new Set();
  for (const d of designs) {
    if (!d || typeof d !== 'object') fail('missing-field', 'Every design must be an object.');
    const label = `Design ${JSON.stringify(d.handle)}`;
    const priceKey = Object.keys(d).find((key) => /price/i.test(key));
    if (priceKey) fail('price-field', `${label}: the field "${priceKey}" is not allowed.`);
    for (const field of REQUIRED) {
      if (d[field] === undefined || d[field] === null) fail('missing-field', `${label}: missing "${field}".`);
    }
    if (typeof d.listed !== 'boolean') fail('missing-field', `${label}: "listed" must be true or false.`);
    if (!Array.isArray(d.description) || !d.description.every((p) => typeof p === 'string')) {
      fail('missing-field', `${label}: "description" must be an array of strings.`);
    }
    if (d.collections !== undefined && d.collections !== null) {
      if (!Array.isArray(d.collections) || !d.collections.every((c) => typeof c === 'string')) {
        fail('missing-field', `${label}: "collections" must be an array of strings.`);
      }
    }
    if (d.options !== undefined && d.options !== null) {
      const ok =
        Array.isArray(d.options) &&
        d.options.every((o) => o && isText(o.name) && Array.isArray(o.values) && o.values.every(isText));
      if (!ok) fail('missing-field', `${label}: "options" must be an array of { name, values } with a non-empty name and non-empty string values.`);
    }
    if (typeof d.handle !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(d.handle)) {
      fail('bad-handle', `${label}: the handle must be a lower-case slug (letters, digits, hyphens).`);
    }
    if (seen.has(d.handle)) fail('duplicate-handle', `Duplicate handle "${d.handle}".`);
    seen.add(d.handle);
    if (d.availability !== 'on-request' && d.availability !== 'archive') {
      fail('bad-availability', `${label}: availability must be "on-request" or "archive".`);
    }
    if (d.status !== 'active' && d.status !== 'archived') {
      fail('bad-status', `${label}: status must be "active" or "archived".`);
    }
    if (d.publishedAt !== undefined && d.publishedAt !== null && !isDate(d.publishedAt)) {
      fail('bad-published-at', `${label}: publishedAt must be YYYY-MM-DD or null.`);
    }
    if (d.sizeGuide !== undefined && d.sizeGuide !== null) validateSizeGuide(label, d.sizeGuide);
    if (!Array.isArray(d.images) || d.images.length === 0) fail('no-images', `${label}: at least one image is required.`);
    for (const image of d.images) {
      if (typeof image?.alt !== 'string' || image.alt.trim() === '') {
        fail('missing-alt', `${label}: every image needs non-empty alt text.`);
      }
      if (typeof image.file !== 'string' || image.file === '') fail('missing-field', `${label}: every image needs a "file".`);
      if (!image.file.startsWith('assets/')) fail('missing-field', `${label}: image file "${image.file}" must start with "assets/".`);
    }
  }
}

// ---------- markup ----------
const esc = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const collator = new Intl.Collator('en', { sensitivity: 'base' });
// Alphabetical by title, ignoring case; the handle breaks ties so the order is fixed.
function byTitle(a, b) {
  return collator.compare(a.title, b.title) || (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0);
}

function page({ title, body, brand }) {
  const icon = brand.icon ? `\n<link rel="icon" href="/${ICON_FILE}" type="image/svg+xml">` : '';
  const home = brand.mark
    ? `<img class="home-logo" src="/${MARK_FILE}" alt="Temple of Unicorns" width="168" height="19">`
    : 'Temple of Unicorns';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>${icon}
<link rel="stylesheet" href="/site.css">
<script src="/site.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="bar">
<a class="home" href="/">${home}</a>
<nav aria-label="Main"><a href="/apparel/">Designs</a></nav>
</header>
<main id="main">
${body}
</main>
</body>
</html>
`;
}

const imageTag = (image, lazy = true) =>
  `<img src="/${esc(image.file)}" alt="${esc(image.alt)}" width="1200" height="1200"${lazy ? ' loading="lazy"' : ''}>`;

// The query separator is "&amp;" because the href sits inside HTML markup.
function mailtoHref(title) {
  const subject = encodeURIComponent(`Question about ${title}`);
  const body = encodeURIComponent(`Hello, I would like to ask about the design "${title}". Is it available?`);
  return `mailto:${RECIPIENT}?subject=${subject}&amp;body=${body}`;
}

function sizeGuideTable(guide) {
  if (!guide) return '';
  const head = guide.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('');
  const rows = guide.rows
    .map(([label, ...cells]) => `<tr><th scope="row">${esc(label)}</th>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('\n');
  return `<div class="table-wrap" role="region" aria-label="Size guide" tabindex="0"><table class="size-guide">
<caption>Size guide</caption>
<thead><tr>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

const STATUS_TEXT = {
  'on-request': 'Available on request.',
  archive: 'Archive only. Not available to order.',
};

function detailPage(d, brand) {
  const fact = (label, value) =>
    `<li class="fact"><span class="label">${esc(label)}</span> <span class="value">${esc(value)}</span></li>`;
  const facts = [
    fact('Status', STATUS_TEXT[d.availability]),
    ...(d.options ?? []).filter((o) => o.values?.length).map((o) => fact(`${o.name}s`, o.values.join(', '))),
  ].join('\n');
  const ask =
    d.availability === 'on-request'
      ? `<p class="ask"><a class="button" href="${mailtoHref(d.title)}">Ask about this design</a></p>`
      : '';
  const plate = (image, i) => `<li class="plate">${imageTag(image, i > 0)}</li>`;
  const [first, ...rest] = d.images;
  const description = d.description
    .map((p) => `<p${/^[•·]/.test(p) ? ' class="bullet"' : ''}>${esc(p)}</p>`)
    .join('\n');
  return page({
    brand,
    title: `${d.title} | Temple of Unicorns`,
    body: `<article class="detail" style="--rows:${Math.ceil(d.images.length / 2)}">
<ul class="plates" role="list">
${plate(first, 0)}
</ul>
<div class="record">
<h1>${esc(d.title)}</h1>
<ul class="facts" role="list">
${facts}
</ul>
${ask}
<div class="desc">
${description}
</div>
${sizeGuideTable(d.sizeGuide)}
</div>
${rest.length ? `<ul class="plates" role="list">\n${rest.map((image, i) => plate(image, i + 1)).join('\n')}\n</ul>\n` : ''}</article>`,
  });
}

function indexPage(listed, brand) {
  const cards = listed
    .map(
      (d) =>
        `<li><a class="tile" href="/apparel/${esc(d.handle)}/">${imageTag(d.images[0])}<span class="tile-title">${esc(d.title)}</span></a></li>`,
    )
    .join('\n');
  return page({
    brand,
    title: 'Designs | Temple of Unicorns',
    body: `<div class="page-head"><h1>Designs</h1><p class="count">${listed.length} designs</p></div>\n<ul class="catalog" role="list">\n${cards}\n</ul>`,
  });
}

function redirectPage(d) {
  const target = d.listed ? `/apparel/${d.handle}/` : '/apparel/';
  const label = d.listed ? `Go to ${d.title}` : 'Go to the apparel archive';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)} | Temple of Unicorns</title>
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<link rel="canonical" href="${SITE}${esc(target)}">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<main id="main">
<h1>This page has moved</h1>
<p><a href="${esc(target)}">${esc(label)}</a></p>
</main>
</body>
</html>
`;
}

// ---------- build ----------
// True when the real path of `file` lies inside the real path of `root`.
function insideReal(root, file) {
  return realpathSync(file).startsWith(realpathSync(root) + sep);
}

// The first file under `dir` whose real path leaves `dir`, or null.
function listSymlinkEscapes(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (!insideReal(dir, full)) return full;
    if (entry.isDirectory()) {
      const nested = listSymlinkEscapes(full);
      if (nested) return nested;
    }
  }
  return null;
}

export function build({ dataPath, srcDir, assetsDir, outDir } = {}) {
  const { designs } = JSON.parse(readFileSync(dataPath, 'utf8'));
  validate(designs);

  const listed = designs.filter((d) => d.listed).sort(byTitle);
  const imageSources = new Map();
  for (const image of listed.flatMap((d) => d.images)) {
    const relative = normalize(image.file.replace(/^assets\//, ''));
    const source = join(assetsDir, relative);
    if (relative.startsWith('..') || !existsSync(source)) throw new Error(`Image not found: ${image.file}`);
    if (!insideReal(assetsDir, source)) throw new Error(`Image resolves outside the assets folder: ${image.file}`);
    imageSources.set(image.file, source);
  }
  const brand = {
    mark: existsSync(join(srcDir, MARK_FILE)),
    icon: existsSync(join(srcDir, ICON_FILE)),
  };
  if (!existsSync(join(srcDir, 'index.html'))) throw new Error(`Missing ${join(srcDir, 'index.html')}`);
  const escaped = listSymlinkEscapes(srcDir);
  if (escaped) throw new Error(`Source file resolves outside the source folder: ${escaped}`);

  // Everything is valid: only now is the output folder touched.
  mkdirSync(outDir, { recursive: true });
  for (const dir of GENERATED_DIRS) rmSync(join(outDir, dir), { recursive: true, force: true });
  cpSync(srcDir, outDir, { recursive: true, dereference: true });
  const put = (rel, content) => {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    writeFileSync(join(outDir, rel), content);
  };
  put('CNAME', 'templeofunicorns.com\n');
  put('.nojekyll', '');
  for (const [file, source] of imageSources) {
    mkdirSync(dirname(join(outDir, file)), { recursive: true });
    copyFileSync(source, join(outDir, file)); // follows a symlink and writes a regular file
  }
  put('apparel/index.html', indexPage(listed, brand));
  for (const d of listed) put(`apparel/${d.handle}/index.html`, detailPage(d, brand));
  for (const d of designs) put(`products/${d.handle}/index.html`, redirectPage(d));
}

const FLAGS = { '--data': 'dataPath', '--src': 'srcDir', '--assets': 'assetsDir', '--out': 'outDir' };

export function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 2) {
    const key = FLAGS[argv[i]];
    if (!key || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    options[key] = argv[i + 1];
  }
  return options;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    await build(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
