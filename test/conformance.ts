/* Conformance harness (scriptc side).
 *
 * Renders every scene to an offscreen surface and writes it as a PNG. No
 * window is opened and no frame loop runs: the surface is created directly,
 * so this lane works under any SDL video driver and in CI.
 *
 * Usage: conformance <outDir>
 */
import * as ffi from "../host/ffi.js";
import * as sk from "../host/skia-ffi.js";
import { Context2D } from "../web/canvas/context.js";
import { decodeImage } from "../web/canvas/image.js";
import { readFileSync } from "node:fs";
import {
  SCENE_NAMES, SCENE_W, SCENE_H, TEST_FONT_PATHS, TEST_IMAGE_PATH, drawScene,
} from "./scenes.js";

function main(): void {
  const args = process.argv;
  const outDir = args.length > 2 ? args[2] : "test/out";

  /* Register the vendored test face BEFORE any scene runs. Text scenes name
   * it explicitly so neither side resolves through a system font manager. */
  for (let i = 0; i < TEST_FONT_PATHS.length; i++) {
    const frc = ffi.fontRegister(TEST_FONT_PATHS[i]);
    if (frc !== 0) {
      console.log(`FATAL: could not register ${TEST_FONT_PATHS[i]} (${frc})`);
      process.exit(2);
    }
  }

  // readFileSync gives a Buffer, which is exactly what a `bytes` FFI param
  // wants: the asset path never crosses the boundary, only its contents.
  const img = decodeImage(readFileSync(TEST_IMAGE_PATH));
  if (!img.valid) {
    console.log(`FATAL: could not decode ${TEST_IMAGE_PATH}`);
    process.exit(2);
  }

  let failures = 0;
  for (let i = 0; i < SCENE_NAMES.length; i++) {
    const name = SCENE_NAMES[i];

    const surface = ffi.surfaceCreate(SCENE_W, SCENE_H);
    if (surface === 0) {
      console.log(`FAIL ${name}: surface creation failed`);
      failures += 1;
      continue;
    }
    const canvas = sk.surfaceGetCanvas(surface);
    const ctx = new Context2D(canvas, surface);

    // Every scene starts from opaque white, matching the goldens: a
    // transparent backdrop would make antialiased edges compare against
    // undefined colour, and PNG alpha would hide real differences.
    ctx.clear("#ffffff");
    drawScene(name, ctx, img);

    const path = `${outDir}/${name}.png`;
    const rc = ffi.surfaceSavePng(surface, path);
    if (rc !== 0) {
      console.log(`FAIL ${name}: save_png returned ${rc}`);
      failures += 1;
    }
    ctx.dispose();
  }

  img.dispose();
  console.log(`rendered ${SCENE_NAMES.length - failures}/${SCENE_NAMES.length} scenes to ${outDir}`);
  console.log(
    `handles live: surface=${ffi.debugLive(0)} canvas=${ffi.debugLive(1)} ` +
      `paint=${ffi.debugLive(2)} path=${ffi.debugLive(3)} shader=${ffi.debugLive(4)} ` +
      `pathEffect=${ffi.debugLive(8)}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
