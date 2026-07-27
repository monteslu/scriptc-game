/* Readback probe: getImageData is the one API where the web shape demands
 * bulk data OUT, which FFI format 1 cannot express. It is implemented as one
 * native rect read plus a per-pixel scalar getter.
 *
 * This checks the values are actually right, which a conformance scene
 * cannot: a golden comparison only sees what was DRAWN, not what was read
 * back. Draws known flat colours, reads them, and asserts.
 */
import { createCanvas, getImageData } from "../web/canvas/offscreen.js";

function main(): void {
  const ctx = createCanvas(32, 32);
  if (ctx === null) { console.log("FAIL: createCanvas"); process.exit(1); }

  ctx.clear("#ffffff");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = "#0000ff";
  ctx.fillRect(16, 16, 16, 16);

  const id = getImageData(ctx, 0, 0, 32, 32);
  if (id === null) { console.log("FAIL: getImageData returned null"); process.exit(1); }

  let failures = 0;
  // (4, 4) is inside the red block; (20, 20) inside the blue; (20, 4) white.
  const checks = [
    [4, 4, 255, 0, 0],
    [20, 20, 0, 0, 255],
    [20, 4, 255, 255, 255],
  ];
  for (let i = 0; i < checks.length; i++) {
    const x = checks[i][0];
    const y = checks[i][1];
    const o = (y * 32 + x) * 4;
    const r = id.data[o];
    const g = id.data[o + 1];
    const b = id.data[o + 2];
    const a = id.data[o + 3];
    const okR = r === checks[i][2];
    const okG = g === checks[i][3];
    const okB = b === checks[i][4];
    if (!okR || !okG || !okB || a !== 255) {
      console.log(`FAIL (${x},${y}): got ${r},${g},${b},${a} want ${checks[i][2]},${checks[i][3]},${checks[i][4]},255`);
      failures += 1;
    }
  }

  if (id.data.length !== 32 * 32 * 4) {
    console.log(`FAIL: buffer length ${id.data.length}, want ${32 * 32 * 4}`);
    failures += 1;
  }

  ctx.dispose();
  console.log(failures === 0 ? "readback OK: all sampled pixels match" : `readback FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
