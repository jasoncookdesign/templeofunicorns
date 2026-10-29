# Temple of Unicorns

A static design archive for the Temple of Unicorns streetwear brand, published at https://templeofunicorns.com. The pages are plain HTML, CSS, and JavaScript with no framework and no runtime dependencies. There is no cart, no checkout, and no payment information. Visitors browse past designs and, for designs marked on-request, email the shop to ask about them.

A small Node script reads one data file and generates the catalog pages. The story page, the 404 page, and the stylesheet and script are written by hand.

## Requirements

Node.js 20 or newer. There is nothing to install: the build and the tests use only Node's built-in modules.

## Commands

```sh
npm test            # run the test suite (node --test)
node build.mjs      # build the site into docs/
```

`node build.mjs` accepts optional flags that override the default locations:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--data` | `data/designs.json` | The data file |
| `--src` | `src` | Hand-written pages, stylesheet, and script |
| `--assets` | `assets` | Root folder that holds the design images |
| `--out` | `docs` | Output folder |

Data is validated before anything is written, so a rejected build leaves the output folder exactly as it was. The build also fails, without writing, if a listed design's image file or `src/index.html` is missing. It exits with a non-zero status and prints a message when the data file is invalid. In that case nothing is written to the output folder. The same build is available as a module: `import { build, DataError } from './build.mjs'` and `build({ dataPath, srcDir, assetsDir, outDir })`.

## Data file

`data/designs.json` holds one object with a `designs` array:

```json
{
  "designs": [
    {
      "handle": "percolator-classic-tee",
      "title": "Percolator Classic Tee",
      "description": ["Plain-text paragraph one.", "Paragraph two."],
      "collections": ["The DJ Collection"],
      "options": [
        { "name": "Size", "values": ["S", "M", "L"] },
        { "name": "Color", "values": ["Black"] }
      ],
      "images": [
        { "file": "assets/designs/percolator-classic-tee/01.jpg", "alt": "Black tee printed with ..." }
      ],
      "sizeGuide": {
        "columns": ["Size", "Length (in)", "Width (in)"],
        "rows": [["S", "28", "18"], ["M", "29", "20"]]
      },
      "listed": true,
      "availability": "on-request",
      "status": "archived",
      "publishedAt": "2024-12-02"
    }
  ]
}
```

| Field | Rules |
| --- | --- |
| `handle` | Unique lower-case slug (letters, digits, hyphens). Used in every URL for the design. |
| `title` | Display name. Any characters are allowed; the build escapes them. |
| `description` | Array of plain-text paragraphs. No HTML. |
| `collections` | Array of collection names the design belongs to. |
| `options` | Array of `{ "name", "values" }` objects, shown as plain lists. |
| `images` | At least one `{ "file", "alt" }` object. `file` is the path of the image relative to the folder that contains `assets/`; `alt` must not be empty. The first image is the one shown in the apparel index. |
| `sizeGuide` | Optional. An object with `columns` (a non-empty list of non-empty strings; the first column is the size label) and `rows` (a non-empty list; each row is a list of exactly as many non-empty strings as there are columns). Measurements are kept as strings, exactly as written (for example `"23 ⅝"`). May be omitted or `null`, in which case the page shows no size section. |
| `listed` | `true` or `false`. A design with `false` gets no page and does not appear in the apparel index. |
| `availability` | Exactly `"on-request"` or `"archive"`. On-request pages carry one "ask about this design" email link; archive pages carry none. |
| `status` | Exactly `"active"` or `"archived"`: the store status when the data was exported, kept for the record. |
| `publishedAt` | Date as `YYYY-MM-DD`, or `null`. May be omitted, which counts as `null`. |

A design with a `sizeGuide` shows it on its page, after the description, as one table captioned "Size guide". The first row holds the column headings, and the first cell of each row is a row heading. The table sits in a wrapper that scrolls sideways on narrow screens. All text is escaped. The build renders a size guide whenever the data has one, whatever the design's `availability`.

There is no price field. Any design with a key named `price`, or any key containing "price" in any letter case, is rejected.

A design that breaks a rule makes the build throw `DataError`, whose `code` is one of `duplicate-handle`, `missing-field`, `bad-availability`, `bad-status`, `missing-alt`, `no-images`, `price-field`, `bad-handle`, or `bad-published-at`, or `bad-size-guide`. Size guides are validated for every design, listed or not.

## Repository layout

| Path | Contents |
| --- | --- |
| `data/designs.json` | The data file |
| `assets/designs/<handle>/NN.<ext>` | Design images (`01`, `02`, ...) |
| `src/` | Hand-written `index.html`, `404.html`, `site.css`, `site.js`, copied unchanged into the output |
| `build.mjs` | The site generator |
| `tests/` | Test suite and fixtures (`node --test`) |
| `docs/` | Generated site, committed and served by GitHub Pages |

## What the build writes to `docs/`

- Everything in `src/` (`index.html`, `404.html`, `site.css`, `site.js`), copied unchanged. Every generated page links `/site.css` and `/site.js`.
- `CNAME` (containing `templeofunicorns.com`) and `.nojekyll`.
- `assets/designs/...`: the images of listed designs. Images of unlisted designs are not published.
- `apparel/index.html`: every listed design with its title, link, and first image.
- `apparel/<handle>/index.html`: one page per listed design.
- `products/<handle>/index.html`: one redirect page per design, listed or not, so old store links keep working. Listed designs redirect to their page; unlisted designs redirect to `/apparel/`.

The build is deterministic, so running it twice gives byte-identical output. It deletes and recreates `docs/apparel/`, `docs/products/`, and `docs/assets/` on every run, so removing a design from the data file removes its pages and images.

Do not edit files in `docs/` by hand; change `src/`, `data/`, or `assets/` and run `node build.mjs`.

## Publishing

GitHub Pages serves the site from the `docs/` folder on the `main` branch (repository settings, Pages, "Deploy from a branch", branch `main`, folder `/docs`). The `CNAME` file sets the custom domain. To publish a change, run `node build.mjs`, commit the updated `docs/`, and merge to `main`.
