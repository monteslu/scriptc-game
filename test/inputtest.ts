/* Automated input verification, using SDL's virtual joystick.
 *
 * The Phase 3 acceptance gate wants "two physical pads, hot-plug, rumble",
 * which no CI machine has. SDL can attach a SYNTHETIC controller that goes
 * through the identical code path -- device add event, slot assignment,
 * standard-mapping accessors, disconnect -- so the plumbing is verified
 * mechanically and hardware is only needed to confirm the mapping feels
 * right (test/padprobe.ts does that interactively).
 *
 * What this proves:
 *   - a pad appearing is seen, gets a slot, and reports connected
 *   - EVERY standard-mapping button reads back what was set, and only it
 *   - axes round-trip with the sign and range the Gamepad API promises
 *   - analog triggers surface as buttons with a value
 *   - a pad disappearing clears its state rather than stranding it held
 *
 * Exit code 0 only if every assertion passes.
 */
import * as ffi from "../runtime/ffi.js";
import { Input } from "../runtime/input/input.js";
import {
  BUTTON_COUNT, AXIS_COUNT,
  BTN_A, BTN_B, BTN_X, BTN_Y, BTN_L1, BTN_R1, BTN_L2, BTN_R2,
  BTN_SELECT, BTN_START, BTN_L3, BTN_R3,
  BTN_DPAD_UP, BTN_DPAD_DOWN, BTN_DPAD_LEFT, BTN_DPAD_RIGHT, BTN_GUIDE,
  AXIS_LEFT_X, AXIS_LEFT_Y, AXIS_RIGHT_X, AXIS_RIGHT_Y,
} from "../runtime/input/gamepad.js";

let failures = 0;
let checks = 0;

function check(ok: boolean, what: string): void {
  checks += 1;
  if (!ok) { console.log(`FAIL: ${what}`); failures += 1; }
}

function near(a: number, b: number, tol: number): boolean {
  const d = a - b;
  return (d < 0 ? -d : d) <= tol;
}

/* Standard-mapping index -> the SDL button index the virtual pad must be
 * told to press. This is the INVERSE of the mapping under test, written out
 * independently: deriving it from the same table would make the test agree
 * with the code by construction rather than by correctness. */
const STANDARD_TO_SDL_BUTTON: number[] = [
  0,   // A
  1,   // B
  2,   // X
  3,   // Y
  9,   // L1  = SDL LEFTSHOULDER
  10,  // R1  = SDL RIGHTSHOULDER
  -1,  // L2  analog, from an axis
  -1,  // R2  analog, from an axis
  4,   // select = SDL BACK
  6,   // start
  7,   // L3  = SDL LEFTSTICK
  8,   // R3  = SDL RIGHTSTICK
  11,  // dpad up
  12,  // dpad down
  13,  // dpad left
  14,  // dpad right
  5,   // guide
];

const BUTTON_NAMES: string[] = [
  "A", "B", "X", "Y", "L1", "R1", "L2", "R2",
  "select", "start", "L3", "R3",
  "dpadUp", "dpadDown", "dpadLeft", "dpadRight", "guide",
];

function main(): void {
  // A window is needed for SDL's event pump even though nothing is drawn.
  if (ffi.init(64, 64, 0) !== 0) { console.log("FATAL: sg_init failed"); process.exit(2); }
  if (ffi.inputInit() !== 0) { console.log("FATAL: input init failed"); process.exit(2); }

  const input = new Input();

  // Count pads present BEFORE attaching, so a real controller plugged into
  // the dev box does not make the virtual one land in slot 0.
  input.pump();
  const preexisting = input.connectedGamepads().length;
  console.log(`pads already connected: ${preexisting}`);

  /* 6 axes and 15 buttons is the shape SDL's default mapping expects of a
   * standard controller; fewer and the trigger axes would not exist. */
  const device = ffi.padAttachVirtual(6, 15);
  if (device < 0) { console.log("FATAL: could not attach a virtual pad"); process.exit(2); }

  // The add event arrives through the normal queue.
  input.pump();

  const pads = input.connectedGamepads();
  check(pads.length === preexisting + 1, `pad count went ${preexisting} -> ${pads.length}, want ${preexisting + 1}`);
  if (pads.length !== preexisting + 1) {
    console.log("cannot continue without the virtual pad");
    ffi.padDetachVirtual(device);
    process.exit(1);
  }

  const pad = pads[pads.length - 1];
  const slot = pad.index;
  console.log(`virtual pad in slot ${slot}, id="${pad.id}"`);
  check(pad.connected, "pad reports connected");
  check(pad.mapping === "standard", `mapping is "${pad.mapping}", want "standard"`);
  check(pad.buttons.length === BUTTON_COUNT, `${pad.buttons.length} buttons, want ${BUTTON_COUNT}`);
  check(pad.axes.length === AXIS_COUNT, `${pad.axes.length} axes, want ${AXIS_COUNT}`);

  /* ---- every digital button, one at a time ----
   * Pressing exactly one and checking the OTHERS are still up is what
   * catches an off-by-one in the mapping table: a shifted table still lights
   * up a button, just the wrong one. */
  for (let b = 0; b < BUTTON_COUNT; b++) {
    const sdl = STANDARD_TO_SDL_BUTTON[b];
    if (sdl < 0) continue;   // analog triggers, tested below

    ffi.padSetVirtualButton(slot, sdl, 1);
    ffi.padUpdate();
    input.pump();
    check(pad.buttons[b].pressed, `${BUTTON_NAMES[b]} pressed after setting SDL button ${sdl}`);
    check(pad.buttons[b].value === 1, `${BUTTON_NAMES[b]} value is 1 when pressed`);

    let othersUp = true;
    for (let o = 0; o < BUTTON_COUNT; o++) {
      if (o === b || STANDARD_TO_SDL_BUTTON[o] < 0) continue;
      if (pad.buttons[o].pressed) othersUp = false;
    }
    check(othersUp, `only ${BUTTON_NAMES[b]} is pressed (no mapping bleed)`);

    ffi.padSetVirtualButton(slot, sdl, 0);
    ffi.padUpdate();
    input.pump();
    check(!pad.buttons[b].pressed, `${BUTTON_NAMES[b]} released`);
  }

  /* ---- axes ----
   * Both extremes and centre. The Gamepad API promises the full -1..1 range,
   * which the shim's asymmetric Sint16 scaling exists to deliver. */
  const AXIS_SDL: number[] = [0, 1, 2, 3];
  const AXIS_STD: number[] = [AXIS_LEFT_X, AXIS_LEFT_Y, AXIS_RIGHT_X, AXIS_RIGHT_Y];
  const AXIS_NAMES: string[] = ["leftX", "leftY", "rightX", "rightY"];

  for (let a = 0; a < 4; a++) {
    ffi.padSetVirtualAxis(slot, AXIS_SDL[a], 1);
    ffi.padUpdate();
    input.pump();
    check(near(pad.axes[AXIS_STD[a]], 1, 0.001), `${AXIS_NAMES[a]} reaches +1 (got ${pad.axes[AXIS_STD[a]]})`);

    ffi.padSetVirtualAxis(slot, AXIS_SDL[a], -1);
    ffi.padUpdate();
    input.pump();
    check(near(pad.axes[AXIS_STD[a]], -1, 0.001), `${AXIS_NAMES[a]} reaches -1 (got ${pad.axes[AXIS_STD[a]]})`);

    ffi.padSetVirtualAxis(slot, AXIS_SDL[a], 0);
    ffi.padUpdate();
    input.pump();
    check(near(pad.axes[AXIS_STD[a]], 0, 0.001), `${AXIS_NAMES[a]} returns to 0 (got ${pad.axes[AXIS_STD[a]]})`);
  }

  /* ---- analog triggers as buttons ---- */
  const TRIGGERS: number[] = [4, 5];
  const TRIGGER_BTN: number[] = [BTN_L2, BTN_R2];
  const TRIGGER_NAMES: string[] = ["L2", "R2"];
  for (let t = 0; t < 2; t++) {
    ffi.padSetVirtualAxis(slot, TRIGGERS[t], 1);
    ffi.padUpdate();
    input.pump();
    const btn = pad.buttons[TRIGGER_BTN[t]];
    check(near(btn.value, 1, 0.001), `${TRIGGER_NAMES[t]} value reaches 1 (got ${btn.value})`);
    check(btn.pressed, `${TRIGGER_NAMES[t]} counts as pressed when fully pulled`);

    /* Released is -1, NOT 0, on the raw joystick axis: SDL's default virtual
     * controller mapping declares the triggers FULL RANGE, so it rescales
     * -32768..32767 onto the trigger's 0..32767. A raw 0 therefore means
     * half-pulled. A real pad reports its resting trigger correctly; this is
     * an artifact of how the synthetic device is wired, so the test speaks
     * the virtual device's language rather than pretending otherwise. */
    ffi.padSetVirtualAxis(slot, TRIGGERS[t], -1);
    ffi.padUpdate();
    input.pump();
    check(near(pad.buttons[TRIGGER_BTN[t]].value, 0, 0.001), `${TRIGGER_NAMES[t]} returns to 0`);
    check(!pad.buttons[TRIGGER_BTN[t]].pressed, `${TRIGGER_NAMES[t]} not pressed at rest`);
  }

  /* ---- held state must not survive a disconnect ---- */
  ffi.padSetVirtualButton(slot, 0, 1);
  ffi.padUpdate();
  input.pump();
  check(pad.buttons[BTN_A].pressed, "A held before unplug");

  ffi.padDetachVirtual(device);
  input.pump();
  check(!pad.connected, "pad reports disconnected after unplug");
  check(!pad.buttons[BTN_A].pressed, "held button cleared on unplug (no stuck input)");
  check(input.connectedGamepads().length === preexisting, "pad list back to its original length");

  ffi.inputQuit();
  ffi.quit();

  console.log(`\ninput test: ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
