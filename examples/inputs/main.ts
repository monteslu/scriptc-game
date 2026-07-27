/* Live input display: keyboard, mouse, and every connected gamepad.
 *
 * The interactive half of the input gate: the automated half
 * (test/inputtest.ts) proves the plumbing with a synthetic pad, this one is
 * for putting hands on real hardware and seeing the mapping is right,
 * hot-plug works, and rumble fires.
 *
 * Browser code: keydown/keyup/mousemove listeners and navigator.getGamepads().
 *
 * Keys:  R rumbles pad 0   ESC quits
 */
import {
  window, document, navigator, requestAnimationFrame,
  KeyboardEvent, MouseEvent, FontFace,
} from "../../web/globals.js";

const FONT = "DejaVu Sans";

/* The Standard Gamepad has 17 buttons and 4 axes, by index -- the spec names
 * no constants, so the counts live here with the labels they go with. */
const BUTTON_COUNT = 17;
const AXIS_COUNT = 4;

const BUTTON_NAMES: string[] = [
  "A", "B", "X", "Y", "L1", "R1", "L2", "R2",
  "back", "start", "L3", "R3", "up", "down", "left", "right", "guide",
];
const AXIS_NAMES: string[] = ["LX", "LY", "RX", "RY"];

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  new FontFace(FONT, "url(DejaVuSans.ttf)").load().then((face) => {
    document.fonts.add(face);
  });

  const held = new Map<string, boolean>();
  const tapped = new Map<string, boolean>();
  let typed = "";

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (held.get(e.code) === undefined) heldOrder.push(e.code);
    held.set(e.code, true);
    tapped.set(e.code, true);
    // A tiny text field, to show `code` names arriving in order.
    if (e.code === "Backspace") {
      if (typed.length > 0) typed = typed.substring(0, typed.length - 1);
    } else if (e.code.startsWith("Key")) {
      typed += e.code.substring(3);
    } else if (e.code === "Space") {
      typed += " ";
    }
    if (typed.length > 40) typed = typed.substring(typed.length - 40);
  });
  window.addEventListener("keyup", (e: KeyboardEvent) => { held.set(e.code, false); });

  let mouseX = 0;
  let mouseY = 0;
  const mouseButtons = new Map<number, boolean>();
  window.addEventListener("mousemove", (e: MouseEvent) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener("mousedown", (e: MouseEvent) => { mouseButtons.set(e.button, true); });
  window.addEventListener("mouseup", (e: MouseEvent) => { mouseButtons.set(e.button, false); });

  /* Map iteration is fenced in the static tier (SC2004), so the set of
   * currently-held keys is maintained as an array on the events themselves
   * -- which is what a browser game does anyway, since the platform has no
   * "list the held keys" query. */
  const heldOrder: string[] = [];

  function heldKeys(): string[] {
    const out: string[] = [];
    for (let i = 0; i < heldOrder.length; i++) {
      if (held.get(heldOrder[i]) === true) out.push(heldOrder[i]);
    }
    return out;
  }

  function frame(time: number): void {
    if (tapped.get("KeyR") === true) {
      const pads = navigator.getGamepads();
      const p = pads.length > 0 ? pads[0] : null;
      if (p !== null && p.connected) {
        p.vibrationActuator.playEffect("dual-rumble", {
          duration: 300,
          weakMagnitude: 0.6,
          strongMagnitude: 0.9,
        });
      }
    }

    ctx.clear("#12161c");
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#7fd1ff";
    ctx.font = `18px ${FONT}`;
    ctx.fillText("input: keyboard / mouse / gamepads", 16, 28);
    ctx.fillStyle = "#5b6672";
    ctx.font = `12px ${FONT}`;
    ctx.fillText("R rumble pad 0    ESC quit", 16, 48);

    drawKeyboard(16, 84);
    drawMouse(16, 200);
    drawPads(16, 300);

    tapped.clear();
    requestAnimationFrame(frame);
  }

  function drawKeyboard(x: number, y: number): void {
    ctx.fillStyle = "#e8eef4";
    ctx.font = `14px ${FONT}`;
    ctx.fillText("keyboard", x, y);

    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = "#9fb3c8";
    const keys = heldKeys();
    let line = "held: ";
    for (let i = 0; i < keys.length; i++) {
      line += keys[i];
      if (i < keys.length - 1) line += " ";
    }
    if (keys.length === 0) line += "(none)";
    ctx.fillText(line, x, y + 20);
    ctx.fillStyle = "#8ee27a";
    ctx.fillText(`typed: ${typed}`, x, y + 40);
  }

  function drawMouse(x: number, y: number): void {
    ctx.fillStyle = "#e8eef4";
    ctx.font = `14px ${FONT}`;
    ctx.fillText("mouse", x, y);

    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = "#9fb3c8";
    ctx.fillText(`pos ${mouseX}, ${mouseY}`, x, y + 20);

    // Web button numbering: 0 left, 1 middle, 2 right.
    const names: string[] = ["L", "M", "R"];
    for (let i = 0; i < 3; i++) {
      const on = mouseButtons.get(i) === true;
      ctx.fillStyle = on ? "#8ee27a" : "#2a3441";
      ctx.fillRect(x + i * 34, y + 32, 28, 22);
      ctx.fillStyle = on ? "#12161c" : "#7c8b9a";
      ctx.fillText(names[i], x + i * 34 + 10, y + 48);
    }
  }

  function drawPads(x: number, y: number): void {
    ctx.fillStyle = "#e8eef4";
    ctx.font = `14px ${FONT}`;

    const pads = navigator.getGamepads();
    let count = 0;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] !== null) count += 1;
    }
    ctx.fillText(`gamepads (${count} connected)`, x, y);

    if (count === 0) {
      ctx.fillStyle = "#5b6672";
      ctx.font = `12px ${FONT}`;
      ctx.fillText("plug one in; hot-plug is picked up on the next frame", x, y + 22);
      return;
    }

    let shown = 0;
    for (let slot = 0; slot < pads.length && shown < 2; slot++) {
      const p = pads[slot];
      if (p === null) continue;
      drawPad(x + shown * 440, y + 20, slot);
      shown += 1;
    }
  }

  function drawPad(x: number, y: number, slot: number): void {
    const pads = navigator.getGamepads();
    const pad = pads[slot];
    if (pad === null) return;

    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = "#7fd1ff";
    ctx.fillText(`slot ${pad.index}: ${pad.id}`, x, y + 14);
    ctx.fillStyle = "#5b6672";
    const canRumble = pad.vibrationActuator.effects.length > 0;
    ctx.fillText(canRumble ? "rumble: yes" : "rumble: no", x, y + 30);

    for (let b = 0; b < BUTTON_COUNT; b++) {
      const col = b % 6;
      const row = (b - col) / 6;
      const bx = x + col * 66;
      const by = y + 44 + row * 40;
      const btn = pad.buttons[b];

      ctx.fillStyle = btn.pressed ? "#8ee27a" : "#2a3441";
      ctx.fillRect(bx, by, 60, 22);
      // A partly-pulled trigger shows a partial bar.
      if (!btn.pressed && btn.value > 0) {
        ctx.fillStyle = "#4a7a3f";
        ctx.fillRect(bx, by, 60 * btn.value, 22);
      }
      ctx.fillStyle = btn.pressed ? "#12161c" : "#7c8b9a";
      ctx.fillText(BUTTON_NAMES[b], bx + 6, by + 15);
    }

    for (let a = 0; a < AXIS_COUNT; a++) {
      const ay = y + 176 + a * 26;
      ctx.fillStyle = "#7c8b9a";
      ctx.fillText(AXIS_NAMES[a], x, ay + 12);

      const trackX = x + 28;
      const trackW = 200;
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
  }

  requestAnimationFrame(frame);
});
