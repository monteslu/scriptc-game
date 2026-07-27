/* Generates the conformance test image deterministically.
 *
 * Committed as a GENERATOR rather than a PNG so the asset is reviewable and
 * regenerable: a checked-in binary would be opaque in diffs, and the point
 * of the image is its exact pixel content (sharp color blocks, an alpha
 * gradient, and 1px detail that makes smoothing and scaling differences
 * visible).
 *
 * Run: node test/assets/make-test-image.mjs   (from the repo root)
 */
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 64, H = 64;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

// Four solid quadrants: exact colors, no antialiasing anywhere.
ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, 32, 32);
ctx.fillStyle = "#00ff00"; ctx.fillRect(32, 0, 32, 32);
ctx.fillStyle = "#0000ff"; ctx.fillRect(0, 32, 32, 32);
ctx.fillStyle = "#ffff00"; ctx.fillRect(32, 32, 32, 32);

// A 1px checkerboard border: scaling and smoothing differences show here
// long before they show in the flat areas.
const img = ctx.getImageData(0, 0, W, H);
for (let i = 0; i < W; i++) {
  const on = i % 2 === 0;
  for (const [x, y] of [[i, 0], [i, H - 1], [0, i], [W - 1, i]]) {
    const o = (y * W + x) * 4;
    img.data[o] = on ? 0 : 255;
    img.data[o + 1] = on ? 0 : 255;
    img.data[o + 2] = on ? 0 : 255;
    img.data[o + 3] = 255;
  }
}
// A half-transparent block, so alpha compositing of images is covered.
for (let y = 20; y < 44; y++) {
  for (let x = 20; x < 44; x++) {
    const o = (y * W + x) * 4;
    img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255;
    img.data[o + 3] = 128;
  }
}
ctx.putImageData(img, 0, 0);

const out = join(dirname(fileURLToPath(import.meta.url)), "test-image.png");
writeFileSync(out, canvas.toBuffer("image/png"));
console.log(`wrote ${out} (${W}x${H})`);
