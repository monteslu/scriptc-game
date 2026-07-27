/* Visual proof that pad state reaches the SCREEN, not just the accessors.
 *
 * test/inputtest.ts asserts the numbers; this renders them. A display that
 * draws a correct-looking but static layout passes every numeric check while
 * showing nothing, so the buttons are lit through a synthetic pad and the
 * frame is saved for inspection.
 *
 * Usage: padvisual <out.png>
 */
import * as ffi from "../host/ffi.js";
import * as sk from "../host/skia-ffi.js";
import { Context2D } from "../web/canvas/context.js";
import { Input } from "../web/input/input.js";
import { BUTTON_COUNT, AXIS_COUNT } from "../web/input/gamepad.js";

const W = 460;
const H = 300;
const FONT = "DejaVu Sans";

const BUTTON_NAMES: string[] = [
  "A", "B", "X", "Y", "L1", "R1", "L2", "R2",
  "back", "start", "L3", "R3", "up", "down", "left", "right", "guide",
];
const AXIS_NAMES: string[] = ["LX", "LY", "RX", "RY"];

function main(): void {
  const args = process.argv;
  const out = args.length > 2 ? args[2] : "test/out/padvisual.png";

  if (ffi.init(64, 64, 0) !== 0) { console.log("FATAL: sg_init"); process.exit(2); }
  if (ffi.inputInit() !== 0) { console.log("FATAL: input init"); process.exit(2); }
  ffi.fontRegister("test/assets/DejaVuSans.ttf");

  const input = new Input();
  input.pump();
  const preexisting = input.connectedGamepads().length;

  const device = ffi.padAttachVirtual(6, 15);
  if (device < 0) { console.log("FATAL: attach virtual pad"); process.exit(2); }
  input.pump();

  const pads = input.connectedGamepads();
  if (pads.length !== preexisting + 1) { console.log("FATAL: pad did not appear"); process.exit(1); }
  const pad = pads[pads.length - 1];
  const slot = pad.index;

  /* A recognisable pose: A and dpad-right held, left stick pushed to a
   * diagonal, right trigger half-pulled. Every one of those is a different
   * code path (digital, dpad, analog axis, analog trigger). */
  ffi.padSetVirtualButton(slot, 0, 1);    // SDL A
  ffi.padSetVirtualButton(slot, 14, 1);   // SDL DPAD_RIGHT
  ffi.padSetVirtualAxis(slot, 0, 0.8);    // left X
  ffi.padSetVirtualAxis(slot, 1, -0.5);   // left Y
  ffi.padSetVirtualAxis(slot, 5, 0);      // right trigger, mid (see inputtest)
  ffi.padUpdate();
  input.pump();

  const surface = ffi.surfaceCreate(W, H);
  const ctx = new Context2D(sk.surfaceGetCanvas(surface), surface);
  ctx.clear("#12161c");
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#7fd1ff";
  ctx.font = `13px ${FONT}`;
  ctx.fillText(`slot ${pad.index}: ${pad.id}`, 12, 22);

  ctx.font = `11px ${FONT}`;
  for (let b = 0; b < BUTTON_COUNT; b++) {
    const col = b % 6;
    const row = (b - col) / 6;
    const bx = 12 + col * 72;
    const by = 36 + row * 32;
    const btn = pad.buttons[b];
    ctx.fillStyle = btn.pressed ? "#8ee27a" : "#2a3441";
    ctx.fillRect(bx, by, 66, 22);
    if (!btn.pressed && btn.value > 0) {
      ctx.fillStyle = "#4a7a3f";
      ctx.fillRect(bx, by, 66 * btn.value, 22);
    }
    ctx.fillStyle = btn.pressed ? "#12161c" : "#7c8b9a";
    ctx.fillText(BUTTON_NAMES[b], bx + 6, by + 15);
  }

  for (let a = 0; a < AXIS_COUNT; a++) {
    const ay = 148 + a * 26;
    ctx.fillStyle = "#7c8b9a";
    ctx.fillText(AXIS_NAMES[a], 12, ay + 12);
    const trackX = 40;
    const trackW = 220;
    ctx.fillStyle = "#2a3441";
    ctx.fillRect(trackX, ay, trackW, 14);
    const v = pad.axes[a];
    const mid = trackX + trackW / 2;
    const half = (trackW / 2) * (v < 0 ? -v : v);
    ctx.fillStyle = "#7fd1ff";
    if (v < 0) ctx.fillRect(mid - half, ay, half, 14);
    else ctx.fillRect(mid, ay, half, 14);
    ctx.fillStyle = "#5b6672";
    ctx.fillRect(mid - 1, ay - 2, 2, 18);
    ctx.fillStyle = "#9fb3c8";
    ctx.fillText(v.toFixed(3), trackX + trackW + 8, ay + 12);
  }

  const rc = ffi.surfaceSavePng(surface, out);
  console.log(`A=${pad.buttons[0].pressed} dpadRight=${pad.buttons[15].pressed} ` +
              `LX=${pad.axes[0].toFixed(3)} LY=${pad.axes[1].toFixed(3)} ` +
              `R2=${pad.buttons[7].value.toFixed(3)}`);
  console.log(`saved ${out} -> ${rc}`);

  ctx.dispose();
  ffi.padDetachVirtual(device);
  ffi.inputQuit();
  ffi.quit();
  process.exit(rc === 0 ? 0 : 1);
}

main();
