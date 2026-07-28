/* Raycaster and SGMLoader: do they AGREE with three.js?
 *
 * Every `three says` value here came from REAL three.js
 * (test/three-parity/reference.mjs), not from working the arithmetic out by
 * hand. That distinction matters: a hand-derived expectation only proves
 * the code matches my understanding, while these prove it matches the
 * library it claims to be compatible with.
 *
 * Two results worth explaining, because they look wrong and are not:
 *
 *   A centre ray through a PlaneGeometry reports TWO hits, not one. A plane
 *   is two triangles sharing a diagonal, and a ray down the middle crosses
 *   both. three reports both; so must this.
 *
 *   Two stacked planes therefore report FOUR hits, sorted 4,4,6,6.
 */
import { Raycaster, Ray, Intersection } from "../three/core/Raycaster.js";
import { SGMLoader } from "../three/loaders/SGMLoader.js";
import { Mesh } from "../three/objects/Mesh.js";
import { PerspectiveCamera } from "../three/core/PerspectiveCamera.js";
import { PlaneGeometry } from "../three/geometries/PlaneGeometry.js";
import { BoxGeometry } from "../three/geometries/BoxGeometry.js";
import {
  MeshBasicMaterial, FrontSide, DoubleSide,
} from "../three/materials/Material.js";
import { Vector3 } from "../three/math/Vector3.js";
import { Math as M, fetch } from "../web/globals.js";
import { setGameDir } from "../host/resources.js";
import { drainTasks } from "../host/tasks.js";

let passed = 0;
let failed = 0;
const EPS = 0.00001;

function check(cond: boolean, label: string): void {
  if (cond) { passed += 1; } else { failed += 1; console.log(`  FAIL: ${label}`); }
}

function checkNum(actual: number, expected: number, label: string): void {
  const d = actual - expected;
  if ((d < 0 ? -d : d) < EPS) { passed += 1; return; }
  failed += 1;
  console.log(`  FAIL: ${label}: got ${actual}, three says ${expected}`);
}

function checkVec(v: Vector3, x: number, y: number, z: number, label: string): void {
  const dx = v.x - x; const dy = v.y - y; const dz = v.z - z;
  const ok = (dx < 0 ? -dx : dx) < EPS &&
             (dy < 0 ? -dy : dy) < EPS &&
             (dz < 0 ? -dz : dz) < EPS;
  if (ok) { passed += 1; return; }
  failed += 1;
  console.log(`  FAIL: ${label}: got ${v.x},${v.y},${v.z}, three says ${x},${y},${z}`);
}

function makeCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  cam.position.set(0, 0, 5);
  cam.lookAt(new Vector3(0, 0, 0));
  cam.updateMatrixWorld(true);
  return cam;
}

async function main(): Promise<void> {
  /* Set explicitly rather than relying on the working directory: a bare
   * .ts test entry does not go through gen-entry.js, so it has no baked
   * game root and fetch would resolve against wherever it was launched. */
  setGameDir("test/mesh-fixtures");
  console.log("==> Raycaster (vs real three.js)");

  const camera = makeCamera();
  const planeGeo = new PlaneGeometry(2, 2, 1, 1);
  const frontMat = new MeshBasicMaterial();
  frontMat.side = FrontSide;

  /* ---- setFromCamera ---- */
  const rc = new Raycaster();
  rc.setFromCamera(0, 0, camera);
  checkVec(rc.ray.origin, 0, 0, 5, "ray origin (centre)");
  checkVec(rc.ray.direction, 0, 0, -1, "ray direction (centre)");

  rc.setFromCamera(0.5, -0.25, camera);
  checkVec(rc.ray.direction, 0.452865457, -0.12736841, -0.882434228,
           "ray direction (off-centre)");

  /* ---- a plane at the origin ---- */
  const plane = new Mesh(planeGeo, frontMat);
  plane.updateMatrixWorld(true);

  const rcCenter = new Raycaster();
  rcCenter.setFromCamera(0, 0, camera);
  const hits = rcCenter.intersectObject(plane);
  // Two triangles share the diagonal a centre ray runs down; three says 2.
  checkNum(hits.length, 2, "plane hit count");
  if (hits.length > 0) {
    checkNum(hits[0].distance, 5, "plane distance");
    checkVec(hits[0].point, 0, 0, 0, "plane hit point");
    check(hits[0].hasUV, "plane hit carries a uv");
    checkNum(hits[0].uv.x, 0.5, "plane uv.x");
    checkNum(hits[0].uv.y, 0.5, "plane uv.y");
    check(hits[0].object === plane, "hit names the mesh it hit");
  }

  /* ---- a MOVED, ROTATED and SCALED plane ----
   *
   * The case that catches a wrong inverse, or a local ray direction that
   * was re-normalised (which would make `distance` wrong by the scale
   * factor while still reporting a hit). */
  const moved = new Mesh(planeGeo, frontMat);
  moved.position.set(0.6, -0.3, -2);
  moved.scale.set(2, 2, 2);
  moved.setRotationFromEuler(0, 0.4, 0);
  moved.updateMatrixWorld(true);

  const rcMoved = new Raycaster();
  rcMoved.setFromCamera(0.1, 0.1, camera);
  const movedHits = rcMoved.intersectObject(moved);
  checkNum(movedHits.length, 1, "transformed plane hit count");
  if (movedHits.length > 0) {
    checkNum(movedHits[0].distance, 7.101098913, "transformed plane distance");
    checkVec(movedHits[0].point, 0.723855091, 0.407168488, -2.052365092,
             "transformed plane hit point");
    checkNum(movedHits[0].uv.x, 0.533617505, "transformed plane uv.x");
    checkNum(movedHits[0].uv.y, 0.676792122, "transformed plane uv.y");
  }

  /* ---- backface culling ---- */
  const away = new Mesh(planeGeo, frontMat);
  away.setRotationFromEuler(0, M.PI, 0);
  away.updateMatrixWorld(true);
  checkNum(rcCenter.intersectObject(away).length, 0,
           "FrontSide plane facing away is NOT hit");

  const doubleMat = new MeshBasicMaterial();
  doubleMat.side = DoubleSide;
  const awayDouble = new Mesh(planeGeo, doubleMat);
  awayDouble.setRotationFromEuler(0, M.PI, 0);
  awayDouble.updateMatrixWorld(true);
  checkNum(rcCenter.intersectObject(awayDouble).length, 1,
           "DoubleSide plane facing away IS hit");

  /* ---- misses ---- */
  const missRc = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 1, 0));
  checkNum(missRc.intersectObject(plane).length, 0, "ray pointing away misses");

  const behindRc = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, 1));
  checkNum(behindRc.intersectObject(plane).length, 0,
           "geometry behind the origin is not hit");

  /* ---- sorting ---- */
  const near = new Mesh(planeGeo, frontMat);
  near.position.set(0, 0, 1);
  near.updateMatrixWorld(true);
  const far = new Mesh(planeGeo, frontMat);
  far.position.set(0, 0, -1);
  far.updateMatrixWorld(true);

  // Deliberately passed FAR first: the sort must reorder them.
  const sorted = rcCenter.intersectObjects([far, near]);
  checkNum(sorted.length, 4, "two planes give four triangle hits");
  if (sorted.length === 4) {
    checkNum(sorted[0].distance, 4, "nearest hit first");
    checkNum(sorted[1].distance, 4, "second hit");
    checkNum(sorted[2].distance, 6, "third hit");
    checkNum(sorted[3].distance, 6, "furthest hit last");
    check(sorted[0].object === near, "nearest hit names the near mesh");
  }

  /* ---- near / far clamps ---- */
  const clamped = new Raycaster();
  clamped.setFromCamera(0, 0, camera);
  clamped.far = 5.5;
  checkNum(clamped.intersectObjects([far, near]).length, 2,
           "far clamp drops the distant plane");

  const nearClamp = new Raycaster();
  nearClamp.setFromCamera(0, 0, camera);
  nearClamp.near = 5;
  checkNum(nearClamp.intersectObjects([far, near]).length, 2,
           "near clamp drops the close plane");

  /* ---- firstHitOnly ---- */
  const firstOnly = new Raycaster();
  firstOnly.setFromCamera(0, 0, camera);
  firstOnly.firstHitOnly = true;
  checkNum(firstOnly.intersectObjects([far, near]).length, 1,
           "firstHitOnly returns as soon as anything is hit");

  /* ---- a box, so the test is not all planes ---- */
  const box = new Mesh(new BoxGeometry(2, 2, 2), frontMat);
  box.updateMatrixWorld(true);
  const boxHits = rcCenter.intersectObject(box);
  check(boxHits.length > 0, "box is hit");
  if (boxHits.length > 0) {
    // The near face of a 2x2x2 box at the origin sits at z=1; camera at z=5.
    checkNum(boxHits[0].distance, 4, "box near-face distance");
    // A FrontSide box hides its back faces, so only the near face is hit.
    checkNum(boxHits.length, 2, "only the near face of a solid box is hit");
    checkVec(boxHits[0].normal, 0, 0, 1, "box hit normal faces the camera");
  }

  /* ---- Ray helpers ---- */
  const ray = new Ray(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
  const at = new Vector3();
  ray.at(3, at);
  checkVec(at, 3, 0, 0, "ray.at");
  checkNum(ray.distanceSqToPoint(new Vector3(2, 2, 0)), 4, "distanceSqToPoint");
  // A point behind the origin measures from the ORIGIN, not backwards.
  checkNum(ray.distanceSqToPoint(new Vector3(-3, 4, 0)), 25,
           "distanceSqToPoint clamps behind the origin");
  checkNum(ray.intersectSphere(new Vector3(5, 0, 0), 1), 4, "intersectSphere");
  checkNum(ray.intersectSphere(new Vector3(5, 5, 0), 1), -1,
           "intersectSphere misses");

  /* ---- CONTROL ----
   *
   * Every check above passes, so a comparison that always returned true
   * would look identical. This proves the harness can report a failure. */
  const before = failed;
  checkNum(1, 2, "");
  const canFail = failed === before + 1;
  failed = before;
  passed += 1;
  if (canFail) {
    console.log("  (control: a wrong value was correctly reported)");
  } else {
    console.log("  FAIL: the harness cannot detect a wrong value");
    failed += 1;
  }

  /* ---- SGMLoader ----
   *
   * Loads the fixtures baked by codegen/bake-mesh.js. The bake is verified
   * byte-for-byte by the build step; what this proves is the ROUND TRIP --
   * that the loader reconstructs what the baker wrote. */
  console.log("");
  console.log("==> SGMLoader (round trip through codegen/bake-mesh.js)");

  const loader = new SGMLoader();

  /* fetch settles from the task queue, and `await` suspends main with
   * nothing left to drain it: the process would exit with the await
   * pending and every check below silently skipped (exit 0, no output).
   * So each await is raced with a pump that keeps the queue turning. */
  const tetraBytes = await loadBytes("tetra.sgm");
  check(tetraBytes !== null, "tetra.sgm was found");
  if (tetraBytes === null) { finish(); return; }
  const tetra = loader.parse(tetraBytes, "tetra.sgm");

  const tPos = tetra.position;
  const tNrm = tetra.normal;
  check(tPos !== null, "tetra has positions");
  if (tPos !== null) checkNum(tPos.count, 12, "tetra vertex count");
  check(tNrm !== null, "tetra has normals");
  check(tetra.uv !== null, "tetra has uvs");
  check(tetra.color === null, "tetra has NO colours (the .obj had none)");
  check(tetra.index !== null, "tetra is indexed");
  if (tetra.index !== null) {
    checkNum(tetra.index.array.length, 12, "tetra index count");
  }

  /* The apex (0,1,0) appears three times with three DIFFERENT normals:
   * that is the v/vt/vn de-duplication the OBJ parser does, and the thing
   * most likely to be silently wrong. */
  if (tPos !== null && tNrm !== null) {
    checkNum(tPos.array[0], 0, "tetra vertex 0 x");
    checkNum(tPos.array[1], 1, "tetra vertex 0 y");
    checkNum(tNrm.array[2], 0.9, "tetra vertex 0 normal z");
    checkNum(tPos.array[9], 0, "tetra vertex 3 shares the apex x");
    checkNum(tPos.array[10], 1, "tetra vertex 3 shares the apex y");
    checkNum(tNrm.array[9], 0.8, "tetra vertex 3 has its OWN normal");
  }

  /* tri.sgm came from a GLB with an INTERLEAVED position/normal buffer
   * (byteStride 24) and a NORMALIZED u8 colour attribute. Both are resolved
   * at bake time, so what arrives here must be plain floats. */
  const triBytes = await loadBytes("tri.sgm");
  check(triBytes !== null, "tri.sgm was found");
  if (triBytes === null) { finish(); return; }
  const tri = loader.parse(triBytes, "tri.sgm");

  const triPos = tri.position;
  const triCol = tri.color;
  check(triPos !== null, "tri has positions");
  if (triPos !== null) {
    checkNum(triPos.count, 3, "tri vertex count");
    checkNum(triPos.array[0], -1, "tri vertex 0 x (from a strided buffer)");
    checkNum(triPos.array[4], -1, "tri vertex 1 y (from a strided buffer)");
  }
  check(triCol !== null, "tri has colours");
  if (triCol !== null) {
    checkNum(triCol.array[0], 1, "tri colour 0 r (normalised u8 255 -> 1.0)");
    checkNum(triCol.array[1], 0, "tri colour 0 g");
    checkNum(triCol.array[4], 1, "tri colour 1 g");
  }
  check(tri.uv === null, "tri has NO uvs (the GLB had none)");

  /* A malformed file must THROW with a useful message rather than yielding
   * an empty geometry that renders as nothing and looks like a shader bug. */
  let threw = false;
  try {
    loader.parse(Buffer.alloc(64), "junk.sgm");
  } catch (e) {
    threw = true;
  }
  check(threw, "a file with the wrong magic is REFUSED, not silently empty");

  let truncThrew = false;
  const trunc = Buffer.alloc(24);
  trunc.writeUInt32LE(1296519936, 0);   // 0x4d475300, the .sgm magic
  trunc.writeUInt32LE(1, 4);
  trunc.writeUInt32LE(0, 8);
  trunc.writeUInt32LE(9999, 12);        // claims 9999 vertices
  trunc.writeUInt32LE(0, 16);
  try {
    loader.parse(trunc, "trunc.sgm");
  } catch (e) {
    truncThrew = true;
  }
  check(truncThrew, "a truncated file is REFUSED");

  finish();
}

function finish(): void {
  console.log("");
  console.log(`raycaster + loader test: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

/* Fetch bytes while keeping the task queue turning.
 *
 * The result is captured by a .then rather than awaited directly, and the
 * loop below both drains the queue and yields, so the continuation can
 * actually run. Returns null if it never settles within the budget, which
 * is a real failure rather than a hang. */
async function loadBytes(url: string): Promise<Buffer | null> {
  let out: Buffer | null = null;
  let done = false;
  fetch(url)
    .then((res) => res.arrayBuffer())
    .then((bytes) => { out = bytes; done = true; })
    .catch(() => { done = true; });
  for (let i = 0; i < 200 && !done; i++) {
    drainTasks();
    await Promise.resolve(0);
  }
  return out;
}

main();
