/* An optional fixed-step game loop.
 *
 * OPTIONAL is the important word. This is a convenience, not a requirement:
 * `examples/minimal` calls requestAnimationFrame directly and never touches
 * this file. Nothing in web/ or host/ imports it. A game that wants a
 * different loop writes a different loop.
 *
 * It is built entirely on the web globals a browser already provides, so it
 * runs unchanged in a page. There is no privileged access here.
 *
 * ## Why fixed-step
 *
 * The naive loop, `update(dt)` straight off the rAF timestamp, ties physics
 * to framerate: the same game behaves differently at 60Hz and 144Hz, and a
 * single long frame can tunnel a fast object through a wall. A fixed
 * timestep decouples them. Simulation always advances in equal slices,
 * whatever the display does.
 *
 * The cost is that a frame rarely lands on an exact slice boundary, so the
 * renderer is handed `alpha`: how far between the last two simulation steps
 * this frame falls, 0..1. Interpolating position by alpha removes the
 * stutter that otherwise shows up as uneven motion.
 *
 * ## Frames are not updates
 *
 * `update` runs on WALL-CLOCK time, not once per frame. An uncapped loop
 * (SG_NO_VSYNC, or a headless run with the dummy video driver) renders
 * thousands of frames per second at ~0.18ms each, so ~90 frames pass
 * between simulation steps and a 400-frame capture shows a game that has
 * barely moved. That is the fixed timestep working, not a stall. A headless
 * test that needs N updates must budget roughly N * step MILLISECONDS, not
 * N frames.
 */
import { requestAnimationFrame } from "../web/globals.js";

export class LoopOptions {
  /** Simulation slice, in ms. 1000/60 by default. */
  step: number = 1000 / 60;
  /** Fixed-rate simulation. `step` is always the same value. */
  update: (step: number) => void = () => {};
  /** Draw. `alpha` is 0..1 between the last two updates; interpolate with it. */
  render: (alpha: number) => void = () => {};
}

/* Two clamps guard the loop against a stall, and they do different jobs.
 *
 * A long pause (a breakpoint, a window drag, a tab in the background) produces
 * one enormous delta. Fed in raw, that becomes hundreds of catch-up updates,
 * which take longer than a frame, which grows the next delta: the classic
 * spiral of death, where the game locks up chasing a debt it cannot pay.
 *
 * MAX_DELTA discards the bulk of the pause up front. MAX_STEPS bounds the work
 * even so, because `step` may be small enough that MAX_DELTA still implies
 * more updates than a frame can afford. Past the cap the remaining time is
 * dropped: the simulation slips rather than freezing, which is the right
 * trade for a game. */
const MAX_DELTA = 250;
const MAX_STEPS = 8;

/** Starts a fixed-step loop. Runs until the host exits. */
export function createGameLoop(opts: LoopOptions): void {
  const step = opts.step > 0 ? opts.step : 1000 / 60;
  let last = 0;
  let accumulator = 0;

  function frame(time: number): void {
    // The first rAF has no previous timestamp, in a browser too, so seed the
    // clock with one nominal step instead of differencing against zero.
    let delta = last === 0 ? step : time - last;
    last = time;
    if (delta > MAX_DELTA) delta = MAX_DELTA;

    accumulator += delta;
    let steps = 0;
    while (accumulator >= step && steps < MAX_STEPS) {
      opts.update(step);
      accumulator -= step;
      steps += 1;
    }
    if (steps >= MAX_STEPS) accumulator = 0;   // drop the unpayable debt

    opts.render(accumulator / step);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
