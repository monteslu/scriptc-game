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

console.log(JSON.stringify(out, null, 2));
