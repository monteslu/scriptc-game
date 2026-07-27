/* Math the static tier does not have.
 *
 * scriptc keeps only the Math functions that lower to an instruction or a
 * comparison: `abs`, `floor`, `ceil`, `round`, `trunc`, `min`, `max`. Those
 * work as normal `Math.*` calls and are NOT wrapped here.
 *
 * Everything transcendental -- sqrt, sin, cos, tan, the inverse trig, pow,
 * exp, log, hypot, fmod -- is fenced with SC2012 ("runs in the embedded
 * dynamic engine, which this build does not include"). Using them would mean
 * `--dynamic` and a ~620KB interpreter in every binary, which the project
 * bans. They cross to libm instead, at roughly the cost of the libm call.
 *
 * Also here: PI and friends, since `Math.PI` is fenced too.
 */
import * as ffi from "../host/ffi.js";

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const E = 2.718281828459045;
export const DEG_TO_RAD = 0.017453292519943295;
export const RAD_TO_DEG = 57.29577951308232;

export function sqrt(x: number): number { return ffi.mathSqrt(x); }
export function sin(x: number): number { return ffi.mathSin(x); }
export function cos(x: number): number { return ffi.mathCos(x); }
export function tan(x: number): number { return ffi.mathTan(x); }
export function asin(x: number): number { return ffi.mathAsin(x); }
export function acos(x: number): number { return ffi.mathAcos(x); }
export function atan(x: number): number { return ffi.mathAtan(x); }
export function atan2(y: number, x: number): number { return ffi.mathAtan2(y, x); }
export function pow(x: number, y: number): number { return ffi.mathPow(x, y); }
export function exp(x: number): number { return ffi.mathExp(x); }
export function log(x: number): number { return ffi.mathLog(x); }
export function log2(x: number): number { return ffi.mathLog2(x); }
export function log10(x: number): number { return ffi.mathLog10(x); }
export function hypot(x: number, y: number): number { return ffi.mathHypot(x, y); }
export function fmod(x: number, y: number): number { return ffi.mathFmod(x, y); }

/** Vector length. One FFI call, not two: hypot also avoids overflow. */
export function length(x: number, y: number): number { return ffi.mathHypot(x, y); }

/** Squared length. NO FFI call, and the right choice for comparisons. */
export function lengthSq(x: number, y: number): number { return x * x + y * y; }

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamps v into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
