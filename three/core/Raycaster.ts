/* Raycaster: what did the player click, and what is the ship about to hit?
 *
 * API-compatible with three: `setFromCamera(ndcX, ndcY, camera)`,
 * `intersectObject(mesh)`, `intersectObjects(meshes)`, results sorted
 * nearest-first with `distance`, `point`, `face` and `uv`.
 *
 * TWO TIERS, as three has:
 *
 *   1. BOUNDING SPHERE. Cheap, and rejects almost everything. A scene of
 *      500 objects usually costs 500 sphere tests and a handful of
 *      triangle loops.
 *   2. TRIANGLES. Exact, in the mesh's LOCAL space: the ray is transformed
 *      by the inverse world matrix once, rather than transforming every
 *      triangle into world space. For a 5000-triangle mesh that is one
 *      matrix inverse instead of 15000 vector transforms.
 *
 * Set `firstHitOnly` when you only need to know IF something was hit (a
 * hitscan weapon, a ground probe); it skips the sort and returns as soon as
 * a triangle is found.
 *
 * WHAT THIS DOES NOT DO: Sprite, Points and Line intersection (three tests
 * those against a threshold, and the shapes are billboarded or infinitely
 * thin, which needs its own treatment), and InstancedMesh per-instance
 * hits. Mesh is what games raycast against.
 */
import { Vector3 } from "../math/Vector3.js";
import { Vector2 } from "../math/Vector2.js";
import { Matrix4 } from "../math/Matrix4.js";
import { Mesh } from "../objects/Mesh.js";
import { PerspectiveCamera } from "./PerspectiveCamera.js";
import { DoubleSide, BackSide, FrontSide } from "../materials/Material.js";
import { Math as M } from "../../web/globals.js";

/** One hit. three's shape, minus the fields that need a scene walk. */
export class Intersection {
  /** Distance from the ray origin, in WORLD units. */
  distance = 0;
  /** The hit position in world space. */
  point: Vector3 = new Vector3();
  /** The mesh that was hit. */
  object: Mesh | null = null;
  /** Index of the hit triangle: a/b/c are indices into the position attr. */
  faceIndexA = 0;
  faceIndexB = 0;
  faceIndexC = 0;
  /** The triangle's geometric normal, in world space. */
  normal: Vector3 = new Vector3();
  /** Barycentric-interpolated uv, if the geometry has a uv attribute. */
  uv: Vector2 = new Vector2();
  hasUV = false;
}

/* A ray: origin plus a NORMALISED direction.
 *
 * Separate from Raycaster because games want one directly -- a bullet
 * path, a ground probe under a character -- without building a camera
 * projection first. three splits them the same way. */
export class Ray {
  origin: Vector3 = new Vector3();
  direction: Vector3 = new Vector3(0, 0, -1);

  constructor(origin: Vector3 | null = null, direction: Vector3 | null = null) {
    if (origin !== null) this.origin.copy(origin);
    if (direction !== null) this.direction.copy(direction);
  }

  set(origin: Vector3, direction: Vector3): Ray {
    this.origin.copy(origin);
    this.direction.copy(direction);
    return this;
  }

  copy(r: Ray): Ray {
    this.origin.copy(r.origin);
    this.direction.copy(r.direction);
    return this;
  }

  /** origin + direction * t, into `target`. */
  at(t: number, target: Vector3): Vector3 {
    target.copy(this.direction);
    target.multiplyScalar(t);
    target.add(this.origin);
    return target;
  }

  /* Transform the ray by a matrix. Used to move a WORLD ray into a mesh's
   * LOCAL space, which is what makes the triangle test cheap.
   *
   * The direction is transformed WITHOUT the translation (it is a
   * direction, not a point) and deliberately NOT re-normalised: under a
   * scaling matrix the direction's length carries that scale, so a `t`
   * solved in local space is directly comparable to world distance. */
  applyMatrix4(m: Matrix4): Ray {
    this.origin.applyMatrix4(m);
    applyDirection(this.direction, m);
    return this;
  }

  /* Distance from a point to this ray, squared. The projection is clamped
   * to t >= 0 so a point BEHIND the origin measures from the origin
   * rather than from an imaginary backwards extension. */
  distanceSqToPoint(point: Vector3): number {
    _v.copy(point).sub(this.origin);
    const t = _v.dot(this.direction);
    if (t < 0) return _v.lengthSq();
    _v.copy(this.direction).multiplyScalar(t).add(this.origin);
    return _v.sub(point).lengthSq();
  }

  /* Nearest intersection with a sphere, or -1 for a miss.
   *
   * Solved on the projection rather than with the quadratic formula: fewer
   * operations, and no catastrophic cancellation when the ray origin is
   * far from the sphere (which is the common case for a camera ray). */
  intersectSphere(center: Vector3, radius: number): number {
    _v.copy(center).sub(this.origin);
    const tca = _v.dot(this.direction);
    const d2 = _v.lengthSq() - tca * tca;
    const r2 = radius * radius;
    if (d2 > r2) return -1;
    const thc = M.sqrt(r2 - d2);
    const t0 = tca - thc;
    const t1 = tca + thc;
    // Both behind the origin: no hit. One behind: the origin is inside.
    if (t1 < 0) return -1;
    return t0 < 0 ? t1 : t0;
  }

  /* Moller-Trumbore triangle intersection. Returns `t`, or -1 for a miss.
   *
   * `backfaceCulling` follows the material side: a FrontSide material is
   * not hit from behind, which is what makes clicking through the back of
   * a closed mesh work correctly. */
  intersectTriangle(a: Vector3, b: Vector3, c: Vector3,
                    backfaceCulling: boolean): number {
    _edge1.copy(b).sub(a);
    _edge2.copy(c).sub(a);
    _pvec.copy(this.direction).cross(_edge2);
    const det = _edge1.dot(_pvec);

    if (backfaceCulling) {
      if (det < 1e-12) return -1;      // parallel, or hitting the back face
    } else if (det > -1e-12 && det < 1e-12) {
      return -1;                        // parallel to the triangle plane
    }

    const invDet = 1 / det;
    _tvec.copy(this.origin).sub(a);
    const u = _tvec.dot(_pvec) * invDet;
    if (u < 0 || u > 1) return -1;

    _qvec.copy(_tvec).cross(_edge1);
    const v = this.direction.dot(_qvec) * invDet;
    if (v < 0 || u + v > 1) return -1;

    const t = _edge2.dot(_qvec) * invDet;
    // Behind the ray origin.
    if (t < 0) return -1;

    _lastU = u;
    _lastV = v;
    return t;
  }
}

export class Raycaster {
  ray: Ray = new Ray();
  /** Hits nearer than this are ignored. three's `near`. */
  near = 0;
  /** Hits further than this are ignored. Infinity by default, as in three. */
  far = Infinity;
  /* Return as soon as ANY triangle is hit, skipping the sort. For "is
   * something in the way?" queries this is markedly cheaper. */
  firstHitOnly = false;

  constructor(origin: Vector3 | null = null, direction: Vector3 | null = null) {
    if (origin !== null) this.ray.origin.copy(origin);
    if (direction !== null) this.ray.direction.copy(direction);
  }

  set(origin: Vector3, direction: Vector3): Raycaster {
    this.ray.set(origin, direction);
    return this;
  }

  /* Build the ray from a NORMALISED DEVICE coordinate: -1..1 on both axes,
   * with +y UP. Converting from a mouse event is the caller's job, exactly
   * as in three:
   *
   *   const x = (e.clientX / canvas.width) * 2 - 1;
   *   const y = -(e.clientY / canvas.height) * 2 + 1;   // note the flip
   *   raycaster.setFromCamera(x, y, camera);
   *
   * three takes a Vector2; the two numbers are spelled out here because
   * that is what every call site actually has.
   *
   * The unprojection is: NDC -> view space via the inverse projection, then
   * -> world via the camera's world matrix. The origin is the camera
   * position, so the direction is simply the unprojected point minus it. */
  setFromCamera(ndcX: number, ndcY: number, camera: PerspectiveCamera): Raycaster {
    camera.updateMatrixWorld(false);

    this.ray.origin.setFromMatrixPosition(camera.matrixWorld);

    /* z = 1 is the FAR plane in NDC. Any z in (-1, 1] gives the same
     * direction; the far plane keeps the arithmetic away from the
     * near-plane singularity. */
    _target.set(ndcX, ndcY, 1);
    _m.copy(camera.projectionMatrix).invert();
    _target.applyMatrix4(_m);            // -> view space
    _target.applyMatrix4(camera.matrixWorld);  // -> world space

    this.ray.direction.copy(_target).sub(this.ray.origin).normalize();
    return this;
  }

  /** All hits on one mesh, nearest first. */
  intersectObject(mesh: Mesh): Intersection[] {
    const out: Intersection[] = [];
    this.intersectMesh(mesh, out);
    sortByDistance(out);
    return out;
  }

  /** All hits across several meshes, nearest first. */
  intersectObjects(meshes: Mesh[]): Intersection[] {
    const out: Intersection[] = [];
    for (let i = 0; i < meshes.length; i++) {
      this.intersectMesh(meshes[i], out);
      if (this.firstHitOnly && out.length > 0) return out;
    }
    sortByDistance(out);
    return out;
  }

  /* The two-tier test for a single mesh. Appends to `out` rather than
   * allocating, so intersectObjects does not build a list per mesh. */
  private intersectMesh(mesh: Mesh, out: Intersection[]): void {
    /* Gated on `raycastable`, NOT on `visible`.
     *
     * They are different questions: an invisible collider box that follows
     * a billboard sprite must be PICKABLE without ever being DRAWN, and
     * conflating the two makes every collider render as a solid block over
     * the thing it stands in for. */
    if (!mesh.raycastable) return;
    const geo = mesh.geometry;
    const pos = geo.position;
    if (pos === null) return;

    mesh.updateMatrixWorld(false);

    /* ---- tier 1: bounding sphere in WORLD space ----
     *
     * The radius is in local units, so it scales with the object. A
     * non-uniform scale would need the largest axis; using the max keeps
     * the sphere conservative (it may be too big, never too small, so it
     * cannot reject a real hit). */
    if (geo.boundingRadius < 0) geo.computeBoundingRadius();
    _sphereCenter.setFromMatrixPosition(mesh.matrixWorld);
    const s = maxScale(mesh.matrixWorld);
    const worldRadius = geo.boundingRadius * s;
    const tSphere = this.ray.intersectSphere(_sphereCenter, worldRadius);
    if (tSphere < 0) return;
    // The whole sphere is beyond `far`: nothing inside it can be nearer.
    if (tSphere > this.far) return;

    /* ---- tier 2: triangles in LOCAL space ----
     *
     * One inverse and one ray transform, versus transforming every vertex
     * into world space. */
    _inverse.copy(mesh.matrixWorld).invert();
    _localRay.copy(this.ray).applyMatrix4(_inverse);

    const side = mesh.material.side;
    const cull = side === FrontSide;
    const index = geo.index;
    const triCount = index !== null
      ? (index.array.length / 3) | 0
      : (pos.count / 3) | 0;

    for (let t = 0; t < triCount; t++) {
      let ia = t * 3;
      let ib = t * 3 + 1;
      let ic = t * 3 + 2;
      if (index !== null) {
        ia = index.array[ia];
        ib = index.array[ib];
        ic = index.array[ic];
      }

      readVertex(pos.array, ia, _a);
      readVertex(pos.array, ib, _b);
      readVertex(pos.array, ic, _c);

      /* A BackSide material is hit from behind, so the winding is
       * reversed rather than the cull flag flipped: that way the reported
       * normal still faces the ray. */
      let hit = -1;
      if (side === BackSide) {
        hit = _localRay.intersectTriangle(_c, _b, _a, true);
      } else {
        hit = _localRay.intersectTriangle(_a, _b, _c, cull);
      }
      if (hit < 0) continue;

      /* `hit` is a distance along the LOCAL ray, whose direction carries
       * the object's scale (applyMatrix4 does not re-normalise), so it is
       * already a world distance. */
      if (hit < this.near || hit > this.far) continue;

      const it = new Intersection();
      it.distance = hit;
      this.ray.at(hit, it.point);
      it.object = mesh;
      it.faceIndexA = ia;
      it.faceIndexB = ib;
      it.faceIndexC = ic;

      // Geometric normal, local -> world, then normalised.
      _edge1.copy(_b).sub(_a);
      _edge2.copy(_c).sub(_a);
      it.normal.copy(_edge1).cross(_edge2);
      applyDirection(it.normal, mesh.matrixWorld);
      it.normal.normalize();

      const uvAttr = geo.uv;
      if (uvAttr !== null) {
        /* Barycentric interpolation. u and v come from the triangle test;
         * the third weight is 1 - u - v. */
        const u = _lastU;
        const v = _lastV;
        const w = 1 - u - v;
        const ua = uvAttr.array;
        it.uv.set(ua[ia * 2] * w + ua[ib * 2] * u + ua[ic * 2] * v,
                  ua[ia * 2 + 1] * w + ua[ib * 2 + 1] * u + ua[ic * 2 + 1] * v);
        it.hasUV = true;
      }

      out.push(it);
      if (this.firstHitOnly) return;
    }
  }
}

/* ---- helpers ---- */

function readVertex(arr: number[], i: number, out: Vector3): void {
  out.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
}

/* Transform as a DIRECTION: the 3x3 part only, no translation. Not
 * re-normalised; callers that need a unit vector say so. */
function applyDirection(v: Vector3, m: Matrix4): void {
  const e = m.elements;
  const x = v.x;
  const y = v.y;
  const z = v.z;
  v.set(e[0] * x + e[4] * y + e[8] * z,
        e[1] * x + e[5] * y + e[9] * z,
        e[2] * x + e[6] * y + e[10] * z);
}

/* The largest axis scale in a matrix, for growing a bounding sphere. Using
 * the MAX (not the average) keeps the sphere conservative under
 * non-uniform scale: too large never loses a hit, too small would. */
function maxScale(m: Matrix4): number {
  const e = m.elements;
  const sx = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  const sy = e[4] * e[4] + e[5] * e[5] + e[6] * e[6];
  const sz = e[8] * e[8] + e[9] * e[9] + e[10] * e[10];
  let max = sx;
  if (sy > max) max = sy;
  if (sz > max) max = sz;
  return M.sqrt(max);
}

/* Insertion sort: hit lists are almost always 0-3 entries, where this beats
 * a comparison-function sort and allocates nothing. */
function sortByDistance(list: Intersection[]): void {
  for (let i = 1; i < list.length; i++) {
    const item = list[i];
    let j = i - 1;
    while (j >= 0 && list[j].distance > item.distance) {
      list[j + 1] = list[j];
      j -= 1;
    }
    list[j + 1] = item;
  }
}

/* Module-level scratch: a raycast per frame per object must not allocate. */
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _edge1 = new Vector3();
const _edge2 = new Vector3();
const _pvec = new Vector3();
const _qvec = new Vector3();
const _tvec = new Vector3();
const _target = new Vector3();
const _sphereCenter = new Vector3();
const _m = new Matrix4();
const _inverse = new Matrix4();
const _localRay = new Ray();

/* Barycentric coordinates of the last triangle hit, for uv interpolation.
 * Module state rather than out-params because the dialect has no tuple
 * return and an out-object would allocate per triangle tested. */
let _lastU = 0;
let _lastV = 0;
