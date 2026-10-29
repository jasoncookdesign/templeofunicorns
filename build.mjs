// Static site generator for the Temple of Unicorns design archive.
// Usage: node build.mjs [--data <file>] [--src <dir>] [--assets <dir>] [--out <dir>]
import { realpathSync } from 'node:fs';
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

export function build({ dataPath, srcDir, assetsDir, outDir } = {}) {
  throw new Error('not implemented');
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
