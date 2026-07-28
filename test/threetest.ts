/* threeTS-lite math: does it AGREE with three.js?
 *
 * The library is API-compatible with three so a project can swap one for the
 * other. That claim is worthless if the numbers differ, so every expected
 * value here was produced by REAL three.js
 * (test/three-parity/reference.mjs) rather than derived by hand.
 *
 * Tolerance is 1e-6: three computes in f64 and so does this, but the two
 * arrive at results through different expression orderings, and comparing
 * floats for exact equality would fail on the last bit for no useful reason.
 */
import { Vector3 } from "../three/math/Vector3.js";
import { Quaternion } from "../three/math/Quaternion.js";
import { Matrix4 } from "../three/math/Matrix4.js";
import { Math as M } from "../web/globals.js";

let passed = 0;
let failed = 0;

const EPS = 0.000001;

function near(a: number, b: number): boolean {
  const d = a - b;
  return (d < 0 ? -d : d) < EPS;
}

function check(cond: boolean, label: string): void {
  if (cond) { passed += 1; } else { failed += 1; console.log(`  FAIL: ${label}`); }
}

function checkNum(actual: number, expected: number, label: string): void {
  if (near(actual, expected)) { passed += 1; return; }
  failed += 1;
  console.log(`  FAIL: ${label}: got ${actual}, three says ${expected}`);
}

function checkArr(actual: number[], expected: number[], label: string): void {
  if (actual.length !== expected.length) {
    failed += 1;
    console.log(`  FAIL: ${label}: length ${actual.length}, three says ${expected.length}`);
    return;
  }
  for (let i = 0; i < actual.length; i++) {
    if (!near(actual[i], expected[i])) {
      failed += 1;
      console.log(`  FAIL: ${label}[${i}]: got ${actual[i]}, three says ${expected[i]}`);
      return;
    }
  }
  passed += 1;
}

function main(): void {
  console.log("==> threeTS-lite math (vs real three.js)");

  /* ---- Vector3 ---- */
  checkNum(new Vector3(1, 2, 3).length(), 3.741657387, "v3.length");
  checkArr(new Vector3(1, 2, 3).normalize().toArray([], 0),
           [0.267261242, 0.534522484, 0.801783726], "v3.normalize");
  checkArr(new Vector3(1, 0, 0).cross(new Vector3(0, 1, 0)).toArray([], 0),
           [0, 0, 1], "v3.cross");
  checkNum(new Vector3(1, 2, 3).dot(new Vector3(4, 5, 6)), 32, "v3.dot");

  /* Default arguments: `new Vector3()` is the origin in three. */
  const origin = new Vector3();
  check(origin.x === 0 && origin.y === 0 && origin.z === 0,
        "new Vector3() defaults to the origin");

  /* ---- Quaternion ---- */
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), M.PI / 3);
  checkArr(q.toArray([], 0), [0, 0.5, 0, 0.866025404], "q.setFromAxisAngle");

  const qe = new Quaternion().setFromEuler(0.3, 0.4, 0.5);
  checkArr(qe.toArray([], 0),
           [0.190505913, 0.154097076, 0.26851547, 0.931590592], "q.setFromEuler(XYZ)");

  const qm = new Quaternion(0.1, 0.2, 0.3, 0.9).normalize()
    .multiply(new Quaternion(0.4, 0.1, 0.2, 0.8).normalize());
  checkArr(qm.toArray([], 0),
           [0.500773396, 0.389490419, 0.389490419, 0.667697861], "q.multiply");

  /* ---- Matrix4 ----
   * makePerspective takes FRUSTUM BOUNDS in three, not fov/aspect. Getting
   * that wrong is silent: the scene renders, just with the wrong
   * projection. */
  const persp = new Matrix4().makePerspective(-1, 1, 0.75, -0.75, 0.1, 100);
  checkArr(persp.elements,
           [0.1, 0, 0, 0, 0, 0.133333333, 0, 0, 0, 0, -1.002002002, -1, 0, 0, -0.2002002, 0], "m4.makePerspective");

  const compose = new Matrix4().compose(
    new Vector3(1, 2, 3),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7),
    new Vector3(2, 2, 2));
  checkArr(compose.elements,
           [1.529684375, 0, -1.288435374, 0, 0, 2, 0, 0, 1.288435374, 0, 1.529684375, 0, 1, 2, 3, 1], "m4.compose");

  checkArr(compose.clone().invert().elements,
           [0.382421094, 0, 0.322108844, 0, 0, 0.5, 0, 0, -0.322108844, 0, 0.382421094, 0, 0.583905437, -1, -1.469372125, 1], "m4.invert");

  const mul = new Matrix4().makeRotationY(0.5)
    .multiply(new Matrix4().makeTranslation(1, 2, 3));
  checkArr(mul.elements,
           [0.877582562, 0, -0.479425539, 0, 0, 1, 0, 0, 0.479425539, 0, 0.877582562, 0, 2.315859178, 2, 2.153322147, 1], "m4.multiply");

  checkArr(new Matrix4().lookAt(new Vector3(3, 4, 5), new Vector3(0, 0, 0),
                                new Vector3(0, 1, 0)).elements,
           [0.857492926, 0, -0.514495755, 0, -0.29104275, 0.824621125, -0.48507125, 0, 0.424264069, 0.565685425, 0.707106781, 0, 0, 0, 0, 1], "m4.lookAt");

  checkArr(new Vector3(1, 2, 3).applyMatrix4(compose).toArray([], 0),
           [6.394990498, 6, 6.300617749], "v3.applyMatrix4");

  /* ---- CONTROL ----
   * Every check above passes when the math is right, so a comparison that
   * always returned true would look identical. This proves it can fail. */
  const before = failed;
  checkNum(1.0, 2.0, "");
  const canFail = failed === before + 1;
  failed = before;
  passed += 1;
  if (canFail) {
    console.log("  (control: a wrong value was correctly reported)");
  } else {
    console.log("  FAIL: the harness cannot detect a wrong value");
    failed += 1;
  }

  console.log(`\nthree math test: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
