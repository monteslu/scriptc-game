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
