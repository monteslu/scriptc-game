/* PerspectiveCamera. API-compatible with three.
 *
 * `updateProjectionMatrix` converts fov/aspect into the frustum bounds
 * Matrix4.makePerspective wants, exactly as three does -- fov is in
 * DEGREES here, as in three, not radians.
 *
 * The view matrix is `matrixWorldInverse`, recomputed by the renderer from
 * matrixWorld each frame.
 */
import { Object3D } from "./Object3D.js";
import { Matrix4 } from "../math/Matrix4.js";
import { Math as M } from "../../web/globals.js";

const DEG2RAD = M.PI / 180;

export class PerspectiveCamera extends Object3D {
  fov = 50;
  aspect = 1;
  near = 0.1;
  far = 2000;
  zoom = 1;

  projectionMatrix: Matrix4 = new Matrix4();
  matrixWorldInverse: Matrix4 = new Matrix4();

  /** three's defaults: 50 degrees, square, 0.1 to 2000. */
  constructor(fov: number = 50, aspect: number = 1,
              near: number = 0.1, far: number = 2000) {
    super();
    this.isCamera = true;
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix(): void {
    const near = this.near;
    const top = near * M.tan(DEG2RAD * 0.5 * this.fov) / this.zoom;
    const height = 2 * top;
    const width = this.aspect * height;
    const left = -0.5 * width;
    this.projectionMatrix.makePerspective(
      left, left + width, top, top - height, near, this.far);
  }

  /** The view matrix: the inverse of where the camera sits. */
  override updateMatrixWorld(force: boolean = false): void {
    super.updateMatrixWorld(force);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }
}
