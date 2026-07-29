/* Sphere: a bounding sphere.
 *
 * The cheap volume for frustum culling. A sphere-vs-plane test is one dot
 * product and a compare, where a box needs the "positive vertex" selection
 * first, so the renderer tests spheres and only falls back to boxes when it
 * needs the tighter fit.
 *
 * API-compatible with three, same conventions as the rest of math/.
 */
import { Math as M } from "../../web/globals.js";
import { Vector3, Matrix4Like } from "./Vector3.js";
import { Box3 } from "./Box3.js";

const _box = new Box3();

export class Sphere {
  readonly isSphere = true;

  center: Vector3;
  radius: number;

  /* A NEGATIVE default radius means empty, which is three's convention:
   * radius 0 is a legitimate degenerate sphere at a point, so it cannot
   * double as "unset". */
  constructor(center: Vector3 | null = null, radius: number = -1) {
    this.center = center === null ? new Vector3() : center;
    this.radius = radius;
  }

  set(center: Vector3, radius: number): Sphere {
    this.center.copy(center);
    this.radius = radius;
    return this;
  }

  isEmpty(): boolean {
    return this.radius < 0;
  }

  makeEmpty(): Sphere {
    this.center.set(0, 0, 0);
    this.radius = -1;
    return this;
  }

  containsPoint(point: Vector3): boolean {
    return point.distanceToSquared(this.center) <= this.radius * this.radius;
  }

  distanceToPoint(point: Vector3): number {
    return point.distanceTo(this.center) - this.radius;
  }

  intersectsSphere(sphere: Sphere): boolean {
    const r = this.radius + sphere.radius;
    return sphere.center.distanceToSquared(this.center) <= r * r;
  }

  intersectsBox(box: Box3): boolean {
    /* Closest point on the box to the centre, then a radius compare. */
    const cx = clamp(this.center.x, box.min.x, box.max.x);
    const cy = clamp(this.center.y, box.min.y, box.max.y);
    const cz = clamp(this.center.z, box.min.z, box.max.z);
    const dx = cx - this.center.x;
    const dy = cy - this.center.y;
    const dz = cz - this.center.z;
    return dx * dx + dy * dy + dz * dz <= this.radius * this.radius;
  }

  /* Transform by a matrix.
   *
   * The radius scales by the LARGEST axis scale, not by an average: under a
   * non-uniform scale the sphere must still contain everything it did
   * before, and taking anything less produces a volume that culls visible
   * geometry. */
  applyMatrix4(matrix: Matrix4Like): Sphere {
    if (this.isEmpty()) return this;
    this.center.applyMatrix4(matrix);
    this.radius = this.radius * maxScaleOnAxis(matrix);
    return this;
  }

  /** Fit around a box: centre at the box centre, radius to a corner. */
  setFromBox(box: Box3): Sphere {
    if (box.isEmpty()) return this.makeEmpty();
    box.getCenter(this.center);
    _box.copy(box);
    this.radius = this.center.distanceTo(_box.max);
    return this;
  }

  copy(sphere: Sphere): Sphere {
    this.center.copy(sphere.center);
    this.radius = sphere.radius;
    return this;
  }

  clone(): Sphere {
    return new Sphere(this.center.clone(), this.radius);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/* The largest of the three axis scale factors baked into a matrix, which is
 * the length of each basis vector. Column-major, so the bases are elements
 * 0-2, 4-6 and 8-10. */
function maxScaleOnAxis(matrix: Matrix4Like): number {
  const e = matrix.elements;
  const sx = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  const sy = e[4] * e[4] + e[5] * e[5] + e[6] * e[6];
  const sz = e[8] * e[8] + e[9] * e[9] + e[10] * e[10];
  let m = sx;
  if (sy > m) m = sy;
  if (sz > m) m = sz;
  return M.sqrt(m);
}
