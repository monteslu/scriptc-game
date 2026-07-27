import { Game, GameOptions } from "../../engine/loop.js";
import { Context2D } from "../../web/canvas/context.js";
import * as ffi from "../../host/ffi.js";

const W = 640;
const H = 360;
const SIZE = 48;

class Bounce extends Game {
  x = 100;
  y = 80;
  vx = 0.22;
  vy = 0.17;
  spin = 0;

  update(dtMs: number): void {
    if (this.input.isDown("Escape")) { this.stop(); return; }
    if (this.input.isDown("ArrowLeft")) this.vx -= 0.002 * dtMs;
    if (this.input.isDown("ArrowRight")) this.vx += 0.002 * dtMs;
    if (this.input.isDown("ArrowUp")) this.vy -= 0.002 * dtMs;
    if (this.input.isDown("ArrowDown")) this.vy += 0.002 * dtMs;

    this.x += this.vx * dtMs;
    this.y += this.vy * dtMs;
    if (this.x < 0) { this.x = 0; this.vx = -this.vx; }
    if (this.y < 0) { this.y = 0; this.vy = -this.vy; }
    if (this.x > W - SIZE) { this.x = W - SIZE; this.vx = -this.vx; }
    if (this.y > H - SIZE) { this.y = H - SIZE; this.vy = -this.vy; }
    this.spin += dtMs * 0.002;
  }

  draw(ctx: Context2D, alpha: number): void {
    ctx.clear("#101820");

    // a static grid so motion is obvious in screenshots
    ctx.strokeStyle = "#1d2b3a";
    ctx.lineWidth = 2;
    for (let gx = 0; gx <= W; gx += 64) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }

    const px = this.x + this.vx * alpha;
    const py = this.y + this.vy * alpha;

    ctx.save();
    ctx.translate(px + SIZE / 2, py + SIZE / 2);
    ctx.rotate(this.spin);
    ctx.fillStyle = "#ffb703";
    ctx.fillRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
    ctx.strokeStyle = "#fb8500";
    ctx.lineWidth = 3;
    ctx.strokeRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(8, 8, 120, 6);
  }
}

function main(): void {
  const game = new Bounce();
  const opts = new GameOptions();
  opts.width = W;
  opts.height = H;
  const framesEnv = process.env["SG_MAX_FRAMES"];
  if (framesEnv !== undefined) opts.maxFrames = parseInt(framesEnv, 10);
  const shotEnv = process.env["SG_SHOT"];
  if (shotEnv !== undefined) opts.shotPath = shotEnv;
  const shotFrameEnv = process.env["SG_SHOT_FRAME"];
  if (shotFrameEnv !== undefined) opts.shotFrame = parseInt(shotFrameEnv, 10);
  if (process.env["SG_NO_VSYNC"] !== undefined) opts.vsync = false;

  const rc = game.run(opts);
  const st = game.stats;
  const avg = st.frames > 0 ? st.totalMs / st.frames : 0;
  const fps = avg > 0 ? 1000 / avg : 0;
  console.log(`frames=${st.frames} avg=${avg.toFixed(2)}ms (${fps.toFixed(1)} fps) min=${st.minMs.toFixed(2)} max=${st.maxMs.toFixed(2)} hitches=${st.hitches}`);
  console.log(`display=${st.displayHz}Hz budget=${st.budgetMs.toFixed(2)}ms`);
  console.log(`handles live: surface=${ffi.debugLive(0)} canvas=${ffi.debugLive(1)} paint=${ffi.debugLive(2)} path=${ffi.debugLive(3)}`);
  process.exit(rc);
}

main();
