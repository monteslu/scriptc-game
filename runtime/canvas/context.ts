/* Context2D: the canvas-shaped drawing surface handed to draw().
 *
 * Phase 1 subset (rects, paths, transforms, colors). Every method holds a
 * u32 handle; the paint is pooled and mutated rather than recreated per
 * call, because paint creation is the expensive part and FFI calls are not
 * (measured 2.5-3.3 ns/call).
 */
import * as ffi from "../ffi.js";
import { parseColor } from "./color.js";

// Math.PI is not in the static tier (SC2012), so the constant is inlined.
const RAD_TO_DEG = 57.29577951308232;

const STYLE_FILL = 0;
const STYLE_STROKE = 1;

export class Context2D {
  private canvas = 0;
  private paint = 0;
  private path = 0;

  // current style state, applied to the pooled paint at draw time
  private fillR = 0; private fillG = 0; private fillB = 0; private fillA = 255;
  private strokeR = 0; private strokeG = 0; private strokeB = 0; private strokeA = 255;

  lineWidth = 1;
  globalAlpha = 1;

  constructor(canvasHandle: number) {
    this.canvas = canvasHandle;
    this.paint = ffi.paintCreate();
    this.path = ffi.pathCreate();
  }

  get width(): number { return ffi.screenWidth(); }
  get height(): number { return ffi.screenHeight(); }

  set fillStyle(css: string) {
    const c = parseColor(css);
    this.fillR = c.r; this.fillG = c.g; this.fillB = c.b; this.fillA = c.a;
  }

  set strokeStyle(css: string) {
    const c = parseColor(css);
    this.strokeR = c.r; this.strokeG = c.g; this.strokeB = c.b; this.strokeA = c.a;
  }

  private applyFill(): void {
    let a = this.fillA * this.globalAlpha;
    if (a < 0) a = 0;
    if (a > 255) a = 255;
    ffi.paintSetStyle(this.paint, STYLE_FILL);
    ffi.paintSetColor(this.paint, this.fillR, this.fillG, this.fillB, a | 0);
  }

  private applyStroke(): void {
    let a = this.strokeA * this.globalAlpha;
    if (a < 0) a = 0;
    if (a > 255) a = 255;
    ffi.paintSetStyle(this.paint, STYLE_STROKE);
    ffi.paintSetColor(this.paint, this.strokeR, this.strokeG, this.strokeB, a | 0);
    ffi.paintSetStrokeWidth(this.paint, this.lineWidth);
  }

  clear(css: string): void {
    const c = parseColor(css);
    // skiac_canvas_clear takes a packed ARGB color
    const packed = ((c.a & 255) << 24) | ((c.r & 255) << 16) | ((c.g & 255) << 8) | (c.b & 255);
    ffi.canvasClear(this.canvas, packed >>> 0);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.applyFill();
    ffi.canvasDrawRect(this.canvas, x, y, w, h, this.paint);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.applyStroke();
    ffi.canvasDrawRect(this.canvas, x, y, w, h, this.paint);
  }

  // transforms
  save(): void { ffi.canvasSave(this.canvas); }
  restore(): void { ffi.canvasRestore(this.canvas); }
  translate(dx: number, dy: number): void { ffi.canvasTranslate(this.canvas, dx, dy); }
  rotate(radians: number): void { ffi.canvasRotate(this.canvas, radians * RAD_TO_DEG); }
  scale(sx: number, sy: number): void { ffi.canvasScale(this.canvas, sx, sy); }

  // paths
  //
  // skiac exposes no path reset, so a fresh path per beginPath() is the only
  // option; the OLD one must be freed unconditionally (the constructor also
  // makes one, so a `pathOpen` guard leaks exactly one path per context and
  // is what the Phase 1 handle counters caught).
  beginPath(): void {
    if (this.path !== 0) ffi.pathDestroy(this.path);
    this.path = ffi.pathCreate();
  }
  moveTo(x: number, y: number): void { ffi.pathMoveTo(this.path, x, y); }
  lineTo(x: number, y: number): void { ffi.pathLineTo(this.path, x, y); }
  closePath(): void { ffi.pathClose(this.path); }

  fill(): void {
    this.applyFill();
    ffi.canvasDrawPath(this.canvas, this.path, this.paint);
  }

  stroke(): void {
    this.applyStroke();
    ffi.canvasDrawPath(this.canvas, this.path, this.paint);
  }

  dispose(): void {
    if (this.paint !== 0) { ffi.paintDestroy(this.paint); this.paint = 0; }
    if (this.path !== 0) { ffi.pathDestroy(this.path); this.path = 0; }
    // The canvas is borrowed from the surface: release the handle only.
    if (this.canvas !== 0) { ffi.canvasRelease(this.canvas); this.canvas = 0; }
  }
}
