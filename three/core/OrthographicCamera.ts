/* OrthographicCamera: parallel projection, no perspective divide.
 *
 * What it is for: 2.5D games, isometric views, UI drawn in 3D space, shadow
 * map passes, and minimaps. Anything where two objects the same size should
 * LOOK the same size regardless of depth.
 *
 * API-compatible with three: `new OrthographicCamera(left, right, top,
 * bottom, near, far)`, and `zoom` scales the visible extent.
 *
 * WHY IT EXTENDS PerspectiveCamera rather than a shared Camera base.
 *
 * The renderer's signatures all name PerspectiveCamera, and the dialect has
 * no structural typing and no downcast, so an unrelated Camera class cannot
 * be passed to `renderer.render(scene, camera)` at all. Extending the
 * existing class is what makes an ortho camera usable everywhere a
 * perspective one is, with no renderer change and no cast.
 *
 * The inherited fov/aspect fields are unused here; updateProjectionMatrix is
 * overridden completely and never reads them. That is the cost of the
 * dialect's lack of a common supertype, and it is a smaller cost than
 * threading a second camera type through fifteen renderer signatures.
 */
import { PerspectiveCamera } from "./PerspectiveCamera.js";

export class OrthographicCamera extends PerspectiveCamera {
  readonly isOrthographicCamera = true;

  left = -1;
  right = 1;
  top = 1;
  bottom = -1;

  /* three's defaults. near defaults to 0.1 as in three's OrthographicCamera
   * signature, NOT the 2000-far perspective default. */
  constructor(left: number = -1, right: number = 1,
              top: number = 1, bottom: number = -1,
              near: number = 0.1, far: number = 2000) {
    /* The super constructor calls updateProjectionMatrix, which is
     * overridden and reads THIS class's fields -- and in the dialect, as in
     * JS, those are not assigned until after super() returns. So the first
     * call runs against the field initialisers above (a 2x2 box), and the
     * real bounds are applied by the explicit call at the end of this
     * constructor. Harmless because nothing can observe the matrix in
     * between, but it is the kind of ordering that looks like a bug later. */
    super(50, 1, near, far);
    this.left = left;
    this.right = right;
    this.top = top;
    this.bottom = bottom;
    this.updateProjectionMatrix();
  }

  /* Zoom divides the extent: a larger zoom shows LESS of the world, which
   * is three's behaviour and the opposite of scaling the bounds up. */
  override updateProjectionMatrix(): void {
    const dx = (this.right - this.left) / (2 * this.zoom);
    const dy = (this.top - this.bottom) / (2 * this.zoom);
    const cx = (this.right + this.left) / 2;
    const cy = (this.top + this.bottom) / 2;

    this.projectionMatrix.makeOrthographic(
      cx - dx, cx + dx, cy + dy, cy - dy, this.near, this.far);
  }
}
