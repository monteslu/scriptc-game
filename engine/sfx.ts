/* Small synthesised sound effects.
 *
 * Games need blips, not sample libraries, and a synthesised effect ships as
 * a few numbers rather than a .wav. Each one builds a tiny graph, schedules
 * an envelope, and stops itself; the nodes are left for the engine to reap
 * when the source ends.
 *
 * Everything is scheduled against `ctx.currentTime` rather than fired
 * immediately, because the audio thread renders ahead: "now" on the main
 * thread is already in the past for the mixer, and scheduling is what keeps
 * an envelope's shape intact.
 */
import { AudioContext } from "../web/globals.js";

/** A short pitched blip: coins, pickups, UI clicks. */
export function blip(ctx: AudioContext, freq: number, durationSec: number,
                     volume: number, wave: string): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, t);
  // A percussive envelope: instant attack, exponential decay. Exponential
  // rather than linear because loudness is perceived logarithmically, so a
  // linear fade sounds like it stops abruptly.
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + durationSec);
}

/** A rising two-tone chirp: pickups, rewards. */
export function pickup(ctx: AudioContext, volume: number): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.setValueAtTime(990, t + 0.06);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.17);
}

/** A falling buzz: damage, errors, failure. */
export function hit(ctx: AudioContext, volume: number): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.28);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1200, t);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.31);
}

/** A short noise-like whoosh, from a fast frequency sweep. */
export function dash(ctx: AudioContext, volume: number): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.12);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(800, t);
  filter.Q.setValueAtTime(2, t);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.15);
}

/** A descending three-note motif for game over. */
export function gameOver(ctx: AudioContext, volume: number): void {
  const notes: number[] = [523.25, 415.30, 311.13];   // C5, G#4, D#4
  for (let i = 0; i < notes.length; i++) {
    const t = ctx.currentTime + i * 0.16;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(notes[i], t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.31);
  }
}
