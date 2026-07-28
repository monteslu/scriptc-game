/* Euler angles, XYZ order.
 *
 * API-compatible with three, with one deliberate narrowing: three supports
 * six rotation orders selected by a string ("XYZ", "YZX", ...), and this
 * supports XYZ only, which is three's default and what game code uses.
 * The `order` field exists and reports "XYZ" so reading it works; setting
 * another order is ignored rather than silently producing a different
 * rotation.
 *
 * Object3D.quaternion is authoritative; Euler is the readable view.
 */
import { Math as M } from "../../web/globals.js";

export class Euler {
  x = 0;
  y = 0;
  z = 0;
  /** Always "XYZ" here. See the note above. */
  readonly order: string = "XYZ";

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): Euler {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(e: Euler): Euler { return this.set(e.x, e.y, e.z); }
  clone(): Euler { return new Euler(this.x, this.y, this.z); }

  /* Extract XYZ angles from a rotation matrix.
   *
   * The clamp on m13 matters: floating point can push it a hair outside
   * [-1, 1], and asin of that is NaN, which would propagate into every
   * subsequent transform. */
  setFromRotationMatrix(e: number[]): Euler {
    const m11 = e[0]; const m12 = e[4]; const m13 = e[8];
    const m22 = e[5]; const m23 = e[9];
    const m32 = e[6]; const m33 = e[10];

    const clamped = m13 < -1 ? -1 : (m13 > 1 ? 1 : m13);
    this.y = M.asin(clamped);
    if (M.abs(m13) < 0.9999999) {
      this.x = M.atan2(-m23, m33);
      this.z = M.atan2(-m12, m11);
    } else {
      // Gimbal lock: y is +/-90 degrees and x/z are not separable.
      this.x = M.atan2(m32, m22);
      this.z = 0;
    }
    return this;
  }

  equals(e: Euler): boolean {
    return this.x === e.x && this.y === e.y && this.z === e.z;
  }
}
