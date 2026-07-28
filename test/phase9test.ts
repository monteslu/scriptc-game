/* The three features that closed out Phase 9: render targets,
 * HemisphereLight and MeshStandardMaterial-lite.
 *
 * Each is checked by RENDERING and hashing the framebuffer, not by
 * inspecting object fields. A material that compiles but shades nothing,
 * or a render target that binds but never receives pixels, would pass any
 * field-level assertion; only the pixels prove the feature works.
 *
 * Every check therefore comes with its own control: a second render that
 * MUST differ. "The hash is stable" and "the hash is stably wrong" look
 * identical otherwise.
 */
import { window, document, Math as M } from "../web/globals.js";
import { Scene } from "../three/core/Scene.js";
import { PerspectiveCamera } from "../three/core/PerspectiveCamera.js";
import { Mesh } from "../three/objects/Mesh.js";
import { BoxGeometry } from "../three/geometries/BoxGeometry.js";
import {
  MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial,
} from "../three/materials/Material.js";
import {
  AmbientLight, DirectionalLight, HemisphereLight,
} from "../three/lights/Light.js";
import { WebGLRenderer } from "../three/renderer/WebGLRenderer.js";
import { WebGLRenderTarget } from "../three/textures/WebGLRenderTarget.js";
import { Vector3 } from "../three/math/Vector3.js";

let passed = 0;
let failed = 0;

function check(cond: boolean, label: string): void {
  if (cond) { passed += 1; } else { failed += 1; console.log(`  FAIL: ${label}`); }
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const W = canvas.width;
  const H = canvas.height;
  const gl = canvas.getContextGL();
  if (gl === null) {
    console.log("phase9: WebGL2 unavailable");
    process.exit(0);
    return;
  }

  const renderer = new WebGLRenderer(gl);
  renderer.setSize(W, H);
  renderer.setClearColor(0x101820);

  const camera = new PerspectiveCamera(60, W / H, 0.1, 100);
  camera.position.set(0, 0, 4);
  camera.lookAt(new Vector3(0, 0, 0));

  console.log("==> Phase 9 closeout");

  /* ---- MeshStandardMaterial ----
   *
   * Roughness must CHANGE the image. A specular term that compiles but
   * contributes nothing would leave the two renders identical. */
  const stdScene = new Scene();
  stdScene.add(new AmbientLight(0x222222, 1));
  const key = new DirectionalLight(0xffffff, 1);
  key.position.set(0.5, 1, 0.8);
  stdScene.add(key);

  const stdMat = new MeshStandardMaterial(0xff8844);
  stdMat.roughness = 0.05;      // tight, bright highlight
  stdMat.metalness = 0.9;
  const stdMesh = new Mesh(new BoxGeometry(1.6, 1.6, 1.6), stdMat);
  stdScene.add(stdMesh);

  renderer.render(stdScene, camera);
  const shiny = gl.hashPixels(0, 0, W, H);

  stdMat.roughness = 1;         // fully diffuse: the highlight should go
  renderer.render(stdScene, camera);
  const rough = gl.hashPixels(0, 0, W, H);

  check(shiny !== rough, "roughness changes the image");

  stdMat.roughness = 0.05;
  stdMat.metalness = 0;         // dielectric: white highlight, full diffuse
  renderer.render(stdScene, camera);
  const dielectric = gl.hashPixels(0, 0, W, H);
  check(dielectric !== shiny, "metalness changes the image");

  /* CONTROL: rendering the SAME state twice must give the same hash. If
   * this fails the hash is noise and every comparison above is
   * meaningless. */
  renderer.render(stdScene, camera);
  const dielectricAgain = gl.hashPixels(0, 0, W, H);
  check(dielectric === dielectricAgain,
        "CONTROL: an unchanged scene hashes the same twice");

  /* ---- HemisphereLight ----
   *
   * Sky above, ground below. Swapping the two colours must change the
   * image: if the ground colour were ignored, both renders would match. */
  const hemiScene = new Scene();
  const hemiMat = new MeshLambertMaterial(0xffffff);
  hemiScene.add(new Mesh(new BoxGeometry(2, 2, 2), hemiMat));
  const hemi = new HemisphereLight(0x0044ff, 0xff4400, 1);
  hemiScene.add(hemi);

  /* The camera must SEE an up-facing surface.
   *
   * A cube's side faces get 0.5*(sky+ground) either way round, and its top
   * and bottom are the only faces that distinguish the two colours. Looking
   * straight at the cube from +Z shows neither, so swapping sky and ground
   * produced a byte-identical image and the check failed against a
   * correct renderer. */
  const hemiCam = new PerspectiveCamera(60, W / H, 0.1, 100);
  hemiCam.position.set(0, 3.2, 3.2);
  hemiCam.lookAt(new Vector3(0, 0, 0));

  renderer.render(hemiScene, hemiCam);
  const skyBlue = gl.hashPixels(0, 0, W, H);

  hemi.color.setHex(0xff4400);        // swap sky and ground
  hemi.groundColor.setHex(0x0044ff);
  renderer.render(hemiScene, hemiCam);
  const skyOrange = gl.hashPixels(0, 0, W, H);

  check(skyBlue !== skyOrange,
        "swapping sky and ground colours changes the image");

  /* Both colours BLACK must differ from either: proves the hemisphere
   * term contributes at all rather than the scene being lit by something
   * else. */
  hemi.color.setHex(0x000000);
  hemi.groundColor.setHex(0x000000);
  renderer.render(hemiScene, hemiCam);
  const dark = gl.hashPixels(0, 0, W, H);
  check(dark !== skyBlue, "a black hemisphere light is not the same as a lit one");

  /* ---- WebGLRenderTarget ----
   *
   * Render a red cube into a target, then a green one, and require the
   * two to differ: that proves pixels actually reach the target rather
   * than the bind silently going nowhere. */
  const rt = new WebGLRenderTarget(128, 128);
  check(rt.texture.isRenderTarget, "the target's texture is flagged as one");
  check(rt.width === 128 && rt.height === 128, "target keeps its size");

  const rtScene = new Scene();
  const rtMat = new MeshBasicMaterial(0xff0000);
  rtScene.add(new Mesh(new BoxGeometry(1.5, 1.5, 1.5), rtMat));

  renderer.setRenderTarget(rt);
  renderer.render(rtScene, camera);
  const rtRed = gl.hashPixels(0, 0, 128, 128);

  rtMat.color.setHex(0x00ff00);
  renderer.render(rtScene, camera);
  const rtGreen = gl.hashPixels(0, 0, 128, 128);
  check(rtRed !== rtGreen, "drawing into a render target changes its pixels");

  renderer.setRenderTarget(null);

  /* Back on the screen, the viewport must be restored. Rendering the
   * full-screen scene again should match the earlier full-screen hash;
   * if setRenderTarget(null) forgot the viewport, the scene would draw
   * into a 128x128 corner and the hash would differ. */
  renderer.render(hemiScene, hemiCam);
  const afterTarget = gl.hashPixels(0, 0, W, H);
  check(afterTarget === dark,
        "setRenderTarget(null) restores the screen viewport");

  /* A resized target drops its GL objects so they are rebuilt. */
  rt.setSize(64, 64);
  check(rt.glFramebuffer === null, "resizing a target invalidates its framebuffer");
  check(rt.width === 64, "resizing a target updates its size");

  console.log("");
  console.log(`phase9 test: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
});
