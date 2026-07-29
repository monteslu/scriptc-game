/* MathUtils: three's small numeric helpers.
 *
 * Exported as plain functions rather than as a `MathUtils` namespace object,
 * because the dialect resolves imported functions statically and a const
 * object of function properties would be a dynamic lookup. Game code writes
 * `import { clamp, degToRad } from ".../MathUtils.js"`, which is how three's
 * own ESM build is consumed anyway.
 */
import { Math as M } from "../../web/globals.js";

export const DEG2RAD = M.PI / 180;
export const RAD2DEG = 180 / M.PI;

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function degToRad(degrees: number): number {
  return degrees * DEG2RAD;
}

export function radToDeg(radians: number): number {
  return radians * RAD2DEG;
}

/** Linear interpolation. `t` is not clamped, matching three. */
export function lerp(x: number, y: number, t: number): number {
  return x + (y - x) * t;
}

/* Smooth Hermite interpolation between two edges, 0 below and 1 above. The
 * classic smoothstep, used for fades and soft thresholds. */
export function smoothstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const t = (x - min) / (max - min);
  return t * t * (3 - 2 * t);
}

export function smootherstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const t = (x - min) / (max - min);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Wrap into [min, max), the way three's euclideanModulo-based version does. */
export function mapLinear(x: number, a1: number, a2: number,
                          b1: number, b2: number): number {
  return b1 + (x - a1) * (b2 - b1) / (a2 - a1);
}

export function euclideanModulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** True when `value` is a power of two, which texture sizing cares about. */
export function isPowerOfTwo(value: number): boolean {
  return (value & (value - 1)) === 0 && value !== 0;
}

export function ceilPowerOfTwo(value: number): number {
  let p = 1;
  while (p < value) p = p * 2;
  return p;
}

export function floorPowerOfTwo(value: number): number {
  let p = 1;
  while (p * 2 <= value) p = p * 2;
  return p;
}

/* Framerate-independent damping.
 *
 * three's `damp`: an exponential approach that gives the same result for a
 * given elapsed time whatever the frame rate, unlike a raw `lerp(a, b, 0.1)`
 * per frame which moves faster when frames are shorter. */
export function damp(x: number, y: number, lambda: number, dt: number): number {
  return lerp(x, y, 1 - M.exp(-lambda * dt));
}
