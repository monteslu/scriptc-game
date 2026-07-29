/* Audio verification: render known graphs offline and check the samples.
 *
 * Offline, not live: a device render depends on a sound card, a mixer, and
 * a human ear, none of which a test has. Rendering to a float WAV checks the
 * part that can actually be wrong -- graph wiring, parameter ids, scheduling,
 * node behaviour -- and produces a file the parity test can compare against
 * the WASM build byte for byte.
 *
 * Usage: audiotest <outDir>
 */
import * as ffi from "../host/ffi.js";
import { readFileSync } from "node:fs";
import {
  OfflineAudioContext, closeAudio, AudioContext,
} from "../web/audio/context.js";

let failures = 0;
let checks = 0;

function check(ok: boolean, what: string): void {
  checks += 1;
  if (!ok) { console.log(`FAIL: ${what}`); failures += 1; }
}

const RATE = 48000;
const FRAMES = 4800;   // 0.1s

/** Reads a 32-bit float WAV and reports peak / mean magnitude. */
class WavStats {
  peak = 0;
  meanAbs = 0;
  samples = 0;
  /** Zero crossings, which is how a pitch is checked without an FFT. */
  crossings = 0;
}

function statsOf(path: string): WavStats {
  const st = new WavStats();
  const buf = readFileSync(path);
  // 44-byte canonical header, then interleaved float32.
  const count = (buf.length - 44) / 4;
  let sum = 0;
  let prev = 0;
  for (let i = 0; i < count; i++) {
    const o = 44 + i * 4;
    // Little-endian float32 by hand: no DataView in the static tier.
    const b0 = buf[o];
    const b1 = buf[o + 1];
    const b2 = buf[o + 2];
    const b3 = buf[o + 3];
    const bits = (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
    const v = f32FromBits(bits >>> 0);
    const a = v < 0 ? -v : v;
    if (a > st.peak) st.peak = a;
    sum += a;
    // Count crossings on the left channel only (stride 2).
    if (i % 2 === 0) {
      if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) st.crossings += 1;
      prev = v;
    }
  }
  st.samples = count;
  st.meanAbs = count > 0 ? sum / count : 0;
  return st;
}

/** Peak magnitude AFTER the first `skipFrames` frames (2ch float32 WAV). */
function tailPeakOf(path: string, skipFrames: number): number {
  const buf = readFileSync(path);
  let peak = 0;
  for (let o = 44 + skipFrames * 2 * 4; o + 3 < buf.length; o += 4) {
    const bits = ((buf[o + 3] << 24) | (buf[o + 2] << 16) | (buf[o + 1] << 8) | buf[o]) >>> 0;
    const v = f32FromBits(bits);
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  return peak;
}

/** IEEE-754 single from its bit pattern. */
function f32FromBits(bits: number): number {
  const sign = (bits >>> 31) !== 0 ? -1 : 1;
  const exp = (bits >>> 23) & 0xff;
  const frac = bits & 0x7fffff;
  if (exp === 0) return sign * frac * 1.4012984643248171e-45;
  if (exp === 255) return frac === 0 ? sign * 1e308 * 10 : 0;
  // (1 + frac/2^23) * 2^(exp-127), without Math.pow.
  let m = 1 + frac / 8388608;
  let e = exp - 127;
  while (e > 0) { m *= 2; e -= 1; }
  while (e < 0) { m /= 2; e += 1; }
  return sign * m;
}

function main(): void {
  const args = process.argv;
  const outDir = args.length > 2 ? args[2] : "test/out";

  const ctx = OfflineAudioContext.create(2, 0, RATE);
  if (ctx === null) { console.log("FATAL: offline context"); process.exit(2); }
  console.log(`offline context: ${ctx.sampleRate}Hz`);
  check(ctx.sampleRate === RATE, `sample rate is ${ctx.sampleRate}, want ${RATE}`);

  /* ---- 1. silence: nothing connected renders nothing ----
   * The control. If this is not silent, every other check is meaningless
   * because something is leaking into the output. */
  const silencePath = `${outDir}/audio-silence.wav`;
  check(ctx.renderToFile(silencePath, FRAMES) === 0, "silence rendered");
  const silence = statsOf(silencePath);
  check(silence.peak === 0, `silence peak is ${silence.peak}, want 0`);
  console.log(`silence: peak=${silence.peak} samples=${silence.samples}`);

  /* ---- 2. a 440Hz sine through a gain ---- */
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 440;
  gain.gain.value = 0.5;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(0);

  const tonePath = `${outDir}/audio-tone.wav`;
  check(ctx.renderToFile(tonePath, FRAMES) === 0, "tone rendered");
  const tone = statsOf(tonePath);
  console.log(`tone: peak=${tone.peak.toFixed(4)} mean=${tone.meanAbs.toFixed(4)} crossings=${tone.crossings}`);

  // A 0.5-gain sine peaks at 0.5 and averages 2/pi of that (~0.318).
  check(tone.peak > 0.45 && tone.peak <= 0.51, `tone peak ${tone.peak}, want ~0.5`);
  check(tone.meanAbs > 0.25 && tone.meanAbs < 0.36, `tone mean ${tone.meanAbs}, want ~0.32`);

  /* 440Hz over 0.1s is 44 cycles = 88 zero crossings. This is what catches a
   * frequency parameter that went to the wrong slot: amplitude would still
   * look perfect. */
  check(tone.crossings >= 86 && tone.crossings <= 90,
        `${tone.crossings} zero crossings, want ~88 for 440Hz over 0.1s`);

  /* ---- 3. gain actually attenuates ---- */
  gain.gain.value = 0.1;
  const quietPath = `${outDir}/audio-quiet.wav`;
  check(ctx.renderToFile(quietPath, FRAMES) === 0, "quiet rendered");
  const quiet = statsOf(quietPath);
  console.log(`quiet: peak=${quiet.peak.toFixed(4)}`);
  check(quiet.peak > 0.08 && quiet.peak < 0.12, `quiet peak ${quiet.peak}, want ~0.1`);
  check(quiet.peak < tone.peak * 0.5, "lowering gain lowered the output");

  /* ---- 4. frequency reaches the oscillator ----
   * 880Hz must double the crossings. Same amplitude, different pitch: only a
   * correct frequency param can produce this. */
  gain.gain.value = 0.5;
  osc.frequency.value = 880;
  const highPath = `${outDir}/audio-880.wav`;
  check(ctx.renderToFile(highPath, FRAMES) === 0, "880Hz rendered");
  const high = statsOf(highPath);
  console.log(`880Hz: peak=${high.peak.toFixed(4)} crossings=${high.crossings}`);
  check(high.crossings >= 174 && high.crossings <= 178,
        `${high.crossings} crossings at 880Hz, want ~176 (double 440)`);

  /* ---- 5. disconnect actually removes the edge ----
   *
   * webaudio-node's disconnectNodes was a no-op stub until this project
   * implemented it upstream; this check is what proved the fix. */
  gain.disconnect(ctx.destination);
  const cutPath = `${outDir}/audio-disconnected.wav`;
  check(ctx.renderToFile(cutPath, FRAMES) === 0, "disconnected rendered");
  const cut = statsOf(cutPath);
  console.log(`after disconnect(): peak=${cut.peak}`);
  check(cut.peak === 0, `disconnected peak is ${cut.peak}, want 0`);

  /* ---- 6. gain 0 also silences ----
   * The gentler option a game should prefer mid-playback: an abrupt
   * disconnect clicks, a ramp to zero does not. */
  gain.connect(ctx.destination);
  gain.gain.value = 0;
  const mutedPath = `${outDir}/audio-muted.wav`;
  check(ctx.renderToFile(mutedPath, FRAMES) === 0, "muted rendered");
  const muted = statsOf(mutedPath);
  console.log(`gain 0: peak=${muted.peak}`);
  check(muted.peak === 0, `muted peak is ${muted.peak}, want 0`);

  /* ---- 7. buffer source loop ----
   *
   * Same story as disconnect (check 5): the engine's setNodeParameter
   * dropped PARAM_LOOP on the floor until this project implemented it
   * upstream, so `src.loop = true` played once and went silent -- which is
   * exactly how station's music behaved. A DC-1 clip of 0.01s rendered into
   * 0.1s: the tail past the clip must be silent unlooped and loud looped. */
  const LOOP_FRAMES = 480;                       // 0.01s of source material
  const pcm = Buffer.alloc(LOOP_FRAMES * 2 * 4); // 2ch interleaved float32
  for (let i = 0; i < LOOP_FRAMES * 2; i++) pcm.writeFloatLE(1.0, i * 4);
  const clip = ctx.createBuffer(pcm, LOOP_FRAMES, 2);
  check(clip !== null, "PCM clip registered");
  if (clip !== null) {
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(ctx.destination);

    const once = ctx.createBufferSource();
    once.buffer = clip;
    once.connect(bus);
    once.start(0);
    const oncePath = `${outDir}/audio-once.wav`;
    check(ctx.renderToFile(oncePath, FRAMES) === 0, "one-shot rendered");
    const onceStats = statsOf(oncePath);
    const onceTail = tailPeakOf(oncePath, LOOP_FRAMES * 2);
    console.log(`one-shot: peak=${onceStats.peak.toFixed(4)} tail=${onceTail}`);
    check(onceStats.peak > 0.9, `one-shot peak ${onceStats.peak}, want ~1`);
    check(onceTail === 0, `one-shot tail peak ${onceTail}, want 0 (no loop)`);

    const looped = ctx.createBufferSource();
    looped.buffer = clip;
    looped.loop = true;
    looped.connect(bus);
    looped.start(0);
    const loopPath = `${outDir}/audio-looped.wav`;
    check(ctx.renderToFile(loopPath, FRAMES) === 0, "looped rendered");
    const loopTail = tailPeakOf(loopPath, LOOP_FRAMES * 2);
    console.log(`looped: tail=${loopTail.toFixed(4)}`);
    check(loopTail > 0.9,
          `looped tail peak ${loopTail}, want ~1: loop flag reached the engine`);
  }

  closeAudio();
  console.log(`\naudio test: ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
