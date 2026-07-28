/* Reference values from REAL three.js.
 *
 * The point of threeTS-lite being API-compatible is that a project can swap
 * it for three. That only holds if the math AGREES, so these are the
 * numbers three produces for a set of operations, dumped for the native
 * suite to compare against.
 *
 * Plain JS on the build machine, never through scriptc.
 */
import * as THREE from "three";

const out = {};
const r = (n) => Number(n.toFixed(9));

// Vector3
const v = new THREE.Vector3(1, 2, 3);
out.v3_length = r(v.length());
out.v3_normalized = new THREE.Vector3(1, 2, 3).normalize().toArray().map(r);
out.v3_cross = new THREE.Vector3(1, 0, 0).cross(new THREE.Vector3(0, 1, 0)).toArray().map(r);
out.v3_dot = r(new THREE.Vector3(1, 2, 3).dot(new THREE.Vector3(4, 5, 6)));

// Quaternion
const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
out.q_axisAngle = [r(q.x), r(q.y), r(q.z), r(q.w)];
const qe = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.4, 0.5, "XYZ"));
out.q_euler = [r(qe.x), r(qe.y), r(qe.z), r(qe.w)];
const qm = new THREE.Quaternion(0.1, 0.2, 0.3, 0.9).normalize()
  .multiply(new THREE.Quaternion(0.4, 0.1, 0.2, 0.8).normalize());
out.q_multiply = [r(qm.x), r(qm.y), r(qm.z), r(qm.w)];

// Matrix4
out.m4_perspective = new THREE.Matrix4()
  .makePerspective(-1, 1, 0.75, -0.75, 0.1, 100).elements.map(r);
const compose = new THREE.Matrix4().compose(
  new THREE.Vector3(1, 2, 3),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7),
  new THREE.Vector3(2, 2, 2));
out.m4_compose = compose.elements.map(r);
out.m4_inverse = compose.clone().invert().elements.map(r);
const mul = new THREE.Matrix4().makeRotationY(0.5)
  .multiply(new THREE.Matrix4().makeTranslation(1, 2, 3));
out.m4_multiply = mul.elements.map(r);
out.m4_lookAt = new THREE.Matrix4().lookAt(
  new THREE.Vector3(3, 4, 5), new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 1, 0)).elements.map(r);

// Vector3 through a matrix
out.v3_applyMatrix4 = new THREE.Vector3(1, 2, 3).applyMatrix4(compose).toArray().map(r);

/* ---- Raycaster ----
 *
 * The interesting cases are the ones easy to get subtly wrong: a ray built
 * from an NDC coordinate through a real camera, a hit on a TRANSFORMED mesh
 * (which exercises the world-to-local ray transform and the scale carried
 * in the local ray's direction), backface culling, and barycentric uv
 * interpolation. */
const rcCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
rcCamera.position.set(0, 0, 5);
rcCamera.lookAt(0, 0, 0);
rcCamera.updateMatrixWorld(true);

const rc = new THREE.Raycaster();
rc.setFromCamera(new THREE.Vector2(0, 0), rcCamera);
out.ray_origin_center = rc.ray.origin.toArray().map(r);
out.ray_dir_center = rc.ray.direction.toArray().map(r);

rc.setFromCamera(new THREE.Vector2(0.5, -0.25), rcCamera);
out.ray_origin_off = rc.ray.origin.toArray().map(r);
out.ray_dir_off = rc.ray.direction.toArray().map(r);

/* A plane at the origin, then the same plane moved, rotated and scaled:
 * the transformed case is where a wrong inverse or a re-normalised local
 * direction shows up as a wrong `distance`. */
const planeGeo = new THREE.PlaneGeometry(2, 2, 1, 1);
const planeMat = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
const plane = new THREE.Mesh(planeGeo, planeMat);
plane.updateMatrixWorld(true);

const rcCenter = new THREE.Raycaster();
rcCenter.setFromCamera(new THREE.Vector2(0, 0), rcCamera);
const hits = rcCenter.intersectObject(plane);
out.ray_plane_hitcount = hits.length;
out.ray_plane_distance = r(hits[0].distance);
out.ray_plane_point = hits[0].point.toArray().map(r);
out.ray_plane_uv = [r(hits[0].uv.x), r(hits[0].uv.y)];

const moved = new THREE.Mesh(planeGeo, planeMat);
moved.position.set(0.6, -0.3, -2);
moved.scale.set(2, 2, 2);
moved.rotation.set(0, 0.4, 0);
moved.updateMatrixWorld(true);
const rcMoved = new THREE.Raycaster();
rcMoved.setFromCamera(new THREE.Vector2(0.1, 0.1), rcCamera);
const movedHits = rcMoved.intersectObject(moved);
out.ray_moved_hitcount = movedHits.length;
out.ray_moved_distance = r(movedHits[0].distance);
out.ray_moved_point = movedHits[0].point.toArray().map(r);
out.ray_moved_uv = [r(movedHits[0].uv.x), r(movedHits[0].uv.y)];

/* Backface culling: a FrontSide plane rotated to face AWAY must not be hit,
 * and the same plane as DoubleSide must be. */
const away = new THREE.Mesh(planeGeo,
  new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
away.rotation.set(0, Math.PI, 0);
away.updateMatrixWorld(true);
out.ray_backface_frontside = rcCenter.intersectObject(away).length;

const awayDouble = new THREE.Mesh(planeGeo,
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
awayDouble.rotation.set(0, Math.PI, 0);
awayDouble.updateMatrixWorld(true);
out.ray_backface_doubleside = rcCenter.intersectObject(awayDouble).length;

/* A ray that misses entirely, and one aimed backwards: both must report
 * nothing rather than a negative distance. */
const missRc = new THREE.Raycaster(
  new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 1, 0));
out.ray_miss = missRc.intersectObject(plane).length;
const behindRc = new THREE.Raycaster(
  new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 1));
out.ray_behind = behindRc.intersectObject(plane).length;

/* Sorting: two planes at different depths, nearest first. */
const near = new THREE.Mesh(planeGeo, planeMat);
near.position.set(0, 0, 1);
near.updateMatrixWorld(true);
const far = new THREE.Mesh(planeGeo, planeMat);
far.position.set(0, 0, -1);
far.updateMatrixWorld(true);
const sorted = rcCenter.intersectObjects([far, near]);
out.ray_sorted_count = sorted.length;
out.ray_sorted_distances = sorted.map((h) => r(h.distance));

console.log(JSON.stringify(out, null, 2));
