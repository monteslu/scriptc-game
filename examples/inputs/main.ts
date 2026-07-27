/* Live input display: keyboard, mouse, and every connected gamepad.
 *
 * This is the interactive half of the Phase 3 gate. The automated half
 * (test/inputtest.ts) proves the plumbing with a synthetic pad; this one is
 * for putting hands on real hardware and seeing that the mapping is right,
 * hot-plug works, and rumble fires.
 *
 * Keys:  T toggles text input   R rumbles pad 0   ESC quits
 */
import { Game, GameOptions } from "../../engine/loop.js";
import { Context2D } from "../../web/canvas/context.js";
import * as ffi from "../../host/ffi.js";
import {
  BUTTON_COUNT, AXIS_COUNT, GamepadEffectParameters,
} from "../../web/input/gamepad.js";
import { MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT } from "../../host/input-events.js";

const W = 900;
const H = 620;
const FONT = "DejaVu Sans";

/* Number.toString(radix) needs the embedded dynamic engine (SC2012), which
 * static builds never include, so hex is done by hand. */
const HEX_DIGITS = "0123456789abcdef";
function hex(v: number): string {
  if (v === 0) return "0x0";
  let n = v < 0 ? -v : v;
  let s = "";
  while (n > 0) {
    const d = n % 16;
    s = HEX_DIGITS.charAt(d) + s;
    n = (n - d) / 16;
  }
  return (v < 0 ? "-0x" : "0x") + s;
}

const BUTTON_NAMES: string[] = [
  "A", "B", "X", "Y", "L1", "R1", "L2", "R2",
  "back", "start", "L3", "R3", "up", "down", "left", "right", "guide",
];
const AXIS_NAMES: string[] = ["LX", "LY", "RX", "RY"];

class InputDemo extends Game {
  typed = "";
  textOn = false;

  update(_dtMs: number): void {
    if (this.input.isDown("Escape")) { this.stop(); return; }

    if (this.input.wasPressed("KeyT")) {
      this.textOn = !this.textOn;
      this.input.textInput(this.textOn);
      if (!this.textOn) this.typed = "";
    }
    if (this.input.wasPressed("KeyR")) {
      const pad = this.input.gamepad(0);
      if (pad !== null && pad.connected) {
        const fx = new GamepadEffectParameters();
        fx.duration = 300;
        fx.weakMagnitude = 0.6;
        fx.strongMagnitude = 0.9;
        pad.vibrationActuator.playEffect("dual-rumble", fx);
      }
    }

    // Text arrives as a per-frame queue, since it is a sequence not a state.
    const events = this.input.textEvents();
    for (let i = 0; i < events.length; i++) this.typed += events[i];
    if (this.input.wasPressed("Backspace") && this.typed.length > 0) {
      this.typed = this.typed.substring(0, this.typed.length - 1);
    }
    if (this.typed.length > 48) this.typed = this.typed.substring(this.typed.length - 48);
  }

  draw(ctx: Context2D, _alpha: number): void {
    ctx.clear("#12161c");
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#7fd1ff";
    ctx.font = `18px ${FONT}`;
    ctx.fillText("input: keyboard / mouse / gamepads", 16, 28);
    ctx.fillStyle = "#5b6672";
    ctx.font = `12px ${FONT}`;
    ctx.fillText("T text input    R rumble pad 0    ESC quit", 16, 48);

    this.drawKeyboard(ctx, 16, 84);
    this.drawMouse(ctx, 16, 200);
    this.drawPads(ctx, 16, 300);
  }

  private drawKeyboard(ctx: Context2D, x: number, y: number): void {
    ctx.fillStyle = "#e8eef4";
    ctx.font = `14px ${FONT}`;
    ctx.fillText("keyboard", x, y);

    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = "#9fb3c8";
    const held = this.input.heldKeys();
    let line = "held: ";
    for (let i = 0; i < held.length; i++) {
      line += held[i];
      if (i < held.length - 1) line += " ";
    }
    if (held.length === 0) line += "(none)";
    ctx.fillText(line, x, y + 20);
    ctx.fillText(`mods: ${hex(this.input.mods)}   focused: ${this.input.focused}`, x, y + 38);

    ctx.fillStyle = this.textOn ? "#8ee27a" : "#5b6672";
    ctx.fillText(`text input ${this.textOn ? "ON" : "off"}: ${this.typed}`, x, y + 60);
    if (this.textOn) {
      // A caret, so an empty buffer still looks alive.
      const m = ctx.measureText(`text input ON: ${this.typed}`);
      ctx.fillRect(x + m.width + 2, y + 50, 8, 2);
    }
  }

  private drawMouse(ctx: Context2D, x: number, y: number): void {
    ctx.fillStyle = "#e8eef4";
    ctx.font = `14px ${FONT}`;
    ctx.fillText("mouse", x, y);

    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = "#9fb3c8";
    ctx.fillText(`pos ${this.input.mouseX}, ${this.input.mouseY}`, x, y + 20);
    ctx.fillText(`wheel ${this.input.wheelX}, ${this.input.wheelY}`, x + 140, y + 20);

    const names: string[] = ["L", "M", "R"];
    const codes: number[] = [MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT];
    for (let i = 0; i < 3; i++) {
      const on = this.input.mouseIsDown(codes[i]);
      ctx.fillStyle = on ? "#8ee27a" : "#2a3441";
      ctx.fillRect(x + i * 34, y + 32, 28, 22);
      ctx.fillStyle = on ? "#12161c" : "#7c8b9a";
      ctx.fillText(names[i], x + i * 34 + 10, y + 48);
    }
  }

  private drawPads(ctx: Context2D, x: number, y: number): void {
    ctx.fillStyle = "#e8eef4";
    ctx.font = `14px ${FONT}`;
    const pads = this.input.connectedGamepads();
    ctx.fillText(`gamepads (${pads.length} connected)`, x, y);

    if (pads.length === 0) {
      ctx.fillStyle = "#5b6672";
      ctx.font = `12px ${FONT}`;
      ctx.fillText("plug one in; hot-plug is picked up on the next frame", x, y + 22);
      return;
    }

    for (let p = 0; p < pads.length && p < 2; p++) {
      this.drawPad(ctx, x + p * 440, y + 20, p);
    }
  }

  private drawPad(ctx: Context2D, x: number, y: number, listIndex: number): void {
    const pads = this.input.connectedGamepads();
    const pad = pads[listIndex];

    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = "#7fd1ff";
    ctx.fillText(`slot ${pad.index}: ${pad.id}`, x, y + 14);
    ctx.fillStyle = "#5b6672";
    ctx.fillText(pad.hasRumble ? "rumble: yes" : "rumble: no", x, y + 30);

    // Buttons as a lit grid; value drives brightness so analog triggers read.
    for (let b = 0; b < BUTTON_COUNT; b++) {
      const col = b % 6;
      const row = (b - col) / 6;
      const bx = x + col * 66;
      const by = y + 44 + row * 40;
      const btn = pad.buttons[b];

      ctx.fillStyle = btn.pressed ? "#8ee27a" : "#2a3441";
      ctx.fillRect(bx, by, 60, 22);
      // Analog fill: a partly-pulled trigger shows a partial bar.
      if (!btn.pressed && btn.value > 0) {
        ctx.fillStyle = "#4a7a3f";
        ctx.fillRect(bx, by, 60 * btn.value, 22);
      }
      ctx.fillStyle = btn.pressed ? "#12161c" : "#7c8b9a";
      ctx.fillText(BUTTON_NAMES[b], bx + 6, by + 15);
    }

    // Axes as centred bars.
    for (let a = 0; a < AXIS_COUNT; a++) {
      const ax = x;
      const ay = y + 176 + a * 26;
      ctx.fillStyle = "#7c8b9a";
      ctx.fillText(AXIS_NAMES[a], ax, ay + 12);

      const trackX = ax + 28;
      const trackW = 200;
      ctx.fillStyle = "#2a3441";
      ctx.fillRect(trackX, ay, trackW, 14);

      const v = pad.axes[a];
      const mid = trackX + trackW / 2;
      ctx.fillStyle = "#7fd1ff";
      const half = (trackW / 2) * (v < 0 ? -v : v);
      if (v < 0) ctx.fillRect(mid - half, ay, half, 14);
      else ctx.fillRect(mid, ay, half, 14);

      ctx.fillStyle = "#5b6672";
      ctx.fillRect(mid - 1, ay - 2, 2, 18);
      ctx.fillStyle = "#9fb3c8";
      ctx.fillText(v.toFixed(3), trackX + trackW + 8, ay + 12);
    }
  }
}

function main(): void {
  // Text scenes need a real face; the demo shares the test asset.
  ffi.fontRegister("test/assets/DejaVuSans.ttf");

  const game = new InputDemo();
  const opts = new GameOptions();
  opts.width = W;
  opts.height = H;
  const framesEnv = process.env["SG_MAX_FRAMES"];
  if (framesEnv !== undefined) opts.maxFrames = parseInt(framesEnv, 10);
  const shotEnv = process.env["SG_SHOT"];
  if (shotEnv !== undefined) opts.shotPath = shotEnv;
  const shotFrameEnv = process.env["SG_SHOT_FRAME"];
  if (shotFrameEnv !== undefined) opts.shotFrame = parseInt(shotFrameEnv, 10);

  const rc = game.run(opts);
  process.exit(rc);
}

main();
