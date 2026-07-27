/* Web Audio, web-shaped, over webaudio-node's C++ graph.
 *
 * The same engine the WASM build runs, compiled native and driven from an
 * SDL audio thread (shim/sg_audio.cpp). Node ids come back from the engine;
 * every mutation is queued to the audio thread through a lock-free ring, so
 * nothing here blocks and nothing races.
 *
 * Shape follows the spec: `ctx.createOscillator()`, `osc.connect(gain)`,
 * `gain.gain.setValueAtTime(...)`, `osc.start()`. Where the dialect cannot
 * express a web idiom the difference is called out in a comment.
 */
import * as ffi from "../ffi.js";
import {
  P_FREQUENCY, P_DETUNE, P_GAIN, P_Q, P_DELAY_TIME, P_PAN, P_OFFSET, P_TYPE,
  P_LOOP, P_THRESHOLD, P_KNEE, P_RATIO, P_ATTACK, P_RELEASE,
  P_POSITION_X, P_POSITION_Y, P_POSITION_Z,
  EV_SET_VALUE, EV_LINEAR_RAMP, EV_EXPONENTIAL_RAMP, EV_SET_TARGET, EV_CANCEL,
  waveTypeOf,
} from "./params.js";

/* AudioParam.
 *
 * `value` is a setter rather than a plain field so an assignment reaches the
 * engine, matching how the web behaves. The scheduling methods are the spec's
 * and all queue through the same ring. */
export class AudioParam {
  private node = 0;
  private id = 0;
  private current = 0;

  constructor(node: number, id: number, defaultValue: number) {
    this.node = node;
    this.id = id;
    this.current = defaultValue;
  }

  get value(): number { return this.current; }
  set value(v: number) {
    this.current = v;
    ffi.audioSetParam(this.node, this.id, v);
  }

  setValueAtTime(value: number, when: number): AudioParam {
    this.current = value;
    ffi.audioScheduleParam(this.node, this.id, EV_SET_VALUE, when, value, 0);
    return this;
  }

  linearRampToValueAtTime(value: number, when: number): AudioParam {
    this.current = value;
    ffi.audioScheduleParam(this.node, this.id, EV_LINEAR_RAMP, when, value, 0);
    return this;
  }

  exponentialRampToValueAtTime(value: number, when: number): AudioParam {
    this.current = value;
    ffi.audioScheduleParam(this.node, this.id, EV_EXPONENTIAL_RAMP, when, value, 0);
    return this;
  }

  setTargetAtTime(target: number, when: number, timeConstant: number): AudioParam {
    this.current = target;
    ffi.audioScheduleParam(this.node, this.id, EV_SET_TARGET, when, target, timeConstant);
    return this;
  }

  cancelScheduledValues(when: number): AudioParam {
    ffi.audioScheduleParam(this.node, this.id, EV_CANCEL, when, 0, 0);
    return this;
  }
}

/** Base class: everything connectable. */
export class AudioNode {
  /** The engine's node id. Public because the context and tests use it. */
  nodeId = 0;

  constructor(nodeId: number) { this.nodeId = nodeId; }

  /** Returns the destination, so `a.connect(b).connect(c)` chains. */
  connect(destination: AudioNode): AudioNode {
    ffi.audioConnect(this.nodeId, destination.nodeId, 0, 0);
    return destination;
  }

  connectOutput(destination: AudioNode, outputIndex: number, inputIndex: number): AudioNode {
    ffi.audioConnect(this.nodeId, destination.nodeId, outputIndex, inputIndex);
    return destination;
  }

  /* Removes ONE edge, as the spec says: connecting the same pair twice makes
   * two summed edges and disconnect() undoes one connect().
   *
   * Mid-playback, prefer ramping gain to zero -- an abrupt disconnect clicks. */
  disconnect(destination: AudioNode): void {
    ffi.audioDisconnect(this.nodeId, destination.nodeId);
  }
}

/** Anything with start()/stop(): oscillators, buffer sources, constants. */
export class AudioScheduledSourceNode extends AudioNode {
  start(when: number): void { ffi.audioStart(this.nodeId, when); }
  stop(when: number): void { ffi.audioStop(this.nodeId, when); }
}

export class OscillatorNode extends AudioScheduledSourceNode {
  frequency: AudioParam;
  detune: AudioParam;

  constructor(nodeId: number) {
    super(nodeId);
    this.frequency = new AudioParam(nodeId, P_FREQUENCY, 440);
    this.detune = new AudioParam(nodeId, P_DETUNE, 0);
  }

  /** "sine" | "square" | "sawtooth" | "triangle". */
  set type(name: string) {
    ffi.audioSetParam(this.nodeId, P_TYPE, waveTypeOf(name));
  }
}

export class GainNode extends AudioNode {
  gain: AudioParam;
  constructor(nodeId: number) {
    super(nodeId);
    this.gain = new AudioParam(nodeId, P_GAIN, 1);
  }
}

export class BiquadFilterNode extends AudioNode {
  frequency: AudioParam;
  detune: AudioParam;
  Q: AudioParam;
  gain: AudioParam;

  constructor(nodeId: number) {
    super(nodeId);
    this.frequency = new AudioParam(nodeId, P_FREQUENCY, 350);
    this.detune = new AudioParam(nodeId, P_DETUNE, 0);
    this.Q = new AudioParam(nodeId, P_Q, 1);
    this.gain = new AudioParam(nodeId, P_GAIN, 0);
  }

  /* Filter kind as the engine's numeric encoding: lowpass, highpass,
   * bandpass, lowshelf, highshelf, peaking, notch, allpass. */
  set type(name: string) {
    ffi.audioSetParam(this.nodeId, P_TYPE, filterTypeOf(name));
  }
}

function filterTypeOf(name: string): number {
  if (name === "highpass") return 1;
  if (name === "bandpass") return 2;
  if (name === "lowshelf") return 3;
  if (name === "highshelf") return 4;
  if (name === "peaking") return 5;
  if (name === "notch") return 6;
  if (name === "allpass") return 7;
  return 0;  // lowpass
}

export class DelayNode extends AudioNode {
  delayTime: AudioParam;
  constructor(nodeId: number) {
    super(nodeId);
    this.delayTime = new AudioParam(nodeId, P_DELAY_TIME, 0);
  }
}

export class StereoPannerNode extends AudioNode {
  pan: AudioParam;
  constructor(nodeId: number) {
    super(nodeId);
    this.pan = new AudioParam(nodeId, P_PAN, 0);
  }
}

export class ConstantSourceNode extends AudioScheduledSourceNode {
  offset: AudioParam;
  constructor(nodeId: number) {
    super(nodeId);
    this.offset = new AudioParam(nodeId, P_OFFSET, 1);
  }
}

export class DynamicsCompressorNode extends AudioNode {
  threshold: AudioParam;
  knee: AudioParam;
  ratio: AudioParam;
  attack: AudioParam;
  release: AudioParam;

  constructor(nodeId: number) {
    super(nodeId);
    this.threshold = new AudioParam(nodeId, P_THRESHOLD, -24);
    this.knee = new AudioParam(nodeId, P_KNEE, 30);
    this.ratio = new AudioParam(nodeId, P_RATIO, 12);
    this.attack = new AudioParam(nodeId, P_ATTACK, 0.003);
    this.release = new AudioParam(nodeId, P_RELEASE, 0.25);
  }
}

export class PannerNode extends AudioNode {
  positionX: AudioParam;
  positionY: AudioParam;
  positionZ: AudioParam;

  constructor(nodeId: number) {
    super(nodeId);
    this.positionX = new AudioParam(nodeId, P_POSITION_X, 0);
    this.positionY = new AudioParam(nodeId, P_POSITION_Y, 0);
    this.positionZ = new AudioParam(nodeId, P_POSITION_Z, 0);
  }
}

/** A decoded sample buffer, registered with the engine. */
export class AudioBuffer {
  bufferId = 0;
  length = 0;
  numberOfChannels = 0;
  sampleRate = 0;

  constructor(bufferId: number, frames: number, channels: number, rate: number) {
    this.bufferId = bufferId;
    this.length = frames;
    this.numberOfChannels = channels;
    this.sampleRate = rate;
  }

  get duration(): number {
    return this.sampleRate > 0 ? this.length / this.sampleRate : 0;
  }
}

export class AudioBufferSourceNode extends AudioScheduledSourceNode {
  playbackRate: AudioParam;
  detune: AudioParam;

  constructor(nodeId: number) {
    super(nodeId);
    // The engine exposes playback rate through the frequency slot.
    this.playbackRate = new AudioParam(nodeId, P_FREQUENCY, 1);
    this.detune = new AudioParam(nodeId, P_DETUNE, 0);
  }

  /** Assign before start(), as on the web. */
  set buffer(buf: AudioBuffer) {
    ffi.audioSetNodeBuffer(this.nodeId, buf.bufferId);
  }

  set loop(on: boolean) {
    ffi.audioSetParam(this.nodeId, P_LOOP, on ? 1 : 0);
  }
}

export class WaveShaperNode extends AudioNode {
  /** The transfer curve, as float32 samples in a Buffer. */
  setCurve(curve: Buffer): void {
    ffi.audioSetCurve(this.nodeId, curve);
  }
}

export class AnalyserNode extends AudioNode {}
export class ChannelMergerNode extends AudioNode {}
export class ChannelSplitterNode extends AudioNode {}
export class ConvolverNode extends AudioNode {}
export class IIRFilterNode extends AudioNode {}

/* AudioContext.
 *
 * One per process, created by sg.run (or explicitly in a test). The
 * destination is a real engine node, as on the web.
 */
export class AudioContext {
  destination: AudioNode;
  sampleRate = 0;
  private offline = false;

  /* `latencyHint` is not modelled: SDL takes a buffer size, which is the
   * same knob spelled concretely, and it is passed to init instead. */
  constructor(destinationId: number, sampleRate: number, offline: boolean) {
    this.destination = new AudioNode(destinationId);
    this.sampleRate = sampleRate;
    this.offline = offline;
  }

  /** Seconds of audio rendered: the spec's monotonically rising clock. */
  get currentTime(): number { return ffi.audioTime(); }

  get state(): string { return this.offline ? "suspended" : "running"; }

  suspend(): void { ffi.audioSuspend(1); }
  resume(): void { ffi.audioSuspend(0); }

  createOscillator(): OscillatorNode {
    return new OscillatorNode(ffi.audioCreateNode("oscillator"));
  }
  createGain(): GainNode {
    return new GainNode(ffi.audioCreateNode("gain"));
  }
  createBiquadFilter(): BiquadFilterNode {
    return new BiquadFilterNode(ffi.audioCreateNode("biquadFilter"));
  }
  createDelay(): DelayNode {
    return new DelayNode(ffi.audioCreateNode("delay"));
  }
  createStereoPanner(): StereoPannerNode {
    return new StereoPannerNode(ffi.audioCreateNode("stereoPanner"));
  }
  createConstantSource(): ConstantSourceNode {
    return new ConstantSourceNode(ffi.audioCreateNode("constantSource"));
  }
  createDynamicsCompressor(): DynamicsCompressorNode {
    return new DynamicsCompressorNode(ffi.audioCreateNode("dynamicsCompressor"));
  }
  createPanner(): PannerNode {
    return new PannerNode(ffi.audioCreateNode("panner"));
  }
  createBufferSource(): AudioBufferSourceNode {
    return new AudioBufferSourceNode(ffi.audioCreateNode("bufferSource"));
  }
  createWaveShaper(): WaveShaperNode {
    return new WaveShaperNode(ffi.audioCreateNode("waveShaper"));
  }
  createAnalyser(): AnalyserNode {
    return new AnalyserNode(ffi.audioCreateNode("analyser"));
  }
  createConvolver(): ConvolverNode {
    return new ConvolverNode(ffi.audioCreateNode("convolver"));
  }
  createChannelMerger(): ChannelMergerNode {
    return new ChannelMergerNode(ffi.audioCreateNode("channelMerger"));
  }
  createChannelSplitter(): ChannelSplitterNode {
    return new ChannelSplitterNode(ffi.audioCreateNode("channelSplitter"));
  }
  createIIRFilter(): IIRFilterNode {
    return new IIRFilterNode(ffi.audioCreateNode("IIRFilter"));
  }

  /** Registers float32 PCM as a playable buffer. */
  createBuffer(samples: Buffer, frames: number, channels: number): AudioBuffer | null {
    const id = ffi.audioRegisterBuffer(samples, frames, channels);
    if (id < 0) return null;
    return new AudioBuffer(id, frames, channels, this.sampleRate);
  }

  /* Renders `frames` to a 32-bit float WAV. Offline contexts only. The
   * samples never cross the FFI -- bulk float data cannot -- so the result is
   * a file, which is also what makes it byte-comparable with the WASM build. */
  renderToFile(path: string, frames: number): number {
    return ffi.audioRenderOffline(path, frames);
  }
}

/** Opens the audio device and returns a live context. null on failure. */
export function createAudioContext(sampleRate: number, bufferFrames: number): AudioContext | null {
  if (ffi.audioInit(sampleRate, bufferFrames) !== 0) return null;
  const dest = ffi.audioCreateNode("destination");
  if (dest < 0) return null;
  return new AudioContext(dest, ffi.audioRate(), false);
}

/** A context with NO device, for tests and faster-than-realtime rendering. */
export function createOfflineAudioContext(sampleRate: number, channels: number): AudioContext | null {
  if (ffi.audioInitOffline(sampleRate, channels) !== 0) return null;
  const dest = ffi.audioCreateNode("destination");
  if (dest < 0) return null;
  return new AudioContext(dest, ffi.audioRate(), true);
}

export function closeAudio(): void { ffi.audioQuit(); }
