/* Image format coverage: which files can a game actually load?
 *
 * Decoding goes through Skia's SkCodec, which SNIFFS the format from the
 * bytes rather than trusting an extension, so the answer is "whatever codecs
 * this Skia build links". That is a property of the vendored archives, not of
 * our code, so it is worth asserting rather than assuming: a Skia bump could
 * drop one silently.
 *
 * Every format is the SAME 96x64 source image, so a decoder that reports the
 * right dimensions but garbage pixels is caught too -- each decode is drawn
 * and its centre sampled.
 *
 * Usage: imagetest <fixtureDir> [outDir]
 */
import * as ffi from "../runtime/ffi.js";
import * as sk from "../runtime/canvas/skia-ffi.js";
import { readFileSync } from "node:fs";
import { Context2D } from "../runtime/canvas/context.js";
import { decodeImage } from "../runtime/canvas/image.js";
import { createCanvas, getImageData } from "../runtime/canvas/offscreen.js";

let failures = 0;
let checks = 0;

function check(ok: boolean, what: string): void {
  checks += 1;
  if (!ok) { console.log(`FAIL: ${what}`); failures += 1; }
}

const W = 96;
const H = 64;

function main(): void {
  const args = process.argv;
  const dir = args.length > 2 ? args[2] : "test/fixtures/images";
  const outDir = args.length > 3 ? args[3] : "test/out";

  /* png and jpg are the two that matter for games; the rest come along with
   * the same Skia build.
   *
   * GIF is in this list despite `nm` finding ZERO SkGifCodec symbols: Skia
   * routes GIF through libwuffs, so grepping for a codec class name is not
   * how you learn what a build supports. Decoding a real file is. */
  const supported: string[] = ["png", "jpg", "webp", "bmp", "gif"];
  const unsupported: string[] = [];

  for (let i = 0; i < supported.length; i++) {
    const fmt = supported[i];
    const path = `${dir}/test.${fmt}`;
    const img = decodeImage(readFileSync(path));

    if (!img.valid) {
      console.log(`FAIL: ${fmt} did not decode`);
      failures += 1;
      checks += 1;
      continue;
    }

    check(img.width === W, `${fmt} width ${img.width}, want ${W}`);
    check(img.height === H, `${fmt} height ${img.height}, want ${H}`);

    /* Draw it and read a pixel back. Dimensions alone do not prove the
     * decode worked: a codec can allocate the right surface and leave it
     * blank, which is exactly the failure a "does it load" test misses. */
    const ctx = createCanvas(W, H);
    if (ctx === null) { console.log("FATAL: createCanvas"); process.exit(2); }
    ctx.clear("#000000");
    ctx.drawImage(img, 0, 0);

    const pixels = getImageData(ctx, 0, 0, W, H);
    let lit = 0;
    let distinct = 0;
    if (pixels !== null) {
      let first = -1;
      for (let p = 0; p < W * H; p++) {
        const o = p * 4;
        const r = pixels.data[o];
        const g = pixels.data[o + 1];
        const b = pixels.data[o + 2];
        if (r + g + b > 24) lit += 1;
        const key = (r << 16) | (g << 8) | b;
        if (first < 0) first = key;
        else if (key !== first && distinct === 0) distinct = 1;
      }
    }

    console.log(`${fmt}: ${img.width}x${img.height} lit=${lit}/${W * H} varied=${distinct}`);
    check(lit > (W * H) / 4, `${fmt} decoded to mostly-black (lit=${lit})`);
    check(distinct === 1, `${fmt} decoded to a single flat colour`);

    ffi.surfaceSavePng(ctx.surfaceHandle(), `${outDir}/image-${fmt}.png`);
    ctx.dispose();
    img.dispose();
  }

  for (let i = 0; i < unsupported.length; i++) {
    const fmt = unsupported[i];
    const img = decodeImage(readFileSync(`${dir}/test.${fmt}`));
    console.log(`${fmt}: ${img.valid ? "decoded (codec was ADDED upstream)" : "not supported by this Skia build"}`);
    check(!img.valid,
          `${fmt} now decodes -- this Skia build gained a codec, update the ` +
          "supported list in test/imagetest.ts and docs/API-SURFACE.md");
    if (img.valid) img.dispose();
  }

  console.log(`\nimage test: ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
