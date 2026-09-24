/**
 * Bundles the engine and the UI into one self-contained HTML file.
 *
 * The page is published as a single artifact, so the script and stylesheet are
 * inlined rather than shipped alongside it. Fonts are the only external load.
 */

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'dist/index.html');

const bundled = await build({
  entryPoints: [resolve(here, 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
});

const script = bundled.outputFiles[0].text;
const styles = await readFile(resolve(here, 'styles.css'), 'utf8');
const shell = await readFile(resolve(here, 'page.html'), 'utf8');

const html = shell
  .replace('/*STYLES*/', () => styles)
  .replace('/*SCRIPT*/', () => script);

await mkdir(dirname(out), { recursive: true });
await writeFile(out, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`web/dist/index.html  ${kb} kB`);
