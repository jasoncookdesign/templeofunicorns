# Temple of Unicorns

A static design archive for the Temple of Unicorns streetwear brand, published at https://templeofunicorns.com. The pages are plain HTML, CSS, and JavaScript with no framework and no runtime dependencies. There is no cart, no checkout, and no payment information. Visitors browse past designs and, for designs marked on-request, email the site owner to ask about them.

A small Node script reads one data file and generates the catalog pages. The story page, the 404 page, the stylesheet, the script, and the logo files are written by hand.

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
| `--src` | `src` | Hand-written pages, stylesheet, script, and `logo/` folder |
| `--assets` | `assets` | Root folder that holds the design images |
| `--out` | `docs` | Output folder |

Data is validated before anything is written. The build also fails, without writing, if a listed design's image file or `src/index.html` is missing, or if a symlink in the assets or source folder resolves outside that folder. In every one of these cases the build exits with a non-zero status, prints a message, and leaves the output folder exactly as it was. Symlinks that stay inside their folder are copied as regular files, never as symlinks. The same build is available as a module: `import { build, DataError } from './build.mjs'` and `build({ dataPath, srcDir, assetsDir, outDir })`.

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
| `description` | Array of plain-text strings, one per paragraph. No HTML. |
| `collections` | Optional. Array of collection names (strings) the design belongs to. |
| `options` | Optional. Array of `{ "name", "values" }` objects, where `name` is a non-empty string and `values` is an array of non-empty strings. Shown as plain lists. |
| `images` | At least one `{ "file", "alt" }` object. `file` is the path of the image relative to the folder that contains `assets/` and must start with `assets/`; `alt` must not be empty. The first image is the one shown in the apparel index. |
| `sizeGuide` | Optional. An object with `columns` (a non-empty list of non-empty strings; the first column is the size label) and `rows` (a non-empty list; each row is a list of exactly as many non-empty strings as there are columns). Measurements are kept as strings, exactly as written (for example `"23 ⅝"`). May be omitted or `null`, in which case the page shows no size section. |
| `listed` | The boolean `true` or `false` (a string such as `"no"` is rejected). A design with `false` gets no page and does not appear in the apparel index. |
| `availability` | Exactly `"on-request"` or `"archive"`. On-request pages carry one "ask about this design" email link; archive pages carry none. |
| `status` | Exactly `"active"` or `"archived"`: the store status when the data was exported, kept for the record. |
| `publishedAt` | Date as `YYYY-MM-DD`, or `null`. May be omitted, which counts as `null`. |

A design with a `sizeGuide` shows it on its page, after the description, as one table captioned "Size guide". The first row holds the column headings, and the first cell of each row is a row heading. The table sits in a wrapper that scrolls sideways on narrow screens; the wrapper is a labelled region ("Size guide") that can be focused with the keyboard and shows a focus ring. All text is escaped. The build renders a size guide whenever the data has one, whatever the design's `availability`.

The "Ask about this design" link on each on-request page is a `mailto:` link addressed to `contact@templeofunicorns.com`, with the design's title in the subject and a short greeting in the body. This is the only email address used anywhere in the generated site or the hand-written sources in `src/`; it is set by the `RECIPIENT` constant in `build.mjs`, and the tests fail if any other address appears.

There is no price field. Any design with a key named `price`, or any key containing "price" in any letter case, is rejected.

A design that breaks a rule makes the build throw `DataError`, whose `code` is one of `duplicate-handle`, `missing-field`, `bad-availability`, `bad-status`, `missing-alt`, `no-images`, `price-field`, `bad-handle`, `bad-published-at`, or `bad-size-guide`. The `missing-field` code also covers a field of the wrong shape: a `description`, `options`, or `collections` value that is not the type described above, a `listed` value that is not a boolean, and an image `file` that does not start with `assets/`. Size guides are validated for every design, listed or not.

## Repository layout

| Path | Contents |
| --- | --- |
| `data/designs.json` | The data file |
| `assets/designs/<handle>/NN.<ext>` | Design images (`01`, `02`, ...) |
| `src/` | Hand-written `index.html`, `404.html`, `site.css`, `site.js`, and the `logo/` folder, copied unchanged into the output |
| `build.mjs` | The site generator |
| `tests/` | Test suite and fixtures (`node --test`) |
| `docs/` | Generated site, committed and served by GitHub Pages |

## What the build writes to `docs/`

- Everything in `src/` (`index.html`, `404.html`, `site.css`, `site.js`, and the `logo/` folder), copied unchanged. Every generated page links `/site.css` and `/site.js`.
- `CNAME` (containing `templeofunicorns.com`) and `.nojekyll`.
- `assets/designs/...`: the images of listed designs. Images of unlisted designs are not published.
- `apparel/index.html`: every listed design with its title, link, and first image, in alphabetical order by title (case-insensitive, ties broken by handle).
- `apparel/<handle>/index.html`: one page per listed design.
- `products/<handle>/index.html`: one redirect page per design, listed or not, so old store links keep working. Listed designs redirect to their page; unlisted designs redirect to `/apparel/`.

The build is deterministic, so running it twice gives byte-identical output. It deletes and recreates `docs/apparel/`, `docs/products/`, and `docs/assets/` on every run, so removing a design from the data file removes its pages and images.

## Logo files

`src/logo/` holds the brand artwork as white SVG files with the viewBox cropped to the artwork: `lockup-white.svg` (the wide lockup on the story page), `wordmark-white.svg` (the wordmark in the page header), and `favicon.svg` (the browser tab icon). The build copies the folder to `docs/logo/` with the rest of `src/`. When `src/logo/wordmark-white.svg` exists, generated pages show it in the header as an image; when `src/logo/favicon.svg` exists, generated pages link it as the icon. Without them, the header shows the site name as text and no icon link is written, so the build works with any source folder.

## Design

The site uses a neutral charcoal page (`color-scheme: dark`) so the design images are the only color. Text meets a 4.5:1 contrast ratio or better, focus rings are 3px, interactive targets are at least 44px, and animation is turned off for visitors who ask for reduced motion. Catalog tiles are uniform square frames with the whole image visible and a title area two lines tall; longer titles wrap in full. A detail page lists the status, colors, and sizes as labelled rows, followed by the description and the size guide. On wide screens the record sits in a column beside the images and scrolls with the page. Text is never smaller than 14px. Headings use a slab serif stack (`Rockwell`, `Rockwell Nova`, `Roboto Slab`, `Georgia`, then the generic serif).

Do not edit files in `docs/` by hand; change `src/`, `data/`, or `assets/` and run `node build.mjs`.

## Publishing

GitHub Pages serves the site from the `docs/` folder on the `main` branch (repository settings, Pages, "Deploy from a branch", branch `main`, folder `/docs`). The `CNAME` file sets the custom domain. To publish a change, run `node build.mjs`, commit the updated `docs/`, and merge to `main`.
