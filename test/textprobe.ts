/* Text smoke probe: does the 26-parameter skiac text entry point work at
 * all through the shim's state-block design? Run before writing text
 * conformance scenes, so a failure here points at the plumbing rather than
 * at a font-resolution difference.
 */
import * as ffi from "../runtime/ffi.js";
import * as sk from "../runtime/canvas/skia-ffi.js";
import { Context2D } from "../runtime/canvas/context.js";

function main(): void {
  const args = process.argv;
  const out = args.length > 2 ? args[2] : "test/out/textprobe.png";
  const fontPath = args.length > 3 ? args[3] : "test/assets/DejaVuSans.ttf";

  const rc = ffi.fontRegister(fontPath);
  console.log(`fontRegister -> ${rc}`);

  const surface = ffi.surfaceCreate(300, 120);
  if (surface === 0) { console.log("surface failed"); process.exit(1); }
  const ctx = new Context2D(sk.surfaceGetCanvas(surface), surface);
  ctx.clear("#ffffff");

  ctx.fillStyle = "#000000";
  ctx.font = "24px DejaVu Sans";
  ctx.fillText("Hello 123", 20, 40);

  const m = ctx.measureText("Hello 123");
  console.log(`measure: width=${m.width} ascent=${m.actualBoundingBoxAscent} descent=${m.actualBoundingBoxDescent}`);

  ctx.fillStyle = "#cc2200";
  ctx.font = "bold 18px DejaVu Sans";
  ctx.fillText("Bold text", 20, 80);

  ctx.strokeStyle = "#0044cc";
  ctx.lineWidth = 1;
  ctx.font = "20px DejaVu Sans";
  ctx.strokeText("Stroked", 160, 80);

  const src = ffi.surfaceSavePng(surface, out);
  console.log(`saved ${out} -> ${src}`);
  ctx.dispose();
  process.exit(0);
}

main();
