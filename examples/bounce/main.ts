/* bounce: a square bouncing around the canvas, nudged with the arrow keys.
 *
 * Browser code. The only non-web line is the import that supplies the
 * globals; in a page an import-map or bundler alias satisfies it and the
 * rest of the file is unchanged.
 */
import {
  window, document, requestAnimationFrame, KeyboardEvent,
} from "../../web/globals.js";

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
  let last = 0;

  /* Held-key state from keydown/keyup, the way a browser game does it: the
   * platform has no "is this key down" query, so the game keeps the set. */
  const held = new Map<string, boolean>();
  window.addEventListener("keydown", (e: KeyboardEvent) => { held.set(e.code, true); });
  window.addEventListener("keyup", (e: KeyboardEvent) => { held.set(e.code, false); });

  function down(code: string): boolean { return held.get(code) === true; }

  function frame(time: number): void {
    // The first rAF has no previous timestamp -- true in a browser too --
    // so seed it rather than computing a delta against zero.
    let dt = last === 0 ? 16 : time - last;
    last = time;
    if (dt > 250) dt = 250;

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
    ctx.translate(x + SIZE / 2, y + SIZE / 2);
    ctx.rotate(spin);
    ctx.fillStyle = "#ffb703";
    ctx.fillRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
    ctx.strokeStyle = "#fb8500";
    ctx.lineWidth = 3;
    ctx.strokeRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(8, 8, 120, 6);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});
