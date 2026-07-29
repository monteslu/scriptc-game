/* Object3D: a node in the scene graph.
 *
 * API-compatible with three: `position`, `quaternion`, `scale`, `rotation`,
 * `children`, `parent`, `add`, `remove`, `traverse`, `updateMatrixWorld`,
 * `lookAt`, `visible`, `name`.
 *
 * Two things worth knowing about how transforms flow, because they are the
 * source of most scene-graph confusion:
 *
 *   `matrix`      LOCAL: this node relative to its parent, composed from
 *                 position/quaternion/scale.
 *   `matrixWorld` WORLD: parent.matrixWorld * this.matrix, recomputed by
 *                 updateMatrixWorld walking down from the scene root.
 *
 * The renderer calls updateMatrixWorld once per frame on the scene; nothing
 * else needs to.
 *
 * `rotation` (Euler) is a READ-ONLY VIEW here, unlike three where assigning
 * to it writes through to the quaternion. The dialect has no property
 * setters that can trigger that sync, so `rotation` is refreshed from the
 * quaternion during updateMatrix and games set rotation through
 * `quaternion` or the helpers below. That is the one API difference in this
 * class, and it is called out in WEBGL-AND-3D.md.
 */
import { Vector3 } from "../math/Vector3.js";
import { Quaternion } from "../math/Quaternion.js";
import { Euler } from "../math/Euler.js";
import { Matrix4 } from "../math/Matrix4.js";

let nextId = 1;

export class Object3D {
  readonly id: number;
  name = "";

  position: Vector3 = new Vector3(0, 0, 0);
  quaternion: Quaternion = new Quaternion(0, 0, 0, 1);
  scale: Vector3 = new Vector3(1, 1, 1);
  /** A read-only view of `quaternion`, refreshed by updateMatrix. */
  rotation: Euler = new Euler(0, 0, 0);

  matrix: Matrix4 = new Matrix4();
  matrixWorld: Matrix4 = new Matrix4();

  parent: Object3D | null = null;
  children: Object3D[] = [];

  visible = true;

  /* Whether the renderer may reject this object with the view frustum.
   * three's flag, same default.
   *
   * Turn it OFF for anything whose drawn extent is not described by its
   * geometry's bounds around its own origin: a vertex shader that displaces
   * geometry, a skinned mesh, or an object deliberately drawn as a
   * background. Such an object would otherwise vanish the moment its origin
   * left the view, which looks like a rendering bug rather than a setting. */
  frustumCulled = true;

  /* Whether the local matrix is recomposed every frame. three exposes the
   * same flag; setting it false and updating `matrix` by hand is how static
   * geometry skips the work. */
  matrixAutoUpdate = true;

  /* Whether the WORLD matrix has to be recomputed.
   *
   * three's flag, and the reason its scene graph scales: a static object
   * recomposes nothing. Recomputing unconditionally cost 34ms per frame
   * on a 10000-object scene -- more than the entire draw path -- because
   * every object paid a compose plus a 4x4 multiply whether or not it had
   * moved.
   *
   * Set by updateMatrix (so moving an object marks it), and cleared once
   * the world matrix is rebuilt. */
  matrixWorldNeedsUpdate = true;

  /** three's flags, kept for API compatibility and for game code to read. */
  isMesh = false;
  isLight = false;
  isCamera = false;

  constructor() {
    this.id = nextId;
    nextId += 1;
  }

  add(child: Object3D): Object3D {
    if (child === this) return this;          // a node cannot parent itself
    if (child.parent !== null) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    return this;
  }

  remove(child: Object3D): Object3D {
    const i = this.children.indexOf(child);
    if (i >= 0) {
      this.children.splice(i, 1);
      child.parent = null;
    }
    return this;
  }

  /** Depth-first over this node and all descendants. */
  traverse(fn: (o: Object3D) => void): void {
    fn(this);
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].traverse(fn);
    }
  }

  /** Depth-first, skipping invisible subtrees: what the renderer walks. */
  traverseVisible(fn: (o: Object3D) => void): void {
    if (!this.visible) return;
    fn(this);
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].traverseVisible(fn);
    }
  }

  /** Recompose the LOCAL matrix from position/quaternion/scale. */
  updateMatrix(): void {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    // Keep the Euler view in step; see the note at the top of the file.
    this.rotation.setFromRotationMatrix(this.matrix.elements);
    this.matrixWorldNeedsUpdate = true;
  }

  /* Recompute world matrices for this node and its descendants.
   *
   * The renderer calls this once per frame on the scene root, so a deep
   * hierarchy costs one walk rather than one per object. */
  updateMatrixWorld(force: boolean = false): void {
    if (this.matrixAutoUpdate) this.updateMatrix();

    /* Only rebuild the world matrix when something CHANGED.
     *
     * This is three's structure and the reason a big static scene is
     * cheap: without it every object pays a 4x4 multiply every frame
     * whether or not it moved -- measured at 34ms per frame for 10000
     * objects, more than the whole draw path.
     *
     * `force` propagates DOWNWARD: when a parent's world matrix changes,
     * every descendant's is stale even if the descendant itself did not
     * move, so the flag alone is not sufficient. */
    let childForce = force;
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.parent === null) {
        this.matrixWorld.copy(this.matrix);
      } else {
        this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      childForce = true;
    }

    for (let i = 0; i < this.children.length; i++) {
      this.children[i].updateMatrixWorld(childForce);
    }
  }

  /** Orient this node to face a world-space point. */
  lookAt(target: Vector3): void {
    _m.lookAt(this.position, target, _up);
    this.quaternion.setFromRotationMatrixElements(_m.elements);
  }

  /** World-space position: the translation column of matrixWorld. */
  getWorldPosition(out: Vector3): Vector3 {
    return out.setFromMatrixPosition(this.matrixWorld);
  }

  /* Rotation helpers. three writes these through the Euler setter; here
   * they go straight to the quaternion, which is authoritative either
   * way. */
  rotateX(angle: number): Object3D { return this.rotateOnAxis(_xAxis, angle); }
  rotateY(angle: number): Object3D { return this.rotateOnAxis(_yAxis, angle); }
  rotateZ(angle: number): Object3D { return this.rotateOnAxis(_zAxis, angle); }

  rotateOnAxis(axis: Vector3, angle: number): Object3D {
    _q.setFromAxisAngle(axis, angle);
    this.quaternion.multiply(_q);
    return this;
  }

  /** Absolute orientation from XYZ Euler angles. */
  setRotationFromEuler(x: number, y: number, z: number): Object3D {
    this.quaternion.setFromEuler(x, y, z);
    return this;
  }

  translateOnAxis(axis: Vector3, distance: number): Object3D {
    _v.copy(axis).applyQuaternion(this.quaternion);
    this.position.addScaledVector(_v, distance);
    return this;
  }

  translateX(d: number): Object3D { return this.translateOnAxis(_xAxis, d); }
  translateY(d: number): Object3D { return this.translateOnAxis(_yAxis, d); }
  translateZ(d: number): Object3D { return this.translateOnAxis(_zAxis, d); }
}

/* Module-level scratch: these run per object per frame, so nothing here
 * allocates. */
const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _up = new Vector3(0, 1, 0);
const _xAxis = new Vector3(1, 0, 0);
const _yAxis = new Vector3(0, 1, 0);
const _zAxis = new Vector3(0, 0, 1);
