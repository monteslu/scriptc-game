/* Sprite-sheet framing: does drawImageRect pick the right cell?
 *
 * The dodge coin is a 64x16 strip of four 16px frames. A game animates it by
 * moving the SOURCE rect, and getting that wrong shows up as an animation
 * that never changes or that samples across two cells. Both look plausible in
 * a still, so this draws every frame and measures them.
 *
 * The coin spin goes full -> half -> edge-on -> half, so the widths must
 * DIFFER and frame 2 must be the narrowest. That is a property no
 * "did it load" check would catch.
 *
 * Usage: spritetest [outDir]
 */
import * as ffi from "../host/ffi.js";
import { readFileSync } from "node:fs";
import { imageFromBytes } from "../web/canvas/image.js";
import { createCanvas, getImageData } from "../web/canvas/offscreen.js";

let failures = 0;
let checks = 0;

function check(ok: boolean, what: string): void {
  checks += 1;
  if (!ok) { console.log(`FAIL: ${what}`); failures += 1; }
}

const CELL = 16;
const FRAMES = 4;
const SCALE = 4;   // drawn big so the measurement is not antialiasing noise

function main(): void {
  const args = process.argv;
  const outDir = args.length > 2 ? args[2] : "test/out";

  const strip = imageFromBytes(readFileSync("examples/dodge/public/coin.png"));
  if (!strip.complete) { console.log("FATAL: coin.png did not decode"); process.exit(2); }
  check(strip.width === CELL * FRAMES, `strip is ${strip.width}px, want ${CELL * FRAMES}`);
  check(strip.height === CELL, `strip is ${strip.height}px tall, want ${CELL}`);

  const w = CELL * SCALE * FRAMES;
  const h = CELL * SCALE;
  const ctx = createCanvas(w, h);
  if (ctx === null) { console.log("FATAL: createCanvas"); process.exit(2); }
  ctx.__clearToColor("#101010");

  for (let f = 0; f < FRAMES; f++) {
    ctx.drawImage(strip, f * CELL, 0, CELL, CELL,
                      f * CELL * SCALE, 0, CELL * SCALE, CELL * SCALE);
  }

  const px = getImageData(ctx, 0, 0, w, h);
  if (px === null) { console.log("FATAL: readback"); process.exit(2); }

  // Measure each frame's lit width at its vertical centre.
  const widths: number[] = [];
  const midY = (CELL * SCALE) / 2;
  for (let f = 0; f < FRAMES; f++) {
    let lo = -1;
    let hi = -1;
    for (let x = f * CELL * SCALE; x < (f + 1) * CELL * SCALE; x++) {
      const o = (midY * w + x) * 4;
      const r = px.data[o];
      const g = px.data[o + 1];
      const b = px.data[o + 2];
      if (r > 140 && g > 110 && b < 150) {
        if (lo < 0) lo = x;
        hi = x;
      }
    }
    widths.push(lo < 0 ? 0 : hi - lo + 1);
  }

  console.log(`coin frame widths: ${widths[0]} ${widths[1]} ${widths[2]} ${widths[3]}`);
  ffi.surfaceSavePng(ctx.surfaceHandle(), `${outDir}/sprite-frames.png`);

  for (let f = 0; f < FRAMES; f++) {
    check(widths[f] > 0, `frame ${f} drew nothing (source rect is off the sheet?)`);
  }
  // The spin: frame 0 widest, frame 2 narrowest, 1 and 3 in between.
  check(widths[0] > widths[1], "frame 0 is wider than frame 1");
  check(widths[1] > widths[2], "frame 1 is wider than frame 2 (edge-on)");
  check(widths[3] > widths[2], "frame 3 is wider than frame 2");
  // If the source rect were ignored, every frame would be identical.
  check(!(widths[0] === widths[1] && widths[1] === widths[2]),
        "frames differ (a constant width means the source rect is ignored)");

  ctx.dispose();
  strip.dispose();
  console.log(`\nsprite test: ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
