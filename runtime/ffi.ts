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

/* Math: the static tier fences every transcendental function (SC2012), so
 * they cross to libm. `abs`/`floor`/`ceil`/`round`/`trunc`/`min`/`max` are
 * NOT here: those compile natively and should be called as Math.* directly. */
declare function sgSqrt(x: number): number;
declare function sgSin(x: number): number;
declare function sgCos(x: number): number;
declare function sgTan(x: number): number;
declare function sgAsin(x: number): number;
declare function sgAcos(x: number): number;
declare function sgAtan(x: number): number;
declare function sgAtan2(y: number, x: number): number;
declare function sgPow(x: number, y: number): number;
declare function sgExp(x: number): number;
declare function sgLog(x: number): number;
declare function sgLog2(x: number): number;
declare function sgLog10(x: number): number;
declare function sgHypot(x: number, y: number): number;
declare function sgFmod(x: number, y: number): number;

/* ---- audio ----
 * The graph is webaudio-node's C++ engine, driven from an SDL audio thread.
 * Mutations queue through a lock-free ring (shim/sg_audio.cpp); only calls
 * that must RETURN a value run on the main thread. */
declare function sgAudioInit(sampleRate: number, bufferFrames: number): number;
declare function sgAudioInitOffline(sampleRate: number, channels: number): number;
declare function sgAudioQuit(unused: number): void;
declare function sgAudioRate(unused: number): number;
declare function sgAudioChannels(unused: number): number;
declare function sgAudioTime(unused: number): number;
declare function sgAudioDropped(unused: number): number;
declare function sgAudioSuspend(suspend: number): number;
declare function sgAudioCreateNode(type: string): number;
declare function sgAudioConnect(src: number, dst: number, oidx: number, iidx: number): number;
declare function sgAudioDisconnect(src: number, dst: number): number;
declare function sgAudioStart(node: number, when: number): number;
declare function sgAudioStop(node: number, when: number): number;
declare function sgAudioSetParam(node: number, param: number, value: number): number;
declare function sgAudioScheduleParam(node: number, param: number, kind: number, time: number, value: number, extra: number): number;
declare function sgAudioRegisterBuffer(data: Buffer, frames: number, channels: number): number;
declare function sgAudioSetNodeBuffer(node: number, bufferId: number): number;
declare function sgAudioSetCurve(node: number, data: Buffer): number;
declare function sgAudioRenderOffline(path: string, frames: number): number;
declare function sgAudioGraphId(unused: number): number;
declare function sgAudioNextBufferId(unused: number): number;
/* Decoding happens NATIVELY and the samples never cross: a 3-minute track is
 * ~90MB of float32. The file goes straight into the engine's buffer store and
 * TS gets back an id plus metadata through the three getters. */
declare function sgAudioDecodeFile(graphId: number, bufferId: number, path: string): number;
declare function sgDecodeFrames(unused: number): number;
declare function sgDecodeChannels(unused: number): number;
declare function sgDecodeRate(unused: number): number;

// input lifecycle
declare function sgInputInit(unused: number): number;
declare function sgInputQuit(unused: number): void;

// text input (UTF-8 bytes of one text event, drained immediately)
declare function sgTextInput(enable: number): number;
declare function sgTextLen(unused: number): number;
declare function sgTextByte(i: number): number;

// gamepads, addressed by SLOT (stable and bounded, unlike SDL instance ids)
declare function sgPadConnected(slot: number): number;
declare function sgPadButton(slot: number, button: number): number;
declare function sgPadAxis(slot: number, axis: number): number;
declare function sgPadName(slot: number): number;
declare function sgPadRumble(slot: number, low: number, high: number, ms: number): number;
declare function sgPadHasRumble(slot: number): number;
declare function sgPadAddMapping(mapping: string): number;

/* Virtual pads: SDL can attach a synthetic controller, which is what makes
 * the gamepad path testable with no hardware. Shipped rather than test-only
 * because it is also the hook for replay and remote input. */
declare function sgPadAttachVirtual(naxes: number, nbuttons: number): number;
declare function sgPadDetachVirtual(deviceIndex: number): number;
declare function sgPadSetVirtualButton(slot: number, button: number, value: number): number;
declare function sgPadSetVirtualAxis(slot: number, axis: number, value: number): number;
declare function sgPadUpdate(unused: number): number;

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

export function mathSqrt(x: number): number { return sgSqrt(x); }
export function mathSin(x: number): number { return sgSin(x); }
export function mathCos(x: number): number { return sgCos(x); }
export function mathTan(x: number): number { return sgTan(x); }
export function mathAsin(x: number): number { return sgAsin(x); }
export function mathAcos(x: number): number { return sgAcos(x); }
export function mathAtan(x: number): number { return sgAtan(x); }
export function mathAtan2(y: number, x: number): number { return sgAtan2(y, x); }
export function mathPow(x: number, y: number): number { return sgPow(x, y); }
export function mathExp(x: number): number { return sgExp(x); }
export function mathLog(x: number): number { return sgLog(x); }
export function mathLog2(x: number): number { return sgLog2(x); }
export function mathLog10(x: number): number { return sgLog10(x); }
export function mathHypot(x: number, y: number): number { return sgHypot(x, y); }
export function mathFmod(x: number, y: number): number { return sgFmod(x, y); }

export function audioInit(sampleRate: number, bufferFrames: number): number { return sgAudioInit(sampleRate, bufferFrames); }
export function audioInitOffline(sampleRate: number, channels: number): number { return sgAudioInitOffline(sampleRate, channels); }
export function audioQuit(): void { sgAudioQuit(0); }
export function audioRate(): number { return sgAudioRate(0); }
export function audioChannels(): number { return sgAudioChannels(0); }
export function audioTime(): number { return sgAudioTime(0); }
export function audioDropped(): number { return sgAudioDropped(0); }
export function audioSuspend(v: number): number { return sgAudioSuspend(v); }
export function audioCreateNode(type: string): number { return sgAudioCreateNode(type); }
export function audioConnect(src: number, dst: number, oidx: number, iidx: number): number { return sgAudioConnect(src, dst, oidx, iidx); }
export function audioDisconnect(src: number, dst: number): number { return sgAudioDisconnect(src, dst); }
export function audioStart(node: number, when: number): number { return sgAudioStart(node, when); }
export function audioStop(node: number, when: number): number { return sgAudioStop(node, when); }
export function audioSetParam(node: number, param: number, value: number): number { return sgAudioSetParam(node, param, value); }
export function audioScheduleParam(node: number, param: number, kind: number, time: number, value: number, extra: number): number {
  return sgAudioScheduleParam(node, param, kind, time, value, extra);
}
export function audioRegisterBuffer(data: Buffer, frames: number, channels: number): number { return sgAudioRegisterBuffer(data, frames, channels); }
export function audioSetNodeBuffer(node: number, bufferId: number): number { return sgAudioSetNodeBuffer(node, bufferId); }
export function audioSetCurve(node: number, data: Buffer): number { return sgAudioSetCurve(node, data); }
export function audioRenderOffline(path: string, frames: number): number { return sgAudioRenderOffline(path, frames); }
export function audioGraphId(): number { return sgAudioGraphId(0); }
export function audioNextBufferId(): number { return sgAudioNextBufferId(0); }
export function audioDecodeFile(graphId: number, bufferId: number, path: string): number {
  return sgAudioDecodeFile(graphId, bufferId, path);
}
export function decodeFrames(): number { return sgDecodeFrames(0); }
export function decodeChannels(): number { return sgDecodeChannels(0); }
export function decodeRate(): number { return sgDecodeRate(0); }

export function inputInit(): number { return sgInputInit(0); }
export function inputQuit(): void { sgInputQuit(0); }

export function textInput(enable: number): number { return sgTextInput(enable); }
export function textEventLen(): number { return sgTextLen(0); }
export function textEventByte(i: number): number { return sgTextByte(i); }

export function padConnected(slot: number): number { return sgPadConnected(slot); }
export function padButton(slot: number, button: number): number { return sgPadButton(slot, button); }
export function padAxis(slot: number, axis: number): number { return sgPadAxis(slot, axis); }
export function padName(slot: number): number { return sgPadName(slot); }
export function padRumble(slot: number, low: number, high: number, ms: number): number {
  return sgPadRumble(slot, low, high, ms);
}
export function padHasRumble(slot: number): number { return sgPadHasRumble(slot); }
export function padAddMapping(mapping: string): number { return sgPadAddMapping(mapping); }

export function padAttachVirtual(naxes: number, nbuttons: number): number {
  return sgPadAttachVirtual(naxes, nbuttons);
}
export function padDetachVirtual(deviceIndex: number): number { return sgPadDetachVirtual(deviceIndex); }
export function padSetVirtualButton(slot: number, button: number, value: number): number {
  return sgPadSetVirtualButton(slot, button, value);
}
export function padSetVirtualAxis(slot: number, axis: number, value: number): number {
  return sgPadSetVirtualAxis(slot, axis, value);
}
export function padUpdate(): number { return sgPadUpdate(0); }

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
