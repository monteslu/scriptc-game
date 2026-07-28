/* Matrix3, column-major. API-compatible with three.
 *
 * Its main job here is the NORMAL MATRIX: the inverse-transpose of a model
 * matrix's upper 3x3, which is what keeps normals perpendicular to a
 * surface under non-uniform scale. Using the model matrix directly is the
 * classic lighting bug that only shows up once something is squashed.
 */
export class Matrix3 {
  elements: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  identity(): Matrix3 {
    return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
  }

  /** Row-major reading order in, column-major storage, as in three. */
  set(n11: number, n12: number, n13: number,
      n21: number, n22: number, n23: number,
      n31: number, n32: number, n33: number): Matrix3 {
    const e = this.elements;
    e[0] = n11; e[3] = n12; e[6] = n13;
    e[1] = n21; e[4] = n22; e[7] = n23;
    e[2] = n31; e[5] = n32; e[8] = n33;
    return this;
  }

  copy(m: Matrix3): Matrix3 {
    const e = this.elements;
    const s = m.elements;
    for (let i = 0; i < 9; i++) e[i] = s[i];
    return this;
  }

  /** The upper-left 3x3 of a Matrix4: rotation and scale, no translation. */
  setFromMatrix4Elements(m: number[]): Matrix3 {
    return this.set(m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]);
  }

  /** Inverse-transpose of a Matrix4's upper 3x3. */
  getNormalMatrix(m4: number[]): Matrix3 {
    return this.setFromMatrix4Elements(m4).invert().transpose();
  }

  invert(): Matrix3 {
    const e = this.elements;
    const n11 = e[0]; const n21 = e[1]; const n31 = e[2];
    const n12 = e[3]; const n22 = e[4]; const n32 = e[5];
    const n13 = e[6]; const n23 = e[7]; const n33 = e[8];

    const t11 = n33 * n22 - n32 * n23;
    const t12 = n32 * n13 - n33 * n12;
    const t13 = n23 * n12 - n22 * n13;
    const det = n11 * t11 + n21 * t12 + n31 * t13;

    // Singular: zero out rather than produce NaN, matching three and
    // Matrix4.invert here.
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
    const d = 1 / det;

    e[0] = t11 * d;
    e[1] = (n31 * n23 - n33 * n21) * d;
    e[2] = (n32 * n21 - n31 * n22) * d;
    e[3] = t12 * d;
    e[4] = (n33 * n11 - n31 * n13) * d;
    e[5] = (n31 * n12 - n32 * n11) * d;
    e[6] = t13 * d;
    e[7] = (n21 * n13 - n23 * n11) * d;
    e[8] = (n22 * n11 - n21 * n12) * d;
    return this;
  }

  transpose(): Matrix3 {
    const e = this.elements;
    let t = 0;
    t = e[1]; e[1] = e[3]; e[3] = t;
    t = e[2]; e[2] = e[6]; e[6] = t;
    t = e[5]; e[5] = e[7]; e[7] = t;
    return this;
  }

  /** Write as float32 for uploading to a mat3 uniform. */
  toBuffer(out: Buffer, offset: number): void {
    const e = this.elements;
    for (let i = 0; i < 9; i++) out.writeFloatLE(e[i], offset + i * 4);
  }
}
