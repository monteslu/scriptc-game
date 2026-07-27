/* Conformance scenes.
 *
 * Each scene is a deterministic drawing of a single feature family onto a
 * 200x150 surface. The SAME logical drawing must exist on both sides of the
 * comparison, so each scene is written twice: here in dialect TS against our
 * Context2D, and in test/golden/scenes.mjs in plain JS against
 * @napi-rs/canvas. That duplication is deliberate -- a shared description
 * format would test the description interpreter, not the two canvas
 * implementations -- and the harness fails loudly if the two lists disagree
 * on names or count.
 *
 * Rules for a scene:
 *   - no randomness, no time, no fonts unless the scene is about fonts
 *   - integer coordinates where the feature allows, so antialiasing is not
 *     the thing under test
 *   - one feature family per scene, so a diff points somewhere specific
 */
import { Context2D } from "../runtime/canvas/context.js";
import { createLinearGradient, createRadialGradient, createConicGradient } from "../runtime/canvas/gradient.js";
import { createPattern } from "../runtime/canvas/pattern.js";
import { GameImage } from "../runtime/canvas/image.js";
import { createCanvas } from "../runtime/canvas/offscreen.js";

export const SCENE_W = 200;
export const SCENE_H = 150;

/* Text scenes name this family explicitly and the harness registers the
 * matching .ttf on both sides. Asking for "sans-serif" would resolve through
 * each side's font manager against 250-odd system fonts, so a diff would
 * mean "different machines" rather than "different renderer". */
export const TEST_FONT = "DejaVu Sans";

/* All three faces are registered, not just the regular one: with only the
 * regular face present both sides SYNTHESIZE bold and italic, and they
 * synthesize differently (caught by conformance -- "bold" was the single
 * failing scene while regular and italic matched byte for byte). */
export const TEST_FONT_PATHS: string[] = [
  "test/assets/DejaVuSans.ttf",
  "test/assets/DejaVuSans-Bold.ttf",
  "test/assets/DejaVuSans-Oblique.ttf",
];

/** Scene names, in order. Must match test/golden/scenes.mjs exactly. */
export const SCENE_NAMES: string[] = [
  "fill-rect",
  "stroke-rect",
  "fill-alpha",
  "global-alpha",
  "path-lines",
  "path-close",
  "path-bezier",
  "path-quadratic",
  "path-arc",
  "path-arc-anticlockwise",
  "path-ellipse",
  "path-arcto",
  "path-rect",
  "path-roundrect",
  "fill-rule-nonzero",
  "fill-rule-evenodd",
  "line-width",
  "line-cap",
  "line-join",
  "miter-limit",
  "line-dash",
  "line-dash-offset",
  "transform-translate",
  "transform-rotate",
  "transform-scale",
  "transform-matrix",
  "transform-settransform",
  "save-restore",
  "clip-rect",
  "clip-path",
  "clear-rect",
  "gradient-linear",
  "gradient-radial",
  "gradient-conic",
  "gradient-stops",
  "composite-multiply",
  "composite-screen",
  "composite-xor",
  "composite-lighter",
  "color-formats",
  "text-fill",
  "text-stroke",
  "text-align",
  "text-baseline",
  "text-weight-style",
  "text-sizes",
  "image-draw",
  "image-scaled",
  "image-subrect",
  "image-alpha",
  "image-smoothing-off",
  "pattern-repeat",
  "pattern-no-repeat",
  "put-image-data",
  "offscreen-canvas",
];

/** The 64x64 procedural asset; see test/assets/make-test-image.mjs. */
export const TEST_IMAGE_PATH = "test/assets/test-image.png";

/** Draws scene `name` with our Context2D. `img` is the shared test asset. */
export function drawScene(name: string, ctx: Context2D, img: GameImage): void {
  if (name === "fill-rect") {
    ctx.fillStyle = "#3366cc";
    ctx.fillRect(20, 20, 60, 40);
    ctx.fillStyle = "#cc3366";
    ctx.fillRect(100, 60, 70, 50);
  } else if (name === "stroke-rect") {
    ctx.strokeStyle = "#228833";
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 60, 40);
    ctx.lineWidth = 1;
    ctx.strokeRect(100, 60, 70, 50);
  } else if (name === "fill-alpha") {
    ctx.fillStyle = "rgba(255,0,0,0.5)";
    ctx.fillRect(20, 20, 80, 60);
    ctx.fillStyle = "rgba(0,0,255,0.5)";
    ctx.fillRect(60, 50, 80, 60);
  } else if (name === "global-alpha") {
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(20, 20, 80, 60);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(60, 50, 80, 60);
    ctx.globalAlpha = 1;
  } else if (name === "path-lines") {
    ctx.strokeStyle = "#000088";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(20, 20);
    ctx.lineTo(180, 40);
    ctx.lineTo(100, 130);
    ctx.stroke();
  } else if (name === "path-close") {
    ctx.fillStyle = "#88cc22";
    ctx.beginPath();
    ctx.moveTo(30, 30);
    ctx.lineTo(170, 50);
    ctx.lineTo(90, 120);
    ctx.closePath();
    ctx.fill("nonzero");
  } else if (name === "path-bezier") {
    ctx.strokeStyle = "#004488";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(20, 120);
    ctx.bezierCurveTo(20, 20, 180, 20, 180, 120);
    ctx.stroke();
  } else if (name === "path-quadratic") {
    ctx.strokeStyle = "#884400";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(20, 120);
    ctx.quadraticCurveTo(100, 10, 180, 120);
    ctx.stroke();
  } else if (name === "path-arc") {
    ctx.fillStyle = "#cc8800";
    ctx.beginPath();
    ctx.arc(100, 75, 50, 0, 3.141592653589793, false);
    ctx.fill("nonzero");
  } else if (name === "path-arc-anticlockwise") {
    ctx.fillStyle = "#0088cc";
    ctx.beginPath();
    ctx.arc(100, 75, 50, 0, 3.141592653589793, true);
    ctx.fill("nonzero");
  } else if (name === "path-ellipse") {
    ctx.strokeStyle = "#660066";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(100, 75, 70, 40, 0, 0, 6.283185307179586, false);
    ctx.stroke();
  } else if (name === "path-arcto") {
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(20, 120);
    ctx.arcTo(20, 20, 180, 20, 60);
    ctx.lineTo(180, 20);
    ctx.stroke();
  } else if (name === "path-rect") {
    ctx.fillStyle = "#226688";
    ctx.beginPath();
    ctx.rect(30, 30, 60, 40);
    ctx.rect(110, 80, 60, 40);
    ctx.fill("nonzero");
  } else if (name === "path-roundrect") {
    ctx.fillStyle = "#886622";
    ctx.beginPath();
    ctx.roundRect(30, 30, 140, 90, 20);
    ctx.fill("nonzero");
  } else if (name === "fill-rule-nonzero") {
    ctx.fillStyle = "#993333";
    ctx.beginPath();
    ctx.rect(30, 30, 100, 90);
    ctx.rect(60, 55, 40, 40);
    ctx.fill("nonzero");
  } else if (name === "fill-rule-evenodd") {
    ctx.fillStyle = "#339933";
    ctx.beginPath();
    ctx.rect(30, 30, 100, 90);
    ctx.rect(60, 55, 40, 40);
    ctx.fill("evenodd");
  } else if (name === "line-width") {
    ctx.strokeStyle = "#000000";
    let w = 1;
    let y = 15;
    while (w <= 9) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(180, y);
      ctx.stroke();
      y += 20;
      w += 2;
    }
  } else if (name === "line-cap") {
    ctx.strokeStyle = "#224466";
    ctx.lineWidth = 14;
    ctx.lineCap = "butt";
    ctx.beginPath(); ctx.moveTo(40, 35); ctx.lineTo(160, 35); ctx.stroke();
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(40, 75); ctx.lineTo(160, 75); ctx.stroke();
    ctx.lineCap = "square";
    ctx.beginPath(); ctx.moveTo(40, 115); ctx.lineTo(160, 115); ctx.stroke();
    ctx.lineCap = "butt";
  } else if (name === "line-join") {
    ctx.strokeStyle = "#663322";
    ctx.lineWidth = 12;
    ctx.lineJoin = "miter";
    ctx.beginPath(); ctx.moveTo(20, 60); ctx.lineTo(50, 25); ctx.lineTo(80, 60); ctx.stroke();
    ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(75, 120); ctx.lineTo(105, 85); ctx.lineTo(135, 120); ctx.stroke();
    ctx.lineJoin = "bevel";
    ctx.beginPath(); ctx.moveTo(130, 60); ctx.lineTo(160, 25); ctx.lineTo(190, 60); ctx.stroke();
    ctx.lineJoin = "miter";
  } else if (name === "miter-limit") {
    ctx.strokeStyle = "#222266";
    ctx.lineWidth = 8;
    ctx.lineJoin = "miter";
    ctx.miterLimit = 2;
    ctx.beginPath(); ctx.moveTo(20, 100); ctx.lineTo(60, 30); ctx.lineTo(100, 100); ctx.stroke();
    ctx.miterLimit = 10;
    ctx.beginPath(); ctx.moveTo(110, 100); ctx.lineTo(150, 30); ctx.lineTo(190, 100); ctx.stroke();
    ctx.miterLimit = 10;
  } else if (name === "line-dash") {
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 6]);
    ctx.beginPath(); ctx.moveTo(20, 40); ctx.lineTo(180, 40); ctx.stroke();
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(20, 80); ctx.lineTo(180, 80); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(20, 120); ctx.lineTo(180, 120); ctx.stroke();
  } else if (name === "line-dash-offset") {
    ctx.strokeStyle = "#661111";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.lineDashOffset = 0;
    ctx.beginPath(); ctx.moveTo(20, 50); ctx.lineTo(180, 50); ctx.stroke();
    ctx.lineDashOffset = 5;
    ctx.beginPath(); ctx.moveTo(20, 100); ctx.lineTo(180, 100); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  } else if (name === "transform-translate") {
    ctx.fillStyle = "#335577";
    ctx.translate(50, 30);
    ctx.fillRect(0, 0, 60, 40);
    ctx.translate(60, 40);
    ctx.fillRect(0, 0, 60, 40);
    ctx.resetTransform();
  } else if (name === "transform-rotate") {
    ctx.fillStyle = "#775533";
    ctx.translate(100, 75);
    ctx.rotate(0.5235987755982988);
    ctx.fillRect(-40, -25, 80, 50);
    ctx.resetTransform();
  } else if (name === "transform-scale") {
    ctx.fillStyle = "#557733";
    ctx.translate(20, 20);
    ctx.scale(2, 1.5);
    ctx.fillRect(0, 0, 40, 30);
    ctx.resetTransform();
  } else if (name === "transform-matrix") {
    ctx.fillStyle = "#773355";
    ctx.transform(1, 0.3, 0.2, 1, 30, 20);
    ctx.fillRect(0, 0, 80, 50);
    ctx.resetTransform();
  } else if (name === "transform-settransform") {
    ctx.fillStyle = "#337755";
    ctx.translate(1000, 1000);           // must be discarded by setTransform
    ctx.setTransform(1, 0, 0, 1, 40, 30);
    ctx.fillRect(0, 0, 70, 45);
    ctx.resetTransform();
  } else if (name === "save-restore") {
    ctx.fillStyle = "#aa2222";
    ctx.save();
    ctx.fillStyle = "#22aa22";
    ctx.translate(90, 60);
    ctx.fillRect(0, 0, 60, 50);
    ctx.restore();
    // Must be back to red at the origin.
    ctx.fillRect(20, 20, 60, 50);
  } else if (name === "clip-rect") {
    ctx.save();
    // Deliberately the PATH form (rect + clip), not clipRect(): the golden
    // side has no clipRect, and the point is to compare the same code path.
    ctx.beginPath();
    ctx.rect(50, 40, 100, 70);
    ctx.clip("nonzero");
    ctx.fillStyle = "#2255aa";
    ctx.fillRect(0, 0, 200, 150);
    ctx.restore();
  } else if (name === "clip-path") {
    ctx.save();
    ctx.beginPath();
    ctx.arc(100, 75, 55, 0, 6.283185307179586, false);
    ctx.clip("nonzero");
    ctx.fillStyle = "#aa5522";
    ctx.fillRect(0, 0, 200, 150);
    ctx.restore();
  } else if (name === "clear-rect") {
    ctx.fillStyle = "#444488";
    ctx.fillRect(0, 0, 200, 150);
    ctx.clearRect(50, 40, 100, 70);
  } else if (name === "gradient-linear") {
    const g = createLinearGradient(20, 0, 180, 0);
    g.addColorStop(0, "#ff0000");
    g.addColorStop(1, "#0000ff");
    ctx.setFillGradient(g);
    ctx.fillRect(20, 30, 160, 90);
    g.dispose();
  } else if (name === "gradient-radial") {
    const g = createRadialGradient(100, 75, 5, 100, 75, 70);
    g.addColorStop(0, "#ffff00");
    g.addColorStop(1, "#008000");
    ctx.setFillGradient(g);
    ctx.fillRect(0, 0, 200, 150);
    g.dispose();
  } else if (name === "gradient-conic") {
    const g = createConicGradient(0, 100, 75);
    g.addColorStop(0, "#ff0000");
    g.addColorStop(0.5, "#00ff00");
    g.addColorStop(1, "#ff0000");
    ctx.setFillGradient(g);
    ctx.fillRect(0, 0, 200, 150);
    g.dispose();
  } else if (name === "gradient-stops") {
    const g = createLinearGradient(0, 20, 0, 130);
    g.addColorStop(0, "#000000");
    g.addColorStop(0.25, "#ff0000");
    g.addColorStop(0.5, "#00ff00");
    g.addColorStop(0.75, "#0000ff");
    g.addColorStop(1, "#ffffff");
    ctx.setFillGradient(g);
    ctx.fillRect(30, 20, 140, 110);
    g.dispose();
  } else if (name === "composite-multiply") {
    compositePair(ctx, "multiply");
  } else if (name === "composite-screen") {
    compositePair(ctx, "screen");
  } else if (name === "composite-xor") {
    compositePair(ctx, "xor");
  } else if (name === "composite-lighter") {
    compositePair(ctx, "lighter");
  } else if (name === "color-formats") {
    ctx.fillStyle = "#f00";
    ctx.fillRect(10, 10, 40, 40);
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(60, 10, 40, 40);
    ctx.fillStyle = "rgb(0,0,255)";
    ctx.fillRect(110, 10, 40, 40);
    ctx.fillStyle = "rgba(255,128,0,0.5)";
    ctx.fillRect(10, 60, 40, 40);
    ctx.fillStyle = "orange";
    ctx.fillRect(60, 60, 40, 40);
    ctx.fillStyle = "#00808080";
    ctx.fillRect(110, 60, 40, 40);
  } else if (name === "text-fill") {
    ctx.fillStyle = "#111111";
    ctx.font = `24px ${TEST_FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Hello 123", 15, 50);
    ctx.fillStyle = "#aa2211";
    ctx.font = `14px ${TEST_FONT}`;
    ctx.fillText("smaller text", 15, 90);
  } else if (name === "text-stroke") {
    ctx.strokeStyle = "#113388";
    ctx.lineWidth = 1;
    ctx.font = `30px ${TEST_FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.strokeText("Outline", 15, 60);
  } else if (name === "text-align") {
    ctx.fillStyle = "#222222";
    ctx.font = `16px ${TEST_FONT}`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText("left", 100, 40);
    ctx.textAlign = "center";
    ctx.fillText("center", 100, 75);
    ctx.textAlign = "right";
    ctx.fillText("right", 100, 110);
    ctx.textAlign = "left";
  } else if (name === "text-baseline") {
    ctx.fillStyle = "#224422";
    ctx.font = `15px ${TEST_FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("top", 15, 40);
    ctx.textBaseline = "middle";
    ctx.fillText("middle", 70, 40);
    ctx.textBaseline = "bottom";
    ctx.fillText("bottom", 140, 40);
    ctx.textBaseline = "alphabetic";
    ctx.fillText("alphabetic", 15, 100);
  } else if (name === "text-weight-style") {
    ctx.fillStyle = "#331144";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `18px ${TEST_FONT}`;
    ctx.fillText("regular", 15, 40);
    ctx.font = `bold 18px ${TEST_FONT}`;
    ctx.fillText("bold", 15, 75);
    ctx.font = `italic 18px ${TEST_FONT}`;
    ctx.fillText("italic", 15, 110);
  } else if (name === "text-sizes") {
    ctx.fillStyle = "#442211";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    let size = 10;
    let y = 25;
    while (size <= 28) {
      ctx.font = `${size}px ${TEST_FONT}`;
      ctx.fillText("Agy", 15, y);
      size += 6;
      y += 32;
    }
  } else if (name === "image-draw") {
    // Natural size, twice, at integer positions.
    ctx.drawImage(img, 10, 10);
    ctx.drawImage(img, 120, 70);
  } else if (name === "image-scaled") {
    ctx.drawImageScaled(img, 10, 10, 128, 96);
    ctx.drawImageScaled(img, 150, 100, 32, 24);
  } else if (name === "image-subrect") {
    // Top-left red quadrant, blown up; then the green quadrant at 1:1.
    ctx.drawImageRect(img, 0, 0, 32, 32, 10, 10, 96, 96);
    ctx.drawImageRect(img, 32, 0, 32, 32, 120, 10, 32, 32);
  } else if (name === "image-alpha") {
    ctx.fillStyle = "#404040";
    ctx.fillRect(0, 0, 200, 150);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(img, 20, 20);
    ctx.globalAlpha = 1;
    ctx.drawImage(img, 110, 60);
  } else if (name === "image-smoothing-off") {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImageRect(img, 0, 0, 8, 8, 10, 10, 80, 80);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImageRect(img, 0, 0, 8, 8, 110, 10, 80, 80);
  } else if (name === "pattern-repeat") {
    const p = createPattern(img, "repeat");
    ctx.setFillPattern(p);
    ctx.fillRect(10, 10, 180, 130);
    p.dispose();
  } else if (name === "pattern-no-repeat") {
    const p = createPattern(img, "no-repeat");
    ctx.setFillPattern(p);
    ctx.fillRect(10, 10, 180, 130);
    p.dispose();
  } else if (name === "put-image-data") {
    // A procedurally built RGBA block: pixels IN is the supported FFI
    // direction, so this is the one bulk path that needs no readback.
    const w = 60;
    const h = 40;
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        buf[o] = (x * 4) & 255;
        buf[o + 1] = (y * 6) & 255;
        buf[o + 2] = 128;
        buf[o + 3] = 255;
      }
    }
    ctx.putImageData(buf, w, h, 20, 20);
    ctx.putImageData(buf, w, h, 110, 80);
  } else if (name === "offscreen-canvas") {
    // Compose into an offscreen surface, then blit it twice.
    const off = createCanvas(80, 60);
    if (off !== null) {
      off.clear("#ffffff");
      off.fillStyle = "#cc4422";
      off.fillRect(5, 5, 70, 50);
      off.fillStyle = "#2244cc";
      off.fillRect(20, 15, 40, 30);
      ctx.drawCanvas(off, 10, 10);
      ctx.drawCanvasRect(off, 0, 0, 80, 60, 110, 80, 80, 60);
      off.dispose();
    }
  }
}

/** Two overlapping squares blended with `op`: the shared composite scene. */
function compositePair(ctx: Context2D, op: string): void {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#3060c0";
  ctx.fillRect(30, 30, 90, 70);
  ctx.globalCompositeOperation = op;
  ctx.fillStyle = "#c08030";
  ctx.fillRect(80, 60, 90, 70);
  ctx.globalCompositeOperation = "source-over";
}
