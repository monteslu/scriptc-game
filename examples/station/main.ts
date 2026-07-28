/* station: SALVAGE RUN.
 *
 * The hull is breached and the air is going. Collect power cells down the
 * corridor and reach the escape pod at the far end before your oxygen runs
 * out. Every cell buys you more air, so the run is a push-your-luck
 * problem: the last cells are the furthest from the pod.
 *
 * It is also the showcase for the model pipeline end to end:
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
 *   W/S, up/down, d-pad up/down, left stick   walk
 *   A/D, left/right, d-pad left/right          turn
 *   Q/E, L1/R1                                 strafe
 *   SHIFT                                      run
 *   ENTER / START                              restart
 */
import {
  window, document, navigator, requestAnimationFrame, KeyboardEvent,
  Image, Math, performance, Gamepad, AudioContext,
} from "../../web/globals.js";
import { pickup, gameOver } from "../../engine/sfx.js";
import { ParticleSystem, BurstOptions } from "../../engine/particles.js";
import { Context2D } from "../../web/canvas/context.js";

import { Scene } from "../../three/core/Scene.js";
import { PerspectiveCamera } from "../../three/core/PerspectiveCamera.js";
import { Mesh } from "../../three/objects/Mesh.js";
import { InstancedMesh } from "../../three/objects/InstancedMesh.js";
import { Points, Sprite } from "../../three/objects/Sprite.js";
import { BoxGeometry } from "../../three/geometries/BoxGeometry.js";
import { BufferGeometry } from "../../three/core/BufferGeometry.js";
import { BufferAttribute } from "../../three/core/BufferAttribute.js";
import {
  MeshLambertMaterial, MeshBasicMaterial, PointsMaterial, SpriteMaterial,
  AdditiveBlending,
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

/* Standard Gamepad button indices. The spec names no constants. */
const BTN_L1 = 4;
const BTN_R1 = 5;
const BTN_DPAD_UP = 12;
const BTN_DPAD_DOWN = 13;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;
/** Below this a stick is treated as centred: cheap sticks never rest at 0. */
const DEADZONE = 0.2;

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

  const glowTex = makeGlowTexture();

  /* ---- audio ---- */
  const audio = new AudioContext();
  const hasAudio = audio.state === "running";

  /* ---- pickup sparks ---- */
  const sparks = new ParticleSystem(scene, 260);
  const cellBurst = new BurstOptions();
  cellBurst.speed = 5.5;
  cellBurst.life = 0.6;
  cellBurst.size = 0.22;
  cellBurst.gravity = 3.5;
  cellBurst.drag = 0.3;
  cellBurst.colorFrom.setHex(0xd8ffe8);
  cellBurst.colorTo.setHex(0x2fbf7a);

  /* ---- HUD ----
   *
   * A 2D canvas uploaded as a texture on a quad pinned to the camera. The
   * oxygen bar is the whole interface: a number alone does not convey
   * "running out" the way a shrinking bar does. */
  const HUD_W = 512;
  const HUD_H = 256;
  const hudCanvas = document.createElement("canvas");
  if (hudCanvas !== null) {
    hudCanvas.width = HUD_W;      // the default is 300x150
    hudCanvas.height = HUD_H;
  }
  const hudCtx = hudCanvas === null ? null : hudCanvas.getContext("2d");
  const hudTexture = hudCtx === null ? null : Texture.fromCanvas(hudCtx);
  const hudMat = new MeshBasicMaterial(0xffffff);
  hudMat.transparent = true;
  hudMat.depthTest = false;      // always on top of the world
  if (hudTexture !== null) hudMat.map = hudTexture;
  const hud = new Mesh(makeQuad(1.15, 0.575), hudMat);
  scene.add(hud);

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

  /* ---- power cells ----
   *
   * Spread down the corridor, alternating sides so the run zig-zags: a
   * straight line of pickups would just be "hold forward". Each is a
   * glowing crate with an additive halo so it reads from the far end of
   * the hall, which is what makes the risk legible.
   */
  const CELL_COUNT = 9;
  const cellMat = new MeshLambertMaterial(0x8fffc8);
  cellMat.emissive.setHex(0x1f6b45);
  const cellHaloMat = new SpriteMaterial(0x66ffb0);
  cellHaloMat.transparent = true;
  cellHaloMat.opacity = 0.5;
  cellHaloMat.blending = AdditiveBlending;
  cellHaloMat.depthWrite = false;
  if (glowTex !== null) cellHaloMat.map = glowTex;

  const cellX: number[] = [];
  const cellZ: number[] = [];
  const cellAlive: boolean[] = [];
  const cellMesh: Mesh[] = [];
  const cellHalo: Sprite[] = [];

  for (let i = 0; i < CELL_COUNT; i++) {
    const frac = (i + 1) / (CELL_COUNT + 1);
    const cz = -frac * (HALL_LEN - 3) * TILE;
    const cx = ((i % 2 === 0) ? -1 : 1) * (halfW - 1.1) * TILE;
    cellX.push(cx);
    cellZ.push(cz);
    cellAlive.push(true);

    const m = new Mesh(new BoxGeometry(0.55, 0.55, 0.55), cellMat);
    m.position.set(cx, FLOOR_TOP + 0.75, cz);
    scene.add(m);
    cellMesh.push(m);

    const halo = new Sprite(cellHaloMat);
    halo.scale.set(2.4, 2.4, 1);
    halo.position.set(cx, FLOOR_TOP + 0.75, cz);
    scene.add(halo);
    cellHalo.push(halo);
  }

  /* ---- the escape pod ----
   *
   * At the FAR end, so the whole run is a commitment: every cell you take
   * is distance you still have to cover coming back to nothing. */
  const podZ = -(HALL_LEN - 1.2) * TILE;
  const podMat = new MeshBasicMaterial(0xffd25a);
  podMat.transparent = true;
  podMat.opacity = 0.75;
  podMat.blending = AdditiveBlending;
  podMat.depthWrite = false;
  const pod = new Mesh(new BoxGeometry(2.6 * SCALE, 0.08, 2.6 * SCALE), podMat);
  pod.position.set(0, FLOOR_TOP + 0.05, podZ);
  scene.add(pod);

  const podLight = new PointLight(0xffd25a, 3.2, 18, 1);
  podLight.position.set(0, FLOOR_TOP + 1.6, podZ);
  scene.add(podLight);

  /* ---- YOUR SHIP, docked at the pod ----
   *
   * The escape craft, sitting on the pad you are running toward. It is
   * the goal made visible: a glowing rectangle on the floor says "here",
   * but a ship says "here is how you get out", and it is the same
   * craft_racer the orbits demo flies.
   *
   * It hovers and turns gently so it reads as powered up and waiting
   * rather than as scenery. */
  const shipMat = new MeshLambertMaterial(0xffffff);
  shipMat.vertexColors = true;
  const playerShip = new Mesh(new BoxGeometry(0.001, 0.001, 0.001), shipMat);
  playerShip.scale.set(6.5, 6.5, 6.5);
  playerShip.position.set(0, FLOOR_TOP + 2.2, podZ);
  scene.add(playerShip);

  /* Its own light: the far end of the corridor is the darkest part of the
   * level, and an unlit ship there is a silhouette rather than a goal. */
  const shipLight = new PointLight(0x9fd0ff, 4.5, 26, 1);
  shipLight.position.set(0, FLOOR_TOP + 4.5, podZ + 4);
  scene.add(shipLight);

  loader.load("craft_racer.sgm")
    .then((geo) => { playerShip.geometry = geo; })
    .catch(() => { console.log("station: craft_racer.sgm did not load"); });

  /* ---- starfield beyond the windows ---- */
  scene.add(makeStars(rand));

  /* ---- game state ----
   *
   * Oxygen is the whole game: it is the clock, the score and the reason to
   * take risks. Cells add air rather than points, so collecting one is
   * always worth something and the decision is only ever "can I reach it
   * and still get back". */
  const START_AIR = 45;
  const AIR_PER_CELL = 13;
  let air = START_AIR;
  let collected = 0;
  let won = false;
  let lost = false;
  let endTime = 0;

  /* ---- movement ---- */
  let px = 0;
  let pz = -2 * SCALE;      // just inside the entrance, facing down the hall
  let yaw = Math.PI;         // facing down the corridor
  let bobPhase = 0;
  let touring = true;
  let elapsed = 0;

  const keys: string[] = [];
  function down(k: string): boolean { return keys.indexOf(k) >= 0; }

  function restart(): void {
    air = START_AIR;
    collected = 0;
    won = false;
    lost = false;
    px = 0;
    pz = -2 * SCALE;
    yaw = Math.PI;
    for (let i = 0; i < CELL_COUNT; i++) {
      cellAlive[i] = true;
      cellMesh[i].visible = true;
      cellHalo[i].visible = true;
    }
  }

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (keys.indexOf(e.key) < 0) keys.push(e.key);
    if (e.key === "Enter" && (won || lost)) { restart(); return; }
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

      /* Standard Gamepad axes: 0/1 left stick, 2/3 right stick. Both Y
       * axes read POSITIVE DOWN, which is why forward subtracts. */
      const lx = pad.axes[0];
      const ly = pad.axes[1];
      const rx = pad.axes[2];
      if (ly > DEADZONE || ly < -DEADZONE) { fwd -= ly; touring = false; }
      if (lx > DEADZONE || lx < -DEADZONE) { strafe += lx; touring = false; }
      if (rx > DEADZONE || rx < -DEADZONE) { turn -= rx; touring = false; }

      /* D-pad MOVES, it does not look.
       *
       * Left/right STRAFE rather than turn: the d-pad is a movement
       * control and the right stick is the camera, which is the standard
       * every first-person game uses. Turning with the d-pad while the
       * right stick also turns gives two controls fighting over one axis.
       */
      if (pad.buttons.length > BTN_DPAD_RIGHT) {
        if (pad.buttons[BTN_DPAD_UP].pressed) { fwd += 1; touring = false; }
        if (pad.buttons[BTN_DPAD_DOWN].pressed) { fwd -= 1; touring = false; }
        if (pad.buttons[BTN_DPAD_LEFT].pressed) { strafe -= 1; touring = false; }
        if (pad.buttons[BTN_DPAD_RIGHT].pressed) { strafe += 1; touring = false; }
      }

      /* Shoulders also strafe, for players who prefer the stick for
       * movement and want a quick sidestep. */
      if (pad.buttons.length > BTN_R1) {
        if (pad.buttons[BTN_L1].pressed) { strafe -= 1; touring = false; }
        if (pad.buttons[BTN_R1].pressed) { strafe += 1; touring = false; }
      }
      break;
    }

    if (won || lost) {
      fwd = 0; strafe = 0; turn = 0;
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
      /* Forward is (sin yaw, cos yaw); RIGHT is that rotated -90 degrees,
       * which is (-cos yaw, sin yaw). The first version used (cos, -sin) --
       * the LEFT-hand vector -- so strafing went the wrong way on both the
       * keyboard and the stick. Checked against yaw=PI (facing -Z), where
       * right must be +X. */
      px += (sinY * fwd - cosY * strafe) * speed * dt;
      pz += (cosY * fwd + sinY * strafe) * speed * dt;
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

    /* ---- game logic ---- */
    if (!won && !lost) {
      air -= dt;

      // Cell pickup: a generous radius, because a precise one in a
      // first-person view reads as the pickup being broken.
      for (let i = 0; i < CELL_COUNT; i++) {
        if (!cellAlive[i]) continue;
        const dx = cellX[i] - px;
        const dz = cellZ[i] - pz;
        if (dx * dx + dz * dz < 2.6 * 2.6) {
          cellAlive[i] = false;
          cellMesh[i].visible = false;
          cellHalo[i].visible = false;
          collected += 1;
          air += AIR_PER_CELL;
          sparks.burst(cellX[i], FLOOR_TOP + 0.75, cellZ[i], 22, cellBurst);
          if (hasAudio) pickup(audio, 0.4);
        }
      }

      // The pod only counts once every cell is aboard.
      const dpz = pz - podZ;
      if (collected >= CELL_COUNT && dpz * dpz < 3.2 * 3.2) {
        won = true;
        endTime = elapsed;
        if (hasAudio) pickup(audio, 0.7);
      }

      if (air <= 0) {
        air = 0;
        lost = true;
        endTime = elapsed;
        if (hasAudio) gameOver(audio, 0.6);
      }
    }

    /* Cells bob and spin: a static pickup reads as scenery. */
    for (let i = 0; i < CELL_COUNT; i++) {
      if (!cellAlive[i]) continue;
      const y = FLOOR_TOP + 0.75 + Math.sin(elapsed * 2.2 + i) * 0.16;
      cellMesh[i].position.set(cellX[i], y, cellZ[i]);
      cellMesh[i].quaternion.setFromEuler(0, elapsed * 1.3 + i, 0.4);
      cellHalo[i].position.set(cellX[i], y, cellZ[i]);
      const pulse = 2.4 * (1 + Math.sin(elapsed * 4 + i) * 0.13);
      cellHalo[i].scale.set(pulse, pulse, 1);
    }

    /* The ship hovers and rocks on its pad; on a win it lifts off, which
     * is the payoff for the whole run. */
    if (won) {
      const since = elapsed - endTime;
      playerShip.position.set(0, FLOOR_TOP + 2.2 + since * since * 2.6,
                              podZ - since * 1.8);
      playerShip.quaternion.setFromEuler(-since * 0.25, Math.PI, 0);
    } else {
      playerShip.position.set(0, FLOOR_TOP + 2.2 + Math.sin(elapsed * 1.6) * 0.18,
                              podZ);
      playerShip.quaternion.setFromEuler(0, Math.PI + Math.sin(elapsed * 0.5) * 0.15,
                                         Math.sin(elapsed * 0.9) * 0.05);
    }

    /* The pod pulses only once it can actually be used, so it reads as
     * "not yet" until the last cell is aboard. */
    podMat.opacity = collected >= CELL_COUNT
      ? 0.55 + Math.sin(elapsed * 6) * 0.3
      : 0.12;
    podLight.intensity = collected >= CELL_COUNT
      ? 3.4 + Math.sin(elapsed * 6) * 1.6
      : 0.7;

    /* Air runs out: the light drains with it, so the panic is visible
     * before the number is. */
    const airFrac = air / START_AIR;
    const dim = lost ? 0.15 : 0.45 + Math.min(1, airFrac * 1.6) * 0.55;
    for (let i = 0; i < lamps.length; i++) lamps[i].intensity = 2.6 * dim;

    sparks.update(dt);

    if (hudCtx !== null && hudTexture !== null) {
      drawHUD(hudCtx, air, START_AIR, collected, CELL_COUNT, won, lost,
              endTime);
      hudTexture.needsUpdate = true;
    }
    placeHUD(hud, camera);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
});

/* ---- helpers ---- */

/* A soft radial glow, drawn once into an offscreen canvas.
 *
 * Additive blending makes the black edge contribute nothing, so the quad
 * has no visible boundary and the falloff itself is the shape. A solid
 * mesh cannot do this: its face is uniformly bright and its silhouette is
 * a hard edge, which reads as a disc pasted on rather than a light. */
function makeGlowTexture(): Texture | null {
  const c = document.createElement("canvas");
  if (c === null) return null;
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (g === null) return null;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(190,255,220,0.8)");
  grad.addColorStop(0.55, "rgba(90,230,160,0.28)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.setFillGradient(grad);
  g.fillRect(0, 0, 128, 128);
  return Texture.fromCanvas(g);
}

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

/** A unit quad, indexed, with uvs: the HUD surface. */
function makeQuad(w: number, h: number): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(
    [-w, -h, 0, w, -h, 0, w, h, 0, -w, h, 0], 3, false));
  geo.setAttribute("uv", new BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2, false));
  geo.setAttribute("normal", new BufferAttribute(
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3, false));
  geo.setIndex(new BufferAttribute([0, 1, 2, 0, 2, 3], 1, false));
  return geo;
}

/* Pin the HUD a fixed distance down the camera's view axis, so it never
 * intersects the world however the camera moves. */
function placeHUD(hud: Mesh, camera: PerspectiveCamera): void {
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  hud.position.copy(camera.position);
  hud.position.addScaledVector(_fwd, 2.2);
  hud.position.addScaledVector(_up, 0.72);
  hud.quaternion.copy(camera.quaternion);
}

function drawHUD(ctx: Context2D, air: number, maxAir: number,
                 cells: number, totalCells: number,
                 won: boolean, lost: boolean, endTime: number): void {
  ctx.clearRect(0, 0, 512, 256);

  /* The oxygen bar IS the game: a number counting down does not convey
   * urgency the way a draining bar does, and the colour shift gives a
   * warning before the number is small enough to read as one. */
  const frac = Math.max(0, Math.min(1, air / maxAir));
  ctx.fillStyle = "rgba(4,8,16,0.72)";
  ctx.fillRect(0, 0, 512, 104);

  ctx.fillStyle = "#7f93bf";
  ctx.font = "18px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("OXYGEN", 26, 30);

  ctx.fillStyle = "#141d33";
  ctx.fillRect(26, 40, 300, 22);
  // Green while comfortable, amber, then red: readable at a glance.
  if (frac > 0.5) ctx.fillStyle = "#4fe08a";
  else if (frac > 0.22) ctx.fillStyle = "#ffc247";
  else ctx.fillStyle = "#ff4d6a";
  ctx.fillRect(26, 40, 300 * frac, 22);

  ctx.fillStyle = "#dbe7ff";
  ctx.font = "30px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.ceil(air)}s`, 486, 62);

  ctx.fillStyle = "#7f93bf";
  ctx.font = "18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`CELLS  ${cells} / ${totalCells}`, 26, 88);

  if (cells >= totalCells && !won && !lost) {
    ctx.fillStyle = "#ffd25a";
    ctx.textAlign = "right";
    ctx.fillText("POD OPEN", 486, 88);
  }

  if (won || lost) {
    ctx.fillStyle = "rgba(3,6,14,0.9)";
    ctx.fillRect(0, 104, 512, 152);
    ctx.textAlign = "center";
    if (won) {
      ctx.fillStyle = "#8ef0a8";
      ctx.font = "44px sans-serif";
      ctx.fillText("ESCAPED", 256, 164);
      ctx.fillStyle = "#dbe7ff";
      ctx.font = "22px sans-serif";
      ctx.fillText(`${endTime.toFixed(1)}s  with ${Math.ceil(air)}s air left`,
                   256, 200);
    } else {
      ctx.fillStyle = "#ff6f8b";
      ctx.font = "44px sans-serif";
      ctx.fillText("OUT OF AIR", 256, 164);
      ctx.fillStyle = "#dbe7ff";
      ctx.font = "22px sans-serif";
      ctx.fillText(`${cells} of ${totalCells} cells recovered`, 256, 200);
    }
    ctx.fillStyle = "#96a8cf";
    ctx.font = "19px sans-serif";
    ctx.fillText("ENTER to try again", 256, 232);
  }
}

const _fwd = new Vector3();
const _up = new Vector3();
const _pos = new Vector3();
const _scl = new Vector3(1, 1, 1);
const _rot = new Quaternion();
const _look = new Vector3();
