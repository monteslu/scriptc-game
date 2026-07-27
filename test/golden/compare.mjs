/* Compares rendered scenes against the goldens, PIXEL by pixel.
 *
 * Not a byte compare of the PNG files: two encoders can emit different chunk
 * layouts, filter choices, or zlib settings for identical pixels, and the
 * claim under test is "the same Skia produces the same picture", not "the
 * same PNG encoder settings". Both files are decoded and their RGBA buffers
 * compared.
 *
 * Exit code 0 only if every scene matches exactly.
 *
 * Usage: node compare.mjs <ourDir> <goldenDir>
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENE_NAMES, SCENE_W, SCENE_H } from "./scenes.mjs";

// This lives under test/golden/ because that is where @napi-rs/canvas is
// installed; Node resolves bare specifiers from the importing file's tree.
const here = dirname(fileURLToPath(import.meta.url));
const ourDir = process.argv[2] ?? join(here, "../out");
const goldenDir = process.argv[3] ?? join(here, "png");

/** Decodes a PNG to a flat RGBA Uint8ClampedArray. */
async function pixelsOf(path) {
  const img = await loadImage(path);
  const canvas = createCanvas(SCENE_W, SCENE_H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, SCENE_W, SCENE_H).data;
}

/** Worst-case and mean absolute channel difference between two buffers. */
function diffStats(a, b) {
  let maxDelta = 0;
  let sum = 0;
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    let pixelDelta = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      if (d > pixelDelta) pixelDelta = d;
      sum += d;
    }
    if (pixelDelta > 0) differing++;
    if (pixelDelta > maxDelta) maxDelta = pixelDelta;
  }
  return {
    maxDelta,
    meanDelta: sum / a.length,
    differing,
    total: a.length / 4,
  };
}

let pass = 0;
const failures = [];

for (const name of SCENE_NAMES) {
  const ourPath = join(ourDir, `${name}.png`);
  const goldenPath = join(goldenDir, `${name}.png`);
  if (!existsSync(ourPath)) {
    failures.push({ name, reason: "not rendered by the scriptc harness" });
    continue;
  }
  if (!existsSync(goldenPath)) {
    failures.push({ name, reason: "no golden" });
    continue;
  }
  const [ours, golden] = await Promise.all([pixelsOf(ourPath), pixelsOf(goldenPath)]);
  if (ours.length !== golden.length) {
    failures.push({ name, reason: `size mismatch: ${ours.length} vs ${golden.length}` });
    continue;
  }
  const st = diffStats(ours, golden);
  if (st.maxDelta === 0) {
    pass++;
  } else {
    failures.push({
      name,
      reason:
        `${st.differing}/${st.total} px differ ` +
        `(max channel delta ${st.maxDelta}, mean ${st.meanDelta.toFixed(4)})`,
    });
  }
}

console.log(`\nconformance: ${pass}/${SCENE_NAMES.length} scenes byte-identical to the goldens`);
if (failures.length > 0) {
  console.log("\nfailures:");
  for (const f of failures) console.log(`  ${f.name}: ${f.reason}`);
  console.log(
    "\nSame Skia, same version: any difference is a real bug in the runtime,\n" +
      "the shim, or a scene that is not actually deterministic. Investigate,\n" +
      "do not raise a tolerance.",
  );
}
process.exit(failures.length === 0 ? 0 : 1);
