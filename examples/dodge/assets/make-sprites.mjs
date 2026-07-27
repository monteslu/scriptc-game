/* Generates dodge's sprite sheets.
 *
 * Committed as a GENERATOR alongside its PNG output, the same pattern as
 * test/assets/make-test-image.mjs: the art is reviewable as code, tweakable
 * without a paint program, and regenerable if the palette changes. Drawn with
 * @napi-rs/canvas, which is the same Skia the game renders with.
 *
 * Run: node examples/dodge/assets/make-sprites.mjs
 */
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* Output goes next to THIS file regardless of cwd, but @napi-rs/canvas is
 * installed under test/golden, so run it from there:
 *   (cd test/golden && node ../../examples/dodge/assets/make-sprites.mjs) */
const here = dirname(fileURLToPath(import.meta.url));

/* ---- player: a 32x32 ship, drawn facing up ---- */
function makePlayer() {
  const S = 32;
  const c = createCanvas(S, S);
  const x = c.getContext("2d");

  // hull
  x.fillStyle = "#58a6ff";
  x.beginPath();
  x.moveTo(16, 2);
  x.lineTo(28, 24);
  x.lineTo(16, 19);
  x.lineTo(4, 24);
  x.closePath();
  x.fill();

  // canopy
  x.fillStyle = "#bcdcff";
  x.beginPath();
  x.moveTo(16, 8);
  x.lineTo(20, 18);
  x.lineTo(16, 16);
  x.lineTo(12, 18);
  x.closePath();
  x.fill();

  // engine glow
  x.fillStyle = "#ffd257";
  x.fillRect(13, 19, 2, 5);
  x.fillRect(17, 19, 2, 5);

  // outline, so the ship reads against a bright background too
  x.strokeStyle = "#1f5fa8";
  x.lineWidth = 1.5;
  x.beginPath();
  x.moveTo(16, 2);
  x.lineTo(28, 24);
  x.lineTo(16, 19);
  x.lineTo(4, 24);
  x.closePath();
  x.stroke();

  return c.toBuffer("image/png");
}

/* ---- hazard: a 32x32 spiked mine ---- */
function makeHazard() {
  const S = 32;
  const c = createCanvas(S, S);
  const x = c.getContext("2d");

  // spikes
  x.fillStyle = "#7d2226";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const cx = 16 + Math.cos(a) * 14;
    const cy = 16 + Math.sin(a) * 14;
    const bx = 16 + Math.cos(a + 0.25) * 8;
    const by = 16 + Math.sin(a + 0.25) * 8;
    const ex = 16 + Math.cos(a - 0.25) * 8;
    const ey = 16 + Math.sin(a - 0.25) * 8;
    x.beginPath();
    x.moveTo(cx, cy);
    x.lineTo(bx, by);
    x.lineTo(ex, ey);
    x.closePath();
    x.fill();
  }

  // body
  const g = x.createRadialGradient(12, 12, 2, 16, 16, 11);
  g.addColorStop(0, "#ff7a7f");
  g.addColorStop(1, "#c2383d");
  x.fillStyle = g;
  x.beginPath();
  x.arc(16, 16, 10, 0, Math.PI * 2);
  x.fill();

  x.strokeStyle = "#7d2226";
  x.lineWidth = 2;
  x.stroke();

  return c.toBuffer("image/png");
}

/* ---- coin: a 4-frame spin, 16x16 each, in one 64x16 strip ----
 * A strip rather than four files: one decode, one handle, and drawImageRect
 * picks the frame. That is how a real sprite sheet works. */
function makeCoinStrip() {
  const F = 16;
  const FRAMES = 4;
  const c = createCanvas(F * FRAMES, F);
  const x = c.getContext("2d");

  // Widths trace a spin: full, half, edge-on, half.
  const widths = [7, 4, 1.5, 4];
  for (let i = 0; i < FRAMES; i++) {
    const ox = i * F + F / 2;
    const w = widths[i];

    x.fillStyle = "#ffd257";
    x.beginPath();
    x.ellipse(ox, 8, w, 7, 0, 0, Math.PI * 2);
    x.fill();

    x.strokeStyle = "#a8761f";
    x.lineWidth = 1.5;
    x.stroke();

    // inner highlight, skipped on the edge-on frame where it would not fit
    if (w > 2) {
      x.fillStyle = "#fff0b8";
      x.beginPath();
      x.ellipse(ox - w * 0.25, 6, w * 0.35, 2.5, 0, 0, Math.PI * 2);
      x.fill();
    }
  }

  return c.toBuffer("image/png");
}

writeFileSync(join(here, "player.png"), makePlayer());
writeFileSync(join(here, "hazard.png"), makeHazard());
writeFileSync(join(here, "coin.png"), makeCoinStrip());
console.log("wrote player.png (32x32), hazard.png (32x32), coin.png (64x16, 4 frames)");
