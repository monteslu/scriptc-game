/* spinfield: the threeTS-lite benchmark.
 *
 * N spinning cubes, drawn two ways, switchable at runtime:
 *
 *   INSTANCED      one InstancedMesh, one draw call, one matrix buffer
 *                  re-uploaded per frame.
 *   NON-INSTANCED  N separate Meshes, N draw calls, N sets of uniforms.
 *
 * Both paths do identical per-cube MATH; the only difference is how the
 * transforms reach the GPU. That is the point: it isolates draw-call and
 * uniform-upload overhead, which is what instancing exists to remove, and
 * it keeps the comparison honest rather than measuring two different
 * workloads.
 *
 * Also exercises Line and Points, so the benchmark doubles as the
 * integration test for everything added in 9.3.
 *
 * Controls (keyboard, or gamepad where noted):
 *   I / gamepad A      toggle instanced vs non-instanced
 *   [ and ]            fewer / more cubes
 *   P                  toggle the point cloud
 *   L                  toggle the wire box
 *   SPACE              pause the spin (rendering continues)
 *
 * On startup it SWEEPS both paths across a range of counts and prints a
 * comparison table, then hands control to the keyboard. Any key during the
 * sweep aborts it and goes interactive immediately.
 */
import {
  window, document, requestAnimationFrame, KeyboardEvent, navigator,
  performance, Math, Gamepad,
} from "../../web/globals.js";

import { Scene } from "../../three/core/Scene.js";
import { PerspectiveCamera } from "../../three/core/PerspectiveCamera.js";
import { Mesh } from "../../three/objects/Mesh.js";
import { InstancedMesh } from "../../three/objects/InstancedMesh.js";
import { Line, LineSegments, Points } from "../../three/objects/Sprite.js";
import { BoxGeometry } from "../../three/geometries/BoxGeometry.js";
import { BufferGeometry } from "../../three/core/BufferGeometry.js";
import { BufferAttribute } from "../../three/core/BufferAttribute.js";
import {
  MeshLambertMaterial, LineBasicMaterial, PointsMaterial,
} from "../../three/materials/Material.js";
import { AmbientLight, DirectionalLight } from "../../three/lights/Light.js";
import { WebGLRenderer } from "../../three/renderer/WebGLRenderer.js";
import { Matrix4 } from "../../three/math/Matrix4.js";
import { Quaternion } from "../../three/math/Quaternion.js";
import { Vector3 } from "../../three/math/Vector3.js";
import { Color } from "../../three/math/Color.js";

/* Benchmark parameters are CONSTANTS rather than env vars or a query
 * string: game source that reads process.env cannot run in a browser (the
 * portability rule this whole tree is built on), and there is no location
 * shim to parse a query from. The sweep below covers the interesting range
 * automatically, so there is nothing a knob would add. */
const START_COUNT = 2000;
const START_INSTANCED = true;
/* Frames per configuration during the automatic sweep. 0 disables the
 * sweep and leaves the field under interactive control. */
const SWEEP_FRAMES = 240;

const FIELD_RADIUS = 26;
const MAX_CUBES = 10000;

/* Per-cube state. Both render paths read exactly this, so neither can get
 * a cheaper workload than the other. */
class Cube {
  px = 0; py = 0; pz = 0;
  axisX = 0; axisY = 1; axisZ = 0;
  spinRate = 1;
  phase = 0;
  scale = 1;
  r = 1; g = 1; b = 1;
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const W = canvas.width;
  const H = canvas.height;

  const gl = canvas.getContextGL();
  if (gl === null) {
    console.log("spinfield: WebGL2 is unavailable");
    return;
  }

  /* A non-null alias: the null check above does not narrow inside the
   * frame closure. */
  const glc = gl;
  const renderer = new WebGLRenderer(gl);
  renderer.setSize(W, H);
  renderer.setClearColor(0x0b1020);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, W / H, 0.1, 400);
  camera.position.set(0, 0, 96);

  scene.addLight(new AmbientLight(0x404a66, 1));
  const sun = new DirectionalLight(0xffffff, 1);
  sun.position.set(0.4, 1, 0.6);
  scene.addLight(sun);

  /* ---- the field ----
   *
   * A fixed LCG rather than Math.random: every run places cubes
   * identically, so two timing runs are comparable and a screenshot is
   * reproducible. */
  let seed = 0x2f6e21;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  const cubes: Cube[] = [];
  for (let i = 0; i < MAX_CUBES; i++) {
    const c = new Cube();
    /* Rejection-free spherical placement: a cube root on the radius keeps
     * the density uniform instead of clumping at the centre. */
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = FIELD_RADIUS * Math.pow(rand(), 1 / 3);
    const s = Math.sqrt(1 - u * u);
    c.px = r * s * Math.cos(theta);
    c.py = r * s * Math.sin(theta);
    c.pz = r * u;

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

    // A cool-to-warm ramp by depth, so the field reads as volume not soup.
    const t = (c.pz + FIELD_RADIUS) / (FIELD_RADIUS * 2);
    c.r = 0.35 + t * 0.6;
    c.g = 0.55 + (1 - t) * 0.35;
    c.b = 0.95 - t * 0.35;
    cubes.push(c);
  }

  const cubeGeo = new BoxGeometry(1, 1, 1);

  /* ---- instanced path ---- */
  const instMat = new MeshLambertMaterial();
  instMat.color.setHex(0xffffff);   // per-instance colour supplies the hue
  const instanced = new InstancedMesh(cubeGeo, instMat, MAX_CUBES);
  const instColor = new Color(0xffffff);
  for (let i = 0; i < MAX_CUBES; i++) {
    const c = cubes[i];
    instColor.setRGB(c.r, c.g, c.b);
    instanced.setColorAt(i, instColor);
  }
  scene.addInstancedMesh(instanced);

  /* ---- non-instanced path ----
   *
   * Built lazily up to whatever count has been asked for: allocating 10k
   * Meshes when the benchmark starts at 2000 would charge the instanced
   * path for memory it never uses. */
  const meshes: Mesh[] = [];
  function ensureMeshes(n: number): void {
    while (meshes.length < n) {
      const c = cubes[meshes.length];
      const m = new MeshLambertMaterial();
      m.color.setRGB(c.r, c.g, c.b);
      const mesh = new Mesh(cubeGeo, m);
      mesh.visible = false;
      meshes.push(mesh);
      scene.addMesh(mesh);
    }
  }

  /* ---- a wire box marking the field bounds (Line) ---- */
  const boxLine = makeWireBox(FIELD_RADIUS);
  scene.addLine(boxLine);

  /* ---- a point cloud at the field's outer shell (Points) ---- */
  const cloud = makePointCloud(rand);
  scene.addPoints(cloud);

  /* ---- state ---- */
  /* The sweep: each entry is (count, instanced) and runs for SWEEP_FRAMES.
   * Both paths at each count, so the table reads as matched pairs. */
  const sweep: number[] = [250, 1000, 2500, 10000];
  /* When sweeping, the FIRST configuration must come from the sweep table
   * too, not from START_*: initialising from START_* mislabelled row one
   * and shifted every instanced/per-mesh pair by one. */
  let count = SWEEP_FRAMES > 0 ? sweep[0] : START_COUNT;
  let useInstanced = SWEEP_FRAMES > 0 ? true : START_INSTANCED;
  let spinning = true;
  let showPoints = true;
  let showLines = true;

  const scratch = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3(1, 1, 1);
  const axis = new Vector3(0, 1, 0);

  /* ---- timing ----
   *
   * Frame time is measured around the WHOLE frame (update + render), which
   * is what a game actually experiences. A mean alone hides stalls, so the
   * report carries p50/p95 and the worst frame too. */
  let sweepIndex = 0;
  let sweepInstanced = true;
  let sweeping = SWEEP_FRAMES > 0;
  const results: string[] = [];
  const samples: number[] = [];
  let frames = 0;
  let last = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsShown = 0;

  const prevButtons: boolean[] = [];

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    const k = e.key;
    if (sweeping) {
      // Someone is watching: stop benchmarking and hand over the controls.
      sweeping = false;
      count = START_COUNT;
      useInstanced = START_INSTANCED;
      return;
    }
    if (k === "i" || k === "I") useInstanced = !useInstanced;
    else if (k === "[") count = Math.max(1, (count / 2) | 0);
    else if (k === "]") count = Math.min(MAX_CUBES, count * 2);
    else if (k === "p" || k === "P") showPoints = !showPoints;
    else if (k === "l" || k === "L") showLines = !showLines;
    else if (k === " ") spinning = !spinning;
  });

  function readPad(): void {
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad === null) continue;
      for (let b = 0; b < pad.buttons.length; b++) {
        const down = pad.buttons[b].pressed;
        const was = b < prevButtons.length ? prevButtons[b] : false;
        while (prevButtons.length <= b) prevButtons.push(false);
        prevButtons[b] = down;
        if (down && !was) {
          if (b === 0) useInstanced = !useInstanced;
          else if (b === 1) spinning = !spinning;
          else if (b === 14) count = Math.max(1, (count / 2) | 0);
          else if (b === 15) count = Math.min(MAX_CUBES, count * 2);
        }
      }
      break;
    }
  }

  let simTime = 0;

  function frame(now: number): void {
    /* A FIXED timestep, not wall-clock dt.
     *
     * The scene is time-dependent (cubes spin, the camera orbits), so
     * advancing by real elapsed time makes the state at frame N depend on
     * how fast the frames rendered. That is exactly what this benchmark
     * varies, so the instanced and per-mesh paths would reach frame 200 at
     * different orbit angles and could not be compared -- either visually
     * or by pixel diff. A fixed step makes frame N identical in both. */
    const dt = 1 / 60;
    last = now;
    const t0 = performance.now();

    readPad();
    if (spinning) simTime += dt;

    /* Both paths compute the SAME per-cube matrix. The instanced path
     * writes it into a buffer; the non-instanced path writes it into an
     * Object3D. Nothing else differs. */
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

    boxLine.visible = showLines;
    cloud.visible = showPoints;

    // A slow orbit, so the field is seen from more than one angle.
    const orbit = simTime * 0.12;
    camera.position.set(Math.sin(orbit) * 96, Math.sin(orbit * 0.4) * 26,
                        Math.cos(orbit) * 96);
    camera.lookAt(new Vector3(0, 0, 0));

    renderer.render(scene, camera);

    /* glFinish before stopping the clock.
     *
     * GL is asynchronous: without this the timer measures how fast the
     * frame can be QUEUED, not how long the driver takes to draw it, and
     * the numbers flatter whichever side queues faster. The three.js
     * reference in test/three-bench does the same, so the two are
     * measuring the same quantity. */
    /* CPU SUBMIT TIME, deliberately without glFinish.
     *
     * A first attempt called finish() here to "measure the real work".
     * Measured: the draw itself is 1-3ms and finish() added ~30ms, because
     * this game PRESENTS every frame and finish blocks until the presented
     * frame retires -- it was timing the swap chain, and every
     * configuration reported an identical 33.2ms whether it drew 250 cubes
     * or 10000.
     *
     * The three.js reference renders offscreen and never presents, so a
     * finish() there waits for nothing comparable. Submit time is the
     * quantity BOTH stacks can report honestly, and it is also the one a
     * game cares about: the CPU cost of getting a frame to the driver. */
    const frameMs = performance.now() - t0;
    frames += 1;

    if (sweeping) {
      /* Skip the first 20 frames of each configuration: the first draw of
       * a new program compiles shaders and creates buffers, which is
       * startup cost rather than steady-state frame cost, and it would
       * otherwise land entirely on whichever path ran first. */
      if (frames > 20) samples.push(frameMs);
      if (frames >= SWEEP_FRAMES + 20) {
        results.push(summarize(samples, sweepInstanced, count));
        samples.splice(0, samples.length);
        frames = 0;

        /* Both paths at each count, then advance: instanced, per-mesh,
         * next count. */
        if (sweepInstanced) {
          sweepInstanced = false;
        } else {
          sweepInstanced = true;
          sweepIndex += 1;
        }

        if (sweepIndex >= sweep.length) {
          sweeping = false;
          printTable(results);
          count = START_COUNT;
          useInstanced = START_INSTANCED;
        } else {
          count = sweep[sweepIndex];
          useInstanced = sweepInstanced;
        }
      }
    } else {
      fpsAccum += frameMs;
      fpsFrames += 1;
      if (fpsFrames >= 60) {
        fpsShown = fpsAccum / fpsFrames;
        fpsAccum = 0;
        fpsFrames = 0;
        console.log(`${useInstanced ? "instanced" : "per-mesh "} ` +
                    `n=${count} ${fpsShown.toFixed(3)} ms/frame ` +
                    `(${(1000 / Math.max(0.001, fpsShown)).toFixed(0)} fps)`);
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});

/* ---- helpers ---- */

/* A 12-edge wire cube as LineSegments: 24 vertices, disconnected pairs.
 * LineSegments rather than Line because a single strip cannot walk a cube's
 * edges without doubling back. */
function makeWireBox(r: number): Line {
  const p: number[] = [];
  const c: number[] = [];
  const v = [
    [-r, -r, -r], [r, -r, -r], [r, r, -r], [-r, r, -r],
    [-r, -r, r], [r, -r, r], [r, r, r], [-r, r, r],
  ];
  const edges = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ];
  for (let i = 0; i < edges.length; i++) {
    const a = v[edges[i]];
    p.push(a[0], a[1], a[2]);
    c.push(0.35, 0.55, 0.9);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(p, 3, false));
  geo.setAttribute("color", new BufferAttribute(c, 3, false));
  // Lines are not lit, but the shader always reads a normal attribute.
  const n: number[] = [];
  for (let i = 0; i < p.length / 3; i++) n.push(0, 0, 1);
  geo.setAttribute("normal", new BufferAttribute(n, 3, false));

  const mat = new LineBasicMaterial();
  mat.vertexColors = true;
  return new LineSegments(geo, mat);
}

/** A shell of points outside the cube field, to exercise GL_POINTS. */
function makePointCloud(rand: () => number): Points {
  const p: number[] = [];
  const n: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < 1200; i++) {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const rr = 34 + rand() * 10;
    const s = Math.sqrt(1 - u * u);
    p.push(rr * s * Math.cos(theta), rr * s * Math.sin(theta), rr * u);
    n.push(0, 0, 1);
    const b = 0.5 + rand() * 0.5;
    c.push(b * 0.7, b * 0.85, b);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(p, 3, false));
  geo.setAttribute("normal", new BufferAttribute(n, 3, false));
  geo.setAttribute("color", new BufferAttribute(c, 3, false));

  const mat = new PointsMaterial();
  mat.size = 0.06;
  mat.sizeAttenuation = true;
  mat.vertexColors = true;
  return new Points(geo, mat);
}

/* Percentiles rather than a bare mean: instancing's win shows up in the
 * tail as much as the average, and a mean alone would hide a stall. */
function summarize(samples: number[], instanced: boolean, count: number): string {
  if (samples.length === 0) return `n=${count}: no samples`;
  const sorted = samples.slice(0);
  sorted.sort((a: number, b: number) => a - b);
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) sum += sorted[i];
  const mean = sum / sorted.length;
  const p50 = sorted[(sorted.length * 0.5) | 0];
  const p95 = sorted[(sorted.length * 0.95) | 0];
  const worst = sorted[sorted.length - 1];
  const label = instanced ? "instanced" : "per-mesh ";
  return `${label} n=${pad(count, 5)}  mean ${pad3(mean)}  p50 ${pad3(p50)}  ` +
         `p95 ${pad3(p95)}  max ${pad3(worst)}  ${pad(Math.round(1000 / Math.max(0.001, mean)), 5)} fps`;
}

function pad(n: number, width: number): string {
  let s = `${n}`;
  while (s.length < width) s = " " + s;
  return s;
}

function pad3(n: number): string {
  let s = n.toFixed(3);
  while (s.length < 8) s = " " + s;
  return s;
}

function printTable(rows: string[]): void {
  console.log("");
  console.log("spinfield: instanced vs per-mesh, same per-cube math");
  console.log("---------------------------------------------------------------");
  for (let i = 0; i < rows.length; i++) console.log(`  ${rows[i]}`);
  console.log("---------------------------------------------------------------");
  console.log("interactive: I instanced  [ ] count  P points  L lines  SPACE pause");
  console.log("");
}
