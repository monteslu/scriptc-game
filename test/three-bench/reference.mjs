/* The REFERENCE half of the head-to-head benchmark.
 *
 * Runs the spinfield scene under Node + REAL three.js + webgl-node and
 * reports frame times. `examples/spinfield` runs the same scene natively
 * through threeTS-lite. The question the whole 3D tier exists to answer is
 * "is this competitive with three.js", and this is the only thing that
 * answers it.
 *
 * THE SCENE MUST MATCH. Same cube count, same geometry, same material
 * class, same light rig, same camera, same per-cube math, same fixed
 * timestep, same warmup. Anything that differs makes the comparison
 * meaningless, so the constants below are copied from
 * examples/spinfield/main.ts and any change there has to be mirrored here.
 *
 * Plain JS on the build machine, never through scriptc.
 */
import { createWebGL2Context } from "webgl-node";
import * as THREE from "three";

/* ---- must match examples/spinfield/main.ts ---- */
const W = 960;
const H = 600;
const FIELD_RADIUS = 26;
const MAX_CUBES = 10000;
const SWEEP = [250, 1000, 2500, 10000];
const FRAMES = 240;
const WARMUP = 20;
const DT = 1 / 60;          // fixed timestep, as in spinfield

/* The same LCG, so the two stacks place cubes identically. Matching
 * placement matters: a different distribution changes overdraw and
 * therefore the frame time. */
let seed = 0x2f6e21;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

const cubes = [];
for (let i = 0; i < MAX_CUBES; i++) {
  const u = rand() * 2 - 1;
  const theta = rand() * Math.PI * 2;
  const r = FIELD_RADIUS * Math.pow(rand(), 1 / 3);
  const s = Math.sqrt(1 - u * u);
  const c = {
    px: r * s * Math.cos(theta),
    py: r * s * Math.sin(theta),
    pz: r * u,
  };
  const ax = rand() * 2 - 1;
  const ay = rand() * 2 - 1;
  const az = rand() * 2 - 1;
  const alen = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  c.axisX = ax / alen;
  c.axisY = ay / alen;
  c.axisZ = az / alen;
  c.spinRate = 0.4 + rand() * 1.8;
  c.phase = rand() * Math.PI * 2;
  c.scale = 0.35 + rand() * 0.5;
  const t = (c.pz + FIELD_RADIUS) / (FIELD_RADIUS * 2);
  c.r = 0.35 + t * 0.6;
  c.g = 0.55 + (1 - t) * 0.35;
  c.b = 0.95 - t * 0.35;
  cubes.push(c);
}

/* createWebGL2Context returns a WRAPPER carrying `canvas` and `gl`; the
 * real WebGL2 context with all 776 members is the inner `.gl`. Handing
 * three the wrapper gives it an object with none of the methods it
 * needs. */
const ctxWrapper = createWebGL2Context(W, H);
if (!ctxWrapper) {
  console.log("BENCH SKIP no GL context");
  process.exit(0);
}
const gl = ctxWrapper.gl;

/* three queries the context for attributes a browser always supplies.
 * webgl-node has no browser to ask, so this reports what the context
 * actually is: a plain opaque back buffer with a depth attachment. */
if (typeof gl.getContextAttributes !== "function") {
  gl.getContextAttributes = () => ({
    alpha: false,
    depth: true,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "default",
    failIfMajorPerformanceCaveat: false,
  });
}

/* webgl-node supplies its own canvas-shaped object. */
const canvas = ctxWrapper.canvas || {
  width: W, height: H,
  addEventListener() {}, removeEventListener() {},
  getContext() { return gl; }, style: {},
};

const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
renderer.setSize(W, H, false);
renderer.setClearColor(0x0b1020, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 400);

scene.add(new THREE.AmbientLight(0x404a66, 1));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(0.4, 1, 0.6);
scene.add(sun);

const cubeGeo = new THREE.BoxGeometry(1, 1, 1);

/* Instanced path: one InstancedMesh, per-instance colour, same as ours. */
const instMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const instanced = new THREE.InstancedMesh(cubeGeo, instMat, MAX_CUBES);
const tmpColor = new THREE.Color();
for (let i = 0; i < MAX_CUBES; i++) {
  tmpColor.setRGB(cubes[i].r, cubes[i].g, cubes[i].b);
  instanced.setColorAt(i, tmpColor);
}
instanced.count = 0;
scene.add(instanced);

/* Per-mesh path, built lazily to the largest count used. */
const meshes = [];
function ensureMeshes(n) {
  while (meshes.length < n) {
    const c = cubes[meshes.length];
    const m = new THREE.MeshLambertMaterial();
    m.color.setRGB(c.r, c.g, c.b);
    const mesh = new THREE.Mesh(cubeGeo, m);
    mesh.visible = false;
    meshes.push(mesh);
    scene.add(mesh);
  }
}

const scratch = new THREE.Matrix4();
const q = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3(1, 1, 1);
const axis = new THREE.Vector3(0, 1, 0);
const camTarget = new THREE.Vector3(0, 0, 0);

function frame(simTime, count, useInstanced) {
  if (useInstanced) {
    instanced.visible = true;
    instanced.count = count;
    for (let i = 0; i < count; i++) {
      const c = cubes[i];
      axis.set(c.axisX, c.axisY, c.axisZ);
      q.setFromAxisAngle(axis, c.phase + simTime * c.spinRate);
      pos.set(c.px, c.py, c.pz);
      scl.set(c.scale, c.scale, c.scale);
      scratch.compose(pos, q, scl);
      instanced.setMatrixAt(i, scratch);
    }
    instanced.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < meshes.length; i++) meshes[i].visible = false;
  } else {
    instanced.visible = false;
    ensureMeshes(count);
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      if (i >= count) { mesh.visible = false; continue; }
      const c = cubes[i];
      mesh.visible = true;
      axis.set(c.axisX, c.axisY, c.axisZ);
      mesh.quaternion.setFromAxisAngle(axis, c.phase + simTime * c.spinRate);
      mesh.position.set(c.px, c.py, c.pz);
      mesh.scale.set(c.scale, c.scale, c.scale);
    }
  }

  const orbit = simTime * 0.12;
  camera.position.set(Math.sin(orbit) * 96, Math.sin(orbit * 0.4) * 26,
                      Math.cos(orbit) * 96);
  camera.lookAt(camTarget);

  renderer.render(scene, camera);
}

function measure(count, useInstanced) {
  let simTime = 0;
  // Warmup: shader compiles and buffer creation are startup cost.
  for (let i = 0; i < WARMUP; i++) { frame(simTime, count, useInstanced); simTime += DT; }

  const samples = [];
  for (let i = 0; i < FRAMES; i++) {
    const t0 = performance.now();
    frame(simTime, count, useInstanced);
    /* CPU SUBMIT TIME, matching examples/spinfield.
     *
     * No finish(): the native side presents every frame and a finish there
     * blocks on the swap chain (measured at ~30ms regardless of load),
     * while this reference renders offscreen and would block on nothing.
     * Submit time is the quantity both stacks can report honestly. */
    samples.push(performance.now() - t0);
    simTime += DT;
  }
  samples.sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    mean: sum / samples.length,
    p50: samples[(samples.length * 0.5) | 0],
    p95: samples[(samples.length * 0.95) | 0],
  };
}

for (const count of SWEEP) {
  for (const inst of [true, false]) {
    const r = measure(count, inst);
    console.log(`BENCH ${inst ? "instanced" : "per-mesh "} ${count} ` +
                `${r.mean.toFixed(3)} ${r.p50.toFixed(3)} ${r.p95.toFixed(3)}`);
  }
}
