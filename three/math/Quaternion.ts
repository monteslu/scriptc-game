/* Quaternion.
 *
 * API-compatible with three.js. Rotations are stored as quaternions rather
 * than Euler angles for the reason every 3D engine does: they compose
 * without gimbal lock and interpolate smoothly.
 *
 * `Object3D.quaternion` is the authoritative rotation; Euler is a
 * convenience view onto it.
 */
import { Math as M } from "../../web/globals.js";
import { Vector3 } from "./Vector3.js";

export class Quaternion {
  x = 0;
  y = 0;
  z = 0;
  w = 1;

  /** Defaults to the identity rotation, as in three. */
  constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  set(x: number, y: number, z: number, w: number): Quaternion {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(q: Quaternion): Quaternion {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    return this;
  }

  clone(): Quaternion { return new Quaternion(this.x, this.y, this.z, this.w); }

  identity(): Quaternion { return this.set(0, 0, 0, 1); }

  /** Rotation of `angle` radians about a NORMALISED axis. */
  setFromAxisAngle(axis: Vector3, angle: number): Quaternion {
    const half = angle / 2;
    const s = M.sin(half);
    this.x = axis.x * s;
    this.y = axis.y * s;
    this.z = axis.z * s;
    this.w = M.cos(half);
    return this;
  }

  /* Euler angles in three's default XYZ order.
   *
   * Order matters: XYZ and ZYX give different rotations for the same three
   * numbers. three defaults to XYZ and so does this. */
  setFromEuler(x: number, y: number, z: number): Quaternion {
    const c1 = M.cos(x / 2); const c2 = M.cos(y / 2); const c3 = M.cos(z / 2);
    const s1 = M.sin(x / 2); const s2 = M.sin(y / 2); const s3 = M.sin(z / 2);
    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 + s1 * s2 * c3;
    this.w = c1 * c2 * c3 - s1 * s2 * s3;
    return this;
  }

  multiply(q: Quaternion): Quaternion {
    return this.multiplyQuaternions(this, q);
  }

  premultiply(q: Quaternion): Quaternion {
    return this.multiplyQuaternions(q, this);
  }

  multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
    // Read before writing: a or b may be this.
    const ax = a.x; const ay = a.y; const az = a.z; const aw = a.w;
    const bx = b.x; const by = b.y; const bz = b.z; const bw = b.w;
    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  length(): number { return M.sqrt(this.lengthSq()); }

  normalize(): Quaternion {
    const l = this.length();
    if (l === 0) return this.identity();
    const inv = 1 / l;
    this.x *= inv;
    this.y *= inv;
    this.z *= inv;
    this.w *= inv;
    return this;
  }

  /** The opposite rotation. Valid for unit quaternions, which these are. */
  invert(): Quaternion {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }

  dot(q: Quaternion): number {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }

  /* Spherical linear interpolation.
   *
   * Falls back to a straight lerp when the two are nearly parallel: the
   * slerp formula divides by sin(theta), which goes to zero there. */
  slerp(q: Quaternion, t: number): Quaternion {
    if (t === 0) return this;
    if (t === 1) return this.copy(q);

    const x = this.x; const y = this.y; const z = this.z; const w = this.w;
    let cosHalfTheta = w * q.w + x * q.x + y * q.y + z * q.z;

    // Take the shorter arc: q and -q are the same rotation.
    let qx = q.x; let qy = q.y; let qz = q.z; let qw = q.w;
    if (cosHalfTheta < 0) {
      cosHalfTheta = -cosHalfTheta;
      qx = -qx; qy = -qy; qz = -qz; qw = -qw;
    }

    if (cosHalfTheta >= 1.0) {
      return this;
    }

    const sqrSinHalfTheta = 1.0 - cosHalfTheta * cosHalfTheta;
    if (sqrSinHalfTheta <= 0.000001) {
      const s = 1 - t;
      this.w = s * w + t * qw;
      this.x = s * x + t * qx;
      this.y = s * y + t * qy;
      this.z = s * z + t * qz;
      return this.normalize();
    }

    const sinHalfTheta = M.sqrt(sqrSinHalfTheta);
    const halfTheta = M.atan2(sinHalfTheta, cosHalfTheta);
    const ratioA = M.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = M.sin(t * halfTheta) / sinHalfTheta;

    this.w = w * ratioA + qw * ratioB;
    this.x = x * ratioA + qx * ratioB;
    this.y = y * ratioA + qy * ratioB;
    this.z = z * ratioA + qz * ratioB;
    return this;
  }

  equals(q: Quaternion): boolean {
    return this.x === q.x && this.y === q.y && this.z === q.z && this.w === q.w;
  }

  fromArray(a: number[], offset: number = 0): Quaternion {
    this.x = a[offset];
    this.y = a[offset + 1];
    this.z = a[offset + 2];
    this.w = a[offset + 3];
    return this;
  }

  toArray(a: number[], offset: number = 0): number[] {
    a[offset] = this.x;
    a[offset + 1] = this.y;
    a[offset + 2] = this.z;
    a[offset + 3] = this.w;
    return a;
  }
}
