/* Vector4. Same conventions as Vector3: mutate and return this, module
 * scratch instead of allocation, signatures matching three's.
 *
 * Mostly used for homogeneous coordinates and for anything that wants a
 * plane or an RGBA-shaped value as one object.
 */
import { Math as M } from "../../web/globals.js";
import { Matrix4Like } from "./Vector3.js";

export class Vector4 {
  readonly isVector4 = true;

  x = 0;
  y = 0;
  z = 0;
  w = 1;

  /* w defaults to 1, as in three: a Vector4 used as a POSITION is the
   * common case, and w=1 is what makes a matrix multiply translate it. */
  constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  set(x: number, y: number, z: number, w: number): Vector4 {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(v: Vector4): Vector4 {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this.w = v.w;
    return this;
  }

  clone(): Vector4 {
    return new Vector4(this.x, this.y, this.z, this.w);
  }

  add(v: Vector4): Vector4 {
    this.x = this.x + v.x;
    this.y = this.y + v.y;
    this.z = this.z + v.z;
    this.w = this.w + v.w;
    return this;
  }

  sub(v: Vector4): Vector4 {
    this.x = this.x - v.x;
    this.y = this.y - v.y;
    this.z = this.z - v.z;
    this.w = this.w - v.w;
    return this;
  }

  multiplyScalar(s: number): Vector4 {
    this.x = this.x * s;
    this.y = this.y * s;
    this.z = this.z * s;
    this.w = this.w * s;
    return this;
  }

  dot(v: Vector4): number {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  length(): number {
    return M.sqrt(this.lengthSq());
  }

  normalize(): Vector4 {
    const len = this.length();
    if (len === 0) return this;
    return this.multiplyScalar(1 / len);
  }

  /** Full 4x4 transform, column-major as everywhere else here. */
  applyMatrix4(m: Matrix4Like): Vector4 {
    const x = this.x, y = this.y, z = this.z, w = this.w;
    const e = m.elements;
    this.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
    this.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
    this.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
    this.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;
    return this;
  }

  equals(v: Vector4): boolean {
    return v.x === this.x && v.y === this.y && v.z === this.z && v.w === this.w;
  }
}
