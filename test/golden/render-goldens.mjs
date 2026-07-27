/* Renders the golden PNGs with Node + @napi-rs/canvas.
 *
 * The version is pinned to the CANVAS_VERSION build-libcanvas built our Skia
 * archives from, so both sides are the same Skia and output is expected
 * byte-identical. A version mismatch here invalidates the whole comparison,
 * so it is checked rather than assumed.
 *
 * Usage: node render-goldens.mjs [outDir]
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENE_NAMES, SCENE_W, SCENE_H, drawScene } from "./scenes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const outDir = process.argv[2] ?? join(here, "png");

// The pin that makes "byte-identical" a meaningful claim.
const expected = readFileSync(join(root, "vendor/linux-x86_64/CANVAS_VERSION"), "utf8").trim();
const actual = JSON.parse(
  readFileSync(join(here, "node_modules/@napi-rs/canvas/package.json"), "utf8"),
).version;
if (expected !== actual) {
  console.error(
    `CANVAS_VERSION mismatch: archives were built from ${expected}, ` +
      `but @napi-rs/canvas here is ${actual}.\n` +
      `Byte-identical comparison is only meaningful at the same version.\n` +
      `Fix: npm i @napi-rs/canvas@${expected} in test/golden/`,
  );
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

for (const name of SCENE_NAMES) {
  const canvas = createCanvas(SCENE_W, SCENE_H);
  const ctx = canvas.getContext("2d");
  // Same opaque-white backdrop as the scriptc side.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  drawScene(name, ctx);
  writeFileSync(join(outDir, `${name}.png`), canvas.toBuffer("image/png"));
}

console.log(`rendered ${SCENE_NAMES.length} goldens (canvas ${actual}) to ${outDir}`);
