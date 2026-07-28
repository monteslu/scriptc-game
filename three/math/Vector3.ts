/* Vector3.
 *
 * API-COMPATIBLE with three.js, deliberately. The goal is that a project can
 * swap this for three (or the reverse) without touching game code, so every
 * signature here matches three's: default constructor arguments,
 * `applyMatrix4(m)` taking the matrix rather than its array, chaining that
 * returns `this`. Where a method is missing it is simply not written yet,
 * never renamed or re-shaped.
 *
 * The IMPLEMENTATION is from scratch for this dialect (three is ~150k lines
 * of `any`, dynamic property access and generic containers that the static
 * tier cannot compile). The surface is the contract; the insides are ours.
 *
 * Two rules from three that are worth keeping and are followed throughout
 * this folder:
 *
 *   1. MUTATE AND RETURN THIS. `a.add(b)` changes `a`. Allocation in a
 *      render loop is the thing to avoid, so the API is built around
 *      reusing vectors rather than producing new ones.
 *   2. Methods that need a temporary use a module-level scratch, never a
 *      fresh object.
 *
 * Math is f64 here (the dialect's only float) and narrows to f32 at upload,
 * which is what the GL layer does anyway.
 */
import { Math as M } from "../../web/globals.js";

/* What Vector3 needs from a Matrix4, spelled structurally so this file does
 * not import Matrix4 (which imports Vector3: a cycle is SC1016). A real
 * Matrix4 satisfies it, so `v.applyMatrix4(m)` reads exactly as in three. */
export interface Matrix4Like {
  elements: number[];
}

export class Vector3 {
  x = 0;
  y = 0;
  z = 0;

  /* Defaults match three: `new Vector3()` is the origin. Verified the
   * dialect supports default parameters (spike/defaults.ts) rather than
   * assumed. */
  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): Vector3 {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vector3): Vector3 {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vector3 { return new Vector3(this.x, this.y, this.z); }

  add(v: Vector3): Vector3 {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  addVectors(a: Vector3, b: Vector3): Vector3 {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    return this;
  }

  addScaledVector(v: Vector3, s: number): Vector3 {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  sub(v: Vector3): Vector3 {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  subVectors(a: Vector3, b: Vector3): Vector3 {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  multiplyScalar(s: number): Vector3 {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  divideScalar(s: number): Vector3 {
    return this.multiplyScalar(s === 0 ? 0 : 1 / s);
  }

  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vector3): Vector3 {
    return this.crossVectors(this, v);
  }

  crossVectors(a: Vector3, b: Vector3): Vector3 {
    // Read all six components BEFORE writing: a or b may be `this`.
    const ax = a.x; const ay = a.y; const az = a.z;
    const bx = b.x; const by = b.y; const bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number { return M.sqrt(this.lengthSq()); }

  /** Distance without the square root: fine for comparisons. */
  distanceToSquared(v: Vector3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  distanceTo(v: Vector3): number { return M.sqrt(this.distanceToSquared(v)); }

  normalize(): Vector3 { return this.divideScalar(this.length()); }

  negate(): Vector3 {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  lerp(v: Vector3, alpha: number): Vector3 {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    return this;
  }

  equals(v: Vector3): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }

  /* Transform by a Matrix4, dividing by w. Takes the MATRIX, as three does:
   * `v.applyMatrix4(m)`. Matrix4 imports Vector3 for its scratch, so this
   * takes the interface rather than the class to avoid the cycle (SC1016);
   * a Matrix4 satisfies it structurally and callers see no difference. */
  applyMatrix4(m: Matrix4Like): Vector3 {
    const e = m.elements;
    const x = this.x; const y = this.y; const z = this.z;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }

  /** The translation column of a Matrix4: where an object sits in world space. */
  setFromMatrixPosition(m: Matrix4Like): Vector3 {
    const e = m.elements;
    this.x = e[12];
    this.y = e[13];
    this.z = e[14];
    return this;
  }

  setScalar(s: number): Vector3 { return this.set(s, s, s); }
  addScalar(s: number): Vector3 { this.x += s; this.y += s; this.z += s; return this; }
  multiply(v: Vector3): Vector3 { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  divide(v: Vector3): Vector3 { this.x /= v.x; this.y /= v.y; this.z /= v.z; return this; }

  setLength(l: number): Vector3 { return this.normalize().multiplyScalar(l); }

  lerpVectors(a: Vector3, b: Vector3, alpha: number): Vector3 {
    this.x = a.x + (b.x - a.x) * alpha;
    this.y = a.y + (b.y - a.y) * alpha;
    this.z = a.z + (b.z - a.z) * alpha;
    return this;
  }

  min(v: Vector3): Vector3 {
    this.x = M.min(this.x, v.x);
    this.y = M.min(this.y, v.y);
    this.z = M.min(this.z, v.z);
    return this;
  }

  max(v: Vector3): Vector3 {
    this.x = M.max(this.x, v.x);
    this.y = M.max(this.y, v.y);
    this.z = M.max(this.z, v.z);
    return this;
  }

  /** The rotation part only: for normals and directions, no translation. */
  transformDirection(m: Matrix4Like): Vector3 {
    const e = m.elements;
    const x = this.x; const y = this.y; const z = this.z;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this.normalize();
  }

  fromArray(a: number[], offset: number = 0): Vector3 {
    this.x = a[offset];
    this.y = a[offset + 1];
    this.z = a[offset + 2];
    return this;
  }

  toArray(a: number[], offset: number = 0): number[] {
    a[offset] = this.x;
    a[offset + 1] = this.y;
    a[offset + 2] = this.z;
    return a;
  }
}

/** A zero vector, for defaults. Never mutate this. */
export const VECTOR3_ZERO = new Vector3(0, 0, 0);
