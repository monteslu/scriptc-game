/* station: a walkable, TEXTURED space station.
 *
 * The showcase for the model pipeline end to end:
 *
 *   TEXTURES     every model samples one shared 512x512 atlas. The kit is
 *                authored that way, so the whole station is ONE texture
 *                bind and one material.
 *   MODELS       19 modular pieces baked from glTF by codegen/bake-mesh.js
 *                and loaded at runtime by SGMLoader.
 *   INSTANCING   floors and walls repeat, so each kind is one
 *                InstancedMesh: a 200-piece station in a handful of draw
 *                calls.
 *   LIGHTING     a warm key, a cool fill, and animated point lights that
 *                travel the corridor.
 *
 * Controls:
 *   W/S or up/down     walk forward and back
 *   A/D or left/right  turn
 *   Q/E                strafe
 *   SHIFT              run
 *   SPACE              toggle the slow auto-tour
 */
import {
  window, document, navigator, requestAnimationFrame, KeyboardEvent,
  Image, Math, performance, Gamepad,
} from "../../web/globals.js";

import { Scene } from "../../three/core/Scene.js";
import { PerspectiveCamera } from "../../three/core/PerspectiveCamera.js";
import { Mesh } from "../../three/objects/Mesh.js";
import { InstancedMesh } from "../../three/objects/InstancedMesh.js";
import { Points } from "../../three/objects/Sprite.js";
import { BoxGeometry } from "../../three/geometries/BoxGeometry.js";
import { BufferGeometry } from "../../three/core/BufferGeometry.js";
import { BufferAttribute } from "../../three/core/BufferAttribute.js";
import {
  MeshLambertMaterial, MeshBasicMaterial, PointsMaterial, AdditiveBlending,
} from "../../three/materials/Material.js";
import {
  AmbientLight, DirectionalLight, PointLight,
} from "../../three/lights/Light.js";
import { WebGLRenderer } from "../../three/renderer/WebGLRenderer.js";
import { SGMLoader } from "../../three/loaders/SGMLoader.js";
import { Texture, NearestFilter } from "../../three/textures/Texture.js";
import { Matrix4 } from "../../three/math/Matrix4.js";
import { Quaternion } from "../../three/math/Quaternion.js";
import { Vector3 } from "../../three/math/Vector3.js";

/* The kit is authored on a 1-unit grid, which is what makes modular pieces
 * line up without hand-placing anything.
 *
 * A wall model measures 1.0 tall in that grid (verified from the glTF
 * accessor bounds), so at 1:1 the camera stood ABOVE the walls and looked
 * down into an open box. Scaling the whole station by 3 makes a wall 3m,
 * which is a corridor a person walks through, and the grid stays exact
 * because every piece scales together. */
const SCALE = 3;
const TILE = 1 * SCALE;
const WALL_H = 1 * SCALE;
const HALL_LEN = 26;      // tiles down the corridor
const HALL_W = 7;         // tiles across
/* Eye height is measured from the FLOOR SURFACE, not from the origin: the
 * floor model is 0.3 tall in kit units, so its top sits at 0.3*SCALE and a
 * bare 1.6 would put the camera 0.7m off the ground -- crawling. */
const FLOOR_TOP = 0.3 * SCALE;
const EYE = FLOOR_TOP + 1.65;

class Piece {
  mesh: InstancedMesh | null = null;
  count = 0;
  /* Column-major transforms, filled before the geometry arrives and
   * flushed into the mesh once it does. */
  pending: Matrix4[] = [];
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("game-canvas");
  const W = canvas.width;
  const H = canvas.height;

  const gl = canvas.getContextGL();
  if (gl === null) {
    console.log("station: WebGL2 is unavailable");
    return;
  }

  const renderer = new WebGLRenderer(gl);
  renderer.setSize(W, H);
  renderer.setClearColor(0x05070d);

  const scene = new Scene();
  const camera = new PerspectiveCamera(68, W / H, 0.05, 260);

  /* ---- the shared atlas ----
   *
   * ONE texture for the entire kit. Every model's uvs index into it, so
   * the whole station is a single bind: the reason a modular kit is cheap
   * to draw is that it never changes texture.
   *
   * NearestFilter because the atlas is flat colour blocks with hard
   * boundaries -- bilinear filtering samples ACROSS those boundaries at
   * glancing angles and bleeds a neighbouring colour onto every edge. */
  const atlas = new Texture(loadImage("colormap.png"));
  atlas.magFilter = NearestFilter;
  atlas.minFilter = NearestFilter;

  const stationMat = new MeshLambertMaterial(0xffffff);
  stationMat.map = atlas;

  /* ---- lighting ----
   *
   * A station interior wants to feel enclosed and artificial: a low
   * ambient so nothing is pure black, one cool overhead fill, and warm
   * point lights that actually travel the corridor. */
  scene.add(new AmbientLight(0x18202f, 1));
  const fill = new DirectionalLight(0x7f9fd8, 0.32);
  fill.position.set(0.3, 1, 0.25);
  scene.add(fill);

  const lamps: PointLight[] = [];
  for (let i = 0; i < 4; i++) {
    /* decay 1, not the physically-correct 2: at station scale
     * inverse-square needs an intensity in the hundreds and then blows out
     * anything nearby. See WEBGL-AND-3D.md. */
    /* Intensity 1.1, not 9. Four lamps with decay 1 at ~2m each
     * contributed 4.5, summing to 18 where 1.0 is already full white: the
     * whole station rendered as a white silhouette with the texture
     * completely washed out. Lit surfaces should peak near 1. */
    const lamp = new PointLight(0xffd9a8, 2.6, 26, 1);
    lamps.push(lamp);
    scene.add(lamp);
  }

  /* ---- the station ----
   *
   * Each distinct model is ONE InstancedMesh, so repeating a floor tile
   * two hundred times costs one draw call rather than two hundred. The
   * geometry loads asynchronously, so transforms are recorded first and
   * flushed when the model arrives. */
  const loader = new SGMLoader();
  const pieces: Piece[] = [];

  function piece(name: string, capacity: number): Piece {
    const p = new Piece();
    const m = new InstancedMesh(new BoxGeometry(0.001, 0.001, 0.001),
                               stationMat, capacity);
    m.count = 0;
    p.mesh = m;
    scene.add(m);
    pieces.push(p);

    loader.load(`${name}.sgm`)
      .then((geo) => {
        m.geometry = geo;
        /* Flush what was placed while the model was in flight. The
         * renderer rebuilds the instanced VAO when the geometry changes,
         * so this is safe after the fact. */
        for (let i = 0; i < p.pending.length && i < capacity; i++) {
          m.setMatrixAt(i, p.pending[i]);
        }
        m.count = p.count;
      })
      .catch(() => { console.log(`station: ${name}.sgm did not load`); });
    return p;
  }

  function place(p: Piece, x: number, y: number, z: number,
                 yaw: number, s: number): void {
    if (p.count >= 400) return;
    _pos.set(x, y, z);
    _rot.setFromEuler(0, yaw, 0);
    _scl.set(s * SCALE, s * SCALE, s * SCALE);
    const m = new Matrix4().compose(_pos, _rot, _scl);
    p.pending.push(m);
    if (p.mesh !== null) p.mesh.setMatrixAt(p.count, m);
    p.count += 1;
    if (p.mesh !== null && p.mesh.geometry.position !== null) {
      p.mesh.count = p.count;
    }
  }

  const floor = piece("floor", 260);
  const floorDetail = piece("floor-detail", 80);
  const wall = piece("wall", 260);
  const wallWindow = piece("wall-window", 120);
  const wallPillar = piece("wall-pillar", 120);
  const wallBanner = piece("wall-banner", 30);
  const container = piece("container", 40);
  const containerTall = piece("container-tall", 30);
  const computerWide = piece("computer-wide", 20);
  const tableDisplay = piece("table-display-planet", 12);
  const chair = piece("chair", 24);
  const railPiece = piece("rail", 60);
  const pipeRing = piece("pipe-ring-colored", 40);

  /* Deterministic layout: the same station every run, so a screenshot is
   * reproducible and a visual change is a real change. */
  let seed = 0x51a3f7;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  const halfW = (HALL_W - 1) / 2;
  for (let z = 0; z < HALL_LEN; z++) {
    const wz = -z * TILE;
    for (let x = -halfW; x <= halfW; x++) {
      const wx = x * TILE;
      // A scattering of detail tiles breaks up a flat repeating floor.
      if (rand() < 0.14) place(floorDetail, wx, 0, wz, 0, 1);
      else place(floor, wx, 0, wz, 0, 1);
    }

    /* Walls down both sides. Windows every few tiles turn a corridor into
     * somewhere with an outside. */
    const left = -(halfW + 0.5) * TILE;
    const right = (halfW + 0.5) * TILE;
    const kind = z % 6;
    for (let s = 0; s < 2; s++) {
      const wx = s === 0 ? left : right;
      const yaw = s === 0 ? Math.PI / 2 : -Math.PI / 2;
      /* TWO courses, stacked.
       *
       * A wall model is 1 kit-unit tall, which is 3m at this scale --
       * shorter than it looks from outside, and from eye level you see
       * straight over it into space. Stacking a second course at the top
       * of the first gives a 6m corridor that actually encloses the
       * walker, and the pieces line up exactly because the kit is built
       * on the grid. */
      const upper = WALL_H;
      if (kind === 0) {
        place(wallPillar, wx, 0, wz, yaw, 1);
        place(wallPillar, wx, upper, wz, yaw, 1);
      } else if (kind === 2 || kind === 4) {
        place(wallWindow, wx, 0, wz, yaw, 1);
        place(wallWindow, wx, upper, wz, yaw, 1);
      } else if (kind === 3) {
        place(wallBanner, wx, 0, wz, yaw, 1);
        place(wall, wx, upper, wz, yaw, 1);
      } else {
        place(wall, wx, 0, wz, yaw, 1);
        place(wall, wx, upper, wz, yaw, 1);
      }
    }

    // Ceiling pipes: overhead detail is what makes an interior feel built.
    if (z % 3 === 0) {
      place(pipeRing, 0, WALL_H * 2 - 0.5, wz, 0, 1);
    }
  }

  /* Furnishings: clustered rather than scattered, so the corridor reads as
   * rooms with purpose instead of props dropped at random. */
  for (let i = 0; i < 7; i++) {
    const z = -3 - i * 3.5;
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (halfW - 0.6);
    if (i % 3 === 0) {
      place(computerWide, x, 0, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
      place(chair, x - side * 0.9, 0, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
    } else if (i % 3 === 1) {
      place(container, x, 0, z, rand() * Math.PI, 1);
      place(containerTall, x - side * 0.1, 0, z - 1.1, rand() * Math.PI, 1);
    } else {
      place(tableDisplay, x, 0, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
    }
  }

  // A rail along the far end, so the corridor terminates in something.
  for (let x = -halfW; x <= halfW; x++) {
    place(railPiece, x * TILE, 0, -(HALL_LEN - 0.5) * TILE, 0, 1);
  }

  /* ---- starfield beyond the windows ---- */
  scene.add(makeStars(rand));

  /* ---- movement ---- */
  let px = 0;
  let pz = -2 * SCALE;      // just inside the entrance, facing down the hall
  let yaw = Math.PI;         // facing down the corridor
  let bobPhase = 0;
  let touring = true;
  let elapsed = 0;

  const keys: string[] = [];
  function down(k: string): boolean { return keys.indexOf(k) >= 0; }

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (keys.indexOf(e.key) < 0) keys.push(e.key);
    if (e.key === " ") touring = !touring;
    else touring = false;   // any other key takes over from the tour
  });
  window.addEventListener("keyup", (e: KeyboardEvent) => {
    const i = keys.indexOf(e.key);
    if (i >= 0) keys.splice(i, 1);
  });

  let last = performance.now();

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt;

    let fwd = 0;
    let strafe = 0;
    let turn = 0;
    const run = down("Shift") ? 2.1 : 1;

    if (down("w") || down("W") || down("ArrowUp")) fwd += 1;
    if (down("s") || down("S") || down("ArrowDown")) fwd -= 1;
    if (down("a") || down("A") || down("ArrowLeft")) turn += 1;
    if (down("d") || down("D") || down("ArrowRight")) turn -= 1;
    if (down("q") || down("Q")) strafe -= 1;
    if (down("e") || down("E")) strafe += 1;

    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad === null) continue;
      const lx = pad.axes[0];
      const ly = pad.axes[1];
      const rx = pad.axes[2];
      if (ly > 0.2 || ly < -0.2) { fwd -= ly; touring = false; }
      if (lx > 0.2 || lx < -0.2) { strafe += lx; touring = false; }
      if (rx > 0.2 || rx < -0.2) { turn -= rx; touring = false; }
      break;
    }

    if (touring) {
      /* The auto-tour: a slow walk down the corridor and back, so the
       * demo shows itself off unattended. */
      /* Walks from just inside the entrance to near the far rail and
       * back. Starting at +4 tiles put the camera 12m BEHIND the corridor,
       * looking in at the outside of the walls. */
      const span = (HALL_LEN - 8) * SCALE;
      const t = (elapsed * 0.09) % 2;
      pz = -2 * SCALE - (t < 1 ? t : 2 - t) * span;
      px = Math.sin(elapsed * 0.35) * 2.6;
      yaw = Math.PI + Math.sin(elapsed * 0.22) * 0.35;
      bobPhase += dt * 6;
    } else {
      yaw += turn * dt * 2.2;
      const speed = 4.6 * run;
      const sinY = Math.sin(yaw);
      const cosY = Math.cos(yaw);
      px += (sinY * fwd + cosY * strafe) * speed * dt;
      pz += (cosY * fwd - sinY * strafe) * speed * dt;
      if (fwd !== 0 || strafe !== 0) bobPhase += dt * 9 * run;

      // Keep the walker inside the corridor.
      const lim = (halfW - 0.35) * SCALE;
      if (px < -lim) px = -lim;
      if (px > lim) px = lim;
      if (pz > 1 * SCALE) pz = 1 * SCALE;
      if (pz < -(HALL_LEN - 1.5) * SCALE) pz = -(HALL_LEN - 1.5) * SCALE;
    }

    /* Head bob: a small vertical sine while moving. It is the cheapest
     * possible thing that makes a first-person camera feel like a body
     * rather than a floating point. */
    const bob = Math.sin(bobPhase) * 0.035;
    camera.position.set(px, EYE + bob, pz);
    _look.set(px + Math.sin(yaw), EYE + bob - 0.06, pz + Math.cos(yaw));
    camera.lookAt(_look);

    /* Lamps travel the corridor at a constant spacing, so the walker is
     * always moving between pools of warm light rather than through flat
     * illumination. */
    for (let i = 0; i < lamps.length; i++) {
      const lz = -(((elapsed * 3.6 + i * 6.5 * SCALE) %
                     ((HALL_LEN + 6) * SCALE)) - 3 * SCALE);
      lamps[i].position.set(Math.sin(elapsed * 0.4 + i) * 1.6,
                            WALL_H * 2 - 1.1, lz);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});

/* ---- helpers ---- */

function loadImage(url: string): Image {
  const img = new Image();
  img.src = url;
  return img;
}

/** A sphere of points, visible through the station's windows. */
function makeStars(rand: () => number): Points {
  const p: number[] = [];
  const n: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < 1400; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const r = 90 + rand() * 60;
    const s = Math.sqrt(1 - u * u);
    p.push(r * s * Math.cos(th), r * u * 0.6 + 10, r * s * Math.sin(th) - 12);
    n.push(0, 0, 1);
    const b = 0.5 + rand() * 0.5;
    c.push(b * 0.8, b * 0.86, b);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(p, 3, false));
  geo.setAttribute("normal", new BufferAttribute(n, 3, false));
  geo.setAttribute("color", new BufferAttribute(c, 3, false));
  const mat = new PointsMaterial();
  mat.size = 0.9;
  mat.sizeAttenuation = false;
  mat.vertexColors = true;
  mat.transparent = true;
  mat.blending = AdditiveBlending;
  return new Points(geo, mat);
}

const _pos = new Vector3();
const _scl = new Vector3(1, 1, 1);
const _rot = new Quaternion();
const _look = new Vector3();
