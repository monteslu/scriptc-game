/* Live-device smoke test: opens the real audio device, plays a short arpeggio,
 * and reports the engine's clock so a silent failure is distinguishable from
 * a working device the tester simply cannot hear.
 *
 * Not part of scripts/test.sh: it needs a sound card and makes noise.
 * Run it by hand when audio hardware changes.
 */
import * as ffi from "../runtime/ffi.js";
import { createAudioContext, closeAudio } from "../runtime/audio/context.js";
import { blip, pickup, hit, dash, gameOver } from "../runtime/audio/sfx.js";

function main(): void {
  const ctx = createAudioContext(48000, 1024);
  if (ctx === null) { console.log("FATAL: no audio device"); process.exit(1); }
  console.log(`device open: ${ctx.sampleRate}Hz, ${ffi.audioChannels()}ch`);

  const t0 = ctx.currentTime;
  console.log("playing: blip, pickup, dash, hit, game over");

  blip(ctx, 440, 0.2, 0.3, "sine");
  ffi.delay(350);
  pickup(ctx, 0.3);
  ffi.delay(350);
  dash(ctx, 0.25);
  ffi.delay(350);
  hit(ctx, 0.4);
  ffi.delay(500);
  gameOver(ctx, 0.3);
  ffi.delay(900);

  const elapsed = ctx.currentTime - t0;
  console.log(`engine clock advanced ${elapsed.toFixed(3)}s`);
  console.log(`commands dropped: ${ffi.audioDropped()}`);

  /* The clock only advances when the callback runs, so this distinguishes
   * "the device is silent" from "the device never started". */
  const ok = elapsed > 2.0 && ffi.audioDropped() === 0;
  console.log(ok ? "audio thread is running" : "PROBLEM: clock did not advance");
  closeAudio();
  process.exit(ok ? 0 : 1);
}

main();
