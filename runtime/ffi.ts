/* FFI declarations for the hand-written shim: window, timing, events, the
 * error mailbox, and the marshalling helpers in sg_skia_extra.cpp.
 *
 * The generated skiac wrappers (canvas/paint/path/matrix/shader/...) live in
 * runtime/canvas/skia-ffi.ts. Both files are scanned by codegen/gen-ffi.js,
 * which derives the manifest from them.
 *
 * Two rules govern this file, both learned the hard way (docs/SPIKE-RESULTS.md):
 *
 * 1. The manifest is ALL-OR-NOTHING. Every function in ffi/core.ffi.json must
 *    have a declaration here (or in skia-ffi.ts), and vice versa, or the
 *    build fails. gen-ffi.js derives one from the other to keep them locked.
 *
 * 2. Never alias a declaration (`const f = sgPresent`) and never pass one as a
 *    value: scriptc binds only DIRECT calls of the exact declaration. The
 *    wrappers below are the only callers, and each returns the call directly.
 *
 * The upstream compiler additionally dropped a bound call whose result
 * initialized a never-reassigned binding (silent build, ReferenceError at
 * load). That is fixed in the pinned fork; the direct-return style here is
 * also immune to it, so this file is correct either way.
 */

// window / lifecycle
declare function sgInit(w: number, h: number, flags: number): number;
declare function sgQuit(unused: number): void;
declare function sgScreenCanvas(unused: number): number;
declare function sgScreenWidth(unused: number): number;
declare function sgScreenHeight(unused: number): number;
declare function sgDisplayHz(unused: number): number;
declare function sgPresent(unused: number): number;
declare function sgSurfaceSavePng(hs: number, path: string): number;
declare function sgSurfaceCreate(w: number, h: number): number;
declare function sgCanvasRelease(hc: number): number;

// timing
declare function sgTicks(unused: number): number;
declare function sgDelay(ms: number): void;

// events
declare function sgPollEvent(unused: number): number;
declare function sgEvtI32(field: number): number;

// error mailbox
declare function sgStrLen(unused: number): number;
declare function sgStrByte(i: number): number;

// gradients + patterns (stops are pushed one at a time, then committed)
declare function sgGradReset(unused: number): number;
declare function sgGradAddStop(offset: number, argb: number): number;
declare function sgShaderLinearGradient(x0: number, y0: number, x1: number, y1: number, tileMode: number): number;
declare function sgShaderRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, tileMode: number): number;
declare function sgShaderConicGradient(cx: number, cy: number, startAngleDeg: number, tileMode: number): number;
declare function sgShaderFromBitmap(hb: number, repeatX: number, repeatY: number): number;

/* Paint: skiac's set_shader/set_path_effect deref their argument, so there is
 * no way to CLEAR one. Clearing resets the paint to a pristine SkPaint behind
 * the same handle; these two only ever set a non-zero value. */
declare function sgPaintReset(hp: number): number;
declare function sgPaintSetShaderOpt(hp: number, hshader: number): number;
declare function sgPaintSetPathEffectOpt(hp: number, heffect: number): number;

// line dash
declare function sgDashReset(unused: number): number;
declare function sgDashPush(interval: number): number;
declare function sgDashMake(phase: number): number;

// transforms (struct-by-value in both directions)
declare function sgCanvasLatchTransform(hc: number): number;
declare function sgTsComponent(i: number): number;
declare function sgCanvasApplyTransform(hc: number, a: number, b: number, c: number, d: number, e: number, f: number, replace: number): number;

// path extras
declare function sgPathLatchBounds(hp: number): number;
declare function sgRectComponent(i: number): number;
declare function sgPathRoundRect(hp: number, x: number, y: number, w: number, h: number, rtl: number, rtr: number, rbr: number, rbl: number, clockwise: number): number;

// text
declare function sgFontRegister(path: string): number;
declare function sgTextSetFont(family: string, size: number, weight: number, slant: number): number;
declare function sgTextSetLayout(align: number, baseline: number, letterSpacing: number, maxWidth: number): number;
declare function sgTextSetString(text: string): number;
declare function sgTextDraw(hc: number, hp: number, x: number, y: number, canvasWidth: number): number;
declare function sgTextMeasure(canvasWidth: number): number;
declare function sgTextMetric(i: number): number;

// images
declare function sgImageDecode(data: Buffer): number;
declare function sgCanvasDrawBitmap(hc: number, hb: number, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, smoothing: number, filterQuality: number, hp: number): number;
declare function sgCanvasPutImageData(hc: number, pixels: Buffer, width: number, height: number, x: number, y: number): number;

// readback (debug tier)
declare function sgReadbackBegin(hs: number, x: number, y: number, w: number, h: number): number;
declare function sgReadbackPixel(i: number): number;

// debug counters
declare function sgDebugLive(domain: number): number;
declare function sgDebugHighWater(domain: number): number;

/* ---- wrappers: every one returns the FFI call directly ---- */

export function init(w: number, h: number, flags: number): number { return sgInit(w, h, flags); }
export function quit(): void { sgQuit(0); }
export function screenCanvas(): number { return sgScreenCanvas(0); }
export function screenWidth(): number { return sgScreenWidth(0); }
export function screenHeight(): number { return sgScreenHeight(0); }
/** Display refresh in Hz, or 0 when unknown (headless). */
export function displayHz(): number { return sgDisplayHz(0); }
export function present(): number { return sgPresent(0); }
/** Encodes a surface to a PNG file; handle 0 means the screen. 0 on success. */
export function surfaceSavePng(hs: number, path: string): number { return sgSurfaceSavePng(hs, path); }
export function surfaceCreate(w: number, h: number): number { return sgSurfaceCreate(w, h); }
export function canvasRelease(hc: number): number { return sgCanvasRelease(hc); }

export function ticks(): number { return sgTicks(0); }
export function delay(ms: number): void { sgDelay(ms); }

export function pollEvent(): number { return sgPollEvent(0); }
export function evtI32(field: number): number { return sgEvtI32(field); }

export function strLen(): number { return sgStrLen(0); }
export function strByte(i: number): number { return sgStrByte(i); }

export function gradReset(): number { return sgGradReset(0); }
export function gradAddStop(offset: number, argb: number): number { return sgGradAddStop(offset, argb); }
export function shaderLinearGradient(x0: number, y0: number, x1: number, y1: number, tileMode: number): number {
  return sgShaderLinearGradient(x0, y0, x1, y1, tileMode);
}
export function shaderRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, tileMode: number): number {
  return sgShaderRadialGradient(x0, y0, r0, x1, y1, r1, tileMode);
}
export function shaderConicGradient(cx: number, cy: number, startAngleDeg: number, tileMode: number): number {
  return sgShaderConicGradient(cx, cy, startAngleDeg, tileMode);
}
export function shaderFromBitmap(hb: number, repeatX: number, repeatY: number): number {
  return sgShaderFromBitmap(hb, repeatX, repeatY);
}

export function paintReset(hp: number): number { return sgPaintReset(hp); }
export function paintSetShaderOpt(hp: number, hshader: number): number { return sgPaintSetShaderOpt(hp, hshader); }
export function paintSetPathEffectOpt(hp: number, heffect: number): number { return sgPaintSetPathEffectOpt(hp, heffect); }

export function dashReset(): number { return sgDashReset(0); }
export function dashPush(interval: number): number { return sgDashPush(interval); }
export function dashMake(phase: number): number { return sgDashMake(phase); }

export function canvasLatchTransform(hc: number): number { return sgCanvasLatchTransform(hc); }
export function tsComponent(i: number): number { return sgTsComponent(i); }
export function canvasApplyTransform(hc: number, a: number, b: number, c: number, d: number, e: number, f: number, replace: number): number {
  return sgCanvasApplyTransform(hc, a, b, c, d, e, f, replace);
}

export function pathLatchBounds(hp: number): number { return sgPathLatchBounds(hp); }
export function rectComponent(i: number): number { return sgRectComponent(i); }
export function pathRoundRect(hp: number, x: number, y: number, w: number, h: number, rtl: number, rtr: number, rbr: number, rbl: number, clockwise: number): number {
  return sgPathRoundRect(hp, x, y, w, h, rtl, rtr, rbr, rbl, clockwise);
}

export function fontRegister(path: string): number { return sgFontRegister(path); }
export function textSetFont(family: string, size: number, weight: number, slant: number): number {
  return sgTextSetFont(family, size, weight, slant);
}
export function textSetLayout(align: number, baseline: number, letterSpacing: number, maxWidth: number): number {
  return sgTextSetLayout(align, baseline, letterSpacing, maxWidth);
}
export function textSetString(text: string): number { return sgTextSetString(text); }
export function textDraw(hc: number, hp: number, x: number, y: number, canvasWidth: number): number {
  return sgTextDraw(hc, hp, x, y, canvasWidth);
}
export function textMeasure(canvasWidth: number): number { return sgTextMeasure(canvasWidth); }
export function textMetric(i: number): number { return sgTextMetric(i); }

export function imageDecode(data: Buffer): number { return sgImageDecode(data); }
export function canvasDrawBitmap(hc: number, hb: number, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, smoothing: number, filterQuality: number, hp: number): number {
  return sgCanvasDrawBitmap(hc, hb, sx, sy, sw, sh, dx, dy, dw, dh, smoothing, filterQuality, hp);
}
export function canvasPutImageData(hc: number, pixels: Buffer, width: number, height: number, x: number, y: number): number {
  return sgCanvasPutImageData(hc, pixels, width, height, x, y);
}

export function readbackBegin(hs: number, x: number, y: number, w: number, h: number): number {
  return sgReadbackBegin(hs, x, y, w, h);
}
export function readbackPixel(i: number): number { return sgReadbackPixel(i); }

export function debugLive(domain: number): number { return sgDebugLive(domain); }
export function debugHighWater(domain: number): number { return sgDebugHighWater(domain); }
