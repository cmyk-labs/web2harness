// Run: node scripts/render-icons.mjs
// Requires the repository's playwright-core and an installed Chrome browser.
// Set CHROME_PATH to use a specific executable. This never uses a saved profile.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = resolve(root, 'assets/brand');
const output = resolve(root, 'output/rounded-icon');
const svg = await readFile(resolve(assets, 'app-icon.svg'), 'utf8');
const mark = JSON.parse(await readFile(resolve(assets, 'brand-mark.json'), 'utf8'));
assert(svg.includes(mark.path), 'App icon must retain the approved H mark');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = new Map();
const checks = [];
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route('**/*', route => route.abort());
  for (const size of [1254, ...sizes]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    const png = await page.screenshot({ omitBackground: true });
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.equal(png[25], 6, 'PNG must retain RGBA transparency');
    const alpha = await page.evaluate(async data => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const edge = image.width - 1;
      return [[0, 0], [edge, 0], [0, edge], [edge, edge], [Math.floor(edge / 2), 0]]
        .map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
    }, png.toString('base64'));
    assert.deepEqual(alpha.slice(0, 4), [0, 0, 0, 0], `${size}px corners must be transparent`);
    assert.equal(alpha[4], 255, `${size}px top edge must retain the black plate`);
    frames.set(size, png);
    checks.push({ size, cornerAlpha: alpha.slice(0, 4), topEdgeAlpha: alpha[4] });
  }
} finally {
  await browser.close();
}

// ICO stores the original RGBA PNG bytes in each directory entry, preserving alpha.
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  const png = frames.get(size);
  directory.writeUInt8(size === 256 ? 0 : size, entry);
  directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(png.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += png.length;
}
const ico = Buffer.concat([directory, ...sizes.map(size => frames.get(size))]);
assert.equal(ico.readUInt16LE(0), 0);
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), sizes.length);
assert.equal(ico.length, offset);
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  const length = ico.readUInt32LE(entry + 8);
  const start = ico.readUInt32LE(entry + 12);
  assert.equal(ico[entry] || 256, size);
  assert.equal(ico[entry + 1] || 256, size);
  assert.equal(ico.readUInt16LE(entry + 6), 32);
  assert(ico.subarray(start, start + length).equals(frames.get(size)));
}

await writeFile(resolve(assets, 'icon.png'), frames.get(1254));
await writeFile(resolve(assets, 'icon.ico'), ico);
for (const size of sizes) await writeFile(resolve(output, `icon-${size}.png`), frames.get(size));
await writeFile(resolve(output, 'validation.json'), JSON.stringify({
  source: 'assets/brand/app-icon.svg',
  png: { width: 1254, height: 1254, colorType: 'RGBA' },
  ico: { sizes, embeddedPngBytesMatch: true },
  checks,
}, null, 2) + '\n');
console.log(`Rendered rounded icon.png and ${sizes.join('/')}px RGBA icon.ico; all corners are transparent.`);
