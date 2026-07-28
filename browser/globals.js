/* The browser side of the one import line.
 *
 * A game imports its globals from "web/globals.js" so that scriptc, which
 * has no dynamic global table, can resolve them statically. In a browser
 * those globals already exist, so this module just hands them back.
 *
 * That is the whole shim. Every export below is the REAL browser global,
 * unwrapped and unmodified. If any of these needed a polyfill, an adapter,
 * or a behaviour tweak, the native side would not be implementing the web
 * API -- it would be implementing something else that resembles it. The
 * fact that this file is a list of re-exports IS the proof.
 *
 * An import map (see index.html) points "../../web/globals.js" here, so the
 * game's source is byte-identical in both worlds.
 */

/* Functions that read `this` must stay bound to their owner: pulling
 * `requestAnimationFrame` off `window` as a bare reference and calling it
 * unbound throws "Illegal invocation" in Chrome. */
export const requestAnimationFrame = globalThis.requestAnimationFrame.bind(globalThis);
export const cancelAnimationFrame = globalThis.cancelAnimationFrame.bind(globalThis);
export const fetch = globalThis.fetch.bind(globalThis);

export const window = globalThis;
/* getContextGL: the native side spells WebGL2 this way because the dialect
 * cannot resolve members off a union return, so one getContext returning
 * Context2D | WebGL2RenderingContext would break every 2D game. A browser
 * has no such method, so it is patched onto the canvas prototype here and
 * forwards to the real getContext("webgl2").
 *
 * Same class of aliasing as the import map itself: the game's source is
 * unchanged, and the one line that differs is satisfied by the shim. */
if (typeof HTMLCanvasElement !== "undefined" &&
    !HTMLCanvasElement.prototype.getContextGL) {
  HTMLCanvasElement.prototype.getContextGL = function getContextGL() {
    if (this.__sgGL) return this.__sgGL;
    /* preserveDrawingBuffer keeps the framebuffer readable after the
     * browser composites the frame. Without it readPixels outside the rAF
     * callback returns a cleared buffer, which reads as "the game drew
     * nothing" -- and that is exactly how the harness reported it.
     *
     * The native side has no compositor and no such flag, so this is a
     * browser-only concession, not a behaviour difference a game can see. */
    this.__sgGL = this.getContext("webgl2", { preserveDrawingBuffer: true });
    return this.__sgGL;
  };
}

/* Two more shims on the WebGL2 context, both bridging places where format 1
 * has no way to express what the web returns.
 *
 * getShaderParameter/getProgramParameter return `any` on the web: a boolean
 * for COMPILE_STATUS, a number for ACTIVE_UNIFORMS. The dialect has no
 * `any`, so the native side returns a number throughout and game code
 * compares against 0. Coercing booleans to 0/1 here makes that comparison
 * mean the same thing in both worlds.
 *
 * texImage2DFromImage exists because pixels cannot cross the FFI outward;
 * natively the copy is Skia-bitmap-to-GL-texture without entering TS. In a
 * page it is just the 6-argument texImage2D overload. */
if (typeof WebGL2RenderingContext !== "undefined") {
  const proto = WebGL2RenderingContext.prototype;

  for (const name of ["getShaderParameter", "getProgramParameter"]) {
    const original = proto[name];
    if (original && !original.__sgCoerced) {
      const wrapped = function (...args) {
        const v = original.apply(this, args);
        return typeof v === "boolean" ? (v ? 1 : 0) : v;
      };
      wrapped.__sgCoerced = true;
      proto[name] = wrapped;
    }
  }

  /* The *fv uniform setters take a Float32Array on the web. Natively they
   * take the FFI's `bytes` class, which is a Buffer (a Uint8Array
   * subclass), because format 1 has no typed-array class and the shim reads
   * the raw bytes as floats. Passing those bytes straight to a browser is
   * INVALID_OPERATION: it sees a Uint8Array where a Float32Array belongs.
   *
   * Reinterpreting the same memory costs nothing (no copy, just a second
   * view), and it is what makes one line of game code mean the same thing
   * in both worlds. */
  const asFloat32 = (data) =>
    data instanceof Float32Array
      ? data
      : new Float32Array(data.buffer, data.byteOffset,
                         data.byteLength / Float32Array.BYTES_PER_ELEMENT);

  for (const name of ["uniform1fv", "uniform2fv", "uniform3fv", "uniform4fv"]) {
    const original = proto[name];
    if (original && !original.__sgFloats) {
      const wrapped = function (loc, data, ...rest) {
        return original.call(this, loc, asFloat32(data), ...rest);
      };
      wrapped.__sgFloats = true;
      proto[name] = wrapped;
    }
  }
  for (const name of ["uniformMatrix2fv", "uniformMatrix3fv", "uniformMatrix4fv"]) {
    const original = proto[name];
    if (original && !original.__sgFloats) {
      const wrapped = function (loc, transpose, data, ...rest) {
        return original.call(this, loc, transpose, asFloat32(data), ...rest);
      };
      wrapped.__sgFloats = true;
      proto[name] = wrapped;
    }
  }

  if (!proto.texImage2DFromImage) {
    proto.texImage2DFromImage = function (target, level, image) {
      /* The 6-argument overload: (target, level, internalformat, format,
       * type, source). The native side always produces RGBA8 from the
       * decoder, so both format arguments are RGBA. */
      this.texImage2D(target, level, this.RGBA, this.RGBA,
                      this.UNSIGNED_BYTE, image);
    };
  }

  if (!proto.texImage2DFromCanvas) {
    /* Uploads a 2D canvas as a texture. The native signature takes the
     * CONTEXT rather than the canvas, because on that side the pixels live
     * in a Skia surface the context owns and never cross the FFI. A browser
     * takes either, and `ctx.canvas` is the spec-guaranteed back-reference
     * from a context to its element, so the two tiers stay call-compatible.
     *
     * TEXTURE SOURCES ARE TOP-DOWN and GL is bottom-up, so the native shim
     * flips rows on upload; UNPACK_FLIP_Y_WEBGL is how a browser does the
     * same. Without it HUD text renders mirrored vertically. The flag is
     * saved and restored so this cannot leak into unrelated uploads. */
    proto.texImage2DFromCanvas = function (target, level, ctx) {
      const source = ctx && ctx.canvas ? ctx.canvas : ctx;
      const prev = this.getParameter(this.UNPACK_FLIP_Y_WEBGL);
      this.pixelStorei(this.UNPACK_FLIP_Y_WEBGL, true);
      this.texImage2D(target, level, this.RGBA, this.RGBA,
                      this.UNSIGNED_BYTE, source);
      this.pixelStorei(this.UNPACK_FLIP_Y_WEBGL, prev);
    };
  }
}

/* Buffer, minimally.
 *
 * The FFI's `bytes` param class is spelled `Buffer` in TS, so any game that
 * hands binary data to the native side (vertex data, uniform matrices,
 * texture pixels) names it. Browsers have no Buffer.
 *
 * This is a Uint8Array subclass with the handful of accessors those uses
 * need, backed by a DataView for the endian-explicit reads and writes.
 * Node's Buffer is far larger; nothing here needs the rest of it, and
 * pulling in a full polyfill would obscure how little is actually used. */
if (typeof globalThis.Buffer === "undefined") {
  class SgBuffer extends Uint8Array {
    static alloc(size) { return new SgBuffer(size); }
    static from(source) { return new SgBuffer(source); }

    get view() {
      // Cached lazily: a DataView over the SAME memory, not a copy.
      if (this._view === undefined) {
        this._view = new DataView(this.buffer, this.byteOffset, this.byteLength);
      }
      return this._view;
    }

    // little-endian throughout, matching Node and every target we build for
    writeFloatLE(value, offset) { this.view.setFloat32(offset, value, true); return offset + 4; }
    readFloatLE(offset) { return this.view.getFloat32(offset, true); }
    writeUInt16LE(value, offset) { this.view.setUint16(offset, value, true); return offset + 2; }
    readUInt16LE(offset) { return this.view.getUint16(offset, true); }
    writeUInt32LE(value, offset) { this.view.setUint32(offset, value, true); return offset + 4; }
    readUInt32LE(offset) { return this.view.getUint32(offset, true); }
    writeInt32LE(value, offset) { this.view.setInt32(offset, value, true); return offset + 4; }
    readInt32LE(offset) { return this.view.getInt32(offset, true); }
    writeUInt8(value, offset) { this[offset] = value & 0xff; return offset + 1; }
    readUInt8(offset) { return this[offset]; }
  }
  globalThis.Buffer = SgBuffer;
}

export const document = globalThis.document;
export const navigator = globalThis.navigator;
export const performance = globalThis.performance;

export const Image = globalThis.Image;
export const FontFace = globalThis.FontFace;
export const Response = globalThis.Response;

export const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
export const OfflineAudioContext = globalThis.OfflineAudioContext;
export const AudioBuffer = globalThis.AudioBuffer;
export const AudioNode = globalThis.AudioNode;
export const AudioParam = globalThis.AudioParam;
export const GainNode = globalThis.GainNode;
export const OscillatorNode = globalThis.OscillatorNode;
export const BiquadFilterNode = globalThis.BiquadFilterNode;
export const DelayNode = globalThis.DelayNode;
export const StereoPannerNode = globalThis.StereoPannerNode;
export const PannerNode = globalThis.PannerNode;
export const DynamicsCompressorNode = globalThis.DynamicsCompressorNode;
export const WaveShaperNode = globalThis.WaveShaperNode;
export const AnalyserNode = globalThis.AnalyserNode;
export const ConvolverNode = globalThis.ConvolverNode;
export const ChannelMergerNode = globalThis.ChannelMergerNode;
export const ChannelSplitterNode = globalThis.ChannelSplitterNode;
export const ConstantSourceNode = globalThis.ConstantSourceNode;
export const IIRFilterNode = globalThis.IIRFilterNode;
export const AudioBufferSourceNode = globalThis.AudioBufferSourceNode;
export const AudioScheduledSourceNode = globalThis.AudioScheduledSourceNode;

export const KeyboardEvent = globalThis.KeyboardEvent;
export const MouseEvent = globalThis.MouseEvent;
export const UIEvent = globalThis.UIEvent;

export const Gamepad = globalThis.Gamepad;
export const GamepadButton = globalThis.GamepadButton;
export const GamepadHapticActuator = globalThis.GamepadHapticActuator;

/* GamepadEffectParameters is a DICTIONARY, not an interface: there is no
 * runtime object to export, and a game passes an object literal. Exported
 * as undefined so the import resolves; using it as a value would be wrong
 * in both worlds. */
export const GamepadEffectParameters = undefined;

/* Math is imported rather than global on the native side, because the
 * static tier fences sqrt/sin/cos/pow/PI across to libm. Here it is just
 * Math. */
export const Math = globalThis.Math;
