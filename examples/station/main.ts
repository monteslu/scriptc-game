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
  Image, Math, performance, Gamepad, AudioContext, fetch, AudioBuffer,
} from "../../web/globals.js";
import { pickup, gameOver, shoot } from "../../engine/sfx.js";
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
/* Two wall courses tall, so the ceiling sits on top of the second one. */
/* THREE wall courses per level: 9m of headroom.
 *
 * Two courses (6m) was still tight for a ship that banks and pitches --
 * the chase camera kept clipping the roof and it read as claustrophobic
 * however wide the tunnels got. Height is what makes a tunnel feel flyable
 * rather than crawled through. */
const WALL_COURSES = 3;
const LEVEL_H = WALL_COURSES * SCALE;
/* Grid <-> world. Pure functions of the constants above, so they live at
 * module scope and anything in the game can use them. */
const CELL = 1 * SCALE;
const GX = 9;             // cells across
const GY = 3;             // LEVELS: what makes it Descent-like
const GZ = 40;            // cells deep
const MID = (GX - 1) / 2;
function cellX(x: number): number { return (x - MID) * CELL; }
function cellY(y: number): number { return y * LEVEL_H; }
function cellZ(z: number): number { return -z * CELL; }
const CEIL_Y = LEVEL_H;
const HALL_W = 7;         // tiles across
/* Eye height is measured from the FLOOR SURFACE, not from the origin: the
 * floor model is 0.3 tall in kit units, so its top sits at 0.3*SCALE and a
 * bare 1.6 would put the camera 0.7m off the ground -- crawling. */
const FLOOR_TOP = 0.3 * SCALE;
const EYE = FLOOR_TOP + 1.65;

/* Standard Gamepad button indices. The spec names no constants. */
const BTN_START = 9;
const BTN_A = 0;
const BTN_L1 = 4;
const BTN_X = 2;
const BTN_L2 = 6;
const BTN_R2 = 7;
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
  /** Pool size; place() silently drops anything beyond it. */
  capacity = 0;
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
  /* Near plane 0.4, not 0.05.
   *
   * A 0.05/260 range spends almost all of the depth buffer's precision in
   * the first centimetre, so distant walls z-fight and near ones clip
   * open -- the view sliced through corridors and showed three tunnels at
   * once. The camera never gets within 0.4m of anything it should see. */
  const camera = new PerspectiveCamera(70, W / H, 0.4, 260);

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

  /* Music at 40%: loud enough to carry the level, quiet enough that the
   * laser and the pickups still cut through it. */
  if (hasAudio) {
    fetch("music.mp3")
      .then((res) => res.arrayBuffer())
      .then((bytes) => audio.decodeAudioData(bytes))
      .then((track) => {
        const bus = audio.createGain();
        bus.gain.value = 0.4;
        bus.connect(audio.destination);
        const src = audio.createBufferSource();
        src.buffer = track;
        src.loop = true;
        src.connect(bus);
        src.start(0);
      })
      .catch(() => { console.log("station: music.mp3 did not load"); });
  }

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
  scene.add(new AmbientLight(0x1e2740, 1));
  const fill = new DirectionalLight(0x7f9fd8, 0.32);
  fill.position.set(0.3, 1, 0.25);
  scene.add(fill);

  /* A second, DOWNWARD fill. The first points up, which lights floors and
   * leaves the new ceiling unlit -- it rendered as a black lid with a few
   * blown-out hotspots. This one catches the underside. */
  const roofFill = new DirectionalLight(0x6d86bd, 0.26);
  roofFill.position.set(-0.2, -1, -0.15);
  scene.add(roofFill);

  const lamps: PointLight[] = [];
  for (let i = 0; i < 3; i++) {
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

  /* A light that flies WITH the ship.
   *
   * A branching three-level map cannot be lit by a handful of travelling
   * lamps: wherever the player actually is would be dark. This is the
   * headlight, and it is what makes a tunnel readable while flying it. */
  const headlight = new PointLight(0xbfd8ff, 2.2, 30, 1);
  scene.add(headlight);

  /* ---- ship state ----
   *
   * Position and VELOCITY: a flying ship carries momentum, so input
   * accelerates rather than teleports. */
  let shipX = 0;
  let shipY = cellY(1) + LEVEL_H * 0.5;
  let shipZ = -3.5 * CELL;
  let velX = 0;
  let velY = 0;
  let velZ = 0;
  let shipYaw = Math.PI;      // facing down the map
  let shipPitch = 0;
  let bank = 0;

  /* The chase camera lags the ship on a spring; these are its own
   * position so the lag survives across frames. */
  let camX = shipX;
  let camY = shipY + 2.4;
  let camZ = shipZ + 7.5;

  /* ---- laser bolts ----
   *
   * Cosmetic: they light the tunnel and they feel good, and they hit
   * nothing. A pool of glowing bars, each with its own point light, fired
   * in alternating pairs from the wingtips.
   *
   * The LIGHT is the point. An additive bar alone reads as a decal; a bar
   * that throws colour onto the walls as it passes is what makes a dark
   * corridor flash. Lights are the expensive part, so the pool is small
   * and the lights are recycled with the bolts. */
  const BOLT_COUNT = 12;
  const boltMat = new MeshBasicMaterial(0xff4d6a);
  boltMat.transparent = true;
  boltMat.opacity = 0.95;
  boltMat.blending = AdditiveBlending;
  boltMat.depthWrite = false;

  const boltMesh: Mesh[] = [];
  const boltLight: PointLight[] = [];
  const boltX: number[] = [];
  const boltY: number[] = [];
  const boltZ: number[] = [];
  const boltVX: number[] = [];
  const boltVY: number[] = [];
  const boltVZ: number[] = [];
  const boltLife: number[] = [];

  for (let i = 0; i < BOLT_COUNT; i++) {
    /* Long in Z and thin: a bolt is a streak, and the mesh is oriented to
     * the direction it flies. */
    const m = new Mesh(new BoxGeometry(0.16, 0.16, 2.2), boltMat);
    m.visible = false;
    scene.add(m);
    boltMesh.push(m);

    const l = new PointLight(0xff4d6a, 0, 16, 1);
    scene.add(l);
    boltLight.push(l);

    boltX.push(0); boltY.push(0); boltZ.push(0);
    boltVX.push(0); boltVY.push(0); boltVZ.push(0);
    boltLife.push(0);
  }

  let boltCursor = 0;
  let fireCooldown = 0;
  /** Alternates the muzzle between wingtips, as a twin-cannon ship does. */
  let fireSide = 1;

  function fire(fx: number, fy: number, fz: number,
                rx: number, rz: number): void {
    const i = boltCursor;
    boltCursor = (boltCursor + 1) % BOLT_COUNT;

    const BOLT_SPEED = 62;
    // Muzzle offset: out to a wingtip and slightly ahead of the hull.
    const off = 0.85 * fireSide;
    boltX[i] = shipX + rx * off + fx * 1.6;
    boltY[i] = shipY + fy * 1.6;
    boltZ[i] = shipZ + rz * off + fz * 1.6;
    /* Inherit the ship's velocity so a bolt fired while strafing does not
     * appear to fly sideways out of the barrel. */
    boltVX[i] = fx * BOLT_SPEED + velX;
    boltVY[i] = fy * BOLT_SPEED + velY;
    boltVZ[i] = fz * BOLT_SPEED + velZ;
    boltLife[i] = 0.85;
    boltMesh[i].visible = true;
    fireSide = -fireSide;
    if (hasAudio) shoot(audio, 0.22);
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
    p.capacity = capacity;
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
    placeRolled(p, x, y, z, yaw, s, 0);
  }

  /* Same as place, with a roll about X. A ceiling is a floor tile flipped
   * 180 degrees: the kit has no ceiling piece, and flipping reuses the
   * same geometry, the same atlas region and the same instanced mesh.
   * Rotating the mesh carries its NORMALS with it, so the underside lights
   * correctly rather than being lit from behind. */
  function placeRolled(p: Piece, x: number, y: number, z: number,
                       yaw: number, s: number, roll: number): void {
    if (p.count >= p.capacity) return;
    _pos.set(x, y, z);
    _rot.setFromEuler(roll, yaw, 0);
    _scl.set(s * SCALE, s * SCALE, s * SCALE);
    const m = new Matrix4().compose(_pos, _rot, _scl);
    p.pending.push(m);
    if (p.mesh !== null) p.mesh.setMatrixAt(p.count, m);
    p.count += 1;
    if (p.mesh !== null && p.mesh.geometry.position !== null) {
      p.mesh.count = p.count;
    }
  }

  const floor = piece("floor", 900);
  const ceiling = piece("floor", 900);
  const floorDetail = piece("floor-detail", 260);
  const wall = piece("wall", 2200);
  const wallWindow = piece("wall-window", 600);
  const wallPillar = piece("wall-pillar", 700);
  const wallBanner = piece("wall-banner", 200);
  const container = piece("container", 60);
  const containerTall = piece("container-tall", 40);
  const computerWide = piece("computer-wide", 30);
  const tableDisplay = piece("table-display-planet", 20);
  const chair = piece("chair", 30);
  const railPiece = piece("rail", 80);
  const pipeRing = piece("pipe-ring-colored", 80);

  /* Deterministic layout: the same station every run, so a screenshot is
   * reproducible and a visual change is a real change. */
  let seed = 0x51a3f7;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  /* ---- the layout ----
   *
   * A GRID of open cells rather than one hardcoded corridor. `open[]` says
   * which (x, y, z) cells are flyable; the geometry pass then walls off
   * every face where an open cell meets a closed one, so branches, side
   * rooms and vertical shafts all fall out of the same loop instead of
   * needing their own code.
   *
   * It is also what makes flight COLLIDE correctly: the same array the
   * walls were built from is the array the ship tests against, so the two
   * can never disagree.
   */
  const open: boolean[] = [];
  for (let i = 0; i < GX * GY * GZ; i++) open.push(false);

  function idx(x: number, y: number, z: number): number {
    return (y * GZ + z) * GX + x;
  }
  function isOpen(x: number, y: number, z: number): boolean {
    if (x < 0 || x >= GX || y < 0 || y >= GY || z < 0 || z >= GZ) return false;
    return open[idx(x, y, z)];
  }
  function carve(x: number, y: number, z: number): void {
    if (x < 0 || x >= GX || y < 0 || y >= GY || z < 0 || z >= GZ) return;
    open[idx(x, y, z)] = true;
  }
  /** An axis-aligned run of cells. */
  function carveRun(x0: number, y0: number, z0: number,
                    x1: number, y1: number, z1: number): void {
    const sx = x1 >= x0 ? 1 : -1;
    const sy = y1 >= y0 ? 1 : -1;
    const sz = z1 >= z0 ? 1 : -1;
    for (let x = x0; x !== x1 + sx; x += sx) {
      for (let y = y0; y !== y1 + sy; y += sy) {
        for (let z = z0; z !== z1 + sz; z += sz) carve(x, y, z);
      }
    }
  }


  /* The spine: a wide main tunnel on the middle level, running the length
   * of the map. */
  carveRun(MID - 1, 1, 0, MID + 1, 1, GZ - 1);

  /* THE START HANGAR.
   *
   * The first thing anyone sees should not be a three-cell-wide tunnel
   * mouth. This is a full-width, full-height bay across all three levels
   * at the near end: you launch into a room, get your bearings, and
   * choose a way in. */
  carveRun(0, 0, 0, GX - 1, GY - 1, 4);

  /* Side branches, alternating left and right, each ending in a room.
   * Cells live down these, so the run is a series of detours rather than
   * a straight sprint. */
  for (let b = 0; b < 5; b++) {
    const bz = 5 + b * 7;
    const left = b % 2 === 0;
    const x0 = left ? 0 : MID + 2;
    const x1 = left ? MID - 2 : GX - 1;
    carveRun(x0, 1, bz, x1, 1, bz);
    // A room at the end, two cells deep so it reads as a place.
    if (left) carveRun(0, 1, bz - 1, 2, 1, bz + 1);
    else carveRun(GX - 3, 1, bz - 1, GX - 1, 1, bz + 1);
  }

  /* VERTICAL SHAFTS. Three of them, connecting all three levels: this is
   * what turns a flat maze into a 3D one, and what makes up/down thrust
   * mean something. */
  const shafts = [8, 20, 32];
  for (let s = 0; s < shafts.length; s++) {
    const sz = shafts[s];
    const sx = s % 2 === 0 ? MID : MID;
    carveRun(sx, 0, sz, sx, GY - 1, sz);
    // Upper and lower galleries running off each shaft.
    carveRun(sx - 2, 2, sz, sx + 2, 2, sz);
    carveRun(sx - 2, 0, sz, sx + 2, 0, sz);
  }

  /* Upper and lower spines, shorter than the main one, so the alternate
   * levels are routes rather than dead ends. */
  carveRun(MID, 2, 8, MID, 2, 32);
  carveRun(MID, 0, 8, MID, 0, 32);

  /* One wall face. `outer` means nothing lies beyond it, so it gets a
   * window: the inside of a maze should read as solid, and the hull
   * should look out at space. Two courses, since a level is 2 walls tall. */
  function placeWall(wx: number, wy: number, wz: number, yaw: number,
                     outer: boolean, variant: number): void {
    const kind = variant % 6;
    /* One course per SCALE of level height, so raising WALL_COURSES makes
     * the tunnels taller without leaving a gap between the top course and
     * the ceiling. */
    for (let c = 0; c < WALL_COURSES; c++) {
      const cy = wy + c * SCALE;
      if (outer && (kind === 2 || kind === 4) && c < 2) {
        place(wallWindow, wx, cy, wz, yaw, 1);
      } else if (kind === 0) {
        place(wallPillar, wx, cy, wz, yaw, 1);
      } else if (outer && kind === 3 && c === 0) {
        place(wallBanner, wx, cy, wz, yaw, 1);
      } else {
        place(wall, wx, cy, wz, yaw, 1);
      }
    }
  }

  /* ---- geometry from the grid ----
   *
   * One pass: for every open cell, floor below, ceiling above, and a wall
   * on each of the four sides that faces a closed cell. A cell with an
   * open neighbour gets nothing there, which is what leaves the branches
   * connected. */

  for (let y = 0; y < GY; y++) {
    for (let z = 0; z < GZ; z++) {
      for (let x = 0; x < GX; x++) {
        if (!isOpen(x, y, z)) continue;
        const wx = cellX(x);
        const wy = cellY(y);
        const wz = cellZ(z);

        // Floor, unless the cell below is also open (then it is a shaft).
        if (!isOpen(x, y - 1, z)) {
          if (rand() < 0.14) place(floorDetail, wx, wy, wz, 0, 1);
          else place(floor, wx, wy, wz, 0, 1);
        }
        // Ceiling, unless the cell above is open.
        if (!isOpen(x, y + 1, z)) {
          placeRolled(ceiling, wx, wy + LEVEL_H, wz, 0, 1, Math.PI);
        }

        /* Side walls. Windows on the OUTER hull only (a wall with nothing
         * beyond it), so the inside of the maze stays solid and the edges
         * look out at space. */
        const half = CELL * 0.5;
        if (!isOpen(x - 1, y, z)) {
          const outer = x === 0;
          placeWall(wx - half, wy, wz, Math.PI / 2, outer, z);
        }
        if (!isOpen(x + 1, y, z)) {
          const outer = x === GX - 1;
          placeWall(wx + half, wy, wz, -Math.PI / 2, outer, z);
        }
        if (!isOpen(x, y, z - 1)) {
          placeWall(wx, wy, wz + half, 0, z === 0, x);
        }
        if (!isOpen(x, y, z + 1)) {
          placeWall(wx, wy, wz - half, Math.PI, z === GZ - 1, x);
        }
      }
    }
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

  const cellPX: number[] = [];
  const cellPY: number[] = [];
  const cellPZ: number[] = [];
  const cellAlive: boolean[] = [];
  const cellMesh: Mesh[] = [];
  const cellHalo: Sprite[] = [];

  /* Cells sit at the END of each branch and on the alternate LEVELS, so
   * collecting them all means actually flying the maze: down every side
   * passage and up and down every shaft. A line of pickups along the
   * spine would just be "hold forward". */
  const spots: number[] = [
    // x, y, z in GRID coordinates
    1, 1, 5,          GX - 2, 1, 12,
    1, 1, 19,         GX - 2, 1, 26,
    1, 1, 33,
    MID, 2, 8,        MID, 2, 20,     MID, 2, 32,
    MID, 0, 20,
  ];
  for (let i = 0; i < CELL_COUNT; i++) {
    const gx = spots[i * 3];
    const gy = spots[i * 3 + 1];
    const gz = spots[i * 3 + 2];
    const cx = cellX(gx);
    const cy = cellY(gy) + FLOOR_TOP + 1.4;
    const cz = cellZ(gz);
    cellPX.push(cx);
    cellPY.push(cy);
    cellPZ.push(cz);
    cellAlive.push(true);

    const m = new Mesh(new BoxGeometry(0.7, 0.7, 0.7), cellMat);
    m.position.set(cx, cy, cz);
    scene.add(m);
    cellMesh.push(m);

    const halo = new Sprite(cellHaloMat);
    halo.scale.set(3.2, 3.2, 1);
    halo.position.set(cx, cy, cz);
    scene.add(halo);
    cellHalo.push(halo);
  }

  /* ---- the escape pod ----
   *
   * At the FAR end, so the whole run is a commitment: every cell you take
   * is distance you still have to cover coming back to nothing. */
  /* The pod sits at the FAR end of the spine, on the middle level. */
  const podX = cellX(MID);
  const podY = cellY(1);
  const podZ = cellZ(GZ - 2);
  const podMat = new MeshBasicMaterial(0xffd25a);
  podMat.transparent = true;
  podMat.opacity = 0.75;
  podMat.blending = AdditiveBlending;
  podMat.depthWrite = false;
  const pod = new Mesh(new BoxGeometry(2.6 * SCALE, 0.08, 2.6 * SCALE), podMat);
  pod.position.set(podX, podY + FLOOR_TOP + 0.05, podZ);
  scene.add(pod);

  const podLight = new PointLight(0xffd25a, 3.2, 18, 1);
  podLight.position.set(podX, podY + FLOOR_TOP + 2.5, podZ);
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
  playerShip.scale.set(0.95, 0.95, 0.95);
  playerShip.position.set(0, 0, 0);
  scene.add(playerShip);

  /* Its own light: the far end of the corridor is the darkest part of the
   * level, and an unlit ship there is a silhouette rather than a goal. */
  const shipLight = new PointLight(0x9fd0ff, 4.5, 26, 1);
  shipLight.position.set(podX, podY + FLOOR_TOP + 5, podZ + 5);
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
  /* The maze is now nine cells wide, three levels tall and forty deep,
   * with five branches and three shafts. 45s was tuned for a straight
   * corridor and is not survivable here. */
  const START_AIR = 110;
  const AIR_PER_CELL = 18;
  let air = START_AIR;
  let collected = 0;
  let won = false;
  let lost = false;
  let endTime = 0;


  let touring = true;
  let restartHeld = false;
  /** Seconds since the run began; drives every animation phase. */
  let elapsed = 0;

  /* Is a sphere around this point clear of walls?
   *
   * Tested against the SAME `open` grid the geometry was built from, so
   * collision can never disagree with what is drawn. The radius keeps the
   * hull off the wall rather than letting it clip halfway in. */
  /* The camera needs LESS clearance than the hull: it is a point, and
   * demanding ship-sized room would jam it against the ship in every
   * corridor. */
  function camClear(x: number, y: number, z: number): boolean {
    const gx = Math.floor(x / CELL + MID + 0.5);
    const gy = Math.floor(y / LEVEL_H);
    const gz = Math.floor(-z / CELL + 0.5);
    return isOpen(gx, gy, gz);
  }

  const SHIP_R = 1.5;
  function flyable(x: number, y: number, z: number): boolean {
    // Grid coordinates of the extremes of the ship's bounding sphere.
    const gx0 = Math.floor((x - SHIP_R) / CELL + MID + 0.5);
    const gx1 = Math.floor((x + SHIP_R) / CELL + MID + 0.5);
    const gy0 = Math.floor((y - SHIP_R) / LEVEL_H);
    const gy1 = Math.floor((y + SHIP_R) / LEVEL_H);
    const gz0 = Math.floor((-z - SHIP_R) / CELL + 0.5);
    const gz1 = Math.floor((-z + SHIP_R) / CELL + 0.5);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          if (!isOpen(gx, gy, gz)) return false;
        }
      }
    }
    return true;
  }

  const keys: string[] = [];
  function down(k: string): boolean { return keys.indexOf(k) >= 0; }

  function restart(): void {
    air = START_AIR;
    collected = 0;
    won = false;
    lost = false;
    shipX = 0;
    shipY = cellY(1) + LEVEL_H * 0.5;
    shipZ = -3.5 * CELL;
    velX = 0; velY = 0; velZ = 0;
    shipYaw = Math.PI;
    shipPitch = 0;
    bank = 0;
    camX = shipX; camY = shipY + 2.4; camZ = shipZ + 7.5;
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
    /** Nose up/down. */
    let pitch = 0;
    /** Thrust straight up/down, independent of where the nose points:
     * this is what makes a vertical shaft flyable. */
    let lift = 0;
    let firing = false;
    const run = down("Shift") ? 2.1 : 1;

    if (down("w") || down("W") || down("ArrowUp")) fwd += 1;
    if (down("s") || down("S") || down("ArrowDown")) fwd -= 1;
    if (down("a") || down("A") || down("ArrowLeft")) turn += 1;
    if (down("d") || down("D") || down("ArrowRight")) turn -= 1;
    if (down("q") || down("Q")) strafe -= 1;
    if (down("e") || down("E")) strafe += 1;
    // Up and down: the axis a walking game did not have.
    if (down(" ") || down("r") || down("R")) lift += 1;
    if (down("Control") || down("f") || down("F")) lift -= 1;
    if (down("i") || down("I")) pitch += 1;
    if (down("k") || down("K")) pitch -= 1;
    if (down("z") || down("Z") || down("Enter")) firing = true;

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
      /* Right stick Y pitches the nose. Positive is DOWN on a gamepad, and
       * pitching the nose UP when the stick goes up is the inverted
       * convention flight games use. */
      const ry = pad.axes.length > 3 ? pad.axes[3] : 0;
      if (ry > DEADZONE || ry < -DEADZONE) { pitch -= ry; touring = false; }

      /* Triggers climb and dive. A vertical shaft needs an axis that does
       * not depend on where the nose is pointing. */
      if (pad.buttons.length > BTN_R2) {
        const lt = pad.buttons[BTN_L2].value;
        const rt = pad.buttons[BTN_R2].value;
        if (rt > 0.1) { lift += rt; touring = false; }
        if (lt > 0.1) { lift -= lt; touring = false; }
      }

      // A or X fires.
      if (pad.buttons.length > BTN_X &&
          (pad.buttons[BTN_A].pressed || pad.buttons[BTN_X].pressed)) {
        firing = true;
        touring = false;
      }

      /* START (or A) restarts once the run is over. A gamepad player
       * should never have to reach for the keyboard to play again.
       *
       * Edge-triggered on the button going down: held across the frame
       * where the run ends, a level-triggered restart would fire
       * immediately and the player would never see the result screen. */
      if (won || lost) {
        const startDown = pad.buttons.length > BTN_START &&
                          pad.buttons[BTN_START].pressed;
        const aDown = pad.buttons.length > BTN_A && pad.buttons[BTN_A].pressed;
        const pressed = startDown || aDown;
        if (pressed && !restartHeld) {
          restartHeld = true;
          restart();
          break;
        }
        if (!pressed) restartHeld = false;
        break;   // no movement while the result screen is up
      }

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
      /* Attract mode: fly the spine so the demo shows itself off. */
      const span = (GZ - 6) * CELL;
      const tt = (elapsed * 0.06) % 2;
      shipZ = -3.5 * CELL - (tt < 1 ? tt : 2 - tt) * span;
      shipX = Math.sin(elapsed * 0.4) * CELL * 0.45;
      shipY = cellY(1) + LEVEL_H * 0.5 + Math.sin(elapsed * 0.3) * 1.2;
      shipYaw = Math.PI + Math.sin(elapsed * 0.25) * 0.22;
      shipPitch = Math.sin(elapsed * 0.19) * 0.12;
      velX = 0; velY = 0; velZ = 0;
      /* The attract mode shoots too, so an unattended demo shows the
       * weapon rather than a ship drifting silently. */
      const cpT = Math.cos(shipPitch);
      fireCooldown -= dt;
      if (fireCooldown <= 0) {
        fireCooldown = 0.22;
        fire(Math.sin(shipYaw) * cpT, Math.sin(shipPitch),
             Math.cos(shipYaw) * cpT, -Math.cos(shipYaw), Math.sin(shipYaw));
      }
    } else {
      /* ---- 6DOF FLIGHT ----
       *
       * Descent's model: you are a ship, not a walker. Thrust accelerates
       * along the hull's own axes, momentum carries you, and drag is the
       * only thing that stops you. Directly setting a position from input
       * is what makes a flying game feel like a cursor.
       */
      shipYaw += turn * dt * 1.9;
      shipPitch += pitch * dt * 1.5;
      // Stop short of straight up/down: past vertical the roll flips.
      const maxPitch = 1.25;
      if (shipPitch > maxPitch) shipPitch = maxPitch;
      if (shipPitch < -maxPitch) shipPitch = -maxPitch;

      /* The hull's basis. Forward is yaw+pitch; right is the horizontal
       * perpendicular (a ship banking should not change which way "right"
       * thrust pushes); up is right x forward. */
      const cp = Math.cos(shipPitch);
      const fx = Math.sin(shipYaw) * cp;
      const fy = Math.sin(shipPitch);
      const fz = Math.cos(shipYaw) * cp;
      const rx = -Math.cos(shipYaw);
      const rz = Math.sin(shipYaw);

      const thrust = 26 * run;
      velX += (fx * fwd + rx * strafe) * thrust * dt;
      /* Vertical gets its OWN, stronger thrust. At the shared value the
       * climb rate lost to drag almost immediately and the ship felt
       * pinned at whatever height it was already at -- shafts were
       * unusable. */
      velY += (fy * fwd * thrust + lift * thrust * 1.8) * dt;
      velZ += (fz * fwd + rz * strafe) * thrust * dt;

      /* Exponential drag: v *= k^dt behaves the same at 30 and 144 fps,
       * unlike v -= v*k*dt. Loose enough that momentum is real, tight
       * enough that a corridor is flyable. */
      const damp = Math.pow(0.06, dt);
      velX *= damp;
      velY *= damp;
      velZ *= damp;

      const sp = Math.sqrt(velX * velX + velY * velY + velZ * velZ);
      const MAX_SPEED = 17 * run;
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        velX *= k; velY *= k; velZ *= k;
      }

      /* Move one axis at a time and cancel that axis on a hit: sliding
       * along a wall instead of stopping dead is the difference between a
       * tunnel that is fun to fly and one that snags on every corner. */
      const nx = shipX + velX * dt;
      if (flyable(nx, shipY, shipZ)) shipX = nx; else velX = -velX * 0.25;
      const ny = shipY + velY * dt;
      if (flyable(shipX, ny, shipZ)) shipY = ny; else velY = -velY * 0.25;
      const nz = shipZ + velZ * dt;
      if (flyable(shipX, shipY, nz)) shipZ = nz; else velZ = -velZ * 0.25;

      // Bank into the turn: a ship that yaws without rolling reads as a cursor.
      bank += (-turn * 0.5 - bank) * Math.min(1, dt * 6);

      /* Fire on a cooldown rather than per frame: at 500fps an
       * uncooled trigger empties the whole pool in one tick and the
       * bolts arrive as a single blob. */
      fireCooldown -= dt;
      if (firing && fireCooldown <= 0 && !won && !lost) {
        fireCooldown = 0.11;
        fire(fx, fy, fz, rx, rz);
      }
    }

    /* ---- the ship, and a chase camera ----
     *
     * Third person, because the whole point is seeing your ship. The
     * camera trails on a spring rather than rigidly: a hard-mounted
     * camera transmits every collision jolt straight to the player's eye
     * and is unreadable in a tight tunnel. */
    playerShip.position.set(shipX, shipY, shipZ);
    playerShip.quaternion.setFromEuler(-shipPitch, shipYaw + Math.PI, 0);
    _bankQ.setFromAxisAngle(_fwdAxis, bank);
    playerShip.quaternion.multiply(_bankQ);

    const cpz = Math.cos(shipPitch);
    const camBackX = -Math.sin(shipYaw) * cpz;
    const camBackY = -Math.sin(shipPitch);
    const camBackZ = -Math.cos(shipYaw) * cpz;
    /* A 6m-tall tunnel leaves very little room above the ship: at
     * CAM_UP 2.4 the camera sat 0.4m under the ceiling and spent most of
     * the flight INSIDE the roof slab, which is why the view was dark and
     * full of wall. Just above the hull is enough to see over it. */
    /* A space shooter puts your ship LOW AND CLOSE, filling the bottom of
     * the frame, with the level above and ahead of it. 6m back reads as a
     * racing chase-cam and pushes the ship into the middle distance. */
    const CAM_DIST = 4.2;
    const CAM_UP = 1.0;
    const wantX = shipX + camBackX * CAM_DIST;
    const wantY = shipY + camBackY * CAM_DIST + CAM_UP;
    const wantZ = shipZ + camBackZ * CAM_DIST;
    /* PULL THE CAMERA IN until it is inside the tunnel.
     *
     * A chase camera with no collision passes straight through walls: at
     * 3.4m back it spent every turn outside the corridor, slicing the
     * geometry open and showing three tunnels at once. Marching from the
     * ship outwards and stopping at the last clear position keeps it in
     * the room the player is in, and naturally tightens the view in a
     * narrow passage -- which is what a space shooter wants anyway.
     *
     * This is also why the game does not need a physics engine: the world
     * is an axis-aligned grid, so "is this point inside a wall" is an
     * array lookup, not a collision query. */
    let fitX = wantX;
    let fitY = wantY;
    let fitZ = wantZ;
    for (let s = 0; s < 6; s++) {
      const k = 1 - s * 0.16;
      fitX = shipX + (wantX - shipX) * k;
      fitY = shipY + (wantY - shipY) * k;
      fitZ = shipZ + (wantZ - shipZ) * k;
      if (camClear(fitX, fitY, fitZ)) break;
    }

    const follow = Math.min(1, dt * 10);
    camX += (fitX - camX) * follow;
    camY += (fitY - camY) * follow;
    camZ += (fitZ - camZ) * follow;

    /* The headlight leads the ship slightly, so the tunnel ahead is lit
     * before you reach it rather than behind you after you pass. */
    headlight.position.set(shipX - camBackX * 5, shipY - camBackY * 5 + 1,
                           shipZ - camBackZ * 5);

    camera.position.set(camX, camY, camZ);
    /* Aim WELL ahead of the ship, so the hull sits low in the frame and
     * the tunnel you are flying into fills it. Looking at the ship itself
     * puts a model in the middle of the screen and hides the level. */
    /* Aim high and far ahead: this drops the hull into the lower third of
     * the frame and fills the rest with where you are going. */
    /* Straight down the flight axis, with only a small lift. Aiming
     * well above it pitches the camera down and fills the frame with the
     * floor immediately ahead instead of the tunnel. */
    _look.set(shipX - camBackX * 20, shipY - camBackY * 20 + 0.9,
              shipZ - camBackZ * 20);
    camera.lookAt(_look);

    /* Lamps travel the corridor at a constant spacing, so the walker is
     * always moving between pools of warm light rather than through flat
     * illumination. */
    for (let i = 0; i < lamps.length; i++) {
      const lz = -(((elapsed * 3.6 + i * 6.5 * SCALE) %
                     ((HALL_LEN + 6) * SCALE)) - 3 * SCALE);
      /* Hung well below the ceiling, not just under it. At 1.1m below a
       * 6m roof the tile directly above each lamp saturated to pure white
       * while the rest of the ceiling sat at (20,27,46) -- nearly black.
       * Lower is both more even and more useful: it lights the floor the
       * player is actually walking on. */
      lamps[i].position.set(Math.sin(elapsed * 0.4 + i) * 1.6,
                            WALL_H * 2 - 2.4, lz);
    }

    /* ---- game logic ---- */
    if (!won && !lost) {
      air -= dt;

      // Cell pickup: a generous radius, because a precise one in a
      // first-person view reads as the pickup being broken.
      for (let i = 0; i < CELL_COUNT; i++) {
        if (!cellAlive[i]) continue;
        const dx = cellPX[i] - shipX;
        const dy = cellPY[i] - shipY;
        const dz = cellPZ[i] - shipZ;
        // A sphere, not a circle: cells sit on three different levels.
        if (dx * dx + dy * dy + dz * dz < 3.4 * 3.4) {
          cellAlive[i] = false;
          cellMesh[i].visible = false;
          cellHalo[i].visible = false;
          collected += 1;
          air += AIR_PER_CELL;
          sparks.burst(cellPX[i], cellPY[i], cellPZ[i], 26, cellBurst);
          if (hasAudio) pickup(audio, 0.4);
        }
      }

      // The pod only counts once every cell is aboard.
      const dpx = shipX - podX;
      const dpz = shipZ - podZ;
      if (collected >= CELL_COUNT &&
          dpx * dpx + dpz * dpz < 5 * 5) {
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
      const y = cellPY[i] + Math.sin(elapsed * 2.2 + i) * 0.2;
      cellMesh[i].position.set(cellPX[i], y, cellPZ[i]);
      cellMesh[i].quaternion.setFromEuler(0, elapsed * 1.3 + i, 0.4);
      cellHalo[i].position.set(cellPX[i], y, cellPZ[i]);
      const pulse = 2.4 * (1 + Math.sin(elapsed * 4 + i) * 0.13);
      cellHalo[i].scale.set(pulse, pulse, 1);
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

    /* ---- bolts ----
     *
     * They fly, they fade, they light what they pass, and they hit
     * nothing. The light intensity follows the remaining life so a bolt
     * dims out rather than snapping off. */
    for (let i = 0; i < BOLT_COUNT; i++) {
      if (boltLife[i] <= 0) continue;
      boltLife[i] = boltLife[i] - dt;   // a[i] -= v is SC1090
      if (boltLife[i] <= 0) {
        boltMesh[i].visible = false;
        boltLight[i].intensity = 0;
        continue;
      }
      boltX[i] = boltX[i] + boltVX[i] * dt;
      boltY[i] = boltY[i] + boltVY[i] * dt;
      boltZ[i] = boltZ[i] + boltVZ[i] * dt;

      boltMesh[i].position.set(boltX[i], boltY[i], boltZ[i]);
      /* Point the streak along its own velocity, so a bolt fired while
       * turning still looks like it is going where it is going. */
      const bs = Math.sqrt(boltVX[i] * boltVX[i] + boltVY[i] * boltVY[i] +
                           boltVZ[i] * boltVZ[i]);
      if (bs > 0.001) {
        const byaw = Math.atan2(boltVX[i], boltVZ[i]);
        const bpit = Math.asin(Math.max(-1, Math.min(1, boltVY[i] / bs)));
        boltMesh[i].quaternion.setFromEuler(-bpit, byaw, 0);
      }

      const f = boltLife[i] / 0.85;
      boltLight[i].position.set(boltX[i], boltY[i], boltZ[i]);
      boltLight[i].intensity = 3.4 * f;
    }

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
  /* Pinned along the camera's ACTUAL view axis. The chase camera now aims
   * far ahead of the ship, so a HUD placed on the old axis ended up
   * outside the frustum and vanished. */
  hud.position.addScaledVector(_fwd, 2.4);
  hud.position.addScaledVector(_up, 0.86);
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
    ctx.fillText("ENTER or START to try again", 256, 232);
  }
}

const _bankQ = new Quaternion();
/* Bank is a roll about the ship's OWN forward axis. */
const _fwdAxis = new Vector3(0, 0, 1);
const _fwd = new Vector3();
const _up = new Vector3();
const _pos = new Vector3();
const _scl = new Vector3(1, 1, 1);
const _rot = new Quaternion();
const _look = new Vector3();
