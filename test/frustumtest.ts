/* Frustum culling: does it reject the right things, and does it change the
 * image?
 *
 * The whole point of culling is that it is INVISIBLE. A frame drawn with it
 * on must be byte-identical to the same frame with it off; if it is not,
 * something on screen is being thrown away. So the gate here is a pixel
 * hash comparison, not a count.
 *
 * A count alone would be a bad test in both directions: culling nothing
 * passes "the image matches", and culling everything passes "the count went
 * up". Both are checked, and both come with a control that must fail.
 */
import { Math as M } from "../web/globals.js";
import { initHeadless, shutdownHeadless } from "../host/gl-ffi.js";
import { WebGL2RenderingContext } from "../web/webgl/context.js";
import { Scene } from "../three/core/Scene.js";
import { PerspectiveCamera } from "../three/core/PerspectiveCamera.js";
import { Mesh } from "../three/objects/Mesh.js";
import { BoxGeometry } from "../three/geometries/BoxGeometry.js";
import { MeshLambertMaterial } from "../three/materials/Material.js";
import { AmbientLight, DirectionalLight } from "../three/lights/Light.js";
import { WebGLRenderer } from "../three/renderer/WebGLRenderer.js";
import { Vector3 } from "../three/math/Vector3.js";
import { Frustum } from "../three/math/Frustum.js";
import { Sphere } from "../three/math/Sphere.js";
import { Box3 } from "../three/math/Box3.js";
import { Plane } from "../three/math/Plane.js";
import { Matrix4 } from "../three/math/Matrix4.js";
import { Vector4 } from "../three/math/Vector4.js";
import { OrthographicCamera } from "../three/core/OrthographicCamera.js";
import { DataTexture } from "../three/textures/DataTexture.js";
import { clamp, degToRad, lerp, smoothstep, isPowerOfTwo } from "../three/math/MathUtils.js";

let passed = 0;
let failed = 0;

function check(cond: boolean, label: string): void {
  if (cond) { passed += 1; } else { failed += 1; console.log(`  FAIL: ${label}`); }
}

const W = 320;
const H = 240;

function main(): void {
  console.log("==> frustum culling");

  /* initHeadless, NOT a canvas load handler.
   *
   * A bare .ts entry is compiled as-is (scripts/build.sh), so host boot()
   * and run() never execute and `load` never fires. A test whose body hangs
   * off addEventListener("load") therefore does nothing at all and still
   * exits 0 -- which is exactly how test/phase9test.ts came to report PASS
   * without running a single check. Top-level is the working shape. */
  if (initHeadless(W, H) !== 0) {
    console.log("    SKIP (no headless GL device)");
    process.exit(0);
  }
  const gl = new WebGL2RenderingContext(W, H);

  /* ---- the math, before the renderer ---- */

  const box = new Box3();
  box.makeEmpty();
  check(box.isEmpty(), "a fresh Box3 is empty");
  box.expandByPoint(new Vector3(-1, -1, -1));
  box.expandByPoint(new Vector3(1, 1, 1));
  check(!box.isEmpty(), "expanding by points makes a box non-empty");
  check(box.containsPoint(new Vector3(0, 0, 0)), "the box contains its centre");
  check(!box.containsPoint(new Vector3(2, 0, 0)), "the box excludes an outside point");

  /* A rotated box must re-fit around all eight corners. Rotating a unit
   * cube 45 degrees about Z widens its X extent to sqrt(2); a version that
   * only transformed min and max would leave it at 1. */
  const rot = new Matrix4();
  rot.makeRotationZ(M.PI / 4);
  const rotated = box.clone();
  rotated.applyMatrix4(rot);
  check(rotated.max.x > 1.3 && rotated.max.x < 1.5,
        "a rotated box re-fits around all eight corners");

  const plane = new Plane(new Vector3(0, 1, 0), 0);
  check(plane.distanceToPoint(new Vector3(0, 5, 0)) === 5, "plane distance above");
  check(plane.distanceToPoint(new Vector3(0, -5, 0)) === -5, "plane distance below");

  /* An unnormalized plane must be fixed by normalize(): the scale is what
   * makes sphere-radius comparisons meaningful. */
  const unnorm = new Plane(new Vector3(0, 10, 0), 0);
  unnorm.normalize();
  check(unnorm.distanceToPoint(new Vector3(0, 3, 0)) === 3,
        "normalize() puts distances back into world units");

  const sphere = new Sphere(new Vector3(0, 0, 0), 1);
  const scale2 = new Matrix4();
  scale2.makeScale(3, 2, 1);
  const scaled = sphere.clone();
  scaled.applyMatrix4(scale2);
  check(scaled.radius === 3,
        "a scaled sphere takes the LARGEST axis scale, so it still contains everything");

  /* ---- the frustum ---- */

  const cam = new PerspectiveCamera(60, W / H, 0.1, 100);
  cam.position.set(0, 0, 10);
  cam.lookAt(new Vector3(0, 0, 0));
  cam.updateMatrixWorld(true);

  const vp = new Matrix4();
  vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const frustum = new Frustum();
  frustum.setFromProjectionMatrix(vp);

  check(frustum.containsPoint(new Vector3(0, 0, 0)),
        "the origin is inside a camera looking at it");
  check(!frustum.containsPoint(new Vector3(0, 0, 200)),
        "a point far behind the camera is outside");
  check(!frustum.containsPoint(new Vector3(500, 0, 0)),
        "a point far off to the side is outside");

  const atOrigin = new Sphere(new Vector3(0, 0, 0), 1);
  check(frustum.intersectsSphere(atOrigin), "a sphere at the origin is visible");
  const farOff = new Sphere(new Vector3(500, 0, 0), 1);
  check(!frustum.intersectsSphere(farOff), "a sphere far off to the side is culled");

  /* A large sphere centred outside must still be ACCEPTED when it reaches
   * into view. Testing centres alone would wrongly reject it, which on
   * screen looks like big objects popping out at the edges. */
  const bigReaching = new Sphere(new Vector3(60, 0, 0), 58);
  check(frustum.intersectsSphere(bigReaching),
        "a large sphere reaching into view is NOT culled");

  /* ---- the renderer: culling must not change the image ---- */

  const renderer = new WebGLRenderer(gl);
  renderer.setSize(W, H);
  renderer.setClearColor(0x101820);

  const scene = new Scene();
  scene.add(new AmbientLight(0x333333, 1));
  const sun = new DirectionalLight(0xffffff, 1);
  sun.position.set(0.5, 1, 0.8);
  scene.add(sun);

  const geo = new BoxGeometry(1, 1, 1);
  /* A grid that deliberately extends well past the view, so there is
   * something real to reject. */
  for (let x = -12; x <= 12; x++) {
    for (let y = -6; y <= 6; y++) {
      const m = new Mesh(geo, new MeshLambertMaterial(0x66ccff));
      m.position.set(x * 2, y * 2, 0);
      scene.add(m);
    }
  }

  const camera = new PerspectiveCamera(60, W / H, 0.1, 100);
  camera.position.set(0, 0, 12);
  camera.lookAt(new Vector3(0, 0, 0));

  renderer.frustumCulling = false;
  renderer.render(scene, camera);
  const hashOff = gl.hashPixels(0, 0, W, H);
  const culledOff = renderer.culledCount;

  renderer.frustumCulling = true;
  renderer.render(scene, camera);
  const hashOn = gl.hashPixels(0, 0, W, H);
  const culledOn = renderer.culledCount;

  check(culledOff === 0, "nothing is culled when culling is off");
  check(culledOn > 0, "something IS culled when culling is on");
  check(hashOn === hashOff,
        "culling does not change a single pixel");

  /* CONTROL: the hash must be able to move. If it cannot, the comparison
   * above proves nothing -- "identical" and "the harness is broken" look
   * exactly the same. */
  /* A mesh at the ORIGIN, not meshes[0]: the grid starts at x=-24, which is
   * off screen, so hiding it changed nothing and the control failed -- doing
   * its job, since a control that cannot move is worthless. */
  let hidden = scene.meshes[0];
  for (let i = 0; i < scene.meshes.length; i++) {
    const p = scene.meshes[i].position;
    if (p.x === 0 && p.y === 0) { hidden = scene.meshes[i]; break; }
  }
  const wasVisible = hidden.visible;
  hidden.visible = false;
  renderer.render(scene, camera);
  const hashChanged = gl.hashPixels(0, 0, W, H);
  hidden.visible = wasVisible;
  check(hashChanged !== hashOn,
        "CONTROL: hiding a visible mesh DOES change the image");

  /* frustumCulled=false must defeat culling for that object. */
  renderer.render(scene, camera);
  const baseCulled = renderer.culledCount;
  for (let i = 0; i < scene.meshes.length; i++) scene.meshes[i].frustumCulled = false;
  renderer.render(scene, camera);
  check(renderer.culledCount === 0 && baseCulled > 0,
        "frustumCulled=false opts an object out of culling");

  /* ---- the rest of the v0 scope ---- */

  check(clamp(5, 0, 1) === 1 && clamp(-5, 0, 1) === 0, "clamp bounds both ways");
  check(lerp(0, 10, 0.5) === 5, "lerp midpoint");
  check(smoothstep(0.5, 0, 1) === 0.5, "smoothstep is symmetric at the midpoint");
  check(isPowerOfTwo(64) && !isPowerOfTwo(63), "isPowerOfTwo");
  check(degToRad(180) > 3.14 && degToRad(180) < 3.15, "degToRad");

  const v4 = new Vector4(1, 2, 3, 1);
  const ident = new Matrix4();
  v4.applyMatrix4(ident);
  check(v4.x === 1 && v4.y === 2 && v4.z === 3 && v4.w === 1,
        "Vector4 through the identity is unchanged");
  /* w=1 means a translation MOVES it; w=0 would not. That distinction is
   * the whole reason Vector4 exists here. */
  const trans = new Matrix4();
  trans.makeTranslation(5, 0, 0);
  const asPoint = new Vector4(0, 0, 0, 1).applyMatrix4(trans);
  const asDir = new Vector4(0, 0, 0, 0).applyMatrix4(trans);
  check(asPoint.x === 5, "w=1 is a POSITION, so translation moves it");
  check(asDir.x === 0, "w=0 is a DIRECTION, so translation does not");

  /* An ortho camera must be usable exactly where a perspective one is, and
   * must actually differ: parallel projection has no perspective divide, so
   * its matrix is not the perspective one. */
  const ortho = new OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
  ortho.position.set(0, 0, 12);
  ortho.lookAt(new Vector3(0, 0, 0));
  renderer.render(scene, ortho);
  const orthoHash = gl.hashPixels(0, 0, W, H);
  check(orthoHash !== hashOn, "an orthographic camera renders a different image");

  /* Zoom must show LESS of the world, so the image changes. */
  ortho.zoom = 2;
  ortho.updateProjectionMatrix();
  renderer.render(scene, ortho);
  check(gl.hashPixels(0, 0, W, H) !== orthoHash, "ortho zoom changes the image");

  /* A DataTexture must reach the GPU: two different byte patterns must
   * produce two different images. A texture that never uploaded would give
   * the same (untextured) result both times. */
  const px = Buffer.alloc(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    px.writeUInt8(i * 16, i * 4);
    px.writeUInt8(255 - i * 16, i * 4 + 1);
    px.writeUInt8(128, i * 4 + 2);
    px.writeUInt8(255, i * 4 + 3);
  }
  const dtex = new DataTexture(px, 4, 4);
  check(dtex.isDataTexture, "DataTexture announces itself to the renderer");
  const texMesh = new Mesh(new BoxGeometry(4, 4, 4), new MeshLambertMaterial(0xffffff));
  texMesh.material.map = dtex;
  const texScene = new Scene();
  texScene.add(new AmbientLight(0xffffff, 1));
  texScene.add(texMesh);
  const texCam = new PerspectiveCamera(60, W / H, 0.1, 100);
  texCam.position.set(0, 0, 8);
  texCam.lookAt(new Vector3(0, 0, 0));
  renderer.render(texScene, texCam);
  const texA = gl.hashPixels(0, 0, W, H);

  for (let i = 0; i < 16; i++) px.writeUInt8(255 - i * 16, i * 4);
  dtex.needsUpdate = true;
  renderer.render(texScene, texCam);
  const texB = gl.hashPixels(0, 0, W, H);
  check(texA !== texB, "changing a DataTexture's bytes changes the image");

  shutdownHeadless();
  console.log("");
  console.log(`frustum test: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
