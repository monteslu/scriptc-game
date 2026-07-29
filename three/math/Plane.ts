/* Plane, in Hessian normal form: dot(normal, p) + constant = 0.
 *
 * `normal` is unit length and `constant` is the signed distance from the
 * origin along it, which makes distanceToPoint a single dot product. That
 * is the whole reason this form is used: the frustum test runs six of these
 * per object per frame.
 *
 * POSITIVE distance is the side the normal points at. The frustum builds
 * its planes with normals pointing INWARD, so "inside" is distance >= 0 on
 * all six, and a single negative distance rejects.
 */
import { Vector3 } from "./Vector3.js";

export class Plane {
  readonly isPlane = true;

  normal: Vector3;
  constant: number;

  constructor(normal: Vector3 | null = null, constant: number = 0) {
    this.normal = normal === null ? new Vector3(1, 0, 0) : normal;
    this.constant = constant;
  }

  set(normal: Vector3, constant: number): Plane {
    this.normal.copy(normal);
    this.constant = constant;
    return this;
  }

  setComponents(x: number, y: number, z: number, w: number): Plane {
    this.normal.set(x, y, z);
    this.constant = w;
    return this;
  }

  /* Scale so the normal is unit length.
   *
   * A plane pulled out of a projection matrix is NOT normalized, and its
   * `constant` is in the same arbitrary scale as its normal. Dividing both
   * by the normal's length is what turns distanceToPoint into a real
   * distance -- without it the frustum still culls correctly for points
   * (only the sign matters) but every sphere-radius comparison is wrong,
   * because the radius is in world units and the distance is not. */
  normalize(): Plane {
    const len = this.normal.length();
    if (len === 0) return this;
    const inv = 1 / len;
    this.normal.x = this.normal.x * inv;
    this.normal.y = this.normal.y * inv;
    this.normal.z = this.normal.z * inv;
    this.constant = this.constant * inv;
    return this;
  }

  distanceToPoint(point: Vector3): number {
    return this.normal.dot(point) + this.constant;
  }

  copy(plane: Plane): Plane {
    this.normal.copy(plane.normal);
    this.constant = plane.constant;
    return this;
  }

  clone(): Plane {
    return new Plane(this.normal.clone(), this.constant);
  }
}
