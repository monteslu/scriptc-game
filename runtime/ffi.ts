/* FFI declarations: the single place `declare function` appears.
 *
 * Two rules govern this file, both learned the hard way (docs/SPIKE-RESULTS.md):
 *
 * 1. The manifest is ALL-OR-NOTHING. Every function in ffi/core.ffi.json must
 *    have a declaration here, and every declaration here must be in the
 *    manifest, or the build fails. Keep the two in lockstep.
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
declare function sgSurfaceSavePng(path: string): number;

// timing
declare function sgTicks(unused: number): number;
declare function sgDelay(ms: number): void;

// events
declare function sgPollEvent(unused: number): number;
declare function sgEvtI32(field: number): number;

// error mailbox
declare function sgStrLen(unused: number): number;
declare function sgStrByte(i: number): number;

// canvas
declare function sgCanvasRelease(hc: number): number;
declare function sgCanvasClear(hc: number, color: number): number;
declare function sgCanvasSave(hc: number): number;
declare function sgCanvasRestore(hc: number): number;
declare function sgCanvasTranslate(hc: number, dx: number, dy: number): number;
declare function sgCanvasRotate(hc: number, degrees: number): number;
declare function sgCanvasScale(hc: number, sx: number, sy: number): number;
declare function sgCanvasDrawRect(hc: number, x: number, y: number, w: number, h: number, hp: number): number;
declare function sgCanvasDrawPath(hc: number, hpath: number, hp: number): number;

// paint
declare function sgPaintCreate(unused: number): number;
declare function sgPaintDestroy(hp: number): void;
declare function sgPaintSetColor(hp: number, r: number, g: number, b: number, a: number): number;
declare function sgPaintSetStyle(hp: number, style: number): number;
declare function sgPaintSetStrokeWidth(hp: number, w: number): number;
declare function sgPaintSetAlpha(hp: number, a: number): number;
declare function sgPaintSetAntiAlias(hp: number, aa: number): number;

// path
declare function sgPathCreate(unused: number): number;
declare function sgPathDestroy(hp: number): void;
declare function sgPathMoveTo(hp: number, x: number, y: number): number;
declare function sgPathLineTo(hp: number, x: number, y: number): number;
declare function sgPathClose(hp: number): number;

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
/** Encodes the screen surface to a PNG file. 0 on success. */
export function surfaceSavePng(path: string): number { return sgSurfaceSavePng(path); }

export function ticks(): number { return sgTicks(0); }
export function delay(ms: number): void { sgDelay(ms); }

export function pollEvent(): number { return sgPollEvent(0); }
export function evtI32(field: number): number { return sgEvtI32(field); }

export function strLen(): number { return sgStrLen(0); }
export function strByte(i: number): number { return sgStrByte(i); }

export function canvasRelease(hc: number): number { return sgCanvasRelease(hc); }
export function canvasClear(hc: number, color: number): number { return sgCanvasClear(hc, color); }
export function canvasSave(hc: number): number { return sgCanvasSave(hc); }
export function canvasRestore(hc: number): number { return sgCanvasRestore(hc); }
export function canvasTranslate(hc: number, dx: number, dy: number): number { return sgCanvasTranslate(hc, dx, dy); }
export function canvasRotate(hc: number, deg: number): number { return sgCanvasRotate(hc, deg); }
export function canvasScale(hc: number, sx: number, sy: number): number { return sgCanvasScale(hc, sx, sy); }
export function canvasDrawRect(hc: number, x: number, y: number, w: number, h: number, hp: number): number {
  return sgCanvasDrawRect(hc, x, y, w, h, hp);
}
export function canvasDrawPath(hc: number, hpath: number, hp: number): number { return sgCanvasDrawPath(hc, hpath, hp); }

export function paintCreate(): number { return sgPaintCreate(0); }
export function paintDestroy(hp: number): void { sgPaintDestroy(hp); }
export function paintSetColor(hp: number, r: number, g: number, b: number, a: number): number {
  return sgPaintSetColor(hp, r, g, b, a);
}
export function paintSetStyle(hp: number, style: number): number { return sgPaintSetStyle(hp, style); }
export function paintSetStrokeWidth(hp: number, w: number): number { return sgPaintSetStrokeWidth(hp, w); }
export function paintSetAlpha(hp: number, a: number): number { return sgPaintSetAlpha(hp, a); }
export function paintSetAntiAlias(hp: number, aa: number): number { return sgPaintSetAntiAlias(hp, aa); }

export function pathCreate(): number { return sgPathCreate(0); }
export function pathDestroy(hp: number): void { sgPathDestroy(hp); }
export function pathMoveTo(hp: number, x: number, y: number): number { return sgPathMoveTo(hp, x, y); }
export function pathLineTo(hp: number, x: number, y: number): number { return sgPathLineTo(hp, x, y); }
export function pathClose(hp: number): number { return sgPathClose(hp); }

export function debugLive(domain: number): number { return sgDebugLive(domain); }
export function debugHighWater(domain: number): number { return sgDebugHighWater(domain); }
