/* bounce: a square bouncing around the canvas, nudged with the arrow keys.
 *
 * Browser code. The only non-web line is the import that supplies the
 * globals; in a page an import-map or bundler alias satisfies it and the
 * rest of the file is unchanged.
 *
 * This one uses the OPTIONAL engine loop (engine/loop.js) to show what it
 * buys: physics runs at a fixed 60Hz whatever the display refresh is, and
 * render interpolates by `alpha` so motion stays smooth between steps.
 * `examples/minimal` skips the engine entirely and drives rAF itself.
 */
import {
  window, document, KeyboardEvent,
} from "../../web/globals.js";
import { createGameLoop, LoopOptions } from "../../engine/loop.js";

const SIZE = 48;

window.onLoad(() => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  let x = 100;
  let y = 80;
  let vx = 0.22;
  let vy = 0.17;
  let spin = 0;

  // Previous-step state, so render can interpolate instead of snapping.
  let prevX = x;
  let prevY = y;
  let prevSpin = spin;

  /* Held-key state from keydown/keyup, the way a browser game does it: the
   * platform has no "is this key down" query, so the game keeps the set. */
  const held = new Map<string, boolean>();
  window.addEventListener("keydown", (e: KeyboardEvent) => { held.set(e.code, true); });
  window.addEventListener("keyup", (e: KeyboardEvent) => { held.set(e.code, false); });

  function down(code: string): boolean { return held.get(code) === true; }

  /* Fixed-rate simulation: `dt` is the SAME every call, so the square
   * behaves identically on a 60Hz and a 144Hz display. */
  function update(dt: number): void {
    prevX = x;
    prevY = y;
    prevSpin = spin;

    if (down("ArrowLeft")) vx -= 0.002 * dt;
    if (down("ArrowRight")) vx += 0.002 * dt;
    if (down("ArrowUp")) vy -= 0.002 * dt;
    if (down("ArrowDown")) vy += 0.002 * dt;

    x += vx * dt;
    y += vy * dt;
    if (x < 0) { x = 0; vx = -vx; }
    if (y < 0) { y = 0; vy = -vy; }
    if (x > W - SIZE) { x = W - SIZE; vx = -vx; }
    if (y > H - SIZE) { y = H - SIZE; vy = -vy; }
    spin += dt * 0.002;
  }

  /* `alpha` is how far this frame falls between the last two updates, so
   * drawing at the interpolated position removes step-boundary stutter. */
  function render(alpha: number): void {
    const drawX = prevX + (x - prevX) * alpha;
    const drawY = prevY + (y - prevY) * alpha;
    const drawSpin = prevSpin + (spin - prevSpin) * alpha;

    ctx.clear("#101820");

    // A static grid, so motion is obvious in a screenshot.
    ctx.strokeStyle = "#1d2b3a";
    ctx.lineWidth = 2;
    for (let gx = 0; gx <= W; gx += 64) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(drawX + SIZE / 2, drawY + SIZE / 2);
    ctx.rotate(drawSpin);
    ctx.fillStyle = "#ffb703";
    ctx.fillRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
    ctx.strokeStyle = "#fb8500";
    ctx.lineWidth = 3;
    ctx.strokeRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(8, 8, 120, 6);
  }

  const loop = new LoopOptions();
  loop.update = update;
  loop.render = render;
  createGameLoop(loop);
});
