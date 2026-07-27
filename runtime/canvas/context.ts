/* Context2D: the canvas-shaped drawing surface handed to draw().
 *
 * Web-SHAPED, not web-compatible: the method names, argument orders and
 * state-machine semantics match CanvasRenderingContext2D closely enough that
 * canvas code reads the same, but there is no DOM, no CSSOM, and no
 * exception-based error reporting.
 *
 * Design notes:
 *   - The paint is POOLED and mutated per draw rather than recreated. Paint
 *     creation is the expensive part; FFI calls are not (2.5-3.3 ns each), so
 *     chatty state application is the cheap side of that trade.
 *   - Style state is kept TS-side and pushed to the paint at draw time, which
 *     is what makes save()/restore() of style (a canvas concept Skia's own
 *     save/restore does NOT cover) possible.
 */
import * as ffi from "../ffi.js";
import * as sk from "./skia-ffi.js";
import { parseColor, Rgba } from "./color.js";
import { Style, cloneStyle } from "./style.js";
import {
  STYLE_FILL, STYLE_STROKE,
  CAP_BUTT, CAP_ROUND, CAP_SQUARE,
  JOIN_MITER, JOIN_ROUND, JOIN_BEVEL,
  FILL_WINDING, FILL_EVEN_ODD,
  TILE_CLAMP, TILE_REPEAT, TILE_MIRROR,
  BASELINE_ALPHABETIC, BASELINE_TOP, BASELINE_MIDDLE, BASELINE_BOTTOM,
  BASELINE_HANGING, BASELINE_IDEOGRAPHIC,
  ALIGN_LEFT, ALIGN_RIGHT, ALIGN_CENTER, ALIGN_START, ALIGN_END,
  blendMode,
} from "./enums.js";
import { Gradient } from "./gradient.js";
import { Pattern } from "./pattern.js";
import { GameImage } from "./image.js";
import { parseFont } from "./font.js";
import { TextMetrics } from "./metrics.js";

// Math.PI is not in the static tier (SC2012), so the constants are inlined.
const PI = 3.141592653589793;
const TAU = 6.283185307179586;
const RAD_TO_DEG = 57.29577951308232;

/** A 2D affine transform in canvas order: [a c e / b d f / 0 0 1]. */
export class Matrix2D {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
}

export class Context2D {
  private canvas = 0;
  private surface = 0;   // 0 for the screen context
  private paint = 0;
  private path = 0;
  /** True once a path verb has been recorded, so fill()/stroke() know the
   * path is worth drawing and moveTo can be synthesized for lineTo-first. */
  private hasPath = false;
  private lastX = 0;
  private lastY = 0;

  private style = new Style();
  private stack: Style[] = [];
  /** Path effect handle for the current dash pattern; 0 = solid. */
  private dashEffect = 0;
  private dashDirty = true;

  constructor(canvasHandle: number, surfaceHandle: number) {
    this.canvas = canvasHandle;
    this.surface = surfaceHandle;
    this.paint = sk.paintCreate();
    this.path = sk.pathCreate();
    sk.paintSetAntiAlias(this.paint, 1);
  }

  get width(): number {
    return this.surface === 0 ? ffi.screenWidth() : sk.surfaceGetWidth(this.surface);
  }
  get height(): number {
    return this.surface === 0 ? ffi.screenHeight() : sk.surfaceGetHeight(this.surface);
  }

  /* ---- style state ---- */

  set fillStyle(css: string) {
    this.style.fill = parseColor(css);
    this.style.fillShader = 0;
  }
  set strokeStyle(css: string) {
    this.style.stroke = parseColor(css);
    this.style.strokeShader = 0;
  }

  /** Gradients and patterns are set through these, since a setter cannot be
   * overloaded on argument type in the dialect. */
  setFillGradient(g: Gradient): void { this.style.fillShader = g.handle(); }
  setStrokeGradient(g: Gradient): void { this.style.strokeShader = g.handle(); }
  setFillPattern(p: Pattern): void { this.style.fillShader = p.handle(); }
  setStrokePattern(p: Pattern): void { this.style.strokeShader = p.handle(); }

  get lineWidth(): number { return this.style.lineWidth; }
  set lineWidth(v: number) { if (v > 0) this.style.lineWidth = v; }

  get globalAlpha(): number { return this.style.globalAlpha; }
  set globalAlpha(v: number) {
    if (v >= 0 && v <= 1) this.style.globalAlpha = v;
  }

  get lineCap(): string { return this.style.lineCap; }
  set lineCap(v: string) {
    if (v === "butt" || v === "round" || v === "square") this.style.lineCap = v;
  }

  get lineJoin(): string { return this.style.lineJoin; }
  set lineJoin(v: string) {
    if (v === "miter" || v === "round" || v === "bevel") this.style.lineJoin = v;
  }

  get miterLimit(): number { return this.style.miterLimit; }
  set miterLimit(v: number) { if (v > 0) this.style.miterLimit = v; }

  get globalCompositeOperation(): string { return this.style.composite; }
  set globalCompositeOperation(v: string) { this.style.composite = v; }

  get font(): string { return this.style.font; }
  set font(v: string) {
    this.style.font = v;
    const parsed = parseFont(v);
    this.style.fontFamily = parsed.family;
    this.style.fontSize = parsed.size;
    this.style.fontWeight = parsed.weight;
    this.style.fontSlant = parsed.slant;
  }

  get textAlign(): string { return this.style.textAlign; }
  set textAlign(v: string) { this.style.textAlign = v; }

  get textBaseline(): string { return this.style.textBaseline; }
  set textBaseline(v: string) { this.style.textBaseline = v; }

  get imageSmoothingEnabled(): boolean { return this.style.smoothing; }
  set imageSmoothingEnabled(v: boolean) { this.style.smoothing = v; }

  get lineDashOffset(): number { return this.style.dashOffset; }
  set lineDashOffset(v: number) {
    this.style.dashOffset = v;
    this.dashDirty = true;
  }

  setLineDash(segments: number[]): void {
    // An odd-length pattern is duplicated, per the canvas spec.
    const out: number[] = [];
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] >= 0) out.push(segments[i]);
    }
    if (out.length % 2 === 1) {
      const n = out.length;
      for (let i = 0; i < n; i++) out.push(out[i]);
    }
    this.style.dash = out;
    this.dashDirty = true;
  }

  getLineDash(): number[] {
    const copy: number[] = [];
    for (let i = 0; i < this.style.dash.length; i++) copy.push(this.style.dash[i]);
    return copy;
  }

  /* ---- paint application ---- */

  private capValue(): number {
    if (this.style.lineCap === "round") return CAP_ROUND;
    if (this.style.lineCap === "square") return CAP_SQUARE;
    return CAP_BUTT;
  }

  private joinValue(): number {
    if (this.style.lineJoin === "round") return JOIN_ROUND;
    if (this.style.lineJoin === "bevel") return JOIN_BEVEL;
    return JOIN_MITER;
  }

  /** Rebuilds the dash path-effect when the pattern or offset changed. */
  private syncDash(): void {
    if (!this.dashDirty) return;
    this.dashDirty = false;
    if (this.dashEffect !== 0) {
      sk.pathEffectDestroy(this.dashEffect);
      this.dashEffect = 0;
    }
    if (this.style.dash.length > 0) {
      ffi.dashReset();
      for (let i = 0; i < this.style.dash.length; i++) ffi.dashPush(this.style.dash[i]);
      this.dashEffect = ffi.dashMake(this.style.dashOffset);
    }
  }

  /* Clearing a shader or a path effect is impossible through skiac (both
   * setters deref their argument, so NULL crashes), so the paint is RESET to
   * a pristine SkPaint instead and the cheap scalar state replayed onto it.
   * `paintHasExtras` tracks whether anything needing a reset was ever set, so
   * the common all-flat-colour frame never pays for one. */
  private paintHasExtras = false;

  private freshPaint(): void {
    if (this.paintHasExtras) {
      ffi.paintReset(this.paint);
      this.paintHasExtras = false;
      // Anti-alias is not a canvas-visible setting; it is our default and
      // must be restored after every reset.
      sk.paintSetAntiAlias(this.paint, 1);
    }
  }

  private applyCommon(): void {
    this.freshPaint();
    sk.paintSetBlendMode(this.paint, blendMode(this.style.composite));
  }

  private applyFill(): void {
    const s = this.style;
    this.applyCommon();
    sk.paintSetStyle(this.paint, STYLE_FILL);
    if (s.fillShader === 0) {
      const c = s.fill;
      sk.paintSetColor(this.paint, c.r, c.g, c.b, alphaOf(c, s.globalAlpha));
    } else {
      ffi.paintSetShaderOpt(this.paint, s.fillShader);
      this.paintHasExtras = true;
      // With a shader the paint colour is ignored except for its alpha.
      sk.paintSetAlpha(this.paint, alphaByteTrunc(s.globalAlpha));
    }
  }

  private applyStroke(): void {
    const s = this.style;
    this.applyCommon();
    this.syncDash();
    sk.paintSetStyle(this.paint, STYLE_STROKE);
    sk.paintSetStrokeWidth(this.paint, s.lineWidth);
    sk.paintSetStrokeCap(this.paint, this.capValue());
    sk.paintSetStrokeJoin(this.paint, this.joinValue());
    sk.paintSetStrokeMiter(this.paint, s.miterLimit);
    if (this.dashEffect !== 0) {
      ffi.paintSetPathEffectOpt(this.paint, this.dashEffect);
      this.paintHasExtras = true;
    }
    if (s.strokeShader === 0) {
      const c = s.stroke;
      sk.paintSetColor(this.paint, c.r, c.g, c.b, alphaOf(c, s.globalAlpha));
    } else {
      ffi.paintSetShaderOpt(this.paint, s.strokeShader);
      this.paintHasExtras = true;
      sk.paintSetAlpha(this.paint, alphaByteTrunc(s.globalAlpha));
    }
  }

  /* ---- rects ---- */

  clear(css: string): void {
    const c = parseColor(css);
    // skiac_canvas_clear takes a packed ARGB color.
    const packed = ((c.a & 255) << 24) | ((c.r & 255) << 16) | ((c.g & 255) << 8) | (c.b & 255);
    sk.canvasClear(this.canvas, packed >>> 0);
  }

  /** clearRect paints transparent black, ignoring the composite op. */
  clearRect(x: number, y: number, w: number, h: number): void {
    this.freshPaint();
    sk.paintSetStyle(this.paint, STYLE_FILL);
    // "clear" blend mode: dst = 0.
    sk.paintSetBlendMode(this.paint, 0);
    sk.paintSetColor(this.paint, 0, 0, 0, 0);
    sk.canvasDrawRect(this.canvas, x, y, w, h, this.paint);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.applyFill();
    sk.canvasDrawRect(this.canvas, x, y, w, h, this.paint);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.applyStroke();
    sk.canvasDrawRect(this.canvas, x, y, w, h, this.paint);
  }

  /* ---- transforms ----
   *
   * save()/restore() must cover BOTH Skia's matrix+clip stack and our
   * TS-side style state; the canvas spec saves them together. */

  save(): void {
    sk.canvasSave(this.canvas);
    this.stack.push(cloneStyle(this.style));
  }

  restore(): void {
    sk.canvasRestore(this.canvas);
    const prev = this.stack.pop();
    if (prev !== undefined) {
      this.style = prev;
      this.dashDirty = true;
    }
  }

  translate(dx: number, dy: number): void { sk.canvasTranslate(this.canvas, dx, dy); }
  rotate(radians: number): void { sk.canvasRotate(this.canvas, radians * RAD_TO_DEG); }
  scale(sx: number, sy: number): void { sk.canvasScale(this.canvas, sx, sy); }
  resetTransform(): void { sk.canvasResetTransform(this.canvas); }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    ffi.canvasApplyTransform(this.canvas, a, b, c, d, e, f, 0);
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    ffi.canvasApplyTransform(this.canvas, a, b, c, d, e, f, 1);
  }

  /** DOMMatrix-shaped record, not a DOMMatrix (X-tier by design). */
  getTransform(): Matrix2D {
    const m = new Matrix2D();
    // Latched in one call so the six reads cannot tear across a draw.
    ffi.canvasLatchTransform(this.canvas);
    m.a = ffi.tsComponent(0);
    m.b = ffi.tsComponent(1);
    m.c = ffi.tsComponent(2);
    m.d = ffi.tsComponent(3);
    m.e = ffi.tsComponent(4);
    m.f = ffi.tsComponent(5);
    return m;
  }

  /* ---- paths ---- */

  beginPath(): void {
    // skiac exposes no path reset, so a fresh path per beginPath() is the
    // only option; the OLD one must be freed unconditionally.
    if (this.path !== 0) sk.pathDestroy(this.path);
    this.path = sk.pathCreate();
    this.hasPath = false;
  }

  moveTo(x: number, y: number): void {
    sk.pathMoveTo(this.path, x, y);
    this.hasPath = true;
    this.lastX = x; this.lastY = y;
  }

  lineTo(x: number, y: number): void {
    // Canvas treats lineTo with no current point as moveTo.
    if (!this.hasPath) { this.moveTo(x, y); return; }
    sk.pathLineTo(this.path, x, y);
    this.lastX = x; this.lastY = y;
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    if (!this.hasPath) this.moveTo(cp1x, cp1y);
    sk.pathCubicTo(this.path, cp1x, cp1y, cp2x, cp2y, x, y);
    this.lastX = x; this.lastY = y;
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!this.hasPath) this.moveTo(cpx, cpy);
    sk.pathQuadTo(this.path, cpx, cpy, x, y);
    this.lastX = x; this.lastY = y;
  }

  closePath(): void {
    if (this.hasPath) sk.pathClose(this.path);
  }

  rect(x: number, y: number, w: number, h: number): void {
    /* WIDTH and HEIGHT, not right and bottom: skia_c.hpp declares this as
     * `(float l, float t, float r, float b)` but the implementation calls
     * SkRect::MakeXYWH(x, y, width, height). The parameter NAMES in the
     * header are wrong; the body is authoritative. Caught by conformance:
     * every rect ran to the canvas edge. */
    sk.pathAddRect(this.path, x, y, w, h);
    this.hasPath = true;
    this.lastX = x; this.lastY = y;
  }

  roundRect(x: number, y: number, w: number, h: number, radius: number): void {
    ffi.pathRoundRect(this.path, x, y, w, h, radius, radius, radius, radius, 1);
    this.hasPath = true;
  }

  /* arc/ellipse are expressed through Skia's arcTo, which takes an oval
   * bounding box plus start/sweep angles in DEGREES and clockwise-positive,
   * where canvas takes centre/radius in RADIANS with an anticlockwise flag. */
  arc(x: number, y: number, r: number, startAngle: number, endAngle: number, anticlockwise: boolean): void {
    this.ellipse(x, y, r, r, 0, startAngle, endAngle, anticlockwise);
  }

  ellipse(x: number, y: number, rx: number, ry: number, rotation: number,
          startAngle: number, endAngle: number, anticlockwise: boolean): void {
    let sweep = endAngle - startAngle;
    if (anticlockwise) {
      // Canvas: anticlockwise means go the other way round; normalize into
      // (-2pi, 0]. A full circle stays a full circle rather than collapsing.
      if (sweep > 0) {
        sweep = sweep % TAU;
        if (sweep > 0) sweep -= TAU;
      }
      if (sweep === 0 && endAngle !== startAngle) sweep = -TAU;
    } else {
      if (sweep < 0) {
        sweep = sweep % TAU;
        if (sweep < 0) sweep += TAU;
      }
      if (sweep === 0 && endAngle !== startAngle) sweep = TAU;
    }
    /* A 360-degree sweep draws NOTHING through Skia's arcTo: the arc's start
     * and end points coincide, and SkPath::arcTo treats that as an empty
     * segment. Canvas means a whole ellipse, so a full sweep is split into
     * two 180-degree arcs. Caught by conformance: full circles vanished
     * while half circles were byte-perfect. */
    const full = sweep >= TAU || sweep <= -TAU;
    if (sweep > TAU) sweep = TAU;
    if (sweep < -TAU) sweep = -TAU;

    // Rotation is applied by rotating the canvas around the centre, since
    // skiac_path_arc_to takes an axis-aligned oval.
    if (rotation !== 0) {
      sk.canvasSave(this.canvas);
      sk.canvasTranslate(this.canvas, x, y);
      sk.canvasRotate(this.canvas, rotation * RAD_TO_DEG);
      sk.canvasTranslate(this.canvas, -x, -y);
    }
    const half = sweep * 0.5 * RAD_TO_DEG;
    sk.pathArcTo(this.path, x - rx, y - ry, x + rx, y + ry,
                 startAngle * RAD_TO_DEG, full ? half : sweep * RAD_TO_DEG,
                 this.hasPath ? 0 : 1);
    if (full) {
      sk.pathArcTo(this.path, x - rx, y - ry, x + rx, y + ry,
                   startAngle * RAD_TO_DEG + half, half, 0);
    }
    if (rotation !== 0) sk.canvasRestore(this.canvas);

    this.hasPath = true;
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    if (!this.hasPath) this.moveTo(x1, y1);
    sk.pathArcToTangent(this.path, x1, y1, x2, y2, radius);
  }

  private setFillRule(rule: string): void {
    sk.pathSetFillType(this.path, rule === "evenodd" ? FILL_EVEN_ODD : FILL_WINDING);
  }

  fill(rule: string): void {
    if (!this.hasPath) return;
    this.setFillRule(rule);
    this.applyFill();
    sk.canvasDrawPath(this.canvas, this.path, this.paint);
  }

  stroke(): void {
    if (!this.hasPath) return;
    this.applyStroke();
    sk.canvasDrawPath(this.canvas, this.path, this.paint);
  }

  clip(rule: string): void {
    if (!this.hasPath) return;
    this.setFillRule(rule);
    sk.canvasClipPath(this.canvas, this.path);
  }

  clipRect(x: number, y: number, w: number, h: number): void {
    sk.canvasClipRect(this.canvas, x, y, w, h);
  }

  isPointInPath(x: number, y: number, rule: string): boolean {
    if (!this.hasPath) return false;
    this.setFillRule(rule);
    return sk.pathHitTest(this.path, x, y, rule === "evenodd" ? FILL_EVEN_ODD : FILL_WINDING) !== 0;
  }

  isPointInStroke(x: number, y: number): boolean {
    if (!this.hasPath) return false;
    return sk.pathStrokeHitTest(this.path, x, y, this.style.lineWidth) !== 0;
  }

  /* ---- text ---- */

  private alignValue(): number {
    const a = this.style.textAlign;
    if (a === "right") return ALIGN_RIGHT;
    if (a === "center") return ALIGN_CENTER;
    if (a === "start") return ALIGN_START;
    if (a === "end") return ALIGN_END;
    return ALIGN_LEFT;
  }

  private baselineValue(): number {
    const b = this.style.textBaseline;
    if (b === "top") return BASELINE_TOP;
    if (b === "middle") return BASELINE_MIDDLE;
    if (b === "bottom") return BASELINE_BOTTOM;
    if (b === "hanging") return BASELINE_HANGING;
    if (b === "ideographic") return BASELINE_IDEOGRAPHIC;
    return BASELINE_ALPHABETIC;
  }

  private pushTextState(text: string): void {
    const s = this.style;
    ffi.textSetFont(s.fontFamily, s.fontSize, s.fontWeight, s.fontSlant);
    ffi.textSetLayout(this.alignValue(), this.baselineValue(), 0, 0);
    ffi.textSetString(text);
  }

  fillText(text: string, x: number, y: number): void {
    this.applyFill();
    this.pushTextState(text);
    ffi.textDraw(this.canvas, this.paint, x, y, this.width);
  }

  strokeText(text: string, x: number, y: number): void {
    this.applyStroke();
    this.pushTextState(text);
    ffi.textDraw(this.canvas, this.paint, x, y, this.width);
  }

  measureText(text: string): TextMetrics {
    this.pushTextState(text);
    ffi.textMeasure(this.width);
    const m = new TextMetrics();
    // skiac already reports these in canvas orientation (ascent positive
    // above the baseline), so they pass through unchanged.
    m.width = ffi.textMetric(0);
    m.actualBoundingBoxAscent = ffi.textMetric(1);
    m.actualBoundingBoxDescent = ffi.textMetric(2);
    m.fontBoundingBoxAscent = ffi.textMetric(3);
    m.fontBoundingBoxDescent = ffi.textMetric(4);
    m.actualBoundingBoxLeft = ffi.textMetric(5);
    m.actualBoundingBoxRight = ffi.textMetric(6);
    return m;
  }

  /* ---- images ---- */

  /** drawImage's 3-argument form: natural size at (dx, dy). */
  drawImage(img: GameImage, dx: number, dy: number): void {
    this.drawImageRect(img, 0, 0, img.width, img.height, dx, dy, img.width, img.height);
  }

  /** 5-argument form: scaled to (dw, dh). */
  drawImageScaled(img: GameImage, dx: number, dy: number, dw: number, dh: number): void {
    this.drawImageRect(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
  }

  /** 9-argument form: source rect to destination rect. */
  drawImageRect(img: GameImage, sx: number, sy: number, sw: number, sh: number,
                dx: number, dy: number, dw: number, dh: number): void {
    this.applyCommon();
    sk.paintSetStyle(this.paint, STYLE_FILL);
    // drawImage sets the paint alpha straight from globalAlpha: ONE rounding,
    // not the colour path's two (there is no source colour to combine with).
    sk.paintSetColor(this.paint, 255, 255, 255, alphaByteRound(this.style.globalAlpha));
    ffi.canvasDrawBitmap(this.canvas, img.handle, sx, sy, sw, sh, dx, dy, dw, dh,
                         this.style.smoothing ? 1 : 0,
                         this.style.smoothing ? 1 : 0, this.paint);
  }

  /** Pixels IN: an RGBA byte buffer placed at (x, y). */
  putImageData(pixels: Buffer, width: number, height: number, x: number, y: number): void {
    ffi.canvasPutImageData(this.canvas, pixels, width, height, x, y);
  }

  /** Draws another Context2D's surface (sg.createCanvas) at (dx, dy). */
  drawCanvas(src: Context2D, dx: number, dy: number): void {
    const h = src.surfaceHandle();
    if (h === 0) return;   // the screen context is not a valid source
    sk.canvasDrawSurface(this.canvas, h, dx, dy,
                         alphaByteRound(this.style.globalAlpha),
                         blendMode(this.style.composite),
                         this.style.smoothing ? 1 : 0);
  }

  /** Source-rect to destination-rect blit from another context's surface. */
  drawCanvasRect(src: Context2D, sx: number, sy: number, sw: number, sh: number,
                 dx: number, dy: number, dw: number, dh: number): void {
    const h = src.surfaceHandle();
    if (h === 0) return;
    sk.canvasDrawSurfaceRect(this.canvas, h, sx, sy, sw, sh, dx, dy, dw, dh,
                             this.style.smoothing ? 1 : 0);
  }

  /* ---- internals ---- */

  /** The backing surface handle, for use as a drawImage source. */
  surfaceHandle(): number { return this.surface; }

  dispose(): void {
    if (this.paint !== 0) { sk.paintDestroy(this.paint); this.paint = 0; }
    if (this.path !== 0) { sk.pathDestroy(this.path); this.path = 0; }
    if (this.dashEffect !== 0) { sk.pathEffectDestroy(this.dashEffect); this.dashEffect = 0; }
    // The canvas is borrowed from the surface: release the handle only.
    if (this.canvas !== 0) { ffi.canvasRelease(this.canvas); this.canvas = 0; }
    // An offscreen context owns its surface; the screen context does not.
    if (this.surface !== 0) { sk.surfaceDestroy(this.surface); this.surface = 0; }
  }
}

/* globalAlpha as a 0-255 byte. THE REFERENCE USES TWO DIFFERENT RULES, and
 * conformance rejects either one applied everywhere:
 *
 *   - colour fills truncate (`... as u8` on the f32), so 0.25 -> 63
 *   - drawImage rounds (`(global_alpha * 255.0).round()`), so 0.25 -> 64
 *
 * The difference is invisible at most alpha values (0.75 -> 191 both ways)
 * and exactly one step at others, which is why only one scene at a time
 * failed while the rule was unified. Keep them separate. */
function alphaByteTrunc(globalAlpha: number): number {
  let v = globalAlpha * 255;
  if (v < 0) v = 0;
  if (v > 255) v = 255;
  return Math.floor(v);
}

function alphaByteRound(globalAlpha: number): number {
  let v = globalAlpha * 255;
  if (v < 0) v = 0;
  if (v > 255) v = 255;
  return Math.round(v);
}

/* Combining a COLOUR's alpha with globalAlpha rounds TWICE, and the two
 * roundings are not equivalent to one: the reference stores globalAlpha as a
 * byte first, then computes `(a/255 * ga/255 * 255).round()`
 * (skia/modules/canvaskit/color.js). Collapsing this to a single multiply is
 * off by one on many values -- conformance caught it as a max-channel-delta
 * of exactly 1 wherever globalAlpha was fractional. */
function scaleAlpha(a: number, globalAlpha: number): number {
  const ga = alphaByteTrunc(globalAlpha);
  let unit = (a / 255) * (ga / 255);
  if (unit < 0) unit = 0;
  if (unit > 1) unit = 1;
  return Math.round(unit * 255);
}

function alphaOf(c: Rgba, globalAlpha: number): number {
  return scaleAlpha(c.a, globalAlpha);
}
