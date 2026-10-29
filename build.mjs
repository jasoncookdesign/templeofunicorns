// Static site generator for the Temple of Unicorns design archive.
// Usage: node build.mjs [--data <file>] [--src <dir>] [--assets <dir>] [--out <dir>]
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
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

const RECIPIENT = 'templeofunicorns@jasoncookdesign.com';
const SITE = 'https://templeofunicorns.com';
const REQUIRED = ['handle', 'title', 'description', 'listed', 'availability', 'status'];
// Folders in the output that the build owns and recreates on every run.
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
    }
  }
}

// ---------- markup ----------
const esc = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/site.css">
<script src="/site.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
<a class="site-name" href="/">Temple of Unicorns</a>
<nav aria-label="Main"><a href="/apparel/">Apparel</a></nav>
</header>
<main id="main">
${body}
</main>
</body>
</html>
`;
}

const imageTag = (image) => `<img src="/${esc(image.file)}" alt="${esc(image.alt)}" loading="lazy">`;

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
  return `<div class="table-wrap"><table class="size-guide">
<caption>Size guide</caption>
<thead><tr>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

function detailPage(d) {
  const options = d.options?.length
    ? `<section aria-labelledby="options-heading">
<h2 id="options-heading">Options</h2>
<ul class="options">
${d.options.map((o) => `<li>${esc(o.name)}\n<ul>\n${o.values.map((v) => `<li>${esc(v)}</li>`).join('\n')}\n</ul>\n</li>`).join('\n')}
</ul>
</section>`
    : '';
  const ask = d.availability === 'on-request' ? `<p><a class="button" href="${mailtoHref(d.title)}">Ask about this design</a></p>` : '';
  return page({
    title: `${d.title} | Temple of Unicorns`,
    body: `<article>
<h1>${esc(d.title)}</h1>
<div class="gallery">
${d.images.map(imageTag).join('\n')}
</div>
${d.description.map((p) => `<p>${esc(p)}</p>`).join('\n')}
${sizeGuideTable(d.sizeGuide)}
${options}
${ask}
</article>`,
  });
}

function indexPage(listed) {
  const cards = listed
    .map((d) => `<li><a href="/apparel/${esc(d.handle)}/">${imageTag(d.images[0])}<span>${esc(d.title)}</span></a></li>`)
    .join('\n');
  return page({ title: 'Apparel | Temple of Unicorns', body: `<h1>Apparel</h1>\n<ul class="grid">\n${cards}\n</ul>` });
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
export function build({ dataPath, srcDir, assetsDir, outDir } = {}) {
  const { designs } = JSON.parse(readFileSync(dataPath, 'utf8'));
  validate(designs);

  const listed = designs.filter((d) => d.listed).sort((a, b) => (a.handle < b.handle ? -1 : 1));
  const imageSources = new Map();
  for (const image of listed.flatMap((d) => d.images)) {
    const relative = normalize(image.file.replace(/^assets\//, ''));
    const source = join(assetsDir, relative);
    if (relative.startsWith('..') || !existsSync(source)) throw new Error(`Image not found: ${image.file}`);
    imageSources.set(image.file, source);
  }
  if (!existsSync(join(srcDir, 'index.html'))) throw new Error(`Missing ${join(srcDir, 'index.html')}`);

  // Everything is valid: only now is the output folder touched.
  mkdirSync(outDir, { recursive: true });
  for (const dir of GENERATED_DIRS) rmSync(join(outDir, dir), { recursive: true, force: true });
  cpSync(srcDir, outDir, { recursive: true });
  const put = (rel, content) => {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    writeFileSync(join(outDir, rel), content);
  };
  put('CNAME', 'templeofunicorns.com\n');
  put('.nojekyll', '');
  for (const [file, source] of imageSources) {
    mkdirSync(dirname(join(outDir, file)), { recursive: true });
    cpSync(source, join(outDir, file));
  }
  put('apparel/index.html', indexPage(listed));
  for (const d of listed) put(`apparel/${d.handle}/index.html`, detailPage(d));
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
