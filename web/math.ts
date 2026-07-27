/* `Math`, complete.
 *
 * The static tier keeps only the Math functions that lower to an instruction
 * or a comparison -- abs, floor, ceil, round, trunc, min, max, sign -- and
 * FENCES every transcendental one (SC2012: "runs in the embedded dynamic
 * engine, which this build does not include"). `Math.PI` is fenced too.
 *
 * A game should not have to know which half is which, so this module carries
 * the whole surface: the fenced calls cross to libm, the rest pass straight
 * through. Import it under the standard name and game code is just browser
 * code:
 *
 *     import { Math } from "scriptc-game/web";
 *     const d = Math.sqrt(dx * dx + dy * dy);
 *
 * In a browser the import resolves to a module that re-exports the real
 * global, so the same source runs unchanged.
 */
import * as ffi from "../host/ffi.js";

class MathShim {
  readonly PI = 3.141592653589793;
  readonly E = 2.718281828459045;
  readonly LN2 = 0.6931471805599453;
  readonly LN10 = 2.302585092994046;
  readonly LOG2E = 1.4426950408889634;
  readonly LOG10E = 0.4342944819032518;
  readonly SQRT2 = 1.4142135623730951;
  readonly SQRT1_2 = 0.7071067811865476;

  /* ---- fenced in the static tier: these cross to libm ---- */
  sqrt(x: number): number { return ffi.mathSqrt(x); }
  sin(x: number): number { return ffi.mathSin(x); }
  cos(x: number): number { return ffi.mathCos(x); }
  tan(x: number): number { return ffi.mathTan(x); }
  asin(x: number): number { return ffi.mathAsin(x); }
  acos(x: number): number { return ffi.mathAcos(x); }
  atan(x: number): number { return ffi.mathAtan(x); }
  atan2(y: number, x: number): number { return ffi.mathAtan2(y, x); }
  pow(x: number, y: number): number { return ffi.mathPow(x, y); }
  exp(x: number): number { return ffi.mathExp(x); }
  log(x: number): number { return ffi.mathLog(x); }
  log2(x: number): number { return ffi.mathLog2(x); }
  log10(x: number): number { return ffi.mathLog10(x); }
  hypot(x: number, y: number): number { return ffi.mathHypot(x, y); }
  cbrt(x: number): number { return ffi.mathPow(x, 1 / 3); }

  /* ---- native in the static tier: pass straight through ---- */
  abs(x: number): number { return x < 0 ? -x : x; }
  floor(x: number): number { return Math.floor(x); }
  ceil(x: number): number { return Math.ceil(x); }
  round(x: number): number { return Math.round(x); }
  trunc(x: number): number { return Math.trunc(x); }
  min(a: number, b: number): number { return a < b ? a : b; }
  max(a: number, b: number): number { return a > b ? a : b; }
  sign(x: number): number { return x < 0 ? -1 : (x > 0 ? 1 : 0); }

  /* Math.random is unavailable and deliberately NOT faked with a fixed seed:
   * a game silently getting the same "random" sequence every run is worse
   * than a compile error pointing at the gap. Seed your own PRNG -- see
   * examples/dodge/main.ts for a four-line xorshift32. */
}

/** Import as `Math` to shadow the built-in with the complete surface. */
export const SgMath = new MathShim();
