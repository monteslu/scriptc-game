/* Matrix4, column-major.
 *
 * API-COMPATIBLE with three.js: same method names, same argument shapes,
 * same element layout, so this can be swapped for three without touching
 * callers. Verified against three's own source rather than from memory --
 * makePerspective takes FRUSTUM BOUNDS (left, right, top, bottom, near,
 * far), not fov and aspect; PerspectiveCamera is what converts.
 *
 * Column-major because that is what GL wants: `elements[12..14]` is the
 * translation, and the array uploads to `uniformMatrix4fv` untransposed.
 * three uses the same layout for the same reason.
 *
 * Every method mutates and returns `this`, and temporaries come from
 * module-level scratch rather than fresh allocations, because these run
 * per-object per-frame.
 */
import { Math as M } from "../../web/globals.js";
import { Vector3 } from "./Vector3.js";
import { Quaternion } from "./Quaternion.js";

export class Matrix4 {
  /* 16 numbers, column-major:
   *   0  4  8 12
   *   1  5  9 13
   *   2  6 10 14
   *   3  7 11 15  */
  elements: number[] = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];

  identity(): Matrix4 {
    return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }

  /* Arguments are in ROW-major reading order, which is how a matrix is
   * written on paper, and stored column-major. three does the same, and
   * getting this backwards is the classic silent bug. */
  set(n11: number, n12: number, n13: number, n14: number,
      n21: number, n22: number, n23: number, n24: number,
      n31: number, n32: number, n33: number, n34: number,
      n41: number, n42: number, n43: number, n44: number): Matrix4 {
    const e = this.elements;
    e[0] = n11; e[4] = n12; e[8] = n13; e[12] = n14;
    e[1] = n21; e[5] = n22; e[9] = n23; e[13] = n24;
    e[2] = n31; e[6] = n32; e[10] = n33; e[14] = n34;
    e[3] = n41; e[7] = n42; e[11] = n43; e[15] = n44;
    return this;
  }

  copy(m: Matrix4): Matrix4 {
    const e = this.elements;
    const s = m.elements;
    for (let i = 0; i < 16; i++) e[i] = s[i];
    return this;
  }

  clone(): Matrix4 { return new Matrix4().copy(this); }

  multiply(m: Matrix4): Matrix4 { return this.multiplyMatrices(this, m); }

  premultiply(m: Matrix4): Matrix4 { return this.multiplyMatrices(m, this); }

  multiplyMatrices(a: Matrix4, b: Matrix4): Matrix4 {
    const ae = a.elements;
    const be = b.elements;
    const te = this.elements;

    // Read every input BEFORE writing: `a` or `b` may be `this`.
    const a11 = ae[0]; const a12 = ae[4]; const a13 = ae[8]; const a14 = ae[12];
    const a21 = ae[1]; const a22 = ae[5]; const a23 = ae[9]; const a24 = ae[13];
    const a31 = ae[2]; const a32 = ae[6]; const a33 = ae[10]; const a34 = ae[14];
    const a41 = ae[3]; const a42 = ae[7]; const a43 = ae[11]; const a44 = ae[15];

    const b11 = be[0]; const b12 = be[4]; const b13 = be[8]; const b14 = be[12];
    const b21 = be[1]; const b22 = be[5]; const b23 = be[9]; const b24 = be[13];
    const b31 = be[2]; const b32 = be[6]; const b33 = be[10]; const b34 = be[14];
    const b41 = be[3]; const b42 = be[7]; const b43 = be[11]; const b44 = be[15];

    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

    return this;
  }

  makeTranslation(x: number, y: number, z: number): Matrix4 {
    return this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1);
  }

  makeScale(x: number, y: number, z: number): Matrix4 {
    return this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1);
  }

  makeRotationX(theta: number): Matrix4 {
    const c = M.cos(theta);
    const s = M.sin(theta);
    return this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1);
  }

  makeRotationY(theta: number): Matrix4 {
    const c = M.cos(theta);
    const s = M.sin(theta);
    return this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1);
  }

  makeRotationZ(theta: number): Matrix4 {
    const c = M.cos(theta);
    const s = M.sin(theta);
    return this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }

  /** Compose position, rotation and scale into one matrix: the TRS a scene
   * graph node needs every frame. */
  compose(position: Vector3, quaternion: Quaternion, scale: Vector3): Matrix4 {
    const te = this.elements;
    const x = quaternion.x; const y = quaternion.y;
    const z = quaternion.z; const w = quaternion.w;
    const x2 = x + x; const y2 = y + y; const z2 = z + z;
    const xx = x * x2; const xy = x * y2; const xz = x * z2;
    const yy = y * y2; const yz = y * z2; const zz = z * z2;
    const wx = w * x2; const wy = w * y2; const wz = w * z2;

    const sx = scale.x; const sy = scale.y; const sz = scale.z;

    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;

    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;

    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;

    te[12] = position.x;
    te[13] = position.y;
    te[14] = position.z;
    te[15] = 1;

    return this;
  }

  /* The inverse, by cofactors.
   *
   * A singular matrix yields all zeros rather than NaN or a throw: a
   * degenerate transform should make an object vanish, not take the frame
   * down with it. three does the same. */
  invert(): Matrix4 {
    const te = this.elements;
    const n11 = te[0]; const n21 = te[1]; const n31 = te[2]; const n41 = te[3];
    const n12 = te[4]; const n22 = te[5]; const n32 = te[6]; const n42 = te[7];
    const n13 = te[8]; const n23 = te[9]; const n33 = te[10]; const n43 = te[11];
    const n14 = te[12]; const n24 = te[13]; const n34 = te[14]; const n44 = te[15];

    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43
              - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43
              + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43
              - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33
              + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (det === 0) {
      return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
    const d = 1 / det;

    te[0] = t11 * d;
    te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43
           + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
    te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42
           - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
    te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42
           + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;

    te[4] = t12 * d;
    te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43
           - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
    te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42
           + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
    te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42
           - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;

    te[8] = t13 * d;
    te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43
           + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
    te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42
            - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
    te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42
            + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;

    te[12] = t14 * d;
    te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33
            - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
    te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32
            + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
    te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32
            - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;

    return this;
  }

  transpose(): Matrix4 {
    const te = this.elements;
    let tmp = 0;
    tmp = te[1]; te[1] = te[4]; te[4] = tmp;
    tmp = te[2]; te[2] = te[8]; te[8] = tmp;
    tmp = te[6]; te[6] = te[9]; te[9] = tmp;
    tmp = te[3]; te[3] = te[12]; te[12] = tmp;
    tmp = te[7]; te[7] = te[13]; te[13] = tmp;
    tmp = te[11]; te[11] = te[14]; te[14] = tmp;
    return this;
  }

  /* A right-handed perspective projection from FRUSTUM BOUNDS, GL depth
   * convention (-1..1). three's signature, so PerspectiveCamera's
   * updateProjectionMatrix reads identically.
   *
   * Element 11 must be -1: that is what carries -z into w and produces the
   * perspective divide. It is the single most commonly mistyped entry in
   * the matrix. */
  makePerspective(left: number, right: number, top: number, bottom: number,
                  near: number, far: number): Matrix4 {
    const x = 2 * near / (right - left);
    const y = 2 * near / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);
    const c = -(far + near) / (far - near);
    const d = -2 * far * near / (far - near);
    return this.set(
      x, 0, a, 0,
      0, y, b, 0,
      0, 0, c, d,
      0, 0, -1, 0,
    );
  }

  /** three's argument order: left, right, top, bottom, near, far. */
  makeOrthographic(left: number, right: number, top: number, bottom: number,
                   near: number, far: number): Matrix4 {
    const w = 1 / (right - left);
    const h = 1 / (top - bottom);
    const p = 1 / (far - near);
    return this.set(
      2 * w, 0, 0, -(right + left) * w,
      0, 2 * h, 0, -(top + bottom) * h,
      0, 0, -2 * p, -(far + near) * p,
      0, 0, 0, 1,
    );
  }

  /* Look from `eye` at `target`: writes the ROTATION only, leaving the
   * translation column alone, which is what three does. Verified against
   * three's source rather than assumed -- an earlier version wrote the eye
   * position into elements 12..14, which is a different matrix and would
   * have silently broken any code that composed lookAt with a translation.
   *
   * Object3D.lookAt is what combines this with a position. */
  lookAt(eye: Vector3, target: Vector3, up: Vector3): Matrix4 {
    _z.subVectors(eye, target);
    if (_z.lengthSq() === 0) _z.z = 1;        // eye and target coincide
    _z.normalize();

    _x.crossVectors(up, _z);
    if (_x.lengthSq() === 0) {
      // up is parallel to the view direction: nudge it and retry.
      _z.z += 0.0001;
      _z.normalize();
      _x.crossVectors(up, _z);
    }
    _x.normalize();
    _y.crossVectors(_z, _x);

    const te = this.elements;
    te[0] = _x.x; te[4] = _y.x; te[8] = _z.x;
    te[1] = _x.y; te[5] = _y.y; te[9] = _z.y;
    te[2] = _x.z; te[6] = _y.z; te[10] = _z.z;
    return this;
  }

  /** Write the 16 elements as float32 for uploading. */
  toBuffer(out: Buffer, offset: number): void {
    const e = this.elements;
    for (let i = 0; i < 16; i++) out.writeFloatLE(e[i], offset + i * 4);
  }
}

/* Scratch for lookAt. Module-level so a per-frame camera update allocates
 * nothing. */
const _x = new Vector3(0, 0, 0);
const _y = new Vector3(0, 0, 0);
const _z = new Vector3(0, 0, 0);
