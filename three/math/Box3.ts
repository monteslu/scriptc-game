/* Box3: an axis-aligned bounding box.
 *
 * API-COMPATIBLE with three, same as the rest of math/: mutate-and-return-
 * this, module-level scratch instead of allocation, signatures matching
 * three's so game code ports either direction.
 *
 * This exists to make FRUSTUM CULLING possible. A renderer that culls needs
 * a cheap volume per object to test against the view planes, and the box is
 * what BufferGeometry can compute once from its position attribute and then
 * reuse every frame.
 *
 * An EMPTY box is min > max on some axis, which is three's convention and
 * the reason makeEmpty() sets min to +Infinity and max to -Infinity: it
 * makes expandByPoint work without a "first point" special case.
 */
import { Vector3, Matrix4Like } from "./Vector3.js";

/* Scratch for the eight corners in applyMatrix4. Module-level, never
 * allocated per call: this runs per object per frame when a scene has
 * moving parents. */
const _corners: Vector3[] = [
  new Vector3(), new Vector3(), new Vector3(), new Vector3(),
  new Vector3(), new Vector3(), new Vector3(), new Vector3(),
];

export class Box3 {
  readonly isBox3 = true;

  min: Vector3;
  max: Vector3;

  constructor(min: Vector3 | null = null, max: Vector3 | null = null) {
    this.min = min === null ? new Vector3(Infinity, Infinity, Infinity) : min;
    this.max = max === null ? new Vector3(-Infinity, -Infinity, -Infinity) : max;
  }

  set(min: Vector3, max: Vector3): Box3 {
    this.min.copy(min);
    this.max.copy(max);
    return this;
  }

  /** Reset to the empty box, so expandByPoint starts fresh. */
  makeEmpty(): Box3 {
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this;
  }

  /* Empty means inverted on ANY axis, not all three: a box flattened to a
   * plane is still a valid volume, but one whose min passed its max is
   * not. */
  isEmpty(): boolean {
    return this.max.x < this.min.x || this.max.y < this.min.y ||
           this.max.z < this.min.z;
  }

  getCenter(target: Vector3): Vector3 {
    if (this.isEmpty()) return target.set(0, 0, 0);
    return target.set(
      (this.min.x + this.max.x) * 0.5,
      (this.min.y + this.max.y) * 0.5,
      (this.min.z + this.max.z) * 0.5,
    );
  }

  getSize(target: Vector3): Vector3 {
    if (this.isEmpty()) return target.set(0, 0, 0);
    return target.set(
      this.max.x - this.min.x,
      this.max.y - this.min.y,
      this.max.z - this.min.z,
    );
  }

  expandByPoint(point: Vector3): Box3 {
    if (point.x < this.min.x) this.min.x = point.x;
    if (point.y < this.min.y) this.min.y = point.y;
    if (point.z < this.min.z) this.min.z = point.z;
    if (point.x > this.max.x) this.max.x = point.x;
    if (point.y > this.max.y) this.max.y = point.y;
    if (point.z > this.max.z) this.max.z = point.z;
    return this;
  }

  /** Grow to contain another box. A no-op when `box` is empty. */
  union(box: Box3): Box3 {
    if (box.isEmpty()) return this;
    if (box.min.x < this.min.x) this.min.x = box.min.x;
    if (box.min.y < this.min.y) this.min.y = box.min.y;
    if (box.min.z < this.min.z) this.min.z = box.min.z;
    if (box.max.x > this.max.x) this.max.x = box.max.x;
    if (box.max.y > this.max.y) this.max.y = box.max.y;
    if (box.max.z > this.max.z) this.max.z = box.max.z;
    return this;
  }

  containsPoint(point: Vector3): boolean {
    return point.x >= this.min.x && point.x <= this.max.x &&
           point.y >= this.min.y && point.y <= this.max.y &&
           point.z >= this.min.z && point.z <= this.max.z;
  }

  intersectsBox(box: Box3): boolean {
    return box.max.x >= this.min.x && box.min.x <= this.max.x &&
           box.max.y >= this.min.y && box.min.y <= this.max.y &&
           box.max.z >= this.min.z && box.min.z <= this.max.z;
  }

  /* Transform by a matrix and re-fit.
   *
   * All EIGHT corners have to be transformed and re-bounded: transforming
   * only min and max is wrong under rotation, because the rotated box's
   * extremes are generally different corners than the original's. That
   * mistake produces a box that is too small, which culls objects that are
   * actually on screen -- a visible bug, not a slow one. */
  applyMatrix4(matrix: Matrix4Like): Box3 {
    if (this.isEmpty()) return this;

    _corners[0].set(this.min.x, this.min.y, this.min.z);
    _corners[1].set(this.min.x, this.min.y, this.max.z);
    _corners[2].set(this.min.x, this.max.y, this.min.z);
    _corners[3].set(this.min.x, this.max.y, this.max.z);
    _corners[4].set(this.max.x, this.min.y, this.min.z);
    _corners[5].set(this.max.x, this.min.y, this.max.z);
    _corners[6].set(this.max.x, this.max.y, this.min.z);
    _corners[7].set(this.max.x, this.max.y, this.max.z);

    this.makeEmpty();
    for (let i = 0; i < 8; i++) {
      _corners[i].applyMatrix4(matrix);
      this.expandByPoint(_corners[i]);
    }
    return this;
  }

  copy(box: Box3): Box3 {
    this.min.copy(box.min);
    this.max.copy(box.max);
    return this;
  }

  clone(): Box3 {
    return new Box3(this.min.clone(), this.max.clone());
  }

  equals(box: Box3): boolean {
    return box.min.equals(this.min) && box.max.equals(this.max);
  }
}
