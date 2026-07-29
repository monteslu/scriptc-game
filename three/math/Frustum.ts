/* Frustum: the six planes bounding what a camera can see.
 *
 * This is the object that makes culling possible, and culling is the single
 * biggest lever this renderer has. The benchmark in docs/WEBGL-AND-3D.md
 * shows a 10000-mesh frame spending ~39ms recomposing transforms and ~33ms
 * walking the scene, all of it for objects that may be entirely off screen.
 * Rejecting those before the per-mesh work is what a real renderer does.
 *
 * Planes point INWARD, so a point is inside when it is on the positive side
 * of all six.
 */
import { Vector3, Matrix4Like } from "./Vector3.js";
import { Plane } from "./Plane.js";
import { Sphere } from "./Sphere.js";
import { Box3 } from "./Box3.js";

const _sphere = new Sphere();
const _vector = new Vector3();

export class Frustum {
  readonly isFrustum = true;

  planes: Plane[];

  constructor() {
    this.planes = [
      new Plane(), new Plane(), new Plane(),
      new Plane(), new Plane(), new Plane(),
    ];
  }

  /* Extract the planes from a view-projection matrix (Gribb/Hartmann).
   *
   * Each plane is a sum or difference of two matrix ROWS, which in this
   * column-major layout means striding by 4. Adding row 3 to row 0 gives
   * the left plane, subtracting gives the right, and so on; the near plane
   * uses row 3 + row 2 for the GL convention where NDC z runs -1..1.
   *
   * Every plane MUST be normalized. Unnormalized planes still give the
   * right sign for a point test, so a points-only check would look
   * correct, but every sphere test compares a world-space radius against a
   * distance in the matrix's arbitrary scale and culls the wrong objects.
   */
  setFromProjectionMatrix(m: Matrix4Like): Frustum {
    const p = this.planes;
    const e = m.elements;

    const m0 = e[0], m1 = e[1], m2 = e[2], m3 = e[3];
    const m4 = e[4], m5 = e[5], m6 = e[6], m7 = e[7];
    const m8 = e[8], m9 = e[9], m10 = e[10], m11 = e[11];
    const m12 = e[12], m13 = e[13], m14 = e[14], m15 = e[15];

    p[0].setComponents(m3 - m0, m7 - m4, m11 - m8, m15 - m12).normalize();  // right
    p[1].setComponents(m3 + m0, m7 + m4, m11 + m8, m15 + m12).normalize();  // left
    p[2].setComponents(m3 + m1, m7 + m5, m11 + m9, m15 + m13).normalize();  // bottom
    p[3].setComponents(m3 - m1, m7 - m5, m11 - m9, m15 - m13).normalize();  // top
    p[4].setComponents(m3 - m2, m7 - m6, m11 - m10, m15 - m14).normalize(); // far
    p[5].setComponents(m3 + m2, m7 + m6, m11 + m10, m15 + m14).normalize(); // near
    return this;
  }

  /* A sphere is outside when it is fully behind ANY one plane.
   *
   * This is a conservative test: a sphere can pass all six and still be
   * outside the frustum near a corner. That is fine and is what three does
   * too -- the cost of a false accept is one wasted draw, while a false
   * reject is a visibly missing object. */
  intersectsSphere(sphere: Sphere): boolean {
    const p = this.planes;
    const negRadius = -sphere.radius;
    for (let i = 0; i < 6; i++) {
      if (p[i].distanceToPoint(sphere.center) < negRadius) return false;
    }
    return true;
  }

  /* Box test using the "positive vertex": for each plane, the box corner
   * furthest along that plane's normal. If even that corner is behind the
   * plane the whole box is, which decides the box in one dot product per
   * plane instead of eight. */
  intersectsBox(box: Box3): boolean {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      const n = p[i].normal;
      _vector.set(
        n.x > 0 ? box.max.x : box.min.x,
        n.y > 0 ? box.max.y : box.min.y,
        n.z > 0 ? box.max.z : box.min.z,
      );
      if (p[i].distanceToPoint(_vector) < 0) return false;
    }
    return true;
  }

  containsPoint(point: Vector3): boolean {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      if (p[i].distanceToPoint(point) < 0) return false;
    }
    return true;
  }

  /** Test a world-space sphere given in local space plus its matrix. */
  intersectsSphereTransformed(local: Sphere, matrixWorld: Matrix4Like): boolean {
    _sphere.copy(local);
    _sphere.applyMatrix4(matrixWorld);
    return this.intersectsSphere(_sphere);
  }

  copy(frustum: Frustum): Frustum {
    for (let i = 0; i < 6; i++) this.planes[i].copy(frustum.planes[i]);
    return this;
  }
}
